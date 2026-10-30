import { staffAccessSurface } from '../../../packages/shared/src/access-links.js';
import { z } from 'zod';
import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { pageFields, sqlPage } from './pagination.js';
const query = z
  .object({
    ...pageFields,
    search: z.string().trim().max(120).default(''),
    role_id: z.uuid().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    sort: z.enum(['name', 'email', 'role_name', 'enabled']).default('name'),
    direction: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();
export async function roleAccessSurfaces(s: Scope): Promise<Row[]> {
  const grants = await rows(
    s.tx,
    sql`SELECT rp.role_id,p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${s.actor.tenantId} AND rp.establishment_id=${s.actor.establishmentId}`,
  );
  const roles = await s.list('roles');
  return roles.map((role) => ({
    ...role,
    access_surface: staffAccessSurface(
      grants.filter((grant) => grant.role_id === role.id).map((grant) => grant.code),
    ),
  }));
}
/** Explicit user fields: membership scope must never expose credentials or other units. */
export async function teamMembers(s: Scope, raw: unknown = {}) {
  const profiles = await roleAccessSurfaces(s);
  const decorate = (members: Record<string, any>[]) =>
    members.map((member) => ({
      ...member,
      access_surface: member.is_account_admin
        ? 'admin'
        : (profiles.find((role) => role.id === member.role_id)?.access_surface ?? 'admin'),
    }));
  const source = sql`SELECT m.*,u.name,u.email,r.name AS role_name,tm.is_account_admin
    FROM staff_memberships m
    JOIN users u ON u.id=m.user_id
    JOIN roles r ON r.id=m.role_id AND r.tenant_id=m.tenant_id AND r.establishment_id=m.establishment_id
    JOIN tenant_memberships tm ON tm.user_id=m.user_id AND tm.tenant_id=m.tenant_id
    WHERE m.tenant_id=${s.actor.tenantId} AND m.establishment_id=${s.actor.establishmentId}`;
  // Preserve the array contract for existing clients and operational references.
  if (!Object.keys(raw as object).length)
    return decorate(await rows(s.tx, sql`${source} ORDER BY u.name,m.id`));
  const q = query.parse(raw),
    conditions = [sql`1=1`];
  if (q.search) {
    const literal = q.search.replace(/[!%_]/g, (c) => '!' + c),
      pattern = '%' + literal + '%';
    conditions.push(
      sql`(name LIKE ${pattern} ESCAPE '!' OR email LIKE ${pattern} ESCAPE '!' OR role_name LIKE ${pattern} ESCAPE '!')`,
    );
  }
  if (q.role_id) conditions.push(sql`role_id=${q.role_id}`);
  if (q.status) conditions.push(sql`enabled=${q.status === 'active'}`);
  const columns = {
    name: sql`name`,
    email: sql`email`,
    role_name: sql`role_name`,
    enabled: sql`enabled`,
  };
  const result = await sqlPage(
    s.tx,
    source,
    sql.join(conditions, sql` AND `),
    sql`${columns[q.sort]} ${q.direction === 'desc' ? sql`DESC` : sql`ASC`},id ASC`,
    q,
  );
  const summary = await rows(
    s.tx,
    sql`SELECT COUNT(*) total,COALESCE(SUM(enabled=TRUE),0) active,COALESCE(SUM(enabled=FALSE),0) inactive,COUNT(DISTINCT role_id) profiles FROM staff_memberships WHERE ${s.where()}`,
  );
  return { ...result, rows: decorate(result.rows), summary: summary[0] };
}
