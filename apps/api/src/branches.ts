import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, sql, Scope, type Row } from '../../../packages/database/src/index.js';
import { assignSlug } from '../../../packages/database/src/slugs.js';
import { ensure, permissions, hash, canonical } from '../../../packages/shared/src/index.js';
import { pageFields, sqlPage } from './pagination.js';
export async function assertBranchAdmin(s: Scope) {
  const [member] = await rows(
    s.tx,
    sql`SELECT tm.is_account_admin FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id JOIN tenants t ON t.id=tm.tenant_id WHERE tm.tenant_id=${s.actor.tenantId} AND tm.user_id=${s.actor.id} AND tm.enabled=TRUE AND u.enabled=TRUE AND t.enabled=TRUE`,
  );
  ensure(
    s.actor.kind === 'STAFF' && member?.is_account_admin,
    'FORBIDDEN',
    'Apenas o administrador geral da conta pode gerenciar filiais e seus vínculos.',
    403,
  );
}
export async function availableBranches(s: Scope) {
  ensure(s.actor.kind === 'STAFF', 'FORBIDDEN', 'Acesso exclusivo da equipe.', 403);
  const [account] = await rows(
    s.tx,
    sql`SELECT t.name,tm.is_account_admin FROM tenants t JOIN tenant_memberships tm ON tm.tenant_id=t.id WHERE t.id=${s.actor.tenantId} AND t.enabled=TRUE AND tm.user_id=${s.actor.id} AND tm.enabled=TRUE`,
  );
  ensure(account, 'FORBIDDEN', 'Conta indisponível.', 403);
  return {
    current_id: s.actor.establishmentId,
    account_name: account.name,
    can_manage: Boolean(account.is_account_admin),
    branches: (
      await rows(
        s.tx,
        sql`SELECT e.id,e.name,e.slug,r.name role_name,p.icon_revision FROM establishments e JOIN staff_memberships m ON m.tenant_id=e.tenant_id AND m.establishment_id=e.id AND m.user_id=${s.actor.id} AND m.enabled=TRUE JOIN roles r ON r.tenant_id=m.tenant_id AND r.establishment_id=m.establishment_id AND r.id=m.role_id LEFT JOIN establishment_pwa_settings p ON p.tenant_id=e.tenant_id AND p.establishment_id=e.id WHERE e.tenant_id=${s.actor.tenantId} ORDER BY e.name,e.id`,
      )
    ).map((branch) => ({
      ...branch,
      icon_url: branch.icon_revision
        ? `/pwa/assets/${branch.id}/${branch.icon_revision}/192.png`
        : null,
    })),
  };
}
export async function createBranch(s: Scope, name: string) {
  await assertBranchAdmin(s);
  const id = randomUUID();
  await s.tx.execute(
    sql`INSERT INTO establishments(id,tenant_id,name,slug,opening_hours) VALUES(${id},${s.actor.tenantId},${name},${id},${JSON.stringify({ daily: 'Consultar estabelecimento' })})`,
  );
  const address = await assignSlug(s.tx, s.actor.tenantId, id, name);
  const target = new Scope(s.tx, { ...s.actor, establishmentId: id });
  const profiles: Record<string, readonly string[]> = {
    Administrador: permissions,
    Garçom: [
      'table.view',
      'order.create',
      'order.postpaid',
      'ticket.view',
      'ticket.redeem',
      'table.release',
      'payment.receive',
    ],
    Caixa: [
      'table.view',
      'order.create',
      'order.postpaid',
      'order.cancel',
      'ticket.view',
      'ticket.reprint',
      'payment.receive',
      'payment.refund',
      'cash.manage',
    ],
    Cozinha: ['production.manage', 'ticket.view'],
  };
  let administrator = '';
  for (const [name, codes] of Object.entries(profiles)) {
    const role = await target.insert('roles', { name });
    if (name === 'Administrador') administrator = role.id;
    for (const code of codes) {
      const [permission] = await rows(s.tx, sql`SELECT id FROM permissions WHERE code=${code}`);
      ensure(permission, 'INVALID_STATE', 'Permissões não provisionadas.');
      await target.insert('role_permissions', { role_id: role.id, permission_id: permission.id });
    }
  }
  await target.insert('staff_memberships', { user_id: s.actor.id, role_id: administrator });
  const area = await target.insert('areas', { name: 'Salão principal' });
  await target.insert('dining_tables', {
    area_id: area.id,
    number: '01',
    public_code: randomUUID(),
    capacity: 4,
  });
  await target.insert('stock_locations', { name: 'Estoque principal', is_default: true });
  await target.insert('cash_registers', { name: 'Caixa principal' });
  await s.audit('establishment.created', id, { name, slug: address.slug });
  await s.event('branches.updated', s.actor.establishmentId, { establishment_id: id });
  return { id, name, slug: address.slug };
}
const userQuery = z
  .object({ ...pageFields, search: z.string().trim().max(120).default('') })
  .strict();
