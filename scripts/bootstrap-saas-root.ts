import { z } from 'zod';
import { db, pool, rows, sql } from '../packages/database/src/index.js';
import { provision } from '../packages/database/src/provision.js';
// Run only from the trusted server CLI. Public registration never accepts platform privileges.
const input = z
  .object({
    SAAS_ROOT_EMAIL: z.email().max(190),
    SAAS_ROOT_NAME: z.string().trim().min(2).max(160).default('Gestor Mesa'),
    SAAS_ROOT_PASSWORD: z.string().min(16).max(200),
  })
  .parse(process.env);
try {
  const [existing] = await rows(
    db,
    sql`SELECT u.id,u.is_superadmin,t.is_platform FROM users u LEFT JOIN tenant_memberships tm ON tm.user_id=u.id LEFT JOIN tenants t ON t.id=tm.tenant_id WHERE u.email=${input.SAAS_ROOT_EMAIL.toLowerCase()} ORDER BY t.is_platform DESC LIMIT 1`,
  );
  if (existing) {
    if (!existing.is_superadmin || !existing.is_platform)
      throw new Error('Este e-mail já pertence a outra conta. Nenhuma permissão foi alterada.');
    console.log(
      JSON.stringify({ created: false, message: 'Gestor já provisionado; senha preservada.' }),
    );
  } else {
    const result = await provision({
      name: 'Mesa · Administração da plataforma',
      owner_email: input.SAAS_ROOT_EMAIL,
      owner_name: input.SAAS_ROOT_NAME,
      password: input.SAAS_ROOT_PASSWORD,
      platform: true,
      superadmin: true,
    });
    console.log(
      JSON.stringify({ created: true, tenant_id: result.tenant_id, user_id: result.user_id }),
    );
  }
} finally {
  await pool.end();
}
