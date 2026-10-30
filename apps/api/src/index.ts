import { buildApp } from './app.js';
import { pool } from '../../../packages/database/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
if (!env.DOCUMENT_KEY) throw new Error('Configure DOCUMENT_KEY (32 bytes hexadecimais) no .env.');
const app = await buildApp();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
await app.listen({ host: env.API_HOST, port: env.API_PORT });
