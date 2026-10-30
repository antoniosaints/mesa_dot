import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool } from '../../packages/database/src/index.js';
const suffix = randomUUID().slice(0, 8),
  password = 'TcpAgentTestsOnlyPassword1!';
let app: Awaited<ReturnType<typeof buildApp>>, token: string, address: string;
async function req(
  method: string,
  path: string,
  body?: unknown,
  credential = token,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + credential, 'Idempotency-Key': key },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco de testes obrigatório.');
  await migrate();
  const unit = await provision({
    name: 'Agente TCP ' + suffix,
    owner_name: 'Gestora',
    owner_email: 'tcp-' + suffix + '@test.local',
    password,
    demo: true,
  });
  app = await buildApp({ logger: false, realtime: false });
  address = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await req(
    'POST',
    '/auth/login',
    { email: 'tcp-' + suffix + '@test.local', password, establishment_slug: unit.slug },
    '',
  );
  expect(login.statusCode, login.body).toBe(200);
  token = login.json().token;
}, 60000);
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('a credencial TCP é emitida uma vez e não concede acesso à gestão', async () => {
  const key = randomUUID(),
    payload = { name: 'Rede de teste', transport: 'TCP' };
  const first = await req('POST', '/print/agents', payload, token, key);
  expect(first.statusCode, first.body).toBe(200);
  const credential = first.json();
  expect(credential.token).toBeTruthy();
  const repeated = await req('POST', '/print/agents', payload, token, key);
  expect(repeated.json()).toMatchObject({ id: credential.id, token: null });
  const agents = (await req('GET', '/print/stations')).json();
  expect(agents.find((a: any) => a.id === credential.id)).toMatchObject({
    transport: 'TCP',
    online: false,
    enabled: true,
    printer_ids: [],
  });
  expect(JSON.stringify(agents)).not.toContain(credential.token);
  for (const path of ['/settings', '/print/agents', '/print/stations', '/print/station'])
    expect((await req('GET', path, undefined, credential.token)).statusCode).toBe(403);
  expect((await req('POST', '/print/jobs/claim', {}, token)).statusCode).toBe(403);
});
it('o programa Node envia ESC/POS por socket, respeita o destino e a revogação e não altera consumo', async () => {
  const printer = (await req('POST', '/printers', { name: 'Térmica TCP', sector: 'tcp' })).json();
  const other = (await req('POST', '/printers', { name: 'Outro destino', sector: 'outro' })).json();
  const agent = (
    await req('POST', '/print/agents', { name: 'Computador TCP', transport: 'TCP' })
  ).json();
  const tables = (await req('GET', '/tables')).json(),
    table = tables[0];
  const orders = (await req('GET', '/orders')).json(),
    tickets = (await req('GET', '/tickets')).json();
  const job = (
    await req('POST', `/tables/${table.id}/qr/print`, { printer_id: printer.id, paper_width: 80 })
  ).json();
  const ignored = (
    await req('POST', `/tables/${table.id}/qr/print`, { printer_id: other.id, paper_width: 80 })
  ).json();
  const packets: Buffer[] = [];
  const server = createServer((socket) => {
    const parts: Buffer[] = [];
    socket.on('data', (part) => parts.push(part));
    socket.on('end', () => packets.push(Buffer.concat(parts)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/print-agent/src/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PRINT_API_URL: address + '/api/v1',
      PRINT_AGENT_TOKEN: agent.token,
      PRINT_PRINTER_ID: printer.id,
      PRINT_PRINTERS_JSON: '',
      PRINT_HOST: '127.0.0.1',
      PRINT_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (part) => (logs += part));
  child.stderr.on('data', (part) => (logs += part));
  try {
    await expect
      .poll(async () => (await req('GET', '/tables/qr/jobs/' + job.id)).json().status, {
        timeout: 15000,
      })
      .toBe('COMPLETED');
    expect(packets).toHaveLength(1);
    expect(packets[0].subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(packets[0].toString('ascii')).toContain('MESA ' + table.number);
    expect((await req('GET', '/tables/qr/jobs/' + ignored.id)).json().status).toBe('PENDING');
    const station = (await req('GET', '/print/stations'))
      .json()
      .find((a: any) => a.id === agent.id);
    expect(station).toMatchObject({ transport: 'TCP', online: true, printer_ids: [printer.id] });
    const revoked = await req('PATCH', '/print/agents/' + agent.id, { enabled: false });
    expect(revoked.statusCode).toBe(200);
    expect(
      (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token))
        .statusCode,
    ).toBe(401);
    expect(
      (await req('GET', '/print/stations')).json().find((a: any) => a.id === agent.id),
    ).toMatchObject({ enabled: false, online: false });
    expect((await req('GET', '/orders')).json()).toEqual(orders);
    expect((await req('GET', '/tickets')).json()).toEqual(tickets);
    expect((await req('GET', '/tables')).json()).toEqual(tables);
    expect(logs).not.toContain(agent.token);
  } finally {
    if (child.exitCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      await exit;
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
