import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { atomic, rows, db, pool, sql } from '../../packages/database/src/index.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  a: Awaited<ReturnType<typeof provision>>,
  foreign: typeof a,
  owner: string,
  foreignToken: string,
  branchToken: string,
  branch: any;
const suffix = randomUUID().slice(0, 8),
  password = 'OverviewTestsOnly1!',
  period = '?start=2026-11-02&end=2026-11-02';
async function req(method: string, path: string, body?: unknown, token = owner, headers = {}) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'Idempotency-Key': randomUUID(),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function call(method: string, path: string, body?: unknown, token = owner) {
  const response = await req(method, path, body, token);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function profile(name: string, permissions: string[]) {
  const role = await call('POST', '/roles', { name, permissions });
  const email =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replaceAll(' ', '-')
      .toLowerCase() +
    '-' +
    suffix +
    '@test.local';
  const staff = await call('POST', '/staff', { name, email, password, role_id: role.id });
  const login = await call(
    'POST',
    '/auth/login',
    { email, password, establishment_slug: a.slug },
    '',
  );
  return { token: login.token, role, staff };
}
async function order(items: any[], date: string, cancelled = false) {
  const draft = await call('POST', '/orders', {
    table_id: a.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items,
  });
  const confirmed = await call('POST', '/orders/' + draft.id + '/confirm', {});
  if (cancelled)
    await call('POST', '/orders/' + draft.id + '/cancel', {
      reason: 'Cancelamento para validar resumo',
    });
  await atomic(a.actor, randomUUID(), 'overview.test-date', {}, async (s) => {
    await s.update('orders', confirmed.id, {
      confirmed_at: new Date(date),
      created_at: new Date(date),
    });
    await s.tx.execute(
      sql`UPDATE financial_entries SET created_at=${new Date(date)} WHERE ${s.where(sql`order_id=${confirmed.id}`)}`,
    );
    return {};
  });
  return confirmed;
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco isolado obrigatório.');
  await migrate();
  app = await buildApp({ logger: false, realtime: false });
  a = await provision({
    name: 'Visão geral ' + suffix,
    owner_name: 'Admin A',
    owner_email: 'overview-' + suffix + '@test.local',
    password,
    demo: true,
  });
  foreign = await provision({
    name: 'Outra conta ' + suffix,
    owner_name: 'Admin B',
    owner_email: 'overview-other-' + suffix + '@test.local',
    password,
    demo: true,
  });
  owner = (
    await call(
      'POST',
      '/auth/login',
      { email: 'overview-' + suffix + '@test.local', password, establishment_slug: a.slug },
      '',
    )
  ).token;
  foreignToken = (
    await call(
      'POST',
      '/auth/login',
      {
        email: 'overview-other-' + suffix + '@test.local',
        password,
        establishment_slug: foreign.slug,
      },
      '',
    )
  ).token;
  branch = await call('POST', '/establishments', { name: 'Filial isolada ' + suffix });
  branchToken = (await call('POST', '/auth/switch-branch', { establishment_id: branch.id })).token;
  await order(
    [
      { product_id: a.products[0].id, quantity: 2, modifiers: [] },
      { product_id: a.products[1].id, quantity: 1, modifiers: [] },
    ],
    '2026-11-02T13:00:00Z',
  );
  await order(
    [{ product_id: a.products[1].id, quantity: 1, modifiers: [] }],
    '2026-11-02T14:00:00Z',
  );
  await order(
    [{ product_id: a.products[2].id, quantity: 1, modifiers: [] }],
    '2026-11-02T15:00:00Z',
    true,
  );
  await order(
    [{ product_id: a.products[1].id, quantity: 1, modifiers: [] }],
    '2026-11-02T02:59:59Z',
  );
  await order(
    [{ product_id: a.products[1].id, quantity: 1, modifiers: [] }],
    '2026-11-03T03:00:00Z',
  );
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('agrega o período em Brasília sem duplicar itens ou misturar pendências atuais', async () => {
  const data = await call('GET', '/dashboard/overview' + period);
  expect(data.scope).toMatchObject({
    tenant_id: a.tenant_id,
    establishment_id: a.establishment_id,
  });
  expect(data.orders.confirmed).toBe(2);
  expect(data.orders.cancelled).toBe(1);
  expect(data.orders.series).toEqual([
    { bucket: '2026-11-02 10:00', count: 1 },
    { bucket: '2026-11-02 11:00', count: 1 },
  ]);
  expect(data.orders.top.map((row: any) => [row.name, Number(row.quantity)]).sort()).toEqual(
    [
      ['Cerveja Pilsen 600 ml', 2],
      ['Água mineral', 2],
    ].sort(),
  );
  expect(data.financial.totals.revenue).toBe('38.00');
  expect(data.financial.outstanding).toBe('48.00');
  expect(data.tables).toMatchObject({
    total: a.tables.length,
    occupied: 1,
    free: a.tables.length - 1,
  });
  expect(
    Object.values(data.deliveries).reduce((sum: number, count) => sum + Number(count), 0),
  ).toBe(6);
  expect(data.production).toEqual({});
});
it('isola a conta e a filial autenticadas e rejeita a troca de escopo por parâmetros', async () => {
  for (const token of [branchToken, foreignToken]) {
    const data = await call('GET', '/dashboard/overview' + period, undefined, token);
    expect(data.orders.confirmed).toBe(0);
    expect(data.financial.totals.revenue).toBe('0.00');
    expect(data.financial.outstanding).toBe('0.00');
    expect(data.tables.occupied).toBe(0);
  }
  expect(
    (await req('GET', '/dashboard/overview' + period + '&establishment_id=' + branch.id))
      .statusCode,
  ).toBe(400);
  expect(
    (await req('GET', '/dashboard/overview' + period + '&tenant_id=' + foreign.tenant_id))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await req('GET', '/dashboard/overview' + period, undefined, owner, {
        'X-Mesa-Establishment': branch.id,
      })
    ).statusCode,
  ).toBe(403);
});
it('omite valores financeiros mesmo para um papel com todas as permissões e valida no banco o admin geral', async () => {
  const manager = await profile('Administrador operacional', [...a.actor.permissions]);
  const data = await call('GET', '/dashboard/overview' + period, undefined, manager.token);
  expect(data.access.financial).toBe(false);
  expect(data.financial).toBeNull();
  expect(data.orders.confirmed).toBe(2);
  expect(data.orders.recent.every((row: any) => row.total === undefined)).toBe(true);
  expect(JSON.stringify(data)).not.toMatch(
    /revenue|received|unit_price|outstanding|expected_amount/,
  );
  const legacy = await call('GET', '/dashboard', undefined, manager.token);
  expect(legacy.outstanding).toBeNull();
  expect(
    (
      await req(
        'GET',
        '/finance/dashboard?start=2026-11-02&end=2026-11-02',
        undefined,
        manager.token,
      )
    ).statusCode,
  ).toBe(403);
});
it('respeita as permissões de cada área e bloqueia perfis sem relatórios, inclusive após revogação', async () => {
  const reporter = await profile('Relatórios operacionais', [
    'reports.view',
    'table.view',
    'ticket.view',
  ]);
  const data = await call('GET', '/dashboard/overview' + period, undefined, reporter.token);
  expect(data.tables.occupied).toBe(1);
  expect(data.orders.confirmed).toBe(2);
  for (const section of ['financial', 'printing', 'cash', 'inventory', 'requests', 'production'])
    expect(data[section], section).toBeNull();
  const minimal = await profile('Relatórios básicos', ['reports.view']);
  const limited = await call('GET', '/dashboard/overview' + period, undefined, minimal.token);
  for (const section of [
    'tables',
    'orders',
    'deliveries',
    'financial',
    'printing',
    'cash',
    'inventory',
    'requests',
    'production',
  ])
    expect(limited[section], section).toBeNull();
  const waiter = await profile('Sem relatórios', ['table.view']);
  expect(
    (await req('GET', '/dashboard/overview' + period, undefined, waiter.token)).statusCode,
  ).toBe(403);
  const [permission] = await rows(db, sql`SELECT id FROM permissions WHERE code='reports.view'`);
  await atomic(a.actor, randomUUID(), 'overview.revoke', {}, async (s) => {
    await s.tx.execute(
      sql`DELETE FROM role_permissions WHERE ${s.where(sql`role_id=${reporter.role.id} AND permission_id=${permission.id}`)}`,
    );
    return {};
  });
  expect(
    (await req('GET', '/dashboard/overview' + period, undefined, reporter.token)).statusCode,
  ).toBe(403);
});
it('valida datas e o limite do período, sem executar consultas para filtros inválidos', async () => {
  for (const query of [
    'start=2026-11-03&end=2026-11-02',
    'start=2026-01-01&end=2026-11-03',
    'start=2026-02-30&end=2026-03-01',
  ])
    expect((await req('GET', '/dashboard/overview?' + query)).statusCode).toBe(400);
});
