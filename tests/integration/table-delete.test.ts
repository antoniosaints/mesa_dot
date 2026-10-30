import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { provision } from '../../packages/database/src/provision.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { view, sql, pool } from '../../packages/database/src/index.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  unit: Awaited<ReturnType<typeof provision>>,
  other: typeof unit,
  token: string,
  foreign: string,
  waiter: string,
  branchToken: string;
const password = 'TableDeleteTestsOnly1!',
  suffix = randomUUID().slice(0, 8),
  email = 'table-delete-' + suffix + '@test.local';
async function req(method: string, path: string, body?: unknown, credential = token) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + credential, 'Idempotency-Key': randomUUID() },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function call(method: string, path: string, body?: unknown, credential = token) {
  const r = await req(method, path, body, credential);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function order(tableId: string) {
  return call('POST', '/orders', {
    table_id: tableId,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: unit.products[0].id, quantity: 1, modifiers: [] }],
  });
}
async function settle(id: string, tabId: string) {
  await call('POST', '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: tabId, amount: '14.00' }],
  });
  await call('POST', '/orders/' + id + '/deliver-tickets', {});
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
    name: 'Excluir mesa ' + suffix,
    owner_email: email,
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  other = await provision({
    name: 'Outra mesa ' + suffix,
    owner_email: 'other-' + email,
    owner_name: 'Outra',
    password,
    demo: true,
  });
  token = (
    await call('POST', '/auth/login', { email, password, establishment_slug: unit.slug }, '')
  ).token;
  foreign = (
    await call(
      'POST',
      '/auth/login',
      { email: 'other-' + email, password, establishment_slug: other.slug },
      '',
    )
  ).token;
  await call('POST', '/staff', {
    name: 'Garçom',
    email: 'waiter-' + email,
    password,
    role_id: unit.roles.find((role) => role.name === 'Garçom')!.id,
  });
  waiter = (
    await call(
      'POST',
      '/auth/login',
      { email: 'waiter-' + email, password, establishment_slug: unit.slug },
      '',
    )
  ).token;
  const branch = await call('POST', '/establishments', { name: 'Filial exclusão ' + suffix });
  branchToken = (await call('POST', '/auth/switch-branch', { establishment_id: branch.id })).token;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('exclui logicamente, preserva todos os vínculos históricos e libera o número sem reativar o QR antigo', async () => {
  const table = unit.tables[0],
    draft = await order(table.id),
    confirmed = await call('POST', '/orders/' + draft.id + '/confirm', {});
  await settle(confirmed.id, confirmed.tab_id);
  const session = (await call('GET', '/tables/' + table.id + '/session')).session;
  await call('POST', '/tables/' + table.id + '/finalize', { session_id: session.id });
  const printer = await call('POST', '/printers', { name: 'Cupom histórico', sector: 'bar' });
  await call('POST', '/orders/' + confirmed.id + '/receipt/print', {
    printer_id: printer.id,
    paper_width: 80,
  });
  const s = view(unit.actor),
    tableBefore = await s.get('dining_tables', table.id),
    dashboard = await call('GET', '/dashboard');
  const preserved = [
    'orders',
    'order_items',
    'tickets',
    'tabs',
    'table_sessions',
    'financial_entries',
    'payments',
    'payment_allocations',
    'refunds',
    'stock_balances',
    'stock_movements',
    'print_jobs',
    'visitor_sessions',
    'customers',
  ] as const;
  const before = await Promise.all(preserved.map((name) => s.list(name)));
  const deleted = await call('DELETE', '/tables/' + table.id);
  expect(deleted).toMatchObject({ id: table.id, deleted: true });
  const after = await s.get('dining_tables', table.id);
  expect(after).toMatchObject({
    id: table.id,
    number: tableBefore.number,
    public_code: tableBefore.public_code,
    enabled: 0,
    active_number: null,
  });
  expect(after.deleted_at).toBeTruthy();
  expect(await Promise.all(preserved.map((name) => s.list(name)))).toEqual(before);
  expect((await call('GET', '/tables')).some((row: any) => row.id === table.id)).toBe(false);
  expect((await call('GET', '/dashboard')).tables).toBe(dashboard.tables - 1);
  expect(
    (await call('GET', '/public/' + unit.slug + '/tables/availability', undefined, '')).some(
      (row: any) => row.id === table.id,
    ),
  ).toBe(false);
  expect(
    (
      await req(
        'POST',
        '/public/' + unit.slug + '/tables/resolve',
        { table_code: table.public_code },
        '',
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await req(
        'POST',
        '/public/' + unit.slug + '/visitor-sessions',
        { table_code: table.public_code, name: 'Cliente', phone: '11999999999' },
        '',
      )
    ).statusCode,
  ).toBe(404);
  expect((await req('POST', '/tables/' + table.id + '/open', {})).statusCode).toBe(404);
  expect((await req('PATCH', '/tables/' + table.id, { enabled: true })).statusCode).toBe(404);
  expect((await req('GET', '/tables/' + table.id + '/qr')).statusCode).toBe(404);
  expect((await call('GET', '/orders/' + confirmed.id)).table_number).toBe(table.number);
  const receipt = await call('GET', '/orders/' + confirmed.id + '/receipt');
  expect(receipt.table_number).toBe(table.number);
  const next = await call('POST', '/tables', { number: table.number, capacity: 4 });
  expect(next.id).not.toBe(table.id);
  expect(next.public_code).not.toBe(table.public_code);
  expect((await call('GET', '/orders/' + confirmed.id)).table_id).toBe(table.id);
  await call('DELETE', '/tables/' + table.id);
  expect(
    await s.list('audit_logs', sql`aggregate_id=${table.id} AND action='table.deleted'`),
  ).toHaveLength(1);
});
it('impede exclusão em atendimento, fechamento e aguardando liberação', async () => {
  const table = unit.tables[1],
    draft = await order(table.id),
    confirmed = await call('POST', '/orders/' + draft.id + '/confirm', {});
  expect((await req('DELETE', '/tables/' + table.id)).statusCode).toBe(409);
  expect((await call('POST', '/tables/' + table.id + '/checkout', {})).status).toBe('CLOSING');
  expect((await req('DELETE', '/tables/' + table.id)).statusCode).toBe(409);
  await settle(confirmed.id, confirmed.tab_id);
  expect((await call('POST', '/tables/' + table.id + '/checkout', {})).status).toBe(
    'AWAITING_RELEASE',
  );
  expect((await req('DELETE', '/tables/' + table.id)).statusCode).toBe(409);
  await call('POST', '/tables/' + table.id + '/release', {});
  await call('DELETE', '/tables/' + table.id);
});
it('bloqueia exclusão durante pré-pagamento sem alterar o pedido pendente', async () => {
  const table = unit.tables[2];
  const visitor = await call(
    'POST',
    '/public/' + unit.slug + '/visitor-sessions',
    { table_code: table.public_code, name: 'Cliente', phone: '11999999999' },
    '',
  );
  const draft = await call(
    'POST',
    '/orders',
    {
      table_id: table.id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: unit.products[0].id, quantity: 1, modifiers: [] }],
    },
    visitor.token,
  );
  const rejected = await req('DELETE', '/tables/' + table.id);
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json().error.message).toContain('aguardando pagamento');
  expect((await view(unit.actor).get('orders', draft.id)).status).toBe('PENDING_PAYMENT');
  expect((await view(unit.actor).get('dining_tables', table.id)).deleted_at).toBeNull();
  await call('POST', '/orders/' + draft.id + '/cancel', { reason: 'Checkout abandonado no teste' });
  await call('DELETE', '/tables/' + table.id);
});
it('respeita permissão e isolamento entre contas e filiais', async () => {
  const table = unit.tables[3];
  expect((await req('DELETE', '/tables/' + table.id, undefined, waiter)).statusCode).toBe(403);
  expect((await req('DELETE', '/tables/' + table.id, undefined, foreign)).statusCode).toBe(404);
  expect((await req('DELETE', '/tables/' + table.id, undefined, branchToken)).statusCode).toBe(404);
  expect((await view(unit.actor).get('dining_tables', table.id)).deleted_at).toBeNull();
});
it('serializa uma exclusão concorrente com a confirmação do primeiro pedido', async () => {
  const table = unit.tables[4],
    draft = await order(table.id);
  const [deletion, confirmation] = await Promise.all([
    req('DELETE', '/tables/' + table.id),
    req('POST', '/orders/' + draft.id + '/confirm', {}),
  ]);
  expect([deletion.statusCode, confirmation.statusCode].sort()).toEqual([200, 409]);
  const record = await view(unit.actor).get('dining_tables', table.id),
    active = await view(unit.actor).list(
      'table_sessions',
      sql`table_id=${table.id} AND status<>'CLOSED'`,
    );
  expect(active.length).toBe(record.deleted_at ? 0 : 1);
});
