import {
  availableBranches,
  createBranch,
  accountUsers,
  userBranches,
  updateUserBranches,
  branchAssignmentsSchema,
} from './branches.js';
import type { HTTPMethods, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { provisionIn } from '../../../packages/database/src/provision.js';
import { ensure, type Permission } from '../../../packages/shared/src/index.js';
type Registrar = (
  method: HTTPMethods,
  path: string,
  permission: Permission | null,
  body: z.ZodType | null,
  handler: (s: Scope, input: any, req: FastifyRequest) => Promise<any>,
  mutation?: boolean,
) => void;
async function superadmin(s: Scope) {
  const user = await rows(
    s.tx,
    sql`SELECT is_superadmin FROM users WHERE id=${s.actor.id} AND enabled=TRUE`,
  );
  ensure(
    s.actor.kind === 'STAFF' && user[0]?.is_superadmin,
    'FORBIDDEN',
    'Acesso restrito ao administrador SaaS.',
    403,
  );
}
async function saasAudit(s: Scope, action: string, id: string, metadata: Row = {}) {
  await s.tx.execute(
    sql`INSERT INTO saas_audit_logs(id,actor_id,action,aggregate_id,metadata) VALUES(${randomUUID()},${s.actor.id},${action},${id},${JSON.stringify(metadata)})`,
  );
}
export async function registerSaas(route: Registrar) {
  route('GET', '/branches', null, null, async (s) => availableBranches(s));
  route('GET', '/establishments', null, null, async (s) => (await availableBranches(s)).branches);
  route(
    'POST',
    '/establishments',
    null,
    z.object({ name: z.string().trim().min(2).max(160) }).strict(),
    async (s, b) => createBranch(s, b.name),
  );
  route('GET', '/account/users', null, null, async (s, _b, req) => accountUsers(s, req.query));
  route('GET', '/account/users/:id/branches', null, null, async (s, _b, req) =>
    userBranches(s, z.uuid().parse((req.params as Row).id)),
  );
  route('PATCH', '/account/users/:id/branches', null, branchAssignmentsSchema, async (s, b, req) =>
    updateUserBranches(s, z.uuid().parse((req.params as Row).id), b),
  );
  route('GET', '/saas/me', null, null, async (s) => {
    await superadmin(s);
    const [user] = await rows(s.tx, sql`SELECT id,name,email FROM users WHERE id=${s.actor.id}`);
    return user;
  });
  route('GET', '/saas/overview', null, null, async (s) => {
    await superadmin(s);
    const [accounts] = await rows(
      s.tx,
      sql`SELECT COUNT(*) total,COALESCE(SUM(enabled=TRUE),0) active,COALESCE(SUM(enabled=FALSE),0) suspended FROM tenants WHERE is_platform=FALSE`,
    );
    const [units] = await rows(
      s.tx,
      sql`SELECT COUNT(*) total FROM establishments e JOIN tenants t ON t.id=e.tenant_id WHERE t.is_platform=FALSE`,
    );
    const [plans] = await rows(s.tx, sql`SELECT COUNT(*) total FROM plans`);
    return { ...accounts, establishments: units.total, plans: plans.total };
  });
  route('GET', '/saas/accounts', null, null, async (s, _b, req) => {
    await superadmin(s);
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        page_size: z.coerce.number().int().min(1).max(100).default(10),
        search: z.string().trim().max(160).default(''),
        status: z.enum(['all', 'active', 'suspended']).default('all'),
      })
      .strict()
      .parse(req.query);
    const filter = sql`t.is_platform=FALSE ${q.status === 'all' ? sql`` : sql`AND t.enabled=${q.status === 'active'}`} ${q.search ? sql`AND (t.name LIKE ${'%' + q.search + '%'} OR t.slug LIKE ${'%' + q.search + '%'} OR EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=t.id AND tm.is_account_admin=TRUE AND (u.name LIKE ${'%' + q.search + '%'} OR u.email LIKE ${'%' + q.search + '%'})))` : sql``}`;
    const [count] = await rows(s.tx, sql`SELECT COUNT(*) total FROM tenants t WHERE ${filter}`);
    const total = Number(count.total),
      page = Math.min(q.page, Math.max(1, Math.ceil(total / q.page_size)));
    const items = await rows(
      s.tx,
      sql`SELECT t.id,t.name,t.slug,t.enabled,t.created_at,
      (SELECT COUNT(*) FROM establishments e WHERE e.tenant_id=t.id) establishments,
      (SELECT u.email FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=t.id AND tm.is_account_admin=TRUE ORDER BY tm.created_at,tm.id LIMIT 1) owner_email,
      sub.id subscription_id,sub.status subscription_status,sub.valid_until,sub.plan_id,p.name plan_name,p.monthly_price
      FROM tenants t LEFT JOIN subscriptions sub ON sub.id=(SELECT x.id FROM subscriptions x WHERE x.tenant_id=t.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1)
      LEFT JOIN plans p ON p.id=sub.plan_id WHERE ${filter} ORDER BY t.created_at DESC,t.id LIMIT ${q.page_size} OFFSET ${(page - 1) * q.page_size}`,
    );
    return { items, total, page, page_size: q.page_size };
  });
  route('GET', '/saas/accounts/:id', null, null, async (s, _b, req) => {
    await superadmin(s);
    const id = z.uuid().parse((req.params as Row).id);
    const [account] = await rows(
      s.tx,
      sql`SELECT id,name,slug,enabled,created_at FROM tenants WHERE id=${id} AND is_platform=FALSE`,
    );
    ensure(account, 'NOT_FOUND', 'Conta não encontrada.', 404);
    const units = await rows(
      s.tx,
      sql`SELECT id,name,slug FROM establishments WHERE tenant_id=${id} ORDER BY name,id`,
    );
    const owners = await rows(
      s.tx,
      sql`SELECT u.name,u.email,u.enabled FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id=${id} AND tm.is_account_admin=TRUE ORDER BY u.name`,
    );
    const subscriptions = await rows(
      s.tx,
      sql`SELECT sub.*,p.name plan_name,p.monthly_price FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id WHERE sub.tenant_id=${id} ORDER BY sub.created_at DESC,sub.id DESC`,
    );
    return { ...account, units, owners, subscriptions };
  });
  route('GET', '/saas/tenants', null, null, async (s) => {
    await superadmin(s);
    return rows(
      s.tx,
      sql`SELECT id,name,slug,enabled,created_at FROM tenants WHERE is_platform=FALSE ORDER BY created_at DESC`,
    );
  });
  route(
    'POST',
    '/saas/tenants',
    null,
    z
      .object({
        name: z.string().min(2).max(160),
        owner_email: z.email(),
        owner_name: z.string().min(2).max(160),
        password: z.string().min(12).max(200),
      })
      .strict(),
    async (s, b) => {
      await superadmin(s);
      const result = await provisionIn(s.tx, b);
      await saasAudit(s, 'tenant.provisioned', result.tenant_id);
      return {
        tenant_id: result.tenant_id,
        establishment_id: result.establishment_id,
        user_id: result.user_id,
        slug: result.slug,
      };
    },
  );
  route(
    'PATCH',
    '/saas/tenants/:id',
    null,
    z.object({ enabled: z.boolean() }).strict(),
    async (s, b, req) => {
      await superadmin(s);
      const id = z.uuid().parse((req.params as Row).id);
      ensure(
        id !== s.actor.tenantId,
        'INVALID_STATE',
        'Não desative o próprio tenant de administração.',
      );
      const exists = await rows(
        s.tx,
        sql`SELECT id FROM tenants WHERE id=${id} AND is_platform=FALSE`,
      );
      ensure(exists.length, 'NOT_FOUND', 'Tenant inexistente.', 404);
      await s.tx.execute(sql`UPDATE tenants SET enabled=${b.enabled} WHERE id=${id}`);
      await saasAudit(s, 'tenant.status_updated', id, { enabled: b.enabled });
      return { id, enabled: b.enabled };
    },
  );
  route('GET', '/saas/plans', null, null, async (s) => {
    await superadmin(s);
    return rows(s.tx, sql`SELECT * FROM plans ORDER BY created_at DESC`);
  });
  route(
    'POST',
    '/saas/plans',
    null,
    z
      .object({
        name: z.string().min(2).max(80),
        monthly_price: z.string().regex(/^\d{1,12}\.\d{2}$/),
        limits_json: z.record(z.string(), z.number().int().positive()),
      })
      .strict(),
    async (s, b) => {
      await superadmin(s);
      const id = randomUUID();
      await s.tx.execute(
        sql`INSERT INTO plans(id,name,monthly_price,limits_json) VALUES(${id},${b.name},${b.monthly_price},${JSON.stringify(b.limits_json)})`,
      );
      await saasAudit(s, 'plan.created', id);
      return { id, ...b };
    },
  );
  route(
    'POST',
    '/saas/subscriptions',
    null,
    z
      .object({
        tenant_id: z.uuid(),
        plan_id: z.uuid(),
        status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED']),
        valid_until: z.iso.datetime(),
      })
      .strict(),
    async (s, b) => {
      await superadmin(s);
      const target = await rows(
        s.tx,
        sql`SELECT id FROM tenants WHERE id=${b.tenant_id} AND is_platform=FALSE`,
      );
      ensure(target.length, 'NOT_FOUND', 'Conta não encontrada.', 404);
      const id = randomUUID();
      await s.tx.execute(
        sql`INSERT INTO subscriptions(id,tenant_id,plan_id,status,valid_until) VALUES(${id},${b.tenant_id},${b.plan_id},${b.status},${new Date(b.valid_until)})`,
      );
      await saasAudit(s, 'subscription.created', id, { tenant_id: b.tenant_id });
      return { id, ...b };
    },
  );
  route(
    'PATCH',
    '/saas/subscriptions/:id',
    null,
    z
      .object({
        plan_id: z.uuid(),
        status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED']),
        valid_until: z.iso.datetime(),
      })
      .strict(),
    async (s, b, req) => {
      await superadmin(s);
      const id = z.uuid().parse((req.params as Row).id);
      const [current] = await rows(
        s.tx,
        sql`SELECT sub.* FROM subscriptions sub JOIN tenants t ON t.id=sub.tenant_id WHERE sub.id=${id} AND t.is_platform=FALSE FOR UPDATE`,
      );
      ensure(current, 'NOT_FOUND', 'Assinatura não encontrada.', 404);
      await s.tx.execute(
        sql`UPDATE subscriptions SET plan_id=${b.plan_id},status=${b.status},valid_until=${new Date(b.valid_until)} WHERE id=${id}`,
      );
      await saasAudit(s, 'subscription.updated', id, {
        tenant_id: current.tenant_id,
        previous_status: current.status,
        status: b.status,
        plan_id: b.plan_id,
      });
      return { id, ...b };
    },
  );
  route('GET', '/saas/subscriptions', null, null, async (s) => {
    await superadmin(s);
    return rows(s.tx, sql`SELECT * FROM subscriptions ORDER BY created_at DESC`);
  });
  route('GET', '/saas/audit-logs', null, null, async (s) => {
    await superadmin(s);
    return rows(
      s.tx,
      sql`SELECT l.*,u.name actor_name,COALESCE(t.name,p.name) target_name FROM saas_audit_logs l LEFT JOIN users u ON u.id=l.actor_id LEFT JOIN tenants t ON t.id=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.metadata,'$.tenant_id')),l.aggregate_id) LEFT JOIN plans p ON p.id=l.aggregate_id ORDER BY l.created_at DESC,l.id DESC LIMIT 200`,
    );
  });
  route('GET', '/observability/metrics', 'reports.view', null, async (s) => {
    const outbox = await rows(
      s.tx,
      sql`SELECT COUNT(*) pending,MIN(created_at) oldest_pending_at,MAX(attempts) max_attempts FROM outbox_events WHERE ${s.where(sql`published_at IS NULL`)}`,
    );
    const print = await rows(
      s.tx,
      sql`SELECT status,COUNT(*) count FROM print_jobs WHERE ${s.where()} GROUP BY status`,
    );
    return { outbox: outbox[0], printing: print };
  });
}
