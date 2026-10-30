import { fileURLToPath } from 'node:url';
import { pool, rows, db, sql } from './index.js';
import { provision } from './provision.js';
import { ensure } from '../../shared/src/index.js';
import { env } from '../../shared/src/config.js';
export async function seed() {
  ensure(
    env.NODE_ENV !== 'production' && process.env.SEED_DEMO === 'true',
    'FORBIDDEN',
    'Seed de demonstração exige SEED_DEMO=true fora de produção.',
    403,
  );
  const password = process.env.SEED_PASSWORD ?? '';
  ensure(
    password.length >= 12,
    'BAD_REQUEST',
    'Defina SEED_PASSWORD com pelo menos 12 caracteres.',
    400,
  );
  for (const [slug, name, email] of [
    ['boteco-da-esquina', 'Boteco da Esquina', 'admin@boteco.local'],
    ['segundo-bar', 'Segundo Bar', 'admin@segundo.local'],
  ]) {
    if ((await rows(db, sql`SELECT id FROM tenants WHERE slug=${slug}`)).length) {
      console.log(`Preservado: ${slug}`);
      continue;
    }
    await provision({
      slug,
      name,
      owner_email: email,
      owner_name: 'Administrador',
      password,
      demo: true,
    });
    console.log(`Criado: ${slug} (${email})`);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await seed();
  } finally {
    await pool.end();
  }
}
