import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { atomic, pool } from '../../packages/database/src/index.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  unit: Awaited<ReturnType<typeof provision>>,
  token: string,
  otherToken: string;
const password = 'FloorTestPasswordOnly1!',
  suffix = randomUUID().slice(0, 8);
async function call(method: string, path: string, body?: unknown, credential = token) {
  const response = await app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + credential, 'Idempotency-Key': randomUUID() },
    ...(body === undefined ? {} : { payload: body as any }),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
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
    name: 'Salão ' + suffix,
    owner_email: 'floor-' + suffix + '@test.local',
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  const other = await provision({
    name: 'Outro salão ' + suffix,
    owner_email: 'other-floor-' + suffix + '@test.local',
    owner_name: 'Outra',
    password,
    demo: true,
  });
  token = (
    await call(
      'POST',
      '/auth/login',
      { email: 'floor-' + suffix + '@test.local', password, establishment_slug: unit.slug },
      '',
    )
  ).token;
  otherToken = (
    await call(
      'POST',
      '/auth/login',
      { email: 'other-floor-' + suffix + '@test.local', password, establishment_slug: other.slug },
      '',
    )
  ).token;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('o mapa soma comandas pelo razão, sem duplicar pagamentos, e ignora atendimentos encerrados', async () => {
  const table = unit.tables[0],
    product = unit.products[0];
  const draft = await call('POST', '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [
      { product_id: product.id, quantity: 2, modifiers: [] },
      { product_id: unit.products[1].id, quantity: 1, modifiers: [] },
    ],
  });
  const order = await call('POST', `/orders/${draft.id}/confirm`, {});
  const detail = await call('GET', `/tables/${table.id}/session`);
  const second = await call('POST', '/tabs', {
    session_id: detail.session.id,
    label: 'Conta da Ana',
    mode: 'INDIVIDUAL',
  });
  const items = (await call('GET', `/orders/${order.id}`)).items;
  await call('POST', `/tabs/${order.tab_id}/transfer-items`, {
    item_ids: [items.find((item: any) => item.product_id === product.id).id],
    target_tab_id: second.id,
  });
  await call('POST', `/tabs/${second.id}/discount`, {
    amount: '1.00',
    reason: 'Desconto do atendimento',
  });
  const payment = await call('POST', '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [
      { tab_id: second.id, amount: '8.00' },
      { tab_id: order.tab_id, amount: '2.00' },
    ],
  });
  await call('POST', '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: second.id, amount: '3.00' }],
  });
  await call('POST', `/payments/${payment.id}/refund`, {
    tab_id: second.id,
    amount: '1.00',
    reason: 'Estorno parcial',
  });
  // Old attendance on the same table must never affect the card's current amount or start time.
  await atomic(unit.actor, randomUUID(), 'test.closed-attendance', {}, async (s) => {
    const session = await s.insert('table_sessions', {
      table_id: table.id,
      status: 'CLOSED',
      opened_at: new Date('2020-01-01T00:00:00Z'),
      opened_by: unit.actor.id,
      join_nonce: randomUUID(),
    });
    const tab = await s.insert('tabs', {
      session_id: session.id,
      label: 'Atendimento antigo',
      status: 'CLOSED',
      mode: 'SHARED',
    });
    await s.insert('financial_entries', {
      tab_id: tab.id,
      type: 'CHARGE',
      amount: '999.00',
      source_key: randomUUID(),
      created_by: unit.actor.id,
    });
    return { created: true };
  });
  const card = (await call('GET', '/tables')).find((item: any) => item.id === table.id);
  const tabs = (await call('GET', `/tables/${table.id}/session`)).tabs;
  expect(card.attendance.tabs).toHaveLength(2);
  expect(Date.parse(card.opened_at_iso)).toBeGreaterThan(Date.now() - 300_000);
  let total = 0,
    paid = 0,
    balance = 0;
  for (const tab of tabs) {
    const value = card.attendance.tabs.find((item: any) => item.id === tab.id);
    expect(value).toMatchObject({
      total: (Number(tab.financial.charges) - Number(tab.financial.credits)).toFixed(2),
      paid: tab.financial.net_paid,
      balance: tab.financial.balance,
    });
    total += Number(value.total);
    paid += Number(value.paid);
    balance += Number(value.balance);
  }
  expect(card.attendance).toMatchObject({
    total: total.toFixed(2),
    paid: paid.toFixed(2),
    balance: balance.toFixed(2),
  });
  const free = (await call('GET', '/tables')).find((item: any) => item.id === unit.tables[1].id);
  expect(free.attendance).toBeNull();
  expect(free.opened_at_iso).toBeNull();
  expect(
    (await call('GET', '/tables', undefined, otherToken)).some(
      (item: any) =>
        item.id === table.id || item.attendance?.tabs?.some((tab: any) => tab.id === second.id),
    ),
  ).toBe(false);
  // Changing a layout still uses the existing bounds validation and scoped write route.
  const invalid = await app.inject({
    method: 'PATCH',
    url: '/api/v1/tables/' + table.id,
    headers: { authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
    payload: { position_x: 2001 },
  });
  expect(invalid.statusCode).toBe(400);
});
