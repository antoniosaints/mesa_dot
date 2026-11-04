import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool, view, sql } from '../../packages/database/src/index.js';

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco de teste exclusivo obrigatório.');
  await migrate();
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});

async function fixture() {
  const suffix = randomUUID().slice(0, 8),
    password = 'CashReceiptOnly1!';
  const f = await provision({
    name: 'Caixa recebimentos ' + suffix,
    owner_name: 'Titular',
    owner_email: suffix + '@cash.test.local',
    password,
    demo: true,
  });
  const auth = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: suffix + '@cash.test.local', password, establishment_slug: f.slug },
  });
  expect(auth.statusCode).toBe(200);
  const token = auth.json().token;
  async function req(method: 'GET' | 'POST', path: string, body?: unknown, key = randomUUID()) {
    const response = await app.inject({
      method,
      url: '/api/v1' + path,
      headers: { authorization: 'Bearer ' + token, 'Idempotency-Key': key },
      ...(body === undefined ? {} : { payload: body as any }),
    });
    return { status: response.statusCode, body: response.json() };
  }
  async function post(path: string, body: unknown) {
    const r = await req('POST', path, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  }
  const order = await post('/orders', {
    table_id: f.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: f.products[0].id, quantity: 10, modifiers: [] }],
  });
  const confirmed = await post(`/orders/${order.id}/confirm`, {});
  return { ...f, req, post, tabId: confirmed.tab_id };
}
it('Pix/cartão sem turno explícito usam o caixa operacional, sem alterar dinheiro físico nem duplicar o movimento', async () => {
  const f = await fixture();
  const cash = await f.post('/cash/sessions', {
    register_id: f.register.id,
    opening_amount: '5.00',
  });
  const key = randomUUID(),
    body = { method: 'PIX_MANUAL', allocations: [{ tab_id: f.tabId, amount: '60.00' }] };
  const pix = await f.req('POST', '/payments/manual', body, key);
  expect(pix.status, JSON.stringify(pix.body)).toBe(200);
  expect((await f.req('POST', '/payments/manual', body, key)).body.id).toBe(pix.body.id);
  await f.post('/payments/manual', {
    method: 'CARD_MANUAL',
    allocations: [{ tab_id: f.tabId, amount: '20.00' }],
  });
  await f.post('/payments/manual', {
    method: 'CASH',
    allocations: [{ tab_id: f.tabId, amount: '10.00' }],
  });
  const moves = await view(f.actor).list('cash_movements', sql`cash_session_id=${cash.id}`);
  expect(moves).toHaveLength(3);
  expect(moves.find((m) => m.payment_id === pix.body.id)).toMatchObject({
    type: 'PIX_MANUAL',
    amount: '60.00',
    source_key: 'payment:' + pix.body.id,
  });
  const active = (await f.req('GET', '/cash/sessions')).body.find((c: any) => c.id === cash.id);
  expect(active).toMatchObject({
    pix_sales: '60.00',
    card_sales: '20.00',
    cash_sales: '10.00',
    expected_amount: '15.00',
  });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  const report = await f.req('GET', `/finance/dashboard?start=${day}&end=${day}`);
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.cash.find((c: any) => c.id === cash.id)).toMatchObject({
    pix_sales: '60.00',
    card_sales: '20.00',
    received_gross: '90.00',
    expected: '15.00',
  });
});
it('seleção explícita prevalece, turno fechado ou de outra unidade é recusado e Pix sem caixa continua permitido', async () => {
  const f = await fixture(),
    foreign = await fixture();
  const first = await f.post('/cash/sessions', {
    register_id: f.register.id,
    opening_amount: '0.00',
  });
  const register = await f.post('/cash-registers', { name: 'Caixa alternativo' });
  const second = await f.post('/cash/sessions', {
    register_id: register.id,
    opening_amount: '0.00',
  });
  const options = (await f.req('GET', '/cash/active')).body;
  expect(options[0].id).toBe(first.id);
  expect(options.find((c: any) => c.id === second.id).register_name).toBe('Caixa alternativo');
  const other = await foreign.post('/cash/sessions', {
    register_id: foreign.register.id,
    opening_amount: '0.00',
  });
  const payment = await f.post('/payments/manual', {
    method: 'CARD_MANUAL',
    cash_session_id: second.id,
    allocations: [{ tab_id: f.tabId, amount: '10.00' }],
  });
  expect(
    (await view(f.actor).list('cash_movements', sql`payment_id=${payment.id}`))[0].cash_session_id,
  ).toBe(second.id);
  const count = (await view(f.actor).list('payments')).length;
  expect(
    (
      await f.req('POST', '/payments/manual', {
        method: 'PIX_MANUAL',
        cash_session_id: other.id,
        allocations: [{ tab_id: f.tabId, amount: '1.00' }],
      })
    ).status,
  ).toBe(404);
  await f.post(`/cash/sessions/${second.id}/close`, { counted_amount: '0.00' });
  expect(
    (
      await f.req('POST', '/payments/manual', {
        method: 'PIX_MANUAL',
        cash_session_id: second.id,
        allocations: [{ tab_id: f.tabId, amount: '1.00' }],
      })
    ).status,
  ).toBe(409);
  expect((await view(f.actor).list('payments')).length).toBe(count);
  await f.post(`/cash/sessions/${first.id}/close`, { counted_amount: '0.00' });
  const loose = await f.post('/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: f.tabId, amount: '1.00' }],
  });
  expect(await view(f.actor).list('cash_movements', sql`payment_id=${loose.id}`)).toHaveLength(0);
  expect(
    (
      await f.req('POST', '/payments/manual', {
        method: 'CASH',
        allocations: [{ tab_id: f.tabId, amount: '1.00' }],
      })
    ).status,
  ).toBe(400);
});
it('fechamento concorrente não permite registrar Pix em um turno já fechado', async () => {
  const f = await fixture();
  const cash = await f.post('/cash/sessions', {
    register_id: f.register.id,
    opening_amount: '0.00',
  });
  const [receipt, closed] = await Promise.all([
    f.req('POST', '/payments/manual', {
      method: 'PIX_MANUAL',
      cash_session_id: cash.id,
      allocations: [{ tab_id: f.tabId, amount: '3.00' }],
    }),
    f.req('POST', `/cash/sessions/${cash.id}/close`, { counted_amount: '0.00' }),
  ]);
  expect(closed.status, JSON.stringify(closed.body)).toBe(200);
  expect([200, 409]).toContain(receipt.status);
  const movements = await view(f.actor).list('cash_movements', sql`cash_session_id=${cash.id}`);
  expect(movements).toHaveLength(receipt.status === 200 ? 1 : 0);
  const session = await view(f.actor).get('cash_sessions', cash.id);
  if (movements.length)
    expect(String(movements[0].created_at) <= String(session.closed_at)).toBe(true);
});
