import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { db, pool, rows, sql } from '../../packages/database/src/index.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  unit: any,
  other: any,
  staffToken: string,
  agent: any,
  printer: any,
  foreignPrinter: any;
const password = 'StationTestsOnlyPassword1!',
  suffix = randomUUID().slice(0, 8);
async function req(method: string, path: string, body?: unknown, token = staffToken, extra = {}) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID(), ...extra },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco isolado obrigatório.');
  await migrate();
  app = await buildApp({ logger: false, realtime: false });
  unit = await provision({
    name: 'Estação ' + suffix,
    owner_email: 'station-' + suffix + '@test.local',
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  other = await provision({
    name: 'Outra estação ' + suffix,
    owner_email: 'other-station-' + suffix + '@test.local',
    owner_name: 'Outra',
    password,
    demo: true,
  });
  staffToken = (
    await req(
      'POST',
      '/auth/login',
      { email: 'station-' + suffix + '@test.local', password, establishment_slug: unit.slug },
      '',
    )
  ).json().token;
  printer = (await req('POST', '/printers', { name: 'Térmica da unidade', sector: 'bar' })).json();
  const otherToken = (
    await req(
      'POST',
      '/auth/login',
      {
        email: 'other-station-' + suffix + '@test.local',
        password,
        establishment_slug: other.slug,
      },
      '',
    )
  ).json().token;
  foreignPrinter = (
    await req('POST', '/printers', { name: 'Outra térmica', sector: 'bar' }, otherToken)
  ).json();
  agent = (
    await req('POST', '/print/agents', { name: 'Computador do balcão', transport: 'PRINTBRIDGE' })
  ).json();
  expect(agent.token).toBeTruthy();
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('a estação tem credencial própria, publica impressoras online e expira o indicador quando fica ausente', async () => {
  const info = await req('GET', '/print/station', undefined, agent.token);
  expect(info.statusCode, info.body).toBe(200);
  expect(info.json()).toMatchObject({
    establishment_id: unit.establishment_id,
    tenant_id: unit.tenant_id,
  });
  expect(info.json().printers).toContainEqual({
    id: printer.id,
    name: printer.name,
    sector: 'bar',
    enabled: 1,
  });
  expect((await req('GET', '/print/station')).statusCode).toBe(403);
  const heart = await req(
    'POST',
    '/print/station/heartbeat',
    { printer_ids: [printer.id], running: true, connected: true, name: 'Balcão principal' },
    agent.token,
  );
  expect(heart.statusCode, heart.body).toBe(200);
  expect(
    (await req('GET', '/print/stations')).json().find((item: any) => item.id === agent.id),
  ).toMatchObject({ name: 'Balcão principal', online: true, printer_ids: [printer.id] });
  const destinations = (await req('GET', '/receipts/printers')).json();
  expect(destinations.find((item: any) => item.id === printer.id).stations).toEqual([
    { id: agent.id, name: 'Balcão principal', online: true },
  ]);
  expect(JSON.stringify(destinations)).not.toContain(agent.token);
  expect((await req('GET', '/print/stations', undefined, agent.token)).statusCode).toBe(403);
  expect((await req('GET', '/settings', undefined, agent.token)).statusCode).toBe(403);
  await db.execute(
    sql`UPDATE print_agents SET last_seen_at=UTC_TIMESTAMP(3)-INTERVAL 60 SECOND WHERE id=${agent.id}`,
  );
  expect(
    (await req('GET', '/print/stations')).json().find((item: any) => item.id === agent.id).online,
  ).toBe(false);
});
it('rejeita vínculo com outra unidade, horário de atividade inválido e cabeçalho de unidade diferente', async () => {
  expect(
    (
      await req(
        'POST',
        '/print/station/heartbeat',
        { printer_ids: [foreignPrinter.id], running: true, connected: true },
        agent.token,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await req(
        'POST',
        '/print/station/heartbeat',
        { printer_ids: [], running: true, connected: true },
        agent.token,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await req(
        'POST',
        '/print/station/heartbeat',
        { printer_ids: [printer.id], running: true, connected: false },
        agent.token,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await req('GET', '/print/station', undefined, agent.token, {
        'X-Mesa-Establishment': other.establishment_id,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await req('PATCH', '/print/agents/' + agent.id, { enabled: false }, agent.token)).statusCode,
  ).toBe(403);
});
it('admin revoga a estação sem cancelar trabalhos e pode reativar sua mesma credencial', async () => {
  const before = await rows(
    db,
    sql`SELECT id,status FROM print_jobs WHERE establishment_id=${unit.establishment_id} ORDER BY id`,
  );
  expect((await req('PATCH', '/print/agents/' + agent.id, { enabled: false })).statusCode).toBe(
    200,
  );
  expect((await req('GET', '/print/station', undefined, agent.token)).statusCode).toBe(401);
  expect(
    (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)).statusCode,
  ).toBe(401);
  expect(
    (await req('GET', '/print/stations')).json().find((item: any) => item.id === agent.id),
  ).toMatchObject({ enabled: false, online: false });
  expect(
    await rows(
      db,
      sql`SELECT id,status FROM print_jobs WHERE establishment_id=${unit.establishment_id} ORDER BY id`,
    ),
  ).toEqual(before);
  expect((await req('PATCH', '/print/agents/' + agent.id, { enabled: true })).statusCode).toBe(200);
  expect((await req('GET', '/print/station', undefined, agent.token)).statusCode).toBe(200);
});