export async function accountUsers(s: Scope, raw: unknown) {
  await assertBranchAdmin(s);
  const query = userQuery.parse(raw);
  const source = sql`SELECT u.id,u.name,u.email,u.enabled,tm.is_account_admin FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id=${s.actor.tenantId} AND tm.enabled=TRUE`;
  const search = '%' + query.search.replace(/[!%_]/g, (value) => '!' + value) + '%';
  const result = await sqlPage(
    s.tx,
    source,
    query.search
      ? sql`(name LIKE ${search} ESCAPE '!' OR email LIKE ${search} ESCAPE '!')`
      : sql`1=1`,
    sql`name,id`,
    query,
  );
  const ids = result.rows.map((row) => row.id);
  const memberships = ids.length
    ? await rows(
        s.tx,
        sql`SELECT m.user_id,e.id,e.name,r.name role_name FROM staff_memberships m JOIN establishments e ON e.tenant_id=m.tenant_id AND e.id=m.establishment_id JOIN roles r ON r.tenant_id=m.tenant_id AND r.establishment_id=m.establishment_id AND r.id=m.role_id WHERE m.tenant_id=${s.actor.tenantId} AND m.enabled=TRUE AND m.user_id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`,`,
        )}) ORDER BY e.name,e.id`,
      )
    : [];
  return {
    ...result,
    rows: result.rows.map((user) => ({
      ...user,
      branches: memberships
        .filter((member) => member.user_id === user.id)
        .map(({ user_id: _user, ...branch }) => branch),
    })),
  };
}
export async function userBranches(
  s: Scope,
  userId: string,
): Promise<{
  user: Row;
  version: string;
  current_id: string;
  branches: (Row & { roles: Row[] })[];
}> {
  await assertBranchAdmin(s);
  const [user] = await rows(
    s.tx,
    sql`SELECT u.id,u.name,u.email,u.enabled,tm.is_account_admin FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id=${s.actor.tenantId} AND tm.enabled=TRUE AND u.id=${userId}`,
  );
  ensure(user, 'NOT_FOUND', 'Usuário não encontrado nesta conta.', 404);
  const units = await rows(
    s.tx,
    sql`SELECT e.id,e.name,e.slug,m.id membership_id,m.role_id,m.enabled FROM establishments e LEFT JOIN staff_memberships m ON m.tenant_id=e.tenant_id AND m.establishment_id=e.id AND m.user_id=${userId} WHERE e.tenant_id=${s.actor.tenantId} ORDER BY e.name,e.id`,
  );
  const roles = await rows(
    s.tx,
    sql`SELECT id,establishment_id,name FROM roles WHERE tenant_id=${s.actor.tenantId} ORDER BY name,id`,
  );
  return {
    user,
    version: hash(
      canonical(
        units
          .map((unit) => ({
            id: unit.id,
            membership_id: unit.membership_id ?? null,
            role_id: unit.role_id ?? null,
            enabled: Boolean(unit.enabled),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    ),
    current_id: s.actor.establishmentId,
    branches: units.map((unit) => ({
      ...unit,
      roles: roles.filter((role) => role.establishment_id === unit.id),
    })),
  };
}
export const branchAssignmentsSchema = z
  .object({
    expected_version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    branches: z
      .array(z.object({ establishment_id: z.uuid(), role_id: z.uuid() }).strict())
      .max(100),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.branches.map((branch) => branch.establishment_id)).size ===
      value.branches.length,
    'Filiais duplicadas.',
  );
export async function updateUserBranches(
  s: Scope,
  userId: string,
  input: z.infer<typeof branchAssignmentsSchema>,
) {
  const context = await userBranches(s, userId);
  ensure(
    !input.expected_version || input.expected_version === context.version,
    'CONFLICT',
    'Os vínculos foram alterados por outro administrador. Atualize os dados antes de salvar.',
    409,
  );
  const assignments = new Map(
    input.branches.map((branch) => [branch.establishment_id, branch.role_id]),
  );
  for (const branch of input.branches) {
    const unit = context.branches.find((unit) => unit.id === branch.establishment_id);
    ensure(
      unit && unit.roles.some((role: Row) => role.id === branch.role_id),
      'NOT_FOUND',
      'Filial ou perfil não encontrado nesta conta.',
      404,
    );
  }
  const current = context.branches.find((unit) => unit.id === s.actor.establishmentId)!;
  ensure(
    userId !== s.actor.id || assignments.get(current.id) === current.role_id,
    'INVALID_STATE',
    'Seu acesso e perfil na filial atual devem ser preservados.',
  );
  for (const branch of context.branches) {
    const roleId = assignments.get(branch.id);
    if (branch.enabled && !roleId && context.user.is_account_admin) {
      const [other] = await rows(
        s.tx,
        sql`SELECT m.id FROM staff_memberships m JOIN tenant_memberships tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id AND tm.enabled=TRUE AND tm.is_account_admin=TRUE JOIN users u ON u.id=m.user_id AND u.enabled=TRUE WHERE m.tenant_id=${s.actor.tenantId} AND m.establishment_id=${branch.id} AND m.enabled=TRUE AND m.user_id<>${userId} LIMIT 1`,
      );
      ensure(
        other,
        'INVALID_STATE',
        'A filial ' + branch.name + ' precisa manter ao menos um administrador geral com acesso.',
      );
    }
    if (branch.membership_id) {
      if (Boolean(branch.enabled) === Boolean(roleId) && (!roleId || roleId === branch.role_id))
        continue;
      await s.tx.execute(
        sql`UPDATE staff_memberships SET enabled=${Boolean(roleId)},role_id=${roleId ?? branch.role_id} WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${branch.id} AND id=${branch.membership_id}`,
      );
    } else if (roleId) {
      await new Scope(s.tx, { ...s.actor, establishmentId: branch.id }).insert(
        'staff_memberships',
        { user_id: userId, role_id: roleId },
      );
    } else continue;
    // Removed grants must not revive when a membership is subsequently re-enabled.
    await s.tx.execute(
      sql`UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${branch.id} AND user_id=${userId} AND revoked_at IS NULL`,
    );
    await new Scope(s.tx, { ...s.actor, establishmentId: branch.id }).event(
      'staff.membership_updated',
      userId,
      {},
    );
  }
  await s.audit('staff.branches_updated', userId, { branches: input.branches });
  return { user_id: userId, branches: input.branches };
}
