import { drizzle } from 'drizzle-orm/mysql2';
import { backfillSlugs } from './slugs.js';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';
import { hash } from '../../shared/src/index.js';
export async function migrate() {
  const connection = await pool.getConnection();
  try {
    const [locked] = await connection.query<any[]>('SELECT GET_LOCK(?, 30) AS acquired', [
      'bar_saas_migrations',
    ]);
    if (locked[0].acquired !== 1) throw new Error('Não foi possível obter o lock de migrations.');
    await connection.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB',
    );
    const path = fileURLToPath(new URL('../migrations/', import.meta.url));
    for (const name of (await readdir(path)).filter((n) => n.endsWith('.sql')).sort()) {
      const source = await readFile(`${path}/${name}`, 'utf8');
      const checksum = hash(source);
      const [existing] = await connection.query<any[]>(
        'SELECT checksum FROM schema_migrations WHERE name=?',
        [name],
      );
      if (existing.length) {
        if (existing[0].checksum !== checksum) throw new Error(`Migration alterada: ${name}`);
        continue;
      }
      for (const statement of source
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await connection.query(statement);
      if (name === '0010_tenant_pwa.sql') {
        await connection.beginTransaction();
        try {
          await backfillSlugs(drizzle(connection));
          await connection.commit();
        } catch (e) {
          await connection.rollback();
          throw e;
        }
      }
      await connection.query('INSERT INTO schema_migrations(name,checksum) VALUES (?,?)', [
        name,
        checksum,
      ]);
      console.log(`Aplicada: ${name}`);
    }
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', ['bar_saas_migrations']);
    connection.release();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await migrate();
  } finally {
    await pool.end();
  }
}
