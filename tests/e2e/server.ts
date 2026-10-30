import { spawn } from 'node:child_process';
import { buildApp } from '../../apps/api/src/app.js';
import { pool } from '../../packages/database/src/index.js';
if (process.env.MESA_TEST_COMPLEMENTS === '1') {
  const { fakeComplementProviders } = await import('../complement-transport.js');
  globalThis.fetch = fakeComplementProviders(true).transport;
}
const worker = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/src/index.ts'], {
  stdio: 'inherit',
  // Browser scenarios use synthetic push endpoints; real transport retries are covered in integration tests.
  env: { ...process.env, WEB_PUSH_PUBLIC_KEY: '', WEB_PUSH_PRIVATE_KEY: '' },
});
const app = await buildApp({ logger: false });
async function stop() {
  worker.kill('SIGTERM');
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
await app.listen({ host: '127.0.0.1', port: Number(process.env.API_PORT ?? 33000) });
