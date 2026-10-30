import { db, sql, rows, view, type Row, Scope } from '../../../packages/database/src/index.js';
import {
  type Actor,
  ensure,
  hash,
  opaqueToken,
  verifyPassword,
  passwordHash,
  permissions,
} from '../../../packages/shared/src/index.js';
import { randomUUID } from 'node:crypto';
export async function authenticate(token: string): Promise<Actor> {
  ensure(token, 'UNAUTHORIZED', 'Autenticação necessária.', 401);
  const tokenHash = hash(token);
  const staff = await rows(
    db,
    sql`SELECT s.*, u.enabled user_enabled FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=${tokenHash} AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND t.enabled=TRUE`,
  );
  if (staff.length) {
    const session = staff[0];
    ensure(session.user_enabled, 'UNAUTHORIZED', 'Conta desativada.', 401);
    const memberships = await rows(
      db,
      sql`SELECT m.role_id,tm.is_account_admin FROM staff_memberships m JOIN tenant_memberships tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id WHERE m.tenant_id=${session.tenant_id} AND m.establishment_id=${session.establishment_id} AND m.user_id=${session.user_id} AND m.enabled=TRUE AND tm.enabled=TRUE`,
    );
    ensure(memberships.length, 'FORBIDDEN', 'Vínculo desativado.', 403);
    const grants = await rows(
      db,
      sql`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${session.tenant_id} AND rp.establishment_id=${session.establishment_id} AND rp.role_id=${memberships[0].role_id}`,
    );
    return {
      id: session.user_id,
      tenantId: session.tenant_id,
      establishmentId: session.establishment_id,
      kind: 'STAFF',
      isAccountAdmin: Boolean(memberships[0].is_account_admin),
      permissions: grants.map((g) => g.code),
    };
  }
  const visitors = await rows(
    db,
    sql`SELECT v.* FROM visitor_sessions v JOIN tenants t ON t.id=v.tenant_id WHERE v.token_hash=${tokenHash} AND v.expires_at>UTC_TIMESTAMP(3) AND t.enabled=TRUE`,
  );
  if (visitors.length) {
    const v = visitors[0];
    return {
      id: v.id,
      tenantId: v.tenant_id,
      establishmentId: v.establishment_id,
      kind: 'VISITOR',
      permissions: [],
      customerId: v.customer_id,
      tableId: v.table_id ?? undefined,
      serviceMode: v.service_mode,
      sessionId: v.session_id,
    };
  }
  const agents = await rows(
    db,
    sql`SELECT a.* FROM print_agents a JOIN tenants t ON t.id=a.tenant_id WHERE a.token_hash=${tokenHash} AND a.enabled=TRUE AND t.enabled=TRUE`,
  );
  if (agents.length)
    return {
      id: agents[0].id,
      tenantId: agents[0].tenant_id,
      establishmentId: agents[0].establishment_id,
      kind: 'AGENT',
      permissions: [],
    };
  throw Object.assign(new Error('Sessão inválida ou expirada.'), {
    code: 'UNAUTHORIZED',
    status: 401,
  });
}
export async function login(
  input: {
    email: string;
    password: string;
    establishment_slug: string;
  },
  expectedUnit?: string,
) {
  const matches = await rows(
    db,
    sql`SELECT u.*, e.id establishment_id, e.slug current_slug, e.tenant_id FROM users u JOIN staff_memberships sm ON sm.user_id=u.id JOIN establishments e ON e.id=sm.establishment_id AND e.tenant_id=sm.tenant_id JOIN tenant_slugs aliases ON aliases.establishment_id=e.id AND aliases.tenant_id=e.tenant_id JOIN tenants t ON t.id=e.tenant_id JOIN tenant_memberships tm ON tm.user_id=u.id AND tm.tenant_id=e.tenant_id WHERE u.email=${input.email.toLowerCase()} AND aliases.slug=${input.establishment_slug} AND sm.enabled=TRUE AND u.enabled=TRUE AND tm.enabled=TRUE AND t.enabled=TRUE`,
  );
  // Scrypt is also computed on unknown accounts to avoid a cheap enumeration path.
  const valid = verifyPassword(input.password, matches[0]?.password_hash ?? dummyPasswordHash);
  ensure(matches.length && valid, 'UNAUTHORIZED', 'Credenciais inválidas.', 401);
  const u = matches[0];
  ensure(
    !expectedUnit || u.establishment_id === expectedUnit,
    'FORBIDDEN',
    'Acesso de outro estabelecimento.',
    403,
  );
  const token = opaqueToken();
  const refresh = opaqueToken();
  const actor: Actor = {
    id: u.id,
    tenantId: u.tenant_id,
    establishmentId: u.establishment_id,
    kind: 'STAFF',
    permissions: [],
  };
  await view(actor).insert('staff_sessions', {
    user_id: u.id,
    token_hash: hash(token),
    refresh_hash: hash(refresh),
    expires_at: new Date(Date.now() + 30 * 60_000),
    refresh_expires_at: new Date(Date.now() + 7 * 86400_000),
  });
  return {
    token,
    refresh_token: refresh,
    expires_in: 1800,
    actor: await authenticate(token),
    name: u.name,
    slug: u.current_slug,
  };
}
/** Account entry points can route an employee to an assigned branch after authentication. */
export async function accountLogin(input: Parameters<typeof login>[0], expectedUnit?: string) {
  const [entry] = await rows(
    db,
    sql`SELECT e.id,e.tenant_id,
    (SELECT first_unit.id FROM establishments first_unit WHERE first_unit.tenant_id=e.tenant_id ORDER BY first_unit.created_at,first_unit.id LIMIT 1) primary_id
    FROM tenant_slugs a JOIN establishments e ON e.id=a.establishment_id AND e.tenant_id=a.tenant_id
    JOIN tenants t ON t.id=e.tenant_id AND t.enabled=TRUE AND t.is_platform=FALSE WHERE a.slug=${input.establishment_slug}`,
  );
  ensure(
    !expectedUnit || !entry || entry.id === expectedUnit,
    'FORBIDDEN',
    'Acesso de outro estabelecimento.',
    403,
  );
  if (entry && entry.id === entry.primary_id) {
    const [target] = await rows(
      db,
      sql`SELECT e.id,e.slug FROM users u
      JOIN staff_memberships sm ON sm.user_id=u.id AND sm.enabled=TRUE
      JOIN tenant_memberships tm ON tm.user_id=u.id AND tm.tenant_id=sm.tenant_id AND tm.enabled=TRUE
      JOIN establishments e ON e.id=sm.establishment_id AND e.tenant_id=sm.tenant_id
      WHERE u.email=${input.email.toLowerCase()} AND u.enabled=TRUE AND e.tenant_id=${entry.tenant_id}
      ORDER BY (e.id=${entry.id}) DESC,e.created_at,e.id LIMIT 1`,
    );
    if (target) return login({ ...input, establishment_slug: target.slug }, target.id);
  }
  return login(input, expectedUnit);
}
/** Issue a session scoped to an explicitly assigned branch; tokens never travel in URLs. */
export async function switchBranch(source: Actor, establishmentId: string) {
  ensure(source.kind === 'STAFF', 'FORBIDDEN', 'Acesso exclusivo da equipe.', 403);
  return db.transaction(
    async (tx) => {
      const [tenant] = await rows(
        tx,
        sql`SELECT id FROM tenants WHERE id=${source.tenantId} AND enabled=TRUE FOR SHARE`,
      );
      ensure(tenant, 'FORBIDDEN', 'Conta indisponível.', 403);
      const memberships = await rows(
        tx,
        sql`SELECT m.establishment_id,m.role_id,u.name,tm.is_account_admin,e.slug FROM staff_memberships m JOIN users u ON u.id=m.user_id AND u.enabled=TRUE JOIN tenant_memberships tm ON tm.user_id=u.id AND tm.tenant_id=m.tenant_id AND tm.enabled=TRUE JOIN establishments e ON e.id=m.establishment_id AND e.tenant_id=m.tenant_id WHERE m.tenant_id=${source.tenantId} AND m.user_id=${source.id} AND m.enabled=TRUE AND m.establishment_id IN (${source.establishmentId},${establishmentId})`,
      );
      ensure(
        memberships.some((member) => member.establishment_id === source.establishmentId),
        'FORBIDDEN',
        'Seu vínculo de origem está desativado.',
        403,
      );
      const target = memberships.find((member) => member.establishment_id === establishmentId);
      ensure(target, 'FORBIDDEN', 'Você não possui acesso a esta filial.', 403);
      const grants = await rows(
        tx,
        sql`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${source.tenantId} AND rp.establishment_id=${establishmentId} AND rp.role_id=${target.role_id}`,
      );
      const actor: Actor = {
        id: source.id,
        tenantId: source.tenantId,
        establishmentId,
        kind: 'STAFF',
        isAccountAdmin: Boolean(target.is_account_admin),
        permissions: grants.map((grant) => grant.code),
      };
      const token = opaqueToken(),
        refresh = opaqueToken();
      const s = new Scope(tx, actor);
      await s.insert('staff_sessions', {
        user_id: source.id,
        token_hash: hash(token),
        refresh_hash: hash(refresh),
        expires_at: new Date(Date.now() + 30 * 60_000),
        refresh_expires_at: new Date(Date.now() + 7 * 86400_000),
      });
      await s.audit('staff.branch_switched', establishmentId, {
        previous_establishment_id: source.establishmentId,
      });
      return {
        token,
        refresh_token: refresh,
        expires_in: 1800,
        actor,
        name: target.name,
        slug: target.slug,
      };
    },
    { isolationLevel: 'read committed' },
  );
}
const dummyPasswordHash = passwordHash(opaqueToken());
export async function rotate(refresh: string, expectedUnit?: string) {
  return db.transaction(async (tx) => {
    const sessions = await rows(
      tx,
      sql`SELECT * FROM staff_sessions WHERE refresh_hash=${hash(refresh)} AND revoked_at IS NULL AND refresh_expires_at>UTC_TIMESTAMP(3) FOR UPDATE`,
    );
    ensure(sessions.length, 'UNAUTHORIZED', 'Refresh inválido ou já utilizado.', 401);
    const s = sessions[0];
    ensure(
      !expectedUnit || s.establishment_id === expectedUnit,
      'FORBIDDEN',
      'Sessão de outro estabelecimento.',
      403,
    );
    const token = opaqueToken();
    const next = opaqueToken();
    await tx.execute(
      sql`UPDATE staff_sessions SET token_hash=${hash(token)}, refresh_hash=${hash(next)}, expires_at=${new Date(Date.now() + 30 * 60_000)} WHERE id=${s.id}`,
    );
    return { token, refresh_token: next, expires_in: 1800 };
  });
}
export async function logout(token: string) {
  await db.execute(
    sql`UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE token_hash=${hash(token)}`,
  );
  return { logged_out: true };
}
export async function createStaff(
  s: Scope,
  input: { name: string; email: string; password: string; role_id: string },
) {
  await assertAssignableRole(s, input.role_id);
  const existing = await rows(
    s.tx,
    sql`SELECT id FROM users WHERE email=${input.email.toLowerCase()}`,
  );
  ensure(
    !existing.length,
    'CONFLICT',
    'E-mail já cadastrado. Para um usuário desta conta, use Usuários e filiais na tela Equipe.',
  );
  const id = randomUUID();
  await s.tx.execute(
    sql`INSERT INTO users(id,name,email,password_hash) VALUES(${id},${input.name},${input.email.toLowerCase()},${passwordHash(input.password)})`,
  );
  await s.tx.execute(
    sql`INSERT INTO tenant_memberships(id,tenant_id,user_id) VALUES(${randomUUID()},${s.actor.tenantId},${id})`,
  );
  const membership = await s.insert('staff_memberships', { user_id: id, role_id: input.role_id });
  await s.audit('staff.created', membership.id, { role_id: input.role_id });
  return { id, membership_id: membership.id, name: input.name, email: input.email };
}
export function publicActor(unit: Row): Actor {
  return {
    id: unit.id,
    tenantId: unit.tenant_id,
    establishmentId: unit.id,
    kind: 'SYSTEM',
    permissions: [...permissions],
  };
}

