import { provision } from '../packages/database/src/provision.js';
import { pool } from '../packages/database/src/index.js';
import { z } from 'zod';
const input = z
  .object({
    TENANT_SLUG: z
      .string()
      .regex(/^[a-z0-9-]{3,80}$/)
      .optional(),
    TENANT_NAME: z.string().min(2),
    OWNER_EMAIL: z.email(),
    OWNER_NAME: z.string().min(2),
    OWNER_PASSWORD: z.string().min(12),
    SUPERADMIN: z.enum(['true', 'false']).default('false'),
  })
  .parse(process.env);
try {
  const result = await provision({
    slug: input.TENANT_SLUG,
    name: input.TENANT_NAME,
    owner_email: input.OWNER_EMAIL,
    owner_name: input.OWNER_NAME,
    password: input.OWNER_PASSWORD,
    superadmin: input.SUPERADMIN === 'true',
  });
  console.log(
    JSON.stringify({
      tenant_id: result.tenant_id,
      establishment_id: result.establishment_id,
      owner_id: result.user_id,
      slug: result.slug,
    }),
  );
} finally {
  await pool.end();
}