export async function assertAssignableRole(s: Scope, roleId: string) {
  await s.get('roles', roleId);
  const grants = await rows(
    s.tx,
    sql`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${s.actor.tenantId} AND rp.establishment_id=${s.actor.establishmentId} AND rp.role_id=${roleId}`,
  );
  ensure(
    grants.every((g) => s.actor.permissions.includes(g.code)),
    'FORBIDDEN',
    'Você não pode atribuir um perfil com permissões superiores às suas.',
    403,
  );
}

/** Passwords are replaced deliberately; plaintext is never retrieved or returned. */
export async function resetStaffPassword(s: Scope, membershipId: string, password: string) {
  ensure(
    s.actor.isAccountAdmin,
    'FORBIDDEN',
    'Apenas o admin geral pode definir uma nova senha.',
    403,
  );
  const admins = await rows(
    s.tx,
    sql`SELECT id FROM tenant_memberships WHERE tenant_id=${s.actor.tenantId} AND user_id=${s.actor.id} AND enabled=TRUE AND is_account_admin=TRUE`,
  );
  ensure(admins.length, 'FORBIDDEN', 'Administração geral da conta necessária.', 403);
  const member = await s.get('staff_memberships', membershipId);
  ensure(
    member.user_id !== s.actor.id,
    'INVALID_STATE',
    'Use a senha conhecida para copiar seu próprio acesso.',
  );
  ensure(member.enabled, 'INVALID_STATE', 'Ative o funcionário antes de definir uma nova senha.');
  await assertAssignableRole(s, member.role_id);
  const otherAccounts = await rows(
    s.tx,
    sql`SELECT id FROM tenant_memberships WHERE user_id=${member.user_id} AND tenant_id<>${s.actor.tenantId}`,
  );
  ensure(
    !otherAccounts.length,
    'INVALID_STATE',
    'Usuário vinculado a outra conta. A senha deve ser alterada pelo próprio usuário.',
  );
  await s.tx.execute(
    sql`UPDATE users SET password_hash=${passwordHash(password)} WHERE id=${member.user_id}`,
  );
  await s.tx.execute(
    sql`UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=${member.user_id} AND tenant_id=${s.actor.tenantId} AND revoked_at IS NULL`,
  );
  await s.audit('staff.password_reset', member.id, { user_id: member.user_id });
  return { id: member.id, password_updated: true };
}
