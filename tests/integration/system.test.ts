import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool, db, sql, rows, atomic, view, type Row } from '../../packages/database/src/index.js';
import { permissions, type Actor } from '../../packages/shared/src/index.js';
import { createStaff } from '../../apps/api/src/auth.js';
import { env } from '../../packages/shared/src/config.js';
const password = 'IntegrationTestsOnly1!';
let app: Awaited<ReturnType<typeof buildApp>>;
let a: Awaited<ReturnType<typeof provision>>, b: typeof a;
let tokenA: string, tokenB: string, waiter1: string, waiter2: string;
async function req(
  method: string,
  path: string,
  body?: unknown,
  token = tokenA,
  key = randomUUID(),
) {
  const response = await app.inject({
    method: method as any,
    url: `/api/v1${path}`,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    ...(body === undefined ? {} : { payload: body as any }),
  });
  return { status: response.statusCode, body: response.json(), headers: response.headers };
}
async function freshTable() {
  return atomic(a.actor, randomUUID(), 'test.table', {}, (s) =>
    s.insert('dining_tables', {
      number: randomUUID().slice(0, 8),
      public_code: randomUUID(),
      capacity: 4,
    }),
  );
}
async function draft(
  table: Row,
  quantity = 1,
  policy = 'POSTPAID',
  product = a.products[0],
  token = tokenA,
) {
  const r = await req(
    'POST',
    '/orders',
    {
      table_id: table.id,
      source: token === tokenA ? 'WAITER' : 'CUSTOMER',
      payment_policy: policy,
      items: [{ product_id: product.id, quantity, modifiers: [] }],
    },
    token,
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function confirmed(table: Row, quantity = 1, product = a.products[0]) {
  const order = await draft(table, quantity, 'POSTPAID', product);
  const r = await req('POST', `/orders/${order.id}/confirm`, {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function tickets(order: Row) {
  const s = view(a.actor);
  const items = await s.list('order_items', sql`order_id=${order.id}`);
  const all: Row[] = [];
  for (const i of items) all.push(...(await s.list('tickets', sql`order_item_id=${i.id}`)));
  return all;
}
async function visitor(table: Row, join_code?: string) {
  return req(
    'POST',
    '/public/' + (await unitSlug()) + '/visitor-sessions',
    {
      table_code: table.public_code,
      name: 'Cliente de teste',
      phone: '+5511999990000',
      ...(join_code ? { join_code } : {}),
    },
    '',
  );
}
async function unitSlug() {
  return (await rows(db, sql`SELECT slug FROM establishments WHERE id=${a.establishment_id}`))[0]
    .slug;
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL deve apontar para um banco exclusivo com sufixo _test.');
  await migrate();
  await migrate();
  const suffix = randomUUID().slice(0, 8);
  a = await provision({
    slug: `test-a-${suffix}`,
    name: 'Bar A',
    owner_email: `a-${suffix}@test.local`,
    owner_name: 'Admin A',
    password,
    demo: true,
  });
  b = await provision({
    slug: `test-b-${suffix}`,
    name: 'Bar B',
    owner_email: `b-${suffix}@test.local`,
    owner_name: 'Admin B',
    password,
    demo: true,
  });
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  const login = async (email: string, slug: string) => {
    const r = await req('POST', '/auth/login', { email, password, establishment_slug: slug }, '');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.token;
  };
  tokenA = await login(`a-${suffix}@test.local`, `test-a-${suffix}`);
  tokenB = await login(`b-${suffix}@test.local`, `test-b-${suffix}`);
  for (const n of [1, 2]) {
    await atomic(a.actor, randomUUID(), 'test.staff', {}, (s) =>
      createStaff(s, {
        name: `Garçom ${n}`,
        email: `waiter${n}-${suffix}@test.local`,
        password,
        role_id: a.roles.find((r) => r.name === 'Garçom')!.id,
      }),
    );
    const t = await login(`waiter${n}-${suffix}@test.local`, `test-a-${suffix}`);
    if (n === 1) waiter1 = t;
    else waiter2 = t;
  }
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
describe('MySQL: isolamento, autenticação e contratos', () => {
  it('migrations aplicam e reexecutam sem alterar a versão', async () => {
    const versions = await rows(db, sql`SELECT * FROM schema_migrations`);
    expect(versions.length).toBeGreaterThan(0);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
  });
  it('bloqueia leitura e referência entre tenants', async () => {
    const result = await req('GET', `/tables/${a.tables[0].id}/session`, undefined, tokenB);
    expect(result.status).toBe(404);
    const write = await req(
      'POST',
      '/products',
      {
        name: 'Intruso',
        price: '1.00',
        stock_policy: 'NO_CONTROL',
        category_id: (await view(a.actor).list('categories'))[0].id,
      },
      tokenB,
    );
    expect(write.status).toBe(409);
  });
  it('nega escopo e preço injetados pelo browser', async () => {
    const r = await req('POST', '/products', {
      name: 'Produto',
      price: '1.00',
      stock_policy: 'NO_CONTROL',
      tenant_id: a.tenant_id,
    });
    expect(r.status).toBe(400);
  });
  it('aplica RBAC granular e nega criação de catálogo para garçom', async () => {
    expect(
      (
        await req(
          'POST',
          '/products',
          { name: 'Intruso', price: '1.00', stock_policy: 'NO_CONTROL' },
          waiter1,
        )
      ).status,
    ).toBe(403);
  });
  it('rotaciona refresh e rejeita reutilização', async () => {
    const email = (await rows(db, sql`SELECT email FROM users WHERE id=${a.user_id}`))[0].email;
    const logged = await req(
      'POST',
      '/auth/login',
      { email, password, establishment_slug: await unitSlug() },
      '',
    );
    const next = await req(
      'POST',
      '/auth/refresh',
      { refresh_token: logged.body.refresh_token },
      '',
    );
    expect(next.status).toBe(200);
    expect(
      (await req('POST', '/auth/refresh', { refresh_token: logged.body.refresh_token }, '')).status,
    ).toBe(401);
    expect((await req('GET', '/me', undefined, logged.body.token)).status).toBe(401);
  });
  it('publica OpenAPI e exige idempotência nas mutações', async () => {
    expect(
      (await req('GET', '/openapi.json', undefined, '')).body.paths['/api/v1/orders'],
    ).toBeDefined();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });
});
describe('Pedidos, ocupação e financeiro', () => {
  it('identificação não ocupa e pré-pago só confirma após aprovação', async () => {
    const table = await freshTable();
    const v = await visitor(table);
    expect(v.status).toBe(200);
    expect(await view(a.actor).list('table_sessions', sql`table_id=${table.id}`)).toHaveLength(0);
    const order = await draft(table, 2, 'PREPAID', a.products[0], v.body.token);
    expect((await req('POST', `/orders/${order.id}/confirm`, {}, v.body.token)).status).toBe(402);
    const intent = await req('POST', '/payments/intents', { order_id: order.id }, v.body.token);
    expect(intent.status, JSON.stringify(intent.body)).toBe(200);
    const paid = await req('POST', '/sandbox/pay', { intent_id: intent.body.id }, v.body.token);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.order.status).toBe('CONFIRMED');
    expect(await tickets(order)).toHaveLength(2);
    expect((await req('GET', '/my-tabs', undefined, v.body.token)).body[0].financial.balance).toBe(
      '0.00',
    );
    expect((await req('GET', '/my-tickets', undefined, v.body.token)).body[0].token).toHaveLength(
      43,
    );
  });
  it('dois primeiros pedidos concorrentes criam uma sessão ativa', async () => {
    const table = await freshTable();
    const [one, two] = await Promise.all([draft(table), draft(table)]);
    const results = await Promise.all([
      req('POST', `/orders/${one.id}/confirm`, {}),
      req('POST', `/orders/${two.id}/confirm`, {}),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await view(a.actor).list('table_sessions', sql`table_id=${table.id} AND status<>'CLOSED'`),
    ).toHaveLength(1);
  });
  it('repetição com mesma chave não duplica e outro conteúdo conflita', async () => {
    const table = await freshTable();
    const body = {
      table_id: table.id,
      source: 'WAITER',
      payment_policy: 'POSTPAID',
      items: [{ product_id: a.products[1].id, quantity: 1, modifiers: [] }],
    };
    const key = randomUUID();
    const [r1, r2] = await Promise.all([
      req('POST', '/orders', body, tokenA, key),
      req('POST', '/orders', body, tokenA, key),
    ]);
    expect(r1.status).toBe(200);
    expect(r1.body.id).toBe(r2.body.id);
    expect(
      (
        await req(
          'POST',
          '/orders',
          { ...body, items: [{ ...body.items[0], quantity: 2 }] },
          tokenA,
          key,
        )
      ).status,
    ).toBe(409);
  });
  it('recebe parcialmente, aplica desconto e calcula saldo exato', async () => {
    const order = await confirmed(await freshTable(), 2);
    await req('POST', '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '10.00' }],
    });
    await req('POST', `/tabs/${order.tab_id}/discount`, {
      amount: '3.00',
      reason: 'Cortesia autorizada',
    });
    const tab = await req('GET', `/tabs/${order.tab_id}`);
    expect(tab.body.financial).toMatchObject({
      charges: '28.00',
      credits: '3.00',
      paid: '10.00',
      balance: '15.00',
    });
    const over = await req('POST', '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '16.00' }],
    });
    expect(over.status).toBe(400);
  });
  it('estorno parcial é auditado e não apaga recebimento', async () => {
    const order = await confirmed(await freshTable());
    const p = await req('POST', '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '14.00' }],
    });
    const refund = await req('POST', `/payments/${p.body.id}/refund`, {
      amount: '4.00',
      tab_id: order.tab_id,
      reason: 'Ajuste solicitado',
    });
    expect(refund.status).toBe(200);
    const tab = await req('GET', `/tabs/${order.tab_id}`);
    expect(tab.body.financial.balance).toBe('4.00');
    expect((await view(a.actor).get('payments', p.body.id)).status).toBe('PARTIALLY_REFUNDED');
  });
  it('mantém comandas compartilhada e individual na mesma sessão', async () => {
    const table = await freshTable();
    const order = await confirmed(table, 1, a.products[1]);
    const details = await req('GET', `/tables/${table.id}/session`);
    const tab = await req('POST', '/tabs', {
      session_id: details.body.session.id,
      mode: 'INDIVIDUAL',
      label: 'Individual',
    });
    const draftOrder = await draft(table, 1, 'POSTPAID', a.products[1]);
    const second = await req('POST', `/orders/${draftOrder.id}/confirm`, {});
    expect(tab.status).toBe(200);
    expect(order.tab_id).not.toBe(second.body.tab_id);
    expect((await req('GET', `/tabs/${order.tab_id}`)).body.financial.balance).toBe('5.00');
  });
  it('mantém pagamento aprovado para revisão quando outro grupo ocupa primeiro', async () => {
    const table = await freshTable();
    const v = await visitor(table);
    const prepaid = await draft(table, 1, 'PREPAID', a.products[1], v.body.token);
    const intent = await req('POST', '/payments/intents', { order_id: prepaid.id }, v.body.token);
    await confirmed(table, 1, a.products[1]);
    const paid = await req('POST', '/sandbox/pay', { intent_id: intent.body.id }, v.body.token);
    expect(paid.status).toBe(200);
    expect(paid.body.payment.status).toBe('APPROVED');
    expect(paid.body.requires_review).toBeTruthy();
    expect(await tickets(prepaid)).toHaveLength(0);
  });
});
describe('Fichas, estoque, atendimento e fechamento', () => {
  it('duas tentativas concorrentes usam a ficha e baixam estoque uma vez', async () => {
    const order = await confirmed(await freshTable());
    const [t] = await tickets(order);
    const document = await req('GET', `/tickets/${t.id}`);
    const before = (
      await view(a.actor).list('stock_balances', sql`product_id=${a.products[0].id}`)
    )[0];
    const results = await Promise.all([
      req('POST', `/tickets/${t.id}/redeem`, { token: document.body.token }, waiter1),
      req('POST', `/tickets/${t.id}/redeem`, { token: document.body.token }, waiter2),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await view(a.actor).get('stock_balances', before.id);
    expect(Number(before.physical_quantity) - Number(after.physical_quantity)).toBe(1);
    expect(
      await view(a.actor).list('stock_movements', sql`ticket_id=${t.id} AND type='CONSUMPTION'`),
    ).toHaveLength(1);
  });
  it('NO_CONTROL não gera reserva nem baixa', async () => {
    const order = await confirmed(await freshTable(), 1, a.products[1]);
    const [t] = await tickets(order);
    const d = await req('GET', `/tickets/${t.id}`);
    await req('POST', `/tickets/${t.id}/redeem`, { token: d.body.token });
    expect(await view(a.actor).list('stock_movements', sql`ticket_id=${t.id}`)).toHaveLength(0);
  });
  it('ON_CONFIRMATION não baixa novamente na entrega', async () => {
    const p = await req('POST', '/products', {
      name: 'Baixa na confirmação',
      price: '1.00',
      stock_policy: 'ON_CONFIRMATION',
    });
    await req('POST', '/stock-balances', { location_id: a.location.id, product_id: p.body.id });
    const balance = (await view(a.actor).list('stock_balances', sql`product_id=${p.body.id}`))[0];
    await req('POST', '/inventory/adjustments', {
      balance_id: balance.id,
      quantity: '5.000',
      type: 'PURCHASE',
      reason: 'Compra inicial',
    });
    const order = await confirmed(await freshTable(), 1, p.body);
    const [t] = await tickets(order);
    const d = await req('GET', `/tickets/${t.id}`);
    expect((await view(a.actor).get('stock_balances', balance.id)).physical_quantity).toBe('4.000');
    await req('POST', `/tickets/${t.id}/redeem`, { token: d.body.token });
    expect((await view(a.actor).get('stock_balances', balance.id)).physical_quantity).toBe('4.000');
  });
  it('produção controla disponibilidade e baixa apenas ao marcar pronto', async () => {
    const order = await confirmed(await freshTable(), 1, a.products[2]);
    const [t] = await tickets(order);
    const job = (await view(a.actor).list('production_jobs', sql`ticket_id=${t.id}`))[0];
    const d = await req('GET', `/tickets/${t.id}`);
    expect((await req('POST', `/tickets/${t.id}/redeem`, { token: d.body.token })).status).toBe(
      409,
    );
    expect(
      (await req('POST', `/production/jobs/${job.id}/status`, { status: 'PREPARING' })).status,
    ).toBe(200);
    expect(
      (await req('POST', `/production/jobs/${job.id}/status`, { status: 'READY' })).status,
    ).toBe(200);
    expect((await req('POST', `/tickets/${t.id}/redeem`, { token: d.body.token })).status).toBe(
      200,
    );
    expect(
      await view(a.actor).list('stock_movements', sql`ticket_id=${t.id} AND type='CONSUMPTION'`),
    ).toHaveLength(1);
  });
  it('RECIPE reserva e consome a quantidade histórica do ingrediente', async () => {
    const order = await confirmed(await freshTable(), 1, a.products[3]);
    const [t] = await tickets(order);
    const reservation = (await view(a.actor).list('stock_reservations', sql`ticket_id=${t.id}`))[0];
    expect(reservation.quantity).toBe('0.050');
    const d = await req('GET', `/tickets/${t.id}`);
    await req('POST', `/tickets/${t.id}/redeem`, { token: d.body.token });
    expect((await view(a.actor).get('stock_reservations', reservation.id)).status).toBe('CONSUMED');
  });
  it('cancela pedido sem apagar histórico e libera a reserva', async () => {
    const order = await confirmed(await freshTable());
    const [t] = await tickets(order);
    const canceled = await req('POST', `/orders/${order.id}/cancel`, {
      reason: 'Cliente desistiu antes da entrega',
    });
    expect(canceled.status).toBe(200);
    expect((await view(a.actor).get('tickets', t.id)).status).toBe('CANCELLED');
    expect((await req('GET', `/tabs/${order.tab_id}`)).body.financial.balance).toBe('0.00');
    expect((await view(a.actor).list('stock_reservations', sql`ticket_id=${t.id}`))[0].status).toBe(
      'RELEASED',
    );
  });
  it('solicitação é idempotente e somente um garçom assume', async () => {
    const table = await freshTable();
    const v = await visitor(table);
    const order = await draft(table, 1, 'PREPAID', a.products[0], v.body.token);
    const intent = await req('POST', '/payments/intents', { order_id: order.id }, v.body.token);
    await req('POST', '/sandbox/pay', { intent_id: intent.body.id }, v.body.token);
    const [t] = await tickets(order);
    const [r1, r2] = await Promise.all([
      req('POST', `/tickets/${t.id}/request`, {}, v.body.token),
      req('POST', `/tickets/${t.id}/request`, {}, v.body.token),
    ]);
    expect(r1.body.id).toBe(r2.body.id);
    const claims = await Promise.all([
      req('POST', `/service-requests/${r1.body.id}/claim`, {}, waiter1),
      req('POST', `/service-requests/${r1.body.id}/claim`, {}, waiter2),
    ]);
    expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('bloqueia estoque insuficiente sem ocupar a mesa nem criar fichas', async () => {
    const product = await req('POST', '/products', {
      name: 'Sem saldo',
      price: '5.00',
      stock_policy: 'ON_DELIVERY',
    });
    await req('POST', '/stock-balances', {
      location_id: a.location.id,
      product_id: product.body.id,
    });
    const table = await freshTable();
    const before = (await view(a.actor).list('orders')).length;
    const result = await req('POST', '/orders', {
      table_id: table.id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: product.body.id, quantity: 1, modifiers: [] }],
    });
    expect(result.body.error.code).toBe('OUT_OF_STOCK');
    expect((await view(a.actor).list('orders')).length).toBe(before);
    expect(await view(a.actor).list('table_sessions', sql`table_id=${table.id}`)).toHaveLength(0);
  });
  it('exige saldo zero, entrega resolvida e liberação explícita', async () => {
    const table = await freshTable();
    const order = await confirmed(table);
    const first = await req('POST', `/tables/${table.id}/checkout`, {});
    expect(first.body.status).toBe('CLOSING');
    expect((await req('POST', `/tables/${table.id}/release`, {})).status).toBe(409);
    await req('POST', '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '14.00' }],
    });
    const [t] = await tickets(order);
    const d = await req('GET', `/tickets/${t.id}`);
    await req('POST', `/tickets/${t.id}/redeem`, { token: d.body.token });
    expect((await req('POST', `/tables/${table.id}/checkout`, {})).body.status).toBe(
      'AWAITING_RELEASE',
    );
    expect(
      await view(a.actor).list('table_sessions', sql`table_id=${table.id} AND status<>'CLOSED'`),
    ).toHaveLength(1);
    expect((await req('POST', `/tables/${table.id}/release`, {}, waiter1)).status).toBe(200);
    expect((await req('GET', `/tables/${table.id}/session`)).body.session).toBeNull();
  });
});
describe('Unidades, divisão financeira e segurança adicional', () => {
  it('aparência é validada, restrita ao administrador e isolada por unidade', async () => {
    const changed = await req('PATCH', '/settings', { primary_color: '#8b5cf6' });
    expect(changed.status).toBe(200);
    expect((await req('GET', '/appearance')).body.primary_color).toBe('#8b5cf6');
    expect((await req('GET', '/appearance', undefined, tokenB)).body.primary_color).toBe('#2584f8');
    expect((await req('PATCH', '/settings', { primary_color: '#ff0000' }, waiter1)).status).toBe(
      403,
    );
    expect((await req('PATCH', '/settings', { primary_color: 'red' })).status).toBe(400);
    const menu = await req('GET', '/public/' + (await unitSlug()) + '/menu', undefined, '');
    expect(menu.body.establishment.primary_color).toBe('#8b5cf6');
    await req('PATCH', '/settings', { primary_color: '#2584f8' });
  });

  it('inclui todo o livro financeiro mesmo acima de dez mil lançamentos', async () => {
    const order = await confirmed(await freshTable(), 1, a.products[1]);
    await atomic(a.actor, randomUUID(), 'test.large-ledger', {}, async (s) => {
      for (let start = 0; start < 10001; start += 1000) {
        const values = Array.from({ length: Math.min(1000, 10001 - start) }, () => {
          const id = randomUUID();
          return sql`(${id},${a.tenant_id},${a.establishment_id},${order.tab_id},'CHARGE','0.01',${`large:${id}`},${a.user_id})`;
        });
        await s.tx.execute(
          sql`INSERT INTO financial_entries(id,tenant_id,establishment_id,tab_id,type,amount,source_key,created_by) VALUES ${sql.join(values, sql`, `)}`,
        );
      }
      return { inserted: 10001 };
    });
    expect((await req('GET', `/tabs/${order.tab_id}`)).body.financial.balance).toBe('105.01');
  });

  it('isola duas unidades da mesma empresa com FK composta', async () => {
    const slug = `unit-${randomUUID().slice(0, 8)}`;
    const unit = await req('POST', '/establishments', { name: 'Outra unidade ' + slug });
    expect(unit.status, JSON.stringify(unit.body)).toBe(200);
    const email = (await rows(db, sql`SELECT email FROM users WHERE id=${a.user_id}`))[0].email;
    const auth = await req(
      'POST',
      '/auth/login',
      { email, password, establishment_slug: unit.body.slug },
      '',
    );
    expect(auth.status).toBe(200);
    expect(
      (await req('GET', `/tables/${a.tables[0].id}/session`, undefined, auth.body.token)).status,
    ).toBe(404);
    const category = (await view(a.actor).list('categories'))[0];
    expect(
      (
        await req(
          'POST',
          '/products',
          {
            name: 'Referência cruzada',
            price: '2.00',
            stock_policy: 'NO_CONTROL',
            category_id: category.id,
          },
          auth.body.token,
        )
      ).status,
    ).toBe(409);
  });
  it('divide um pagamento entre duas comandas sem misturar saldos', async () => {
    const table = await freshTable();
    const one = await confirmed(table, 1, a.products[1]);
    const two = await confirmed(table, 1, a.products[1]);
    const paid = await req('POST', '/payments/manual', {
      method: 'CARD_MANUAL',
      allocations: [
        { tab_id: one.tab_id, amount: '5.00' },
        { tab_id: two.tab_id, amount: '3.00' },
      ],
    });
    expect(paid.status).toBe(200);
    expect((await req('GET', `/tabs/${one.tab_id}`)).body.financial.balance).toBe('0.00');
    expect((await req('GET', `/tabs/${two.tab_id}`)).body.financial.balance).toBe('2.00');
    expect(
      (
        await req('POST', `/payments/${paid.body.id}/refund`, {
          amount: '4.00',
          tab_id: two.tab_id,
          reason: 'Excede alocação',
        })
      ).status,
    ).toBe(400);
  });
  it('transfere itens mantendo snapshots e fichas; cancelamento compensa cada comanda', async () => {
    const table = await freshTable();
    const draft = await req('POST', '/orders', {
      table_id: table.id,
      source: 'WAITER',
      payment_policy: 'POSTPAID',
      items: [
        { product_id: a.products[0].id, quantity: 1, modifiers: [] },
        { product_id: a.products[1].id, quantity: 1, modifiers: [] },
      ],
    });
    const order = (await req('POST', `/orders/${draft.body.id}/confirm`, {})).body;
    const session = (await req('GET', `/tables/${table.id}/session`)).body.session;
    const target = await req('POST', '/tabs', {
      session_id: session.id,
      mode: 'INDIVIDUAL',
      label: 'Pessoa 2',
    });
    const detail = await req('GET', `/orders/${order.id}`);
    const item = detail.body.items.find((i: Row) => i.product_id === a.products[0].id);
    const transfer = await req('POST', `/tabs/${order.tab_id}/transfer-items`, {
      item_ids: [item.id],
      target_tab_id: target.body.id,
    });
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(200);
    const transferredTicket = (await req('GET', '/tickets')).body.find(
      (ticket: Row) => ticket.order_item_id === item.id,
    );
    expect(transferredTicket.tab_label).toBe('Pessoa 2');
    expect(transferredTicket.order_id).toBe(order.id);
    expect((await req('GET', `/tickets/${transferredTicket.id}`)).body.tab_label).toBe('Pessoa 2');
    expect((await req('GET', `/orders/${order.id}`)).body.tab_labels).toContain('Pessoa 2');

    expect((await req('GET', `/tabs/${order.tab_id}`)).body.financial.balance).toBe('5.00');
    expect((await req('GET', `/tabs/${target.body.id}`)).body.financial.balance).toBe('14.00');
    expect(await tickets(order)).toHaveLength(2);
    expect(
      (await req('POST', `/orders/${order.id}/cancel`, { reason: 'Cancelamento após divisão' }))
        .status,
    ).toBe(200);
    expect((await req('GET', `/tabs/${order.tab_id}`)).body.financial.balance).toBe('0.00');
    expect((await req('GET', `/tabs/${target.body.id}`)).body.financial.balance).toBe('0.00');
  });
  it('não entrega uma ficha pré-paga após estorno', async () => {
    const table = await freshTable();
    const v = await visitor(table);
    const o = await draft(table, 1, 'PREPAID', a.products[1], v.body.token);
    const intent = await req('POST', '/payments/intents', { order_id: o.id }, v.body.token);
    const paid = await req('POST', '/sandbox/pay', { intent_id: intent.body.id }, v.body.token);
    const order = paid.body.order;
    await req('POST', `/payments/${paid.body.payment.id}/refund`, {
      amount: '5.00',
      tab_id: order.tab_id,
      reason: 'Cancelamento solicitado',
    });
    const [ticket] = await tickets(order);
    const doc = await req('GET', `/tickets/${ticket.id}`);
    expect(
      (await req('POST', `/tickets/${ticket.id}/redeem`, { token: doc.body.token })).body.error
        .code,
    ).toBe('PAYMENT_REQUIRED');
  });
  it('confirmação e idempotência persistem após recriar a API', async () => {
    const order = await confirmed(await freshTable(), 1, a.products[1]);
    const second = await buildApp({ realtime: false, logger: false });
    await second.ready();
    try {
      const response = await second.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/confirm`,
        headers: { authorization: `Bearer ${tokenA}`, 'idempotency-key': randomUUID() },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(await tickets(order)).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
  it('nega administração SaaS ao proprietário de bar', async () =>
    expect((await req('GET', '/saas/tenants')).status).toBe(403));
  it('não permite que gestor de equipe atribua perfil superior ao próprio', async () => {
    const role = await req('POST', '/roles', {
      name: `Gestor limitado ${randomUUID().slice(0, 5)}`,
      permissions: ['staff.manage'],
    });
    const email = `limited-${randomUUID().slice(0, 8)}@test.local`;
    await req('POST', '/staff', {
      name: 'Gestor limitado',
      email,
      password,
      role_id: role.body.id,
    });
    const auth = await req(
      'POST',
      '/auth/login',
      { email, password, establishment_slug: await unitSlug() },
      '',
    );
    const escalation = await req(
      'POST',
      '/staff',
      {
        name: 'Escalada',
        email: `escalation-${randomUUID()}@test.local`,
        password,
        role_id: a.roles[0].id,
      },
      auth.body.token,
    );
    expect(escalation.status).toBe(403);
  });
  it('provisiona tenant SaaS com auditoria e repetição idempotente', async () => {
    await db.execute(sql`UPDATE users SET is_superadmin=TRUE WHERE id=${a.user_id}`);
    try {
      const slug = `provisioned-${randomUUID().slice(0, 8)}`;
      const body = {
        name: 'Novo cliente SaaS',
        owner_email: `${slug}@test.local`,
        owner_name: 'Novo proprietário',
        password,
      };
      const key = randomUUID();
      const first = await req('POST', '/saas/tenants', body, tokenA, key);
      const second = await req('POST', '/saas/tenants', body, tokenA, key);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.tenant_id).toBe(second.body.tenant_id);
      expect(
        await rows(
          db,
          sql`SELECT id FROM saas_audit_logs WHERE aggregate_id=${first.body.tenant_id}`,
        ),
      ).toHaveLength(1);
    } finally {
      await db.execute(sql`UPDATE users SET is_superadmin=FALSE WHERE id=${a.user_id}`);
    }
  });
});
describe('Gateway, impressão e durabilidade', () => {
  it('rejeita webhook forjado e processa assinatura e repetição idempotentemente', async () => {
    const table = await freshTable();
    const v = await visitor(table);
    const o = await draft(table, 1, 'PREPAID', a.products[1], v.body.token);
    const intent = await req('POST', '/payments/intents', { order_id: o.id }, v.body.token);
    const event = {
      event_id: randomUUID(),
      reference: intent.body.provider_reference,
      amount: '5.00',
      status: 'APPROVED',
      settled: false,
    };
    const payload = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET!)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    const send = (sig: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/payments/sandbox',
        headers: {
          'content-type': 'application/json',
          'x-timestamp': timestamp,
          'x-signature': sig,
        },
        payload,
      });
    expect((await send('bad')).statusCode).toBe(401);
    expect((await send(signature)).statusCode).toBe(200);
    expect((await send(signature)).statusCode).toBe(200);
    expect(await tickets(o)).toHaveLength(1);
  });
  it('reimprime a mesma ficha e agente retoma job sem emitir novos direitos', async () => {
    const printer = await req('POST', '/printers', { name: 'Térmica de teste', sector: 'bar' });
    const other = await req('POST', '/printers', { name: 'Outro dispositivo', sector: 'outro' });
    const order = await confirmed(await freshTable());
    const [t] = await tickets(order);
    const original = await req('GET', `/tickets/${t.id}`);
    const again = await req('POST', `/tickets/${t.id}/reprint`, { reason: 'Papel terminou' });
    expect(again.status).toBe(200);
    expect((await req('GET', `/tickets/${t.id}`)).body.token).toBe(original.body.token);
    expect(await tickets(order)).toHaveLength(1);
    const created = await req('POST', '/print/agents', { name: 'Agente de teste' });
    const agentToken = created.body.token;
    expect(agentToken).toBeTruthy();
    const unrelated = await req(
      'POST',
      '/print/jobs/claim',
      { printer_ids: [other.body.id] },
      agentToken,
    );
    expect(unrelated.body.idle).toBe(true);
    const claimed = await req(
      'POST',
      '/print/jobs/claim',
      { printer_ids: [printer.body.id] },
      agentToken,
    );
    expect(claimed.body.printer.id).toBe(printer.body.id);
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    const doc = await req('GET', `/print/jobs/${claimed.body.id}/document`, undefined, agentToken);
    expect(doc.status).toBe(200);
    expect(doc.body.token).toHaveLength(43);
    expect(
      (await req('POST', `/print/jobs/${claimed.body.id}/finish`, { success: true }, agentToken))
        .status,
    ).toBe(200);
    const cached = await view(a.actor).list(
      'idempotency_records',
      sql`operation='print.agent.create'`,
    );
    expect(JSON.stringify(cached)).not.toContain(agentToken);
  });
  it('mudança principal e outbox/auditoria são persistidas juntas', async () => {
    const table = await freshTable();
    const order = await confirmed(table);
    expect(
      await view(a.actor).list(
        'outbox_events',
        sql`aggregate_id=${order.id} AND event='order.confirmed'`,
      ),
    ).toHaveLength(1);
    expect(
      await view(a.actor).list(
        'audit_logs',
        sql`aggregate_id=${order.id} AND action='order.confirmed'`,
      ),
    ).toHaveLength(1);
  });
  it('FK composta impede referência entre unidades mesmo com SQL direto', async () => {
    const foreignActor: Actor = { ...a.actor, establishmentId: b.establishment_id };
    await expect(
      atomic(foreignActor, randomUUID(), 'test.fk', {}, (s) =>
        s.insert('categories', { name: 'Inválido' }),
      ),
    ).rejects.toThrow();
    expect(permissions).toContain('ticket.redeem');
  });
});

describe('Contexto operacional para pedidos e fichas', () => {
  it('inclui referências úteis sem expor tokens ou dados de outra unidade', async () => {
    const table = await freshTable();
    const order = await confirmed(table, 2, a.products[1]);
    const listed = (await req('GET', '/orders')).body.find((row: Row) => row.id === order.id);
    expect(listed.table_number).toBe(table.number);
    expect(Math.abs(Date.now() - Date.parse(listed.created_at_iso))).toBeLessThan(60000);
    expect(listed.item_count).toBe(2);
    expect(listed.ticket_count).toBe(2);
    expect(listed.items_summary).toContain('2 ×');
    expect(listed.tab_label).toBeTruthy();
    const detail = (await req('GET', `/orders/${order.id}`)).body;
    expect(detail.tickets).toHaveLength(2);
    const issued = (await req('GET', '/tickets')).body.filter(
      (row: Row) => row.order_id === order.id,
    );
    expect(issued).toHaveLength(2);
    expect(issued[0]).toMatchObject({
      table_id: table.id,
      table_number: table.number,
      product: a.products[1].name,
    });
    for (const ticket of [...issued, ...detail.tickets]) {
      expect(ticket).not.toHaveProperty('token');
      expect(ticket).not.toHaveProperty('token_hash');
      expect(ticket).not.toHaveProperty('token_nonce');
    }
    expect((await req('GET', `/orders/${order.id}`, undefined, tokenB)).status).toBe(404);
    expect(
      (await req('GET', '/orders', undefined, tokenB)).body.some(
        (row: Row) => row.table_id === table.id,
      ),
    ).toBe(false);
    expect(
      (await req('GET', '/tickets', undefined, tokenB)).body.some(
        (row: Row) => row.order_id === order.id,
      ),
    ).toBe(false);
    const catalog = await req('GET', '/catalog/operational', undefined, waiter1);
    expect(catalog.status).toBe(200);
    expect(catalog.body.products.some((product: Row) => product.id === a.products[1].id)).toBe(
      true,
    );
    expect(catalog.body).not.toHaveProperty('document_key');
    expect(
      (await req('GET', '/catalog/operational', undefined, tokenB)).body.products.some(
        (product: Row) => product.id === a.products[1].id,
      ),
    ).toBe(false);
  });
});

describe('Alertas de solicitação por mesa e entrega por garçom', () => {
  it('mantém o alerta ao assumir e limpa ao entregar ou cancelar, isolado por unidade', async () => {
    const table = await freshTable();
    const customer = await visitor(table);
    const order = await draft(table, 2, 'PREPAID', a.products[1], customer.body.token);
    const intent = await req(
      'POST',
      '/payments/intents',
      { order_id: order.id },
      customer.body.token,
    );
    const paid = await req(
      'POST',
      '/sandbox/pay',
      { intent_id: intent.body.id },
      customer.body.token,
    );
    expect(paid.status).toBe(200);
    const [first, second] = await tickets(paid.body.order);
    const state = async () =>
      (await req('GET', '/tables', undefined, waiter1)).body.find(
        (row: Row) => row.id === table.id,
      );
    expect((await state()).service_request_count).toBe(0);
    const request = await req('POST', `/tickets/${first.id}/request`, {}, customer.body.token);
    expect(request.status).toBe(200);
    expect(await state()).toMatchObject({ service_request_count: 1, unclaimed_request_count: 1 });
    expect(
      (await req('GET', '/tables', undefined, tokenB)).body.some((row: Row) => row.id === table.id),
    ).toBe(false);
    expect(
      (await req('POST', `/service-requests/${request.body.id}/claim`, {}, waiter1)).status,
    ).toBe(200);
    expect(await state()).toMatchObject({ service_request_count: 1, unclaimed_request_count: 0 });
    const document = (await req('GET', `/tickets/${first.id}`, undefined, waiter1)).body;
    expect(document.request_claimed_by).toBeTruthy();
    expect(document.tab_id).toBe(paid.body.order.tab_id);
    expect(document.session_id).toBeTruthy();
    expect(
      (await req('POST', `/tickets/${first.id}/redeem`, { token: document.token }, waiter2)).status,
    ).toBe(409);
    expect((await state()).service_request_count).toBe(1);
    expect(
      (await req('POST', `/tickets/${first.id}/redeem`, { token: document.token }, waiter1)).status,
    ).toBe(200);
    expect((await state()).service_request_count).toBe(0);
    const next = await req('POST', `/tickets/${second.id}/request`, {}, customer.body.token);
    expect((await state()).service_request_count).toBe(1);
    expect(
      (await req('POST', `/service-requests/${next.body.id}/cancel`, {}, customer.body.token))
        .status,
    ).toBe(200);
    expect((await state()).service_request_count).toBe(0);
  });
});

describe('Estorno no contexto do cancelamento', () => {
  async function prepaidForCancellation() {
    const table = await freshTable();
    const order = await draft(table, 1, 'PREPAID', a.products[1]);
    const intent = await req('POST', '/payments/intents', { order_id: order.id });
    const paid = await req('POST', '/sandbox/pay', { intent_id: intent.body.id });
    expect(paid.status).toBe(200);
    return { table, ...paid.body };
  }
  it('calcula o restante após estorno parcial e permite cancelar somente após quitar o estorno', async () => {
    const { order, payment } = await prepaidForCancellation();
    expect(
      (await req('GET', `/orders/${order.id}/cancellation-context`, undefined, tokenB)).status,
    ).toBe(404);
    expect(
      (await req('GET', `/orders/${order.id}/cancellation-context`, undefined, waiter1)).status,
    ).toBe(403);
    const initial = (await req('GET', `/orders/${order.id}/cancellation-context`)).body;
    expect(initial).toMatchObject({
      can_cancel: false,
      can_refund: true,
      refund_required_amount: '5.00',
      cancellation_blockers: [],
    });
    expect(initial.refund_targets[0]).toMatchObject({
      payment_id: payment.id,
      tab_id: order.tab_id,
      refundable_amount: '5.00',
    });
    expect(
      (
        await req('POST', `/payments/${payment.id}/refund`, {
          amount: '1.25',
          tab_id: order.tab_id,
          reason: 'Ajuste parcial de teste',
        })
      ).status,
    ).toBe(200);
    const partial = (await req('GET', `/orders/${order.id}/cancellation-context`)).body;
    expect(partial.refund_required_amount).toBe('3.75');
    expect(partial.refund_targets[0].refunded_amount).toBe('1.25');
    expect(partial.refund_targets[0].refundable_amount).toBe('3.75');
    expect(
      (await req('POST', `/orders/${order.id}/cancel`, { reason: 'Cliente desistiu' })).status,
    ).toBe(409);
    expect(
      (
        await req('POST', `/payments/${payment.id}/refund`, {
          amount: '3.75',
          tab_id: order.tab_id,
          reason: 'Restante do cancelamento',
        })
      ).status,
    ).toBe(200);
    expect((await req('GET', `/orders/${order.id}/cancellation-context`)).body).toMatchObject({
      refund_required_amount: '0.00',
      can_cancel: true,
    });
    expect(
      (await req('POST', `/orders/${order.id}/cancel`, { reason: 'Cliente desistiu' })).status,
    ).toBe(200);
    expect((await req('GET', `/tabs/${order.tab_id}`)).body.financial.balance).toBe('0.00');
  });
  it('explica bloqueio por entrega e por comanda encerrada sem liberar cancelamento indevido', async () => {
    const { order, payment } = await prepaidForCancellation();
    const [ticket] = await tickets(order);
    const doc = (await req('GET', `/tickets/${ticket.id}`)).body;
    expect((await req('POST', `/tickets/${ticket.id}/redeem`, { token: doc.token })).status).toBe(
      200,
    );
    const delivered = (await req('GET', `/orders/${order.id}/cancellation-context`)).body;
    expect(delivered.can_cancel).toBe(false);
    expect(delivered.cancellation_blockers.join(' ')).toContain('já entregue');
    expect(delivered.refund_targets[0].refundable_amount).toBe('5.00');
    await req('POST', `/tables/${order.table_id}/checkout`, {});
    await req('POST', `/tables/${order.table_id}/release`, {});
    const closed = (await req('GET', `/orders/${order.id}/cancellation-context`)).body;
    expect(closed.refund_targets[0].blocked_reason).toContain('comanda está encerrada');
    expect(
      (
        await req('POST', `/payments/${payment.id}/refund`, {
          amount: '5.00',
          tab_id: order.tab_id,
          reason: 'Estorno após encerramento',
        })
      ).status,
    ).toBe(409);
  });
});

describe('gestão centralizada do produto e estoque por variação', () => {
  it('separa reserva, baixa e devolução por variação e preserva os componentes do pedido', async () => {
    const create = async (path: string, body: any) => {
      const r = await req('POST', path, body);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    };
    const location = await create('/stock-locations', {
      name: 'Estoque de variantes ' + randomUUID().slice(0, 4),
      is_default: false,
    });
    const product = await create('/products', {
      name: 'Produto por variação',
      price: '10.00',
      stock_policy: 'ON_DELIVERY',
      stock_location_id: location.id,
      enabled: true,
    });
    const variant = await create('/product-variants', {
      product_id: product.id,
      name: 'Grande',
      price: '15.00',
      enabled: true,
      stock_mode: 'OWN',
      stock_location_id: location.id,
    });
    const shared = await create('/stock-balances', {
      product_id: product.id,
      location_id: location.id,
    });
    const own = await create('/stock-balances', {
      product_id: product.id,
      location_id: location.id,
      variant_id: variant.id,
    });
    for (const balance of [shared, own])
      await create('/inventory/adjustments', {
        balance_id: balance.id,
        quantity: '10.000',
        type: 'PURCHASE',
        reason: 'Entrada inicial de teste',
      });
    const table = await freshTable();
    const order = await create('/orders', {
      table_id: table.id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: product.id, variant_id: variant.id, quantity: 2, modifiers: [] }],
    });
    await create(`/orders/${order.id}/confirm`, {});
    let context = (await req('GET', `/products/${product.id}/management`)).body;
    expect(context.balances.find((b: any) => b.id === own.id)).toMatchObject({
      physical_quantity: '10.000',
      reserved_quantity: '2.000',
    });
    expect(context.balances.find((b: any) => b.id === shared.id)).toMatchObject({
      physical_quantity: '10.000',
      reserved_quantity: '0.000',
    });
    const issued = await tickets(order);
    const doc = (await req('GET', '/tickets/' + issued[0].id)).body;
    await create('/tickets/' + doc.id + '/redeem', { token: doc.token });
    const changed = await req('PATCH', '/product-variants/' + variant.id, {
      stock_mode: 'SHARED',
      stock_location_id: null,
    });
    expect(changed.status).toBe(200);
    // A configuração futura muda, mas a segunda ficha conserva sua reserva no saldo original.
    const second = (await req('GET', '/tickets/' + issued[1].id)).body;
    await create('/tickets/' + second.id + '/redeem', { token: second.token });
    context = (await req('GET', `/products/${product.id}/management`)).body;
    expect(context.balances.find((b: any) => b.id === own.id)).toMatchObject({
      physical_quantity: '8.000',
      reserved_quantity: '0.000',
    });
    expect(
      (await req('POST', `/orders/${order.id}/cancel`, { reason: 'Entrega já realizada' })).status,
    ).toBe(409);
    await req('PATCH', '/product-variants/' + variant.id, {
      stock_mode: 'OWN',
      stock_location_id: location.id,
    });
    const reserved = await create('/orders', {
      table_id: table.id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: product.id, variant_id: variant.id, quantity: 2, modifiers: [] }],
    });
    await create(`/orders/${reserved.id}/confirm`, {});
    await req('PATCH', '/product-variants/' + variant.id, {
      stock_mode: 'SHARED',
      stock_location_id: null,
    });
    await create(`/orders/${reserved.id}/cancel`, { reason: 'Cancelar itens ainda não entregues' });
    context = (await req('GET', `/products/${product.id}/management`)).body;
    expect(context.balances.find((b: any) => b.id === own.id)).toMatchObject({
      physical_quantity: '8.000',
      reserved_quantity: '0.000',
    });
    expect(context.balances.find((b: any) => b.id === shared.id)).toMatchObject({
      physical_quantity: '10.000',
      reserved_quantity: '0.000',
    });
    const next = await create('/orders', {
      table_id: table.id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: product.id, variant_id: variant.id, quantity: 1, modifiers: [] }],
    });
    await create(`/orders/${next.id}/confirm`, {});
    context = (await req('GET', `/products/${product.id}/management`)).body;
    expect(context.balances.find((b: any) => b.id === shared.id).reserved_quantity).toBe('1.000');
    expect(
      context.movements.some((m: any) => m.balance_id === own.id && m.type === 'CANCELLATION'),
    ).toBe(true);
    expect((await req('GET', `/products/${product.id}/management`, undefined, tokenB)).status).toBe(
      404,
    );
    expect(
      (await req('GET', `/products/${product.id}/management`, undefined, waiter1)).status,
    ).toBe(403);
    const wrong = await req('POST', '/stock-balances', {
      product_id: a.products[0].id,
      location_id: location.id,
      variant_id: variant.id,
    });
    expect(wrong.status).toBe(400);
    expect(
      (
        await req('POST', '/stock-balances', {
          product_id: product.id,
          location_id: location.id,
          variant_id: variant.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req('POST', '/inventory/adjustments', {
          balance_id: shared.id,
          quantity: '0.000',
          type: 'COUNT',
          reason: 'Contagem abaixo da reserva',
        })
      ).status,
    ).toBe(409);
  });
  it('troca o padrão atomicamente, valida grupos e mantém vínculos isolados', async () => {
    const created = await req('POST', '/stock-locations', {
      name: 'Novo padrão de teste',
      is_default: false,
    });
    expect(created.status).toBe(200);
    expect((await req('POST', `/inventory/locations/${created.body.id}/default`, {})).status).toBe(
      200,
    );
    const locations = (await req('GET', '/stock-locations')).body;
    expect(locations.filter((l: any) => l.is_default)).toHaveLength(1);
    const old = locations.find((l: any) => l.id !== created.body.id);
    expect((await req('POST', `/inventory/locations/${old.id}/default`, {})).status).toBe(200);
    expect(
      (await req('POST', '/modifier-groups', { name: 'Inválido', min_choices: 2, max_choices: 1 }))
        .status,
    ).toBe(400);
    const group = (
      await req('POST', '/modifier-groups', {
        name: 'Grupo de teste',
        min_choices: 0,
        max_choices: 1,
      })
    ).body;
    const link = (
      await req('POST', '/product-modifiers', { product_id: a.products[0].id, group_id: group.id })
    ).body;
    expect((await req('DELETE', '/product-modifiers/' + link.id, undefined, tokenB)).status).toBe(
      404,
    );
    expect((await req('DELETE', '/product-modifiers/' + link.id)).status).toBe(200);
    expect((await req('GET', '/modifier-groups')).body.some((g: any) => g.id === group.id)).toBe(
      true,
    );
  });
});

it('financeiro exclusivo do administrador da conta, mesmo com perfil local de permissões completas', async () => {
  const full = await req('POST', '/staff', {
    name: 'Administrador local',
    email: `local-${randomUUID()}@test.local`,
    password,
    role_id: a.roles.find((r) => r.name === 'Administrador')!.id,
  });
  expect(full.status).toBe(200);
  const email = (await rows(db, sql`SELECT email FROM users WHERE id=${full.body.id}`))[0].email;
  const auth = await req(
    'POST',
    '/auth/login',
    { email, password, establishment_slug: await unitSlug() },
    '',
  );
  expect(auth.body.actor.isAccountAdmin).toBe(false);
  for (const path of [
    '/finance/context',
    '/finance/dashboard?start=2026-10-01&end=2026-10-28',
    '/finance/records?start=2026-10-01&end=2026-10-28',
  ]) {
    expect((await req('GET', path, undefined, auth.body.token)).status).toBe(403);
    expect((await req('GET', path, undefined, waiter1)).status).toBe(403);
  }
  expect((await req('GET', '/finance/context')).status).toBe(200);
  const foreign = await req(
    'GET',
    `/finance/dashboard?start=2026-10-01&end=2026-10-28&establishment_id=${b.establishment_id}`,
  );
  expect(foreign.status).toBe(404);
  expect((await req('GET', '/finance/dashboard?start=2026-10-29&end=2026-10-28')).status).toBe(400);
  expect((await req('GET', '/finance/dashboard?start=2024-01-01&end=2026-10-28')).status).toBe(400);
});

it('financeiro reconcilia faturamento, desconto, cancelamento, pagamento parcial, estorno e dinheiro físico sem duplicar valores', async () => {
  const suffix = randomUUID().slice(0, 8),
    slug = `finance-${suffix}`,
    email = `finance-${suffix}@test.local`;
  const f = await provision({
    slug,
    name: 'Financeiro isolado',
    owner_email: email,
    owner_name: 'Titular',
    password,
    demo: true,
  });
  const login = await req('POST', '/auth/login', { email, password, establishment_slug: slug }, '');
  const token = login.body.token;
  expect(login.body.actor.isAccountAdmin).toBe(true);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await req(method, path, body, token);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const create = async (quantity: number) => {
    const order = await call('POST', '/orders', {
      table_id: f.tables[0].id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: f.products[0].id, quantity, modifiers: [] }],
    });
    return call('POST', `/orders/${order.id}/confirm`, {});
  };
  const order = await create(2),
    cancelled = await create(1);
  await call('POST', `/orders/${cancelled.id}/cancel`, {
    reason: 'Cancelamento de teste financeiro',
  });
  const tab = await view(f.actor).get('tabs', order.tab_id);
  await call('POST', `/tabs/${tab.id}/discount`, {
    amount: '2.00',
    reason: 'Desconto de teste financeiro',
  });
  const cash = await call('POST', '/cash/sessions', {
    register_id: f.register.id,
    opening_amount: '100.00',
  });
  const payment = await call('POST', '/payments/manual', {
    method: 'CASH',
    cash_session_id: cash.id,
    allocations: [{ tab_id: tab.id, amount: '20.00' }],
  });
  await call('POST', `/payments/${payment.id}/refund`, {
    amount: '5.00',
    tab_id: tab.id,
    reason: 'Estorno parcial teste',
    cash_session_id: cash.id,
  });
  await call('POST', '/cash/movements', {
    cash_session_id: cash.id,
    type: 'SUPPLY',
    amount: '10.00',
    reason: 'Troco de teste',
  });
  await call('POST', '/cash/movements', {
    cash_session_id: cash.id,
    type: 'WITHDRAWAL',
    amount: '3.00',
    reason: 'Sangria de teste',
  });
  // Fixed dates only in this isolated test tenant: validate the midnight boundary in Brasília.
  for (const table of [
    'financial_entries',
    'payments',
    'refunds',
    'table_sessions',
    'orders',
    'cash_movements',
  ])
    await db.execute(
      sql`UPDATE ${sql.identifier(table)} SET created_at='2026-10-28 15:00:00' WHERE tenant_id=${f.tenant_id}`,
    );
  await db.execute(
    sql`UPDATE payments SET confirmed_at='2026-10-28 15:00:00' WHERE tenant_id=${f.tenant_id}`,
  );
  await db.execute(
    sql`UPDATE orders SET confirmed_at='2026-10-28 15:00:00' WHERE tenant_id=${f.tenant_id}`,
  );
  const path = '/finance/dashboard?start=2026-10-28&end=2026-10-28';
  let report = await call('GET', path);
  expect(report.totals).toMatchObject({
    revenue: '26.00',
    received: '15.00',
    average: '13.00',
    attendances: 1,
  });
  expect(Number(report.totals.gross)).toBe(42);
  expect(Number(report.totals.cancellations)).toBe(14);
  expect(Number(report.totals.discounts)).toBe(2);
  expect(Number(report.current.outstanding)).toBe(11);
  expect(Number(report.current.outstanding_tabs)).toBe(1);
  expect(Number(report.cash[0].expected)).toBe(122);
  expect(report.methods).toHaveLength(1);
  expect(Number(report.methods[0].gross)).toBe(20);
  expect(Number(report.methods[0].refunded)).toBe(5);
  expect(report.hourly).toHaveLength(1);
  expect(Number(report.hourly[0].hour)).toBe(12);
  expect(Number(report.hourly[0].amount)).toBe(26);
  expect(Number(report.flow[0].net)).toBe(15);
  const list = async (kind: string, extra = '') =>
    call('GET', `/finance/records?start=2026-10-28&end=2026-10-28&kind=${kind}${extra}`);
  expect((await list('sales', '&page_size=1')).rows).toHaveLength(1);
  expect((await list('sales', '&search=' + order.id)).total).toBe(1);
  expect((await list('sales', '&search=%25')).total).toBe(0);
  expect((await list('payments')).rows[0]).toMatchObject({ net: '15.00', refunded: '5.00' });
  expect((await list('receivables')).rows[0]).toMatchObject({ balance: '11.00' });
  expect((await list('movements')).total).toBe(4);
  const close = await call('POST', `/cash/sessions/${cash.id}/close`, { counted_amount: '120.00' });
  expect(close.difference).toBe('-2.00');
  await db.execute(
    sql`UPDATE cash_sessions SET closed_at='2026-10-28 16:00:00' WHERE id=${cash.id}`,
  );
  expect((await list('closures')).rows[0]).toMatchObject({
    expected: '122.00',
    difference: '-2.00',
  });
  await db.execute(
    sql`UPDATE refunds SET created_at='2026-10-28 02:59:59.999' WHERE tenant_id=${f.tenant_id}`,
  );
  report = await call('GET', path);
  expect(report.totals.received).toBe('20.00');
  expect(Number(report.totals.refunds)).toBe(0);
  expect(Number(report.comparison.refunds)).toBe(5);
  // A forged actor flag cannot bypass the persisted account relationship.
  await db.execute(
    sql`UPDATE tenant_memberships SET is_account_admin=FALSE WHERE tenant_id=${f.tenant_id} AND user_id=${f.user_id}`,
  );
  expect((await req('GET', path, undefined, token)).status).toBe(403);
});

it('revisão de fechamento não altera o atendimento e finalização valida pendências, ocupação e idempotência', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Produto revisão',
      price: '14.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const table = await freshTable(),
    order = await confirmed(table, 1, product);
  const path = `/tables/${table.id}`;
  let review = await req('GET', path + '/closing-review');
  expect(review.status).toBe(200);
  const sid = review.body.session_id;
  expect(review.body.status).toBe('OPEN');
  expect(review.body.issues).toHaveLength(2);
  expect(review.body.tickets).toHaveLength(1);
  expect(review.body.totals).toMatchObject({ total: '14.00', paid: '0.00', balance: '14.00' });
  expect((await view(a.actor).get('table_sessions', sid)).status).toBe('OPEN');
  expect((await view(a.actor).get('tabs', order.tab_id)).status).toBe('OPEN');
  expect((await req('GET', path + '/closing-review', undefined, tokenB)).status).toBe(404);
  expect((await req('POST', path + '/finalize', { session_id: sid })).status).toBe(409);
  expect((await view(a.actor).get('table_sessions', sid)).status).toBe('OPEN');
  expect(
    await view(a.actor).list('audit_logs', sql`aggregate_id=${sid} AND action='table.checkout'`),
  ).toHaveLength(0);
  await req('POST', '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: order.tab_id, amount: '14.00' }],
  });
  review = await req('GET', path + '/closing-review');
  expect(review.body.issues).toHaveLength(1);
  expect((await req('POST', path + '/finalize', { session_id: sid })).status).toBe(409);
  const [ticket] = await tickets(order);
  const detail = await req('GET', `/tickets/${ticket.id}`);
  await req('POST', `/tickets/${ticket.id}/redeem`, { token: detail.body.token });
  review = await req('GET', path + '/closing-review');
  expect(review.body.issues).toEqual([]);
  expect(review.body.can_finalize).toBe(true);
  // Another item arriving after the review must block the final action.
  const extra = await confirmed(table, 1, product);
  expect((await req('POST', path + '/finalize', { session_id: sid })).status).toBe(409);
  await req('POST', `/orders/${extra.id}/cancel`, { reason: 'Cancelar item de teste da revisão' });
  const key = randomUUID(),
    closed = await req('POST', path + '/finalize', { session_id: sid }, tokenA, key);
  expect(closed.status, JSON.stringify(closed.body)).toBe(200);
  expect(closed.body.status).toBe('CLOSED');
  expect((await req('POST', path + '/finalize', { session_id: sid }, tokenA, key)).body).toEqual(
    closed.body,
  );
  expect((await req('GET', path + '/session')).body.session).toBeNull();
  expect((await req('GET', path + '/closing-review')).body.session_id).toBeNull();
  const newOrder = await confirmed(table, 1, product);
  expect((await req('POST', path + '/finalize', { session_id: sid })).status).toBe(409);
  expect((await req('GET', path + '/session')).body.session.status).toBe('OPEN');
  expect(newOrder.tab_id).not.toBe(order.tab_id);
});

it('revisão respeita consulta, recebimento e liberação separados por perfil', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Produto revisão perfil',
      price: '14.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const table = await freshTable(),
    order = await confirmed(table, 1, product),
    sid = (await req('GET', `/tables/${table.id}/session`)).body.session.id;
  const role = await req('POST', '/roles', {
    name: 'Liberar após conferência ' + randomUUID().slice(0, 5),
    permissions: ['table.view', 'table.release'],
  });
  const email = `release-only-${randomUUID()}@test.local`;
  await req('POST', '/staff', {
    name: 'Liberador de teste',
    email,
    password,
    role_id: role.body.id,
  });
  const login = await req(
    'POST',
    '/auth/login',
    { email, password, establishment_slug: await unitSlug() },
    '',
  );
  const token = login.body.token;
  let review = await req('GET', `/tables/${table.id}/closing-review`, undefined, token);
  expect(review.status).toBe(200);
  expect(review.body.can_receive).toBe(false);
  expect(review.body.can_finalize).toBe(false);
  expect(
    (await req('POST', `/tables/${table.id}/finalize`, { session_id: sid }, token)).status,
  ).toBe(403);
  await req('POST', '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: order.tab_id, amount: '14.00' }],
  });
  const [ticket] = await tickets(order);
  const detail = await req('GET', `/tickets/${ticket.id}`);
  await req('POST', `/tickets/${ticket.id}/redeem`, { token: detail.body.token });
  await req('POST', `/tables/${table.id}/checkout`, {});
  review = await req('GET', `/tables/${table.id}/closing-review`, undefined, token);
  expect(review.body.can_finalize).toBe(true);
  expect(
    (await req('POST', `/tables/${table.id}/finalize`, { session_id: sid }, token)).status,
  ).toBe(200);
});

it('caixas exibem responsável e conferência exata, separam Pix/cartão do dinheiro e respeitam cash.manage', async () => {
  const register = await req('POST', '/cash-registers', {
    name: 'Caixa conferência ' + randomUUID().slice(0, 5),
  });
  expect(register.status).toBe(200);
  const product = await req('POST', '/products', {
    name: 'Produto caixa',
    price: '10.00',
    stock_policy: 'NO_CONTROL',
  });
  const table = await freshTable(),
    order = await confirmed(table, 4, product.body);
  const opened = await req('POST', '/cash/sessions', {
    register_id: register.body.id,
    opening_amount: '100.00',
  });
  expect(opened.status).toBe(200);
  const sid = opened.body.id;
  expect(
    (
      await req('POST', '/cash/sessions', {
        register_id: register.body.id,
        opening_amount: '10.00',
      })
    ).status,
  ).toBe(409);
  const cash = await req('POST', '/payments/manual', {
    method: 'CASH',
    cash_session_id: sid,
    allocations: [{ tab_id: order.tab_id, amount: '20.00' }],
  });
  expect(cash.status).toBe(200);
  expect(
    (
      await req('POST', `/payments/${cash.body.id}/refund`, {
        amount: '5.00',
        tab_id: order.tab_id,
        cash_session_id: sid,
        reason: 'Estorno de teste de caixa',
      })
    ).status,
  ).toBe(200);
  for (const [method, amount] of [
    ['PIX_MANUAL', '7.00'],
    ['CARD_MANUAL', '8.00'],
  ])
    expect(
      (
        await req('POST', '/payments/manual', {
          method,
          cash_session_id: sid,
          allocations: [{ tab_id: order.tab_id, amount }],
        })
      ).status,
    ).toBe(200);
  await req('POST', '/cash/movements', {
    cash_session_id: sid,
    type: 'SUPPLY',
    amount: '10.00',
    reason: 'Troco de teste',
  });
  await req('POST', '/cash/movements', {
    cash_session_id: sid,
    type: 'WITHDRAWAL',
    amount: '3.00',
    reason: 'Sangria de teste',
  });
  let all = await req('GET', '/cash/sessions');
  expect(all.status).toBe(200);
  let session = all.body.find((s: Row) => s.id === sid);
  expect(session.register_name).toBe(register.body.name);
  expect(session.opened_by_name).toBe('Admin A');
  for (const [field, value] of Object.entries({
    cash_sales: 20,
    pix_sales: 7,
    card_sales: 8,
    refunds: -5,
    supplies: 10,
    withdrawals: -3,
    expected_amount: 122,
    movement_count: 6,
  }))
    expect(Number(session[field])).toBe(value);
  expect(session.difference_amount).toBeNull();
  expect((await req('GET', '/cash/sessions', undefined, waiter1)).status).toBe(403);
  expect(
    (await req('GET', '/cash/sessions', undefined, tokenB)).body.some((s: Row) => s.id === sid),
  ).toBe(false);
  const email = `cash-profile-${randomUUID()}@test.local`;
  await req('POST', '/staff', {
    name: 'Operador caixa',
    email,
    password,
    role_id: a.roles.find((r) => r.name === 'Caixa')!.id,
  });
  const credentials = { email, password, establishment_slug: await unitSlug() };
  let auth = await req('POST', '/auth/login', credentials, '');
  // Respect the real login budget when the complete suite has already used it.
  if (auth.status === 429) {
    const seconds = Number(auth.headers['retry-after']);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    auth = await req('POST', '/auth/login', credentials, '');
  }
  expect(auth.status, JSON.stringify(auth.body)).toBe(200);
  expect(auth.body.actor.isAccountAdmin).toBe(false);
  expect((await req('GET', '/cash/sessions', undefined, auth.body.token)).status).toBe(200);
  expect((await req('GET', '/finance/context', undefined, auth.body.token)).status).toBe(403);
  const closed = await req('POST', `/cash/sessions/${sid}/close`, { counted_amount: '120.00' });
  expect(closed.status).toBe(200);
  expect(closed.body).toMatchObject({ expected: '122.00', difference: '-2.00' });
  all = await req('GET', '/cash/sessions');
  session = all.body.find((s: Row) => s.id === sid);
  expect(Number(session.expected_amount)).toBe(122);
  expect(Number(session.difference_amount)).toBe(-2);
  expect(session.closed_by_name).toBe('Admin A');
  expect(
    (
      await req('POST', '/cash/movements', {
        cash_session_id: sid,
        type: 'SUPPLY',
        amount: '1.00',
        reason: 'Não deve alterar turno fechado',
      })
    ).status,
  ).toBe(409);
}, 90000);

it('cupom respeita itens transferidos, pagamentos e estornos por comanda sem ratear recebimentos no pedido', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Café especial cupom',
      price: '12.50',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const small = (
    await req('POST', '/products', {
      name: 'Água do cupom',
      price: '5.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const table = await freshTable();
  const draft = await req('POST', '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [
      { product_id: product.id, quantity: 2, modifiers: [], notes: 'Sem açúcar' },
      { product_id: small.id, quantity: 1, modifiers: [] },
    ],
  });
  expect(draft.status).toBe(200);
  const order = (await req('POST', `/orders/${draft.body.id}/confirm`, {})).body;
  const service = (await req('GET', `/tables/${table.id}/session`)).body;
  const target = (
    await req('POST', '/tabs', {
      session_id: service.session.id,
      label: 'Conta B cupom',
      mode: 'INDIVIDUAL',
    })
  ).body;
  const details = (await req('GET', `/orders/${order.id}`)).body;
  const water = details.items.find((i: Row) => i.product_id === small.id);
  expect(
    (
      await req('POST', `/tabs/${order.tab_id}/transfer-items`, {
        item_ids: [water.id],
        target_tab_id: target.id,
      })
    ).status,
  ).toBe(200);
  await req('POST', `/tabs/${order.tab_id}/discount`, {
    amount: '2.00',
    reason: 'Desconto no cupom',
  });
  const payment = (
    await req('POST', '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '15.00' }],
    })
  ).body;
  await req('POST', `/payments/${payment.id}/refund`, {
    tab_id: order.tab_id,
    amount: '5.00',
    reason: 'Estorno do teste de cupom',
  });
  const tabDoc = await req('GET', `/tabs/${order.tab_id}/receipt?paper_width=58`);
  expect(tabDoc.status, JSON.stringify(tabDoc.body)).toBe(200);
  expect(tabDoc.body.items).toHaveLength(1);
  expect(tabDoc.body.items[0].name).toBe('Café especial cupom');
  expect(tabDoc.body.paper_width).toBe(58);
  expect(
    Math.abs(Date.parse(tabDoc.body.issued_at) - Date.parse(tabDoc.body.created_at)),
  ).toBeLessThan(30000);
  expect(tabDoc.body.totals).toEqual({
    subtotal: '25.00',
    cancelled: '0.00',
    discount: '2.00',
    adjustments: '0.00',
    total: '23.00',
    paid: '10.00',
    balance: '13.00',
  });
  expect(tabDoc.body.payments).toEqual([{ method: 'Pix', amount: '15.00', refunded: '5.00' }]);
  const targetDoc = (await req('GET', `/tabs/${target.id}/receipt`)).body;
  expect(targetDoc.items).toHaveLength(1);
  expect(targetDoc.totals.total).toBe('5.00');
  const orderDoc = (await req('GET', `/orders/${order.id}/receipt`)).body;
  expect(orderDoc.items).toHaveLength(2);
  expect(orderDoc.totals.total).toBe('30.00');
  expect(orderDoc.totals.paid).toBeNull();
  expect(orderDoc.totals.balance).toBeNull();
  expect((await req('GET', `/orders/${order.id}/receipt?paper_width=90`)).status).toBe(400);
  expect((await req('GET', `/tabs/${order.tab_id}/receipt`, undefined, tokenB)).status).toBe(404);
  const visitorToken = (await visitor(table, service.session.join_code)).body.token;
  expect((await req('GET', `/orders/${order.id}/receipt`, undefined, visitorToken)).status).toBe(
    403,
  );
  const pdf = await app.inject({
    method: 'GET',
    url: `/api/v1/tabs/${order.tab_id}/receipt.pdf?paper_width=58`,
    headers: { authorization: `Bearer ${tokenA}` },
  });
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers['content-type']).toContain('application/pdf');
  expect(pdf.headers['cache-control']).toContain('no-store');
  expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.rawPayload.toString('latin1')).toContain('/FontFile2');
  const wrong = await app.inject({
    method: 'GET',
    url: `/api/v1/tabs/${order.tab_id}/receipt.pdf`,
    headers: { authorization: `Bearer ${tokenB}` },
  });
  expect(wrong.statusCode).toBe(404);
});

it('cupom térmico usa snapshot imutável, fila idempotente, agente autorizado e nova tentativa como cópia', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Produto original cupom',
      price: '20.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const table = await freshTable(),
    order = await confirmed(table, 1, product);
  const printer = (
    await req('POST', '/printers', {
      name: 'Térmica de cupons ' + randomUUID().slice(0, 4),
      sector: 'conta',
    })
  ).body;
  const disabled = (
    await req('POST', '/printers', { name: 'Desativada cupom', sector: 'conta', enabled: false })
  ).body;
  expect(
    (
      await req('POST', `/orders/${order.id}/receipt/print`, {
        printer_id: disabled.id,
        paper_width: 80,
      })
    ).status,
  ).toBe(409);
  const key = randomUUID(),
    queued = await req(
      'POST',
      `/orders/${order.id}/receipt/print`,
      { printer_id: printer.id, paper_width: 80 },
      waiter1,
      key,
    );
  expect(queued.status, JSON.stringify(queued.body)).toBe(200);
  expect(
    (
      await req(
        'POST',
        `/orders/${order.id}/receipt/print`,
        { printer_id: printer.id, paper_width: 80 },
        waiter1,
        key,
      )
    ).body.id,
  ).toBe(queued.body.id);
  expect(await view(a.actor).list('print_jobs', sql`source_order_id=${order.id}`)).toHaveLength(1);
  await req('PATCH', `/products/${product.id}`, { name: 'Nome novo', price: '99.00' });
  expect(
    (await req('POST', `/orders/${order.id}/cancel`, { reason: 'Cancelar depois de emitir cupom' }))
      .status,
  ).toBe(200);
  const agent = (await req('POST', '/print/agents', { name: 'Agente de cupons' })).body;
  const claim = await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token);
  expect(claim.status).toBe(200);
  expect(claim.body.id).toBe(queued.body.id);
  expect(claim.body.document).toBeUndefined();
  expect(claim.body.receipt_snapshot).toBeUndefined();
  const doc = await req('GET', `/print/jobs/${queued.body.id}/document`, undefined, agent.token);
  expect(doc.body.kind).toBe('RECEIPT');
  expect(doc.body.items[0].name).toBe('Produto original cupom');
  expect(doc.body.totals.total).toBe('20.00');
  expect(doc.body.is_copy).toBe(false);
  expect(JSON.stringify(doc.body)).not.toContain('token');
  expect((await req('GET', `/print/jobs/${queued.body.id}/document`)).status).toBe(403);
  expect(
    (
      await req(
        'POST',
        '/print/jobs/' + queued.body.id + '/finish',
        { success: false, error: 'Sem papel' },
        agent.token,
      )
    ).status,
  ).toBe(200);
  const retry = await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token);
  expect(retry.body.id).toBe(queued.body.id);
  expect(
    (await req('GET', `/print/jobs/${queued.body.id}/document`, undefined, agent.token)).body
      .is_copy,
  ).toBe(true);
  expect(
    (await req('POST', '/print/jobs/' + queued.body.id + '/finish', { success: true }, agent.token))
      .status,
  ).toBe(200);
  expect(
    (await req('GET', `/receipts/jobs/${queued.body.id}`, undefined, waiter1)).body.status,
  ).toBe('COMPLETED');
  expect((await req('GET', `/receipts/jobs/${queued.body.id}`, undefined, tokenB)).status).toBe(
    404,
  );
  const current = (await req('GET', `/orders/${order.id}/receipt`)).body;
  expect(current.status).toBe('PEDIDO CANCELADO');
  expect(current.totals.total).toBe('0.00');
});

describe('Pagamentos: contexto operacional da listagem', () => {
  it('enriquece recebimento com mesa, comanda, líquido e histórico sem cruzar unidades', async () => {
    const product = (
      await req('POST', '/products', {
        name: 'Consulta de pagamentos',
        price: '20.00',
        stock_policy: 'NO_CONTROL',
      })
    ).body;
    const table = await freshTable();
    const order = await confirmed(table, 1, product);
    const payment = await req('POST', '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '10.00' }],
    });
    expect(payment.status).toBe(200);
    const refund = await req('POST', `/payments/${payment.body.id}/refund`, {
      amount: '3.00',
      tab_id: order.tab_id,
      reason: 'Revisão da listagem',
    });
    expect(refund.status).toBe(200);
    const list = await req('GET', '/payments');
    const item = list.body.find((p: Row) => p.id === payment.body.id);
    expect(item.status).toBe('PARTIALLY_REFUNDED');
    expect(item.refunded_amount).toBe('3.00');
    expect(item.net_amount).toBe('7.00');
    expect(item.refundable_amount).toBe('7.00');
    expect(item.allocations[0]).toMatchObject({
      tab_id: order.tab_id,
      table_number: table.number,
      tab_status: 'OPEN',
      refundable_amount: '7.00',
    });
    expect(item.allocations[0].tab_label).toBeTruthy();
    expect(item.refunds[0]).toMatchObject({ amount: '3.00', reason: 'Revisão da listagem' });
    expect(item.refunds[0].created_at).toMatch(/Z$/);
    const detail = await req('GET', `/payments/${payment.body.id}`);
    expect(detail.body.net_amount).toBe('7.00');
    expect((await req('GET', `/payments/${payment.body.id}`, undefined, tokenB)).status).toBe(404);
    expect(
      (await req('GET', '/payments', undefined, tokenB)).body.some(
        (p: Row) => p.id === payment.body.id,
      ),
    ).toBe(false);
    expect((await req('GET', '/payments', undefined, waiter1)).status).toBe(200);
    expect(
      (
        await req(
          'POST',
          `/payments/${payment.body.id}/refund`,
          { amount: '1.00', tab_id: order.tab_id, reason: 'Sem permissão' },
          waiter1,
        )
      ).status,
    ).toBe(403);
    await req('POST', `/payments/${payment.body.id}/refund`, {
      amount: '7.00',
      tab_id: order.tab_id,
      reason: 'Estorno do restante',
    });
    const full = await req('GET', `/payments/${payment.body.id}`);
    expect(full.body).toMatchObject({
      status: 'REFUNDED',
      net_amount: '0.00',
      refunded_amount: '10.00',
      refundable_amount: '0.00',
    });
  });
});

it('pagamentos mostram a referência do pedido online e saldo por comanda em recebimento dividido', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Pagamento online e dividido',
      price: '20.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const onlineTable = await freshTable();
  const customer = await visitor(onlineTable);
  const order = await draft(onlineTable, 1, 'PREPAID', product, customer.body.token);
  const intent = await req(
    'POST',
    '/payments/intents',
    { order_id: order.id },
    customer.body.token,
  );
  const paid = await req(
    'POST',
    '/sandbox/pay',
    { intent_id: intent.body.id },
    customer.body.token,
  );
  expect(paid.status).toBe(200);
  const online = await req('GET', `/payments/${paid.body.payment.id}`);
  expect(online.body.order).toMatchObject({ order_id: order.id, table_number: onlineTable.number });
  expect(online.body.net_amount).toBe(paid.body.payment.amount);
  const tables = [await freshTable(), await freshTable()];
  const orders = [await confirmed(tables[0], 1, product), await confirmed(tables[1], 1, product)];
  const split = await req('POST', '/payments/manual', {
    method: 'CARD_MANUAL',
    allocations: orders.map((o) => ({ tab_id: o.tab_id, amount: '5.00' })),
  });
  expect(split.status).toBe(200);
  await req('POST', `/payments/${split.body.id}/refund`, {
    amount: '2.00',
    tab_id: orders[1].tab_id,
    reason: 'Somente segunda comanda',
  });
  const detail = await req('GET', `/payments/${split.body.id}`);
  expect(detail.body.net_amount).toBe('8.00');
  expect(
    detail.body.allocations.find((r: Row) => r.tab_id === orders[0].tab_id).refundable_amount,
  ).toBe('5.00');
  expect(
    detail.body.allocations.find((r: Row) => r.tab_id === orders[1].tab_id).refundable_amount,
  ).toBe('3.00');
});

it('produção inclui produto, adicionais, mesa e comanda atuais sem tokens e preserva transições', async () => {
  const table = await freshTable();
  const product = (
    await req('POST', '/products', {
      name: 'Produto da produção contextual',
      price: '20.00',
      stock_policy: 'NO_CONTROL',
      requires_production: true,
      sector: 'cozinha',
    })
  ).body;
  const group = (
    await req('POST', '/modifier-groups', {
      name: 'Finalização da produção',
      min_choices: 0,
      max_choices: 1,
    })
  ).body;
  const modifier = (
    await req('POST', '/modifiers', {
      group_id: group.id,
      name: 'Molho separado',
      price: '2.00',
      enabled: true,
    })
  ).body;
  expect(
    (await req('POST', '/product-modifiers', { product_id: product.id, group_id: group.id }))
      .status,
  ).toBe(200);
  const draftOrder = await req('POST', '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [
      {
        product_id: product.id,
        quantity: 2,
        modifiers: [modifier.id],
        notes: 'Alergia a amendoim',
      },
    ],
  });
  expect(draftOrder.status, JSON.stringify(draftOrder.body)).toBe(200);
  const order = await req('POST', `/orders/${draftOrder.body.id}/confirm`, {});
  expect(order.status).toBe(200);
  const list = await req('GET', '/production/jobs');
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  const jobs = list.body.filter((j: Row) => j.order_id === order.body.id);
  expect(jobs).toHaveLength(2);
  expect(jobs[0]).toMatchObject({
    product: product.name,
    table_number: table.number,
    tab_id: order.body.tab_id,
    notes: 'Alergia a amendoim',
    modifiers: ['Molho separado'],
    status: 'PENDING',
    ticket_status: 'PENDING',
  });
  expect(jobs[0].tab_label).toBeTruthy();
  expect(jobs[0].public_number).toBeTruthy();
  expect(Math.abs(Date.now() - Date.parse(jobs[0].created_at_iso))).toBeLessThan(15000);
  for (const j of jobs) {
    expect(j).not.toHaveProperty('token');
    expect(j).not.toHaveProperty('token_hash');
    expect(j).not.toHaveProperty('token_nonce');
    expect(j).not.toHaveProperty('amount');
  }
  expect((await req('GET', '/production/jobs', undefined, waiter1)).status).toBe(403);
  expect(
    (await req('GET', '/production/jobs', undefined, tokenB)).body.some((j: Row) =>
      jobs.some((x: Row) => x.id === j.id),
    ),
  ).toBe(false);
  expect(
    (await req('POST', `/production/jobs/${jobs[0].id}/status`, { status: 'READY' })).status,
  ).toBe(409);
  expect(
    (await req('POST', `/production/jobs/${jobs[0].id}/status`, { status: 'PREPARING' })).status,
  ).toBe(200);
  expect(
    (await req('POST', `/production/jobs/${jobs[0].id}/status`, { status: 'READY' })).status,
  ).toBe(200);
  expect((await req('GET', `/tickets/${jobs[0].ticket_id}`)).body.status).toBe('AVAILABLE');
  expect((await req('GET', '/production/jobs')).body.some((j: Row) => j.id === jobs[0].id)).toBe(
    false,
  );
});

it('PrintBridge congela documento, separa agentes, recupera sem nova chave e exige conferência para resultado incerto', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Ficha PrintBridge',
      price: '12.50',
      stock_policy: 'NO_CONTROL',
      sector: 'bridge-test',
    })
  ).body;
  const printer = (
    await req('POST', '/printers', { name: 'Local PrintBridge', sector: 'bridge-test' })
  ).body;
  const order = await confirmed(await freshTable(), 1, product);
  const agent = (
    await req('POST', '/print/agents', { name: 'Estação PrintBridge', transport: 'PRINTBRIDGE' })
  ).body;
  const legacy = (await req('POST', '/print/agents', { name: 'Rede legada' })).body;
  const second = (
    await req('POST', '/print/agents', { name: 'Outra estação', transport: 'PRINTBRIDGE' })
  ).body;
  const claimed = await req(
    'POST',
    '/print/jobs/claim',
    { printer_ids: [printer.id] },
    agent.token,
  );
  expect(claimed.status).toBe(200);
  expect(claimed.body.document).toBeUndefined();
  expect(claimed.body.bridge_delivery).toBeUndefined();
  const id = claimed.body.id;
  const input = {
    origin: 'http://localhost:5173',
    printer_id: 'cups:local-58',
    format: 'pdf',
    paper_width: 58,
  };
  const prepared = await req('POST', `/print/jobs/${id}/bridge/prepare`, input, agent.token);
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
  const meta = prepared.body;
  const wire = () =>
    app.inject({
      method: 'GET',
      url: `/api/v1/print/jobs/${id}/bridge/document?generation=${meta.generation}`,
      headers: { authorization: 'Bearer ' + agent.token },
    });
  const aPdf = await wire(),
    bPdf = await wire();
  expect(aPdf.statusCode, aPdf.body).toBe(200);
  expect(aPdf.rawPayload.equals(bPdf.rawPayload)).toBe(true);
  expect(aPdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  expect(
    (
      await req(
        'POST',
        `/print/jobs/${id}/bridge/prepare`,
        { ...input, printer_id: 'outro', format: 'escpos' },
        agent.token,
      )
    ).body,
  ).toEqual(meta);
  expect(
    (
      await req(
        'POST',
        `/print/jobs/${id}/bridge/prepare`,
        { ...input, origin: 'http://127.0.0.1:5173' },
        agent.token,
      )
    ).status,
  ).toBe(409);
  await atomic(a.actor, randomUUID(), 'test.bridge-tab-label', {}, async (s) => {
    await s.update('tabs', order.tab_id, { label: 'Nome alterado após envio' });
    return { updated: true };
  });
  expect((await wire()).rawPayload.equals(aPdf.rawPayload)).toBe(true);
  expect(
    (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, legacy.token)).body.idle,
  ).toBe(true);
  expect(
    (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, second.token)).body.idle,
  ).toBe(true);
  expect(
    (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)).body.id,
  ).toBe(id);
  expect(
    (await req('POST', `/print/jobs/${id}/bridge/prepare`, input, agent.token)).body.idempotencyKey,
  ).toBe(meta.idempotencyKey);
  const report = (state: string, job = 'native-job') =>
    req(
      'POST',
      `/print/jobs/${id}/bridge/status`,
      { generation: meta.generation, job_id: job, state },
      agent.token,
    );
  expect((await report('queued')).status).toBe(200);
  expect((await report('submitted', 'different-job')).status).toBe(409);
  expect((await report('unknown')).body.status).toBe('FAILED');
  expect(
    (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)).body.idle,
  ).toBe(true);
  expect((await req('POST', `/print/jobs/${id}/retry`, {})).status).toBe(400);
  expect(
    (await req('POST', `/print/jobs/${id}/retry`, { reason: 'Saída física conferida' })).status,
  ).toBe(200);
  await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token);
  const copy = (await req('POST', `/print/jobs/${id}/bridge/prepare`, input, agent.token)).body;
  expect(copy.isCopy).toBe(true);
  expect(copy.generation).not.toBe(meta.generation);
  expect(
    (
      await req(
        'POST',
        `/print/jobs/${id}/bridge/status`,
        { generation: copy.generation, job_id: 'new-native-job', state: 'submitted' },
        agent.token,
      )
    ).body.status,
  ).toBe('COMPLETED');
  expect(
    (
      await req(
        'POST',
        `/print/jobs/${id}/bridge/status`,
        { generation: copy.generation, job_id: 'new-native-job', state: 'queued' },
        agent.token,
      )
    ).body.status,
  ).toBe('COMPLETED');
  const ticket = (await req('GET', `/tickets/${claimed.body.ticket_id}`)).body;
  const stored = await view(a.actor).get('print_jobs', id);
  expect(JSON.stringify(stored.bridge_delivery)).not.toContain(ticket.token);
  const logs = await view(a.actor).list('audit_logs', sql`aggregate_id=${id}`);
  expect(JSON.stringify(logs)).not.toContain(ticket.token);
  const idem = await view(a.actor).list('idempotency_records', sql`actor_id=${agent.id}`);
  expect(JSON.stringify(idem)).not.toContain(ticket.token);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/print/jobs/${id}/bridge/document?generation=${copy.generation}`,
        headers: { authorization: 'Bearer ' + tokenA },
      })
    ).statusCode,
  ).toBe(403);
  const queued = await req('POST', `/orders/${order.id}/receipt/print`, {
    printer_id: printer.id,
    paper_width: 58,
  });
  expect(queued.status).toBe(200);
  const receiptJob = (
    await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)
  ).body;
  const receiptMeta = (
    await req(
      'POST',
      `/print/jobs/${receiptJob.id}/bridge/prepare`,
      { ...input, paper_width: 80 },
      agent.token,
    )
  ).body;
  expect(receiptMeta.paperWidth).toBe(58);
  const receiptWire = () =>
    app.inject({
      method: 'GET',
      url: `/api/v1/print/jobs/${receiptJob.id}/bridge/document?generation=${receiptMeta.generation}`,
      headers: { authorization: 'Bearer ' + agent.token },
    });
  expect((await receiptWire()).rawPayload.equals((await receiptWire()).rawPayload)).toBe(true);
});

it('equipe identifica funcionários sem expor credenciais e conserva isolamento e proteção do próprio vínculo', async () => {
  const result = await req('GET', '/staff');
  expect(result.status).toBe(200);
  const owner = result.body.find((m: Row) => m.user_id === a.actor.id);
  expect(owner).toMatchObject({ name: 'Admin A', role_name: 'Administrador', is_account_admin: 1 });
  expect(owner.email).toMatch(/^a-.*@test.local$/);
  expect(result.body.some((m: Row) => m.name === 'Garçom 1')).toBe(true);
  for (const member of result.body) {
    expect(member.tenant_id).toBe(a.actor.tenantId);
    expect(member.establishment_id).toBe(a.actor.establishmentId);
    for (const forbidden of ['password_hash', 'token_hash', 'refresh_hash', 'is_superadmin'])
      expect(member).not.toHaveProperty(forbidden);
  }
  const other = await req('GET', '/staff', undefined, tokenB);
  expect(other.body.every((m: Row) => m.tenant_id === b.actor.tenantId)).toBe(true);
  expect(other.body.some((m: Row) => m.user_id === owner.user_id)).toBe(false);
  expect((await req('GET', '/staff', undefined, waiter1)).status).toBe(403);
  expect((await req('PATCH', `/staff/${owner.id}`, { enabled: false })).status).toBe(409);
  const member = result.body.find((m: Row) => m.name === 'Garçom 1');
  expect((await req('PATCH', `/staff/${member.id}`, { enabled: false }, tokenB)).status).toBe(404);
  expect((await req('GET', '/staff')).body.find((m: Row) => m.id === owner.id).enabled).toBe(1);
});

it('paginação server-side da equipe filtra antes do COUNT/LIMIT, ordena e limita por unidade', async () => {
  const tag = 'page-' + randomUUID().slice(0, 8);
  const role = a.roles.find((r) => r.name === 'Garçom')!;
  for (let i = 0; i < 13; i++)
    await atomic(a.actor, randomUUID(), 'test.page-staff', {}, (s) =>
      createStaff(s, {
        name: `Paginação ${tag} ${String(i).padStart(2, '0')}`,
        email: `${tag}-${i}@test.local`,
        password,
        role_id: role.id,
      }),
    );
  const path = (suffix = '') => `/staff?search=${tag}&page_size=5${suffix}`;
  const first = (await req('GET', path('&page=1'))).body;
  const second = (await req('GET', path('&page=2'))).body;
  const last = (await req('GET', path('&page=99'))).body;
  expect(first).toMatchObject({ total: 13, page: 1, page_size: 5 });
  expect(first.rows).toHaveLength(5);
  expect(second.rows).toHaveLength(5);
  expect(last.rows).toHaveLength(3);
  expect(last.page).toBe(3);
  const all = [...first.rows, ...second.rows, ...last.rows];
  expect(new Set(all.map((m: Row) => m.id)).size).toBe(13);
  expect(all.map((m: Row) => m.name)).toEqual([...all.map((m: Row) => m.name)].sort());
  expect(Number(first.summary.total)).toBeGreaterThanOrEqual(13);
  const reverse = (await req('GET', path('&page=1&direction=desc'))).body;
  expect(reverse.rows[0].id).toBe(last.rows.at(-1).id);
  await req('PATCH', `/staff/${last.rows.at(-1).id}`, { enabled: false });
  const filtered = (await req('GET', path(`&page=99&status=active&role_id=${role.id}`))).body;
  expect(filtered).toMatchObject({ total: 12, page: 3 });
  expect(filtered.rows).toHaveLength(2);
  const empty = (await req('GET', path('&page=99'), undefined, tokenB)).body;
  expect(empty).toMatchObject({ total: 0, page: 1, rows: [] });
  expect((await req('GET', `/staff?page=1&search=${tag}%25`)).body.total).toBe(0);
  for (const query of [
    'page=0',
    'page=1.5',
    'page_size=101',
    'sort=password_hash',
    'tenant_id=' + b.actor.tenantId,
  ])
    expect((await req('GET', '/staff?' + query)).status).toBe(400);
  expect((await req('GET', path(), undefined, waiter1)).status).toBe(403);
  expect(Array.isArray((await req('GET', '/staff')).body)).toBe(true);
});
it('estoque inicial é atômico, auditado, opcional e não duplica saldo ou cruza unidades', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Novo com estoque ' + randomUUID(),
      price: '8.00',
      stock_policy: 'ON_DELIVERY',
      sector: 'bar',
    })
  ).body;
  const location = (
    await req('POST', '/stock-locations', {
      name: 'Local inicial ' + randomUUID(),
      is_default: false,
    })
  ).body;
  const input = { location_id: location.id, quantity: '12.500', use_for_consumption: true };
  const path = '/products/' + product.id + '/initial-stock',
    key = randomUUID();
  const initialized = await req('POST', path, input, tokenA, key);
  expect(initialized.status, JSON.stringify(initialized.body)).toBe(200);
  expect(initialized.body).toMatchObject({
    physical_quantity: '12.500',
    reserved_quantity: '0.000',
    location_id: location.id,
    variant_id: null,
  });
  expect((await req('POST', path, input, tokenA, key)).body).toEqual(initialized.body);
  expect((await req('POST', path, input)).status).toBe(409);
  const context = (await req('GET', '/products/' + product.id + '/management')).body;
  expect(context.balances).toHaveLength(1);
  expect(context.movements).toHaveLength(1);
  expect(context.product).toMatchObject({
    stock_location_id: location.id,
    stock_policy: 'ON_DELIVERY',
  });
  expect(context.movements[0]).toMatchObject({
    type: 'COUNT',
    quantity: '12.500',
    reason: 'Saldo inicial no cadastro do produto',
  });
  expect((await req('POST', path, { location_id: b.location.id })).status).toBe(404);
  expect((await req('POST', path, input, tokenB)).status).toBe(404);
  expect((await req('POST', path, input, waiter1)).status).toBe(403);
  expect((await req('POST', path, { location_id: location.id, quantity: '-1.000' })).status).toBe(
    400,
  );
  const zero = (
    await req('POST', '/products', {
      name: 'Saldo zero ' + randomUUID(),
      price: '2.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const result = await req('POST', '/products/' + zero.id + '/initial-stock', {
    location_id: location.id,
  });
  expect(result.status).toBe(200);
  expect(result.body.physical_quantity).toBe('0.000');
  const recipe = (
    await req('POST', '/products', {
      name: 'Receita ' + randomUUID(),
      price: '2.00',
      stock_policy: 'RECIPE',
    })
  ).body;
  expect(
    (await req('POST', '/products/' + recipe.id + '/initial-stock', { ...input })).status,
  ).toBe(400);
  expect((await req('GET', '/products/' + recipe.id + '/management')).body.balances).toHaveLength(
    0,
  );
});
it('reposição em massa preserva reservas, separa variações e locais e registra compra e histórico idempotentes', async () => {
  const origin = (
    await req('POST', '/stock-locations', {
      name: 'Origem independente da reposição',
      is_default: false,
    })
  ).body;
  const product = (
    await req('POST', '/products', {
      name: 'Produto independente da reposição',
      price: '14.00',
      stock_policy: 'ON_DELIVERY',
      stock_location_id: origin.id,
    })
  ).body;
  const initialBalance = (
    await req('POST', '/stock-balances', { product_id: product.id, location_id: origin.id })
  ).body;
  expect(
    (
      await req('POST', '/inventory/adjustments', {
        balance_id: initialBalance.id,
        type: 'PURCHASE',
        quantity: '20.000',
        reason: 'Saldo inicial da reposição',
      })
    ).status,
  ).toBe(200);
  await confirmed(await freshTable(), 2, product);
  const before = (
    await view(a.actor).list('stock_balances', sql`product_id=${product.id} AND variant_id IS NULL`)
  )[0];
  const location = (
    await req('POST', '/stock-locations', {
      name: 'Recebimento ' + randomUUID(),
      is_default: false,
    })
  ).body;
  const variant = (
    await req('POST', '/product-variants', {
      product_id: product.id,
      name: 'Saldo próprio compra',
      price: '30.00',
      stock_mode: 'OWN',
    })
  ).body;
  const own = (
    await req('POST', '/stock-balances', {
      product_id: product.id,
      location_id: location.id,
      variant_id: variant.id,
    })
  ).body;
  const initialPrice = (await view(a.actor).get('products', product.id)).price;
  const body = {
    supplier_name: 'Distribuidora ' + randomUUID(),
    invoice_number: '000123-A',
    freight: '10.00',
    discount: '5.00',
    notes: 'Conferido no recebimento',
    items: [
      { balance_id: before.id, quantity: '12.500', unit_cost: '2.35' },
      { balance_id: own.id, quantity: '3.000', unit_cost: '10.00' },
    ],
  };
  const key = randomUUID(),
    [first, replay] = await Promise.all([
      req('POST', '/inventory/replenishments', body, tokenA, key),
      req('POST', '/inventory/replenishments', body, tokenA, key),
    ]);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(replay.body).toEqual(first.body);
  expect(first.body).toMatchObject({
    supplier_name: body.supplier_name,
    invoice_number: '000123-A',
    item_count: 2,
    subtotal: '59.38',
    total: '64.38',
    freight: '10.00',
    discount: '5.00',
  });
  expect(first.body.items).toHaveLength(2);
  expect(first.body.items.find((i: Row) => i.balance_id === own.id)).toMatchObject({
    variant_name: variant.name,
    location_name: location.name,
    physical_before: '0.000',
    physical_after: '3.000',
  });
  const after = await view(a.actor).get('stock_balances', before.id);
  expect(Number(after.physical_quantity)).toBe(Number(before.physical_quantity) + 12.5);
  expect(after.reserved_quantity).toBe(before.reserved_quantity);
  expect((await view(a.actor).get('products', product.id)).price).toBe(initialPrice);
  const movements = await view(a.actor).list(
    'stock_movements',
    sql`source_key LIKE ${'replenishment:' + first.body.id + ':%'}`,
  );
  expect(movements).toHaveLength(2);
  expect(movements.every((row) => row.type === 'PURCHASE')).toBe(true);
  expect((await req('GET', '/inventory/replenishments/' + first.body.id)).body).toEqual(first.body);
  const list = await req(
    'GET',
    '/inventory/replenishments?search=' + encodeURIComponent(body.supplier_name),
  );
  expect(list.body.total).toBe(1);
  expect(list.body.rows[0]).not.toHaveProperty('tenant_id');
  expect(
    (await req('GET', '/inventory/replenishments/' + first.body.id, undefined, tokenB)).status,
  ).toBe(404);
  expect(
    (
      await req(
        'GET',
        '/inventory/replenishments?search=' + encodeURIComponent(body.supplier_name),
        undefined,
        tokenB,
      )
    ).body.total,
  ).toBe(0);
  expect(
    (await req('POST', '/inventory/replenishments', { ...body, discount: '4.00' }, tokenA, key))
      .status,
  ).toBe(409);
});
it('reposição aborta o lote inválido inteiro, valida escopo e exige autorização', async () => {
  const stock = (await view(a.actor).list('stock_balances'))[0],
    foreign = (await view(b.actor).list('stock_balances'))[0];
  const before = await view(a.actor).get('stock_balances', stock.id),
    headers = (await view(a.actor).list('stock_replenishments')).length;
  const input = { items: [{ balance_id: stock.id, quantity: '1.000', unit_cost: '1.00' }] };
  expect(
    (
      await req('POST', '/inventory/replenishments', {
        items: [...input.items, { balance_id: foreign.id, quantity: '1.000' }],
      })
    ).status,
  ).toBe(404);
  for (const body of [
    { items: [] },
    { items: [...input.items, ...input.items] },
    { items: [{ balance_id: stock.id, quantity: '0.000' }] },
    { items: [{ balance_id: stock.id, quantity: '-1.000' }] },
    { ...input, discount: '2.00' },
    { ...input, tenant_id: b.tenant_id },
  ])
    expect((await req('POST', '/inventory/replenishments', body)).status).toBe(400);
  expect((await req('POST', '/inventory/replenishments', input, waiter1)).status).toBe(403);
  expect((await req('GET', '/inventory/replenishments', undefined, waiter1)).status).toBe(403);
  expect(await view(a.actor).get('stock_balances', stock.id)).toEqual(before);
  expect((await view(a.actor).list('stock_replenishments')).length).toBe(headers);
});
it('reposições aceitam somente quantidades, mantém custo desconhecido e paginam o histórico por unidade', async () => {
  const stock = (await view(a.actor).list('stock_balances'))[0],
    supplier = 'Pagina reposição ' + randomUUID();
  for (let i = 0; i < 12; i++) {
    const r = await req('POST', '/inventory/replenishments', {
      supplier_name: supplier,
      items: [{ balance_id: stock.id, quantity: '0.001' }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      subtotal: null,
      total: null,
      freight: '0.00',
      discount: '0.00',
    });
  }
  const path = '/inventory/replenishments?page_size=5&search=' + encodeURIComponent(supplier);
  const first = (await req('GET', path + '&page=1')).body,
    second = (await req('GET', path + '&page=2')).body,
    last = (await req('GET', path + '&page=99')).body;
  expect(first).toMatchObject({ total: 12, page: 1 });
  expect(first.rows).toHaveLength(5);
  expect(second.rows).toHaveLength(5);
  expect(last).toMatchObject({ page: 3 });
  expect(last.rows).toHaveLength(2);
  expect(new Set([...first.rows, ...second.rows, ...last.rows].map((r: Row) => r.id)).size).toBe(
    12,
  );
  expect((await req('GET', path, undefined, tokenB)).body.total).toBe(0);
  expect((await req('GET', '/inventory/replenishments?search=%25')).body.total).toBe(0);
});

it('cores de categorias e locais persistem, validam formato e respeitam a unidade', async () => {
  const category = await req('POST', '/categories', {
    name: 'Categoria com cor',
    color: '#AABBCC',
  });
  expect(category.status, JSON.stringify(category.body)).toBe(200);
  expect(category.body.color).toBe('#aabbcc');
  const location = await req('POST', '/stock-locations', {
    name: 'Local com cor',
    is_default: false,
    color: '#059669',
  });
  expect(location.status, JSON.stringify(location.body)).toBe(200);
  const product = await req('POST', '/products', {
    name: 'Produto com categoria colorida',
    price: '10.00',
    stock_policy: 'ON_DELIVERY',
    category_id: category.body.id,
  });
  expect(product.status).toBe(200);
  const balance = await req('POST', '/stock-balances', {
    product_id: product.body.id,
    location_id: location.body.id,
  });
  const replenishment = await req('POST', '/inventory/replenishments', {
    items: [{ balance_id: balance.body.id, quantity: '1.000' }],
  });
  expect(replenishment.status, JSON.stringify(replenishment.body)).toBe(200);
  expect(replenishment.body.items[0].location_color).toBe('#059669');
  const context = (await req('GET', '/products/' + product.body.id + '/management')).body;
  expect(context.categories.find((c: Row) => c.id === category.body.id).color).toBe('#aabbcc');
  expect(context.locations.find((l: Row) => l.id === location.body.id).color).toBe('#059669');
  const operational = (await req('GET', '/catalog/operational', undefined, waiter1)).body;
  expect(operational.categories.find((c: Row) => c.id === category.body.id).color).toBe('#aabbcc');
  const menu = (await req('GET', '/public/' + (await unitSlug()) + '/menu', undefined, '')).body;
  expect(menu.categories.find((c: Row) => c.id === category.body.id).color).toBe('#aabbcc');
  for (const [path, record] of [
    ['categories', category.body],
    ['stock-locations', location.body],
  ] as const) {
    for (const color of ['red', '#fff', '#000000ff', 'url(https://example.com)', '', '#12345Z']) {
      expect((await req('PATCH', '/' + path + '/' + record.id, { color })).status).toBe(400);
    }
    expect(
      (await req('PATCH', '/' + path + '/' + record.id, { color: '#ff0000' }, tokenB)).status,
    ).toBe(404);
    expect(
      (await req('PATCH', '/' + path + '/' + record.id, { color: '#ff0000' }, waiter1)).status,
    ).toBe(403);
    const updated = await req('PATCH', '/' + path + '/' + record.id, { color: '#7C3AED' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: record.name, color: '#7c3aed' });
    expect(
      (await req('PATCH', '/' + path + '/' + record.id, { name: record.name })).body.color,
    ).toBe('#7c3aed');
    expect(
      (await req('PATCH', '/' + path + '/' + record.id, { color: null })).body.color,
    ).toBeNull();
    expect(
      (await req('GET', '/' + path, undefined, tokenB)).body.some((r: Row) => r.id === record.id),
    ).toBe(false);
  }
  const plainCategory = await req('POST', '/categories', { name: 'Categoria sem cor' });
  expect(plainCategory.status).toBe(200);
  expect(
    (await req('GET', '/categories')).body.find((r: Row) => r.id === plainCategory.body.id).color,
  ).toBeNull();
  const plainLocation = await req('POST', '/stock-locations', {
    name: 'Local sem cor',
    is_default: false,
  });
  expect(plainLocation.status).toBe(200);
  expect(
    (await req('GET', '/stock-locations')).body.find((r: Row) => r.id === plainLocation.body.id)
      .color,
  ).toBeNull();
  const unchanged = (await req('GET', '/inventory/balances')).body.find(
    (r: Row) => r.id === balance.body.id,
  );
  expect(unchanged).toMatchObject({ physical_quantity: '1.000', reserved_quantity: '0.000' });
});

it('cancelamento de impressão individual e da fila é auditado, idempotente e não altera pedidos nem fichas', async () => {
  const sector = 'cancel-' + randomUUID().slice(0, 8);
  const printer = (await req('POST', '/printers', { name: 'Cancelar fila', sector })).body;
  const product = (
    await req('POST', '/products', {
      name: 'Produto fila',
      price: '10.00',
      stock_policy: 'NO_CONTROL',
      sector,
    })
  ).body;
  const order = await confirmed(await freshTable(), 3, product);
  const jobTickets = await tickets(order);
  const jobs = await view(a.actor).list('print_jobs', sql`printer_id=${printer.id}`);
  expect(jobs).toHaveLength(3);
  const receipt = (
    await req('POST', `/orders/${order.id}/receipt/print`, {
      printer_id: printer.id,
      paper_width: 80,
    })
  ).body;
  const agent = (await req('POST', '/print/agents', { name: 'Agente cancelamento' })).body;
  expect((await req('POST', `/print/jobs/${jobs[0].id}/cancel`, {}, waiter1)).status).toBe(403);
  expect((await req('POST', `/print/jobs/${jobs[0].id}/cancel`, {}, tokenB)).status).toBe(404);
  expect((await req('POST', '/print/jobs/cancel', {}, agent.token)).status).toBe(403);
  expect((await req('POST', '/print/jobs/cancel', { tenant_id: b.tenant_id })).status).toBe(400);
  const one = await req('POST', `/print/jobs/${jobs[0].id}/cancel`, {
    reason: 'Impresso por engano',
  });
  expect(one.status).toBe(200);
  expect(one.body.status).toBe('CANCELLED');
  const claimed = (
    await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)
  ).body;
  expect(claimed.id).not.toBe(jobs[0].id);
  const before = await view(a.actor).list(
    'print_jobs',
    sql`status IN ('PENDING','PROCESSING','FAILED')`,
  );
  const key = randomUUID();
  const cancelled = await req(
    'POST',
    '/print/jobs/cancel',
    { reason: 'Limpar fila de teste' },
    tokenA,
    key,
  );
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
  expect(cancelled.body).toMatchObject({
    cancelled: before.length,
    processing: before.filter((job) => job.status === 'PROCESSING').length,
  });
  expect(
    (await req('GET', `/print/jobs/${claimed.id}/state`, undefined, agent.token)).body.status,
  ).toBe('CANCELLED');
  expect(
    (await req('GET', `/print/jobs/${claimed.id}/document`, undefined, agent.token)).status,
  ).toBe(403);
  expect(
    (await req('POST', `/print/jobs/${claimed.id}/finish`, { success: true }, agent.token)).body
      .status,
  ).toBe('CANCELLED');
  expect((await req('POST', `/print/jobs/${claimed.id}/retry`, {})).status).toBe(409);
  expect(
    (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)).body.idle,
  ).toBe(true);
  const stored = await view(a.actor).get('print_jobs', receipt.id);
  expect(stored).toMatchObject({
    status: 'CANCELLED',
    cancelled_by: a.actor.id,
    cancellation_reason: 'Limpar fila de teste',
    lease_until: null,
  });
  expect(stored.cancelled_at).toBeTruthy();
  const fresh = (
    await req('POST', `/orders/${order.id}/receipt/print`, {
      printer_id: printer.id,
      paper_width: 80,
    })
  ).body;
  expect(
    (await req('POST', '/print/jobs/cancel', { reason: 'Limpar fila de teste' }, tokenA, key)).body,
  ).toEqual(cancelled.body);
  expect((await view(a.actor).get('print_jobs', fresh.id)).status).toBe('PENDING');
  const freshClaim = (
    await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)
  ).body;
  expect(freshClaim.id).toBe(fresh.id);
  expect(
    (await req('POST', `/print/jobs/${fresh.id}/finish`, { success: true }, agent.token)).status,
  ).toBe(200);
  expect((await req('POST', `/print/jobs/${fresh.id}/cancel`, {})).status).toBe(409);
  expect((await req('POST', '/print/jobs/cancel', {})).body.cancelled).toBe(0);
  expect((await view(a.actor).get('orders', order.id)).status).toBe('CONFIRMED');
  for (const ticket of jobTickets)
    expect((await view(a.actor).get('tickets', ticket.id)).status).toBe(ticket.status);
  expect(await view(a.actor).list('audit_logs', sql`action='print.queue_cancelled'`)).toHaveLength(
    1,
  );
  expect(
    await view(a.actor).list('outbox_events', sql`event='print.queue_cancelled'`),
  ).toHaveLength(1);
});
it('PrintBridge preserva cancelamento mesmo com resposta local tardia e não fornece documento cancelado', async () => {
  const sector = 'bridge-cancel-' + randomUUID().slice(0, 6);
  const printer = (await req('POST', '/printers', { name: 'Bridge cancelamento', sector })).body;
  const product = (
    await req('POST', '/products', {
      name: 'Produto bridge cancelamento',
      price: '10.00',
      stock_policy: 'NO_CONTROL',
      sector,
    })
  ).body;
  await confirmed(await freshTable(), 1, product);
  const agent = (
    await req('POST', '/print/agents', { name: 'Bridge cancelar', transport: 'PRINTBRIDGE' })
  ).body;
  const other = (
    await req('POST', '/print/agents', { name: 'Outra estação cancelar', transport: 'PRINTBRIDGE' })
  ).body;
  const job = (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token))
    .body;
  const input = {
    origin: 'http://localhost:5173',
    printer_id: 'printer-native',
    format: 'escpos',
    paper_width: 80,
  };
  const d = (await req('POST', `/print/jobs/${job.id}/bridge/prepare`, input, agent.token)).body;
  expect((await req('GET', `/print/jobs/${job.id}/state`, undefined, other.token)).status).toBe(
    403,
  );
  expect(
    (await req('POST', `/print/jobs/${job.id}/cancel`, { reason: 'Interromper envio' })).status,
  ).toBe(200);
  expect(
    (await req('POST', `/print/jobs/${job.id}/bridge/prepare`, input, agent.token)).status,
  ).toBe(409);
  const payload = await app.inject({
    url: `/api/v1/print/jobs/${job.id}/bridge/document?generation=${d.generation}`,
    headers: { authorization: `Bearer ${agent.token}` },
  });
  expect(payload.statusCode).toBe(409);
  expect(
    (
      await req(
        'POST',
        `/print/jobs/${job.id}/bridge/status`,
        { generation: d.generation, job_id: 'native-late', state: 'submitted' },
        other.token,
      )
    ).status,
  ).toBe(403);
  const report = await req(
    'POST',
    `/print/jobs/${job.id}/bridge/status`,
    { generation: d.generation, job_id: 'native-late', state: 'submitted' },
    agent.token,
  );
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.status).toBe('CANCELLED');
  expect(report.body.bridge).toMatchObject({ state: 'submitted', jobId: 'native-late' });
  const saved = await view(a.actor).get('print_jobs', job.id);
  expect(saved).toMatchObject({ status: 'CANCELLED', completed_at: null, lease_until: null });
  expect(
    (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)).body.idle,
  ).toBe(true);
});

it('pedido avulso recebe no ato, entrega, baixa estoque e gera cupom sem mesa ou ocupação, de forma idempotente', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Avulso pronto',
      price: '12.50',
      stock_policy: 'ON_DELIVERY',
      sector: 'balcao',
    })
  ).body;
  const location = (
    await req('POST', '/stock-locations', { name: 'Balcão teste', is_default: false })
  ).body;
  const balance = (
    await req('POST', '/stock-balances', { product_id: product.id, location_id: location.id })
  ).body;
  await req('PATCH', '/products/' + product.id, { stock_location_id: location.id });
  await req('POST', '/inventory/adjustments', {
    balance_id: balance.id,
    type: 'PURCHASE',
    quantity: '10.000',
    reason: 'Saldo para venda avulsa',
  });
  const tablesBefore = await view(a.actor).list('dining_tables'),
    sessionsBefore = await view(a.actor).list('table_sessions');
  const body = {
    items: [{ product_id: product.id, quantity: 2, modifiers: [] }],
    expected_total: '25.00',
    method: 'PIX_MANUAL',
    customer_name: 'Cliente retirada',
    deliver_available: true,
  };
  const key = randomUUID();
  const sales = await Promise.all([
    req('POST', '/orders/counter', body, tokenA, key),
    req('POST', '/orders/counter', body, tokenA, key),
  ]);
  expect(sales[0].status, JSON.stringify(sales[0].body)).toBe(200);
  expect(sales[1].body.order.id).toBe(sales[0].body.order.id);
  const sale = sales[0].body,
    order = sale.order;
  expect(order).toMatchObject({
    table_id: null,
    service_mode: 'COUNTER',
    payment_policy_snapshot: 'IMMEDIATE',
    customer_name: 'Cliente retirada',
    status: 'CONFIRMED',
    total: '25.00',
  });
  expect(sale).toMatchObject({ delivered: 2, pending: 0 });
  expect(await view(a.actor).get('tabs', order.tab_id)).toMatchObject({
    session_id: null,
    mode: 'COUNTER',
    status: 'CLOSED',
  });
  expect(await view(a.actor).get('stock_balances', balance.id)).toMatchObject({
    physical_quantity: '8.000',
    reserved_quantity: '0.000',
  });
  expect(await view(a.actor).list('dining_tables')).toEqual(tablesBefore);
  expect(await view(a.actor).list('table_sessions')).toEqual(sessionsBefore);
  const detail = (await req('GET', '/orders/' + order.id)).body;
  expect(detail.tickets).toHaveLength(2);
  expect(
    detail.tickets.every((t: Row) => t.status === 'REDEEMED' && t.service_mode === 'COUNTER'),
  ).toBe(true);
  expect((await req('GET', '/tickets/' + detail.tickets[0].id)).body).toMatchObject({
    service_mode: 'COUNTER',
    session_id: null,
    table_id: null,
  });
  const receipt = (await req('GET', `/orders/${order.id}/receipt?paper_width=80`)).body;
  expect(receipt).toMatchObject({
    service_mode: 'COUNTER',
    customer_name: 'Cliente retirada',
    totals: { total: '25.00', paid: '25.00', balance: '0.00' },
  });
  expect(receipt.payments).toMatchObject([{ method: 'Pix', amount: '25.00' }]);
  expect((await req('GET', `/orders/${order.id}`, undefined, tokenB)).status).toBe(404);
  const overview = (await req('GET', '/payments')).body.find((p: Row) => p.id === sale.payment_id);
  expect(overview.allocations[0]).toMatchObject({
    tab_id: order.tab_id,
    table_number: null,
    service_mode: 'COUNTER',
  });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  const finance = await req(
    'GET',
    `/finance/records?start=${day}&end=${day}&kind=sales&search=${order.id}`,
  );
  expect(finance.status, JSON.stringify(finance.body)).toBe(200);
  expect(finance.body.rows[0]).toMatchObject({
    id: order.id,
    service_mode: 'COUNTER',
    amount: '25.00',
  });
});
it('pedido avulso rejeita preço desatualizado, dinheiro sem caixa e escopo inválido sem deixar registros ou consumir estoque', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Avulso transação',
      price: '10.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const body = {
    items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
    expected_total: '10.00',
    method: 'CASH',
  };
  const before = {
    orders: (await view(a.actor).list('orders')).length,
    tabs: (await view(a.actor).list('tabs')).length,
    payments: (await view(a.actor).list('payments')).length,
  };
  expect((await req('POST', '/orders/counter', body)).status).toBe(400);
  expect(
    (
      await req('POST', '/orders/counter', {
        ...body,
        method: 'PIX_MANUAL',
        expected_total: '1.00',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req('POST', '/orders/counter', {
        ...body,
        method: 'PIX_MANUAL',
        table_id: a.tables[0].id,
      })
    ).status,
  ).toBe(400);
  const unauthorized = (
    await req('POST', '/print/agents', { name: 'Sem permissão de venda avulsa' })
  ).body.token;
  expect((await req('POST', '/orders/counter', body, unauthorized)).status).toBe(403);
  expect((await req('POST', '/orders/counter', body, tokenB)).status).toBe(404);
  expect((await view(a.actor).list('orders')).length).toBe(before.orders);
  expect((await view(a.actor).list('tabs')).length).toBe(before.tabs);
  expect((await view(a.actor).list('payments')).length).toBe(before.payments);
  const register = (await req('POST', '/cash-registers', { name: 'Caixa avulso' })).body;
  const cash = (
    await req('POST', '/cash/sessions', { register_id: register.id, opening_amount: '0.00' })
  ).body;
  const sale = await req('POST', '/orders/counter', {
    ...body,
    cash_session_id: cash.id,
    deliver_available: false,
  });
  expect(sale.status, JSON.stringify(sale.body)).toBe(200);
  const context = (await req('GET', `/orders/${sale.body.order.id}/cancellation-context`)).body;
  expect(context).toMatchObject({
    service_mode: 'COUNTER',
    refund_required_amount: '10.00',
    can_cancel: false,
  });
  expect(context.refund_targets[0]).toMatchObject({
    payment_id: sale.body.payment_id,
    tab_id: sale.body.order.tab_id,
    refundable_amount: '10.00',
  });
  expect(
    (
      await req('POST', `/orders/${sale.body.order.id}/cancel`, {
        reason: 'Desistiu antes de retirar',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req('POST', `/payments/${sale.body.payment_id}/refund`, {
        amount: '10.00',
        tab_id: sale.body.order.tab_id,
        reason: 'Desistiu antes de retirar',
        cash_session_id: cash.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await req('POST', `/orders/${sale.body.order.id}/cancel`, {
        reason: 'Cancelado após estorno',
      })
    ).status,
  ).toBe(200);
  expect((await view(a.actor).get('tabs', sale.body.order.tab_id)).status).toBe('CLOSED');
  const movements = await view(a.actor).list('cash_movements', sql`cash_session_id=${cash.id}`);
  expect(movements.filter((m) => m.type === 'CASH')[0].amount).toBe('10.00');
  expect(movements.filter((m) => m.type === 'REFUND')[0].amount).toBe('-10.00');
});
it('pedido avulso com preparo aparece na cozinha, mantém reserva e só encerra após a entrega', async () => {
  const product = (
    await req('POST', '/products', {
      name: 'Avulso cozinha',
      price: '20.00',
      stock_policy: 'ON_PRODUCTION',
      requires_production: true,
      sector: 'cozinha-avulso',
    })
  ).body;
  const location = (
    await req('POST', '/stock-locations', { name: 'Cozinha avulso', is_default: false })
  ).body;
  const stock = (
    await req('POST', '/stock-balances', { location_id: location.id, product_id: product.id })
  ).body;
  await req('PATCH', `/products/${product.id}`, { stock_location_id: location.id });
  await req('POST', '/inventory/adjustments', {
    balance_id: stock.id,
    type: 'PURCHASE',
    quantity: '5.000',
    reason: 'Compra para cozinha',
  });
  const sale = await req('POST', '/orders/counter', {
    items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
    expected_total: '20.00',
    method: 'CARD_MANUAL',
    deliver_available: true,
  });
  expect(sale.status, JSON.stringify(sale.body)).toBe(200);
  expect(sale.body).toMatchObject({ delivered: 0, pending: 1 });
  expect((await view(a.actor).get('tabs', sale.body.order.tab_id)).status).toBe('OPEN');
  expect(await view(a.actor).get('stock_balances', stock.id)).toMatchObject({
    physical_quantity: '5.000',
    reserved_quantity: '1.000',
  });
  const jobs = (await req('GET', '/production/jobs')).body;
  const job = jobs.find((j: Row) => j.order_id === sale.body.order.id);
  expect(job).toMatchObject({
    table_id: null,
    session_id: null,
    service_mode: 'COUNTER',
    status: 'PENDING',
  });
  await req('POST', `/production/jobs/${job.id}/status`, { status: 'PREPARING' });
  await req('POST', `/production/jobs/${job.id}/status`, { status: 'READY' });
  const ticket = (await req('GET', `/tickets/${job.ticket_id}`)).body;
  expect(
    (await req('POST', `/tickets/${job.ticket_id}/redeem`, { token: ticket.token })).status,
  ).toBe(200);
  expect((await view(a.actor).get('tabs', sale.body.order.tab_id)).status).toBe('CLOSED');
  expect(await view(a.actor).get('stock_balances', stock.id)).toMatchObject({
    physical_quantity: '4.000',
    reserved_quantity: '0.000',
  });
});

it('contratos numéricos rejeitam decimais em inteiros, limites do banco e formatos locais sem conversão', async () => {
  for (const capacity of ['4', 1.5, 0, 101])
    expect(
      (await req('POST', '/tables', { number: 'Num-' + randomUUID().slice(0, 6), capacity }))
        .status,
    ).toBe(400);
  expect(
    (
      await req('POST', '/tables', {
        number: 'Num-' + randomUUID().slice(0, 6),
        capacity: 4,
        position_x: 2001,
      })
    ).status,
  ).toBe(400);
  expect(
    (await req('POST', '/categories', { name: 'Ordem inválida', sort_order: 2147483648 })).status,
  ).toBe(400);
  const category = await req('POST', '/categories', {
    name: 'Ordem negativa válida',
    sort_order: -2147483648,
  });
  expect(category.status).toBe(200);
  expect(category.body.sort_order).toBe(-2147483648);
  for (const price of ['14,50', '14.501', '-14.50'])
    expect(
      (
        await req('POST', '/products', {
          name: 'Preço inválido',
          price,
          stock_policy: 'NO_CONTROL',
        })
      ).status,
    ).toBe(400);
  const product = (
    await req('POST', '/products', {
      name: 'Contrato quantidade',
      price: '14.50',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const recipe = (await req('POST', '/recipes', { product_id: product.id })).body;
  for (const quantity of ['1,500', '1.5000', '0.000', '0.0001', '100000000.000'])
    expect(
      (
        await req('POST', '/recipe-items', {
          recipe_id: recipe.id,
          ingredient_id: a.products[0].id,
          quantity,
        })
      ).status,
    ).toBe(400);
  expect(
    (
      await req('POST', '/recipe-items', {
        recipe_id: recipe.id,
        ingredient_id: a.products[0].id,
        quantity: '1.500',
      })
    ).status,
  ).toBe(200);
});

it('aparência salva cores independentes de sidebar por unidade e preserva as demais políticas', async () => {
  const before = (await req('GET', '/settings')).body;
  const changed = await req('PATCH', '/settings', {
    primary_color: '#8B5CF6',
    sidebar_color: '#FFFFFF',
  });
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  expect(changed.body).toMatchObject({
    primary_color: '#8b5cf6',
    sidebar_color: '#ffffff',
    name: before.name,
    slug: before.slug,
    payment_mode: before.payment_mode,
    is_open: before.is_open,
  });
  expect((await req('GET', '/appearance')).body).toEqual({
    primary_color: '#8b5cf6',
    sidebar_color: '#ffffff',
  });
  expect((await req('GET', '/appearance', undefined, tokenB)).body.sidebar_color).toBe('#0d1b2a');
  expect((await req('PATCH', '/settings', { sidebar_color: '#000000' }, waiter1)).status).toBe(403);
  for (const sidebar_color of ['red', '#fff', '#123456\n', 'url(javascript:alert(1))'])
    expect((await req('PATCH', '/settings', { sidebar_color })).status).toBe(400);
  expect(
    (await req('PATCH', '/settings', { sidebar_color: '#123456', tenant_id: b.tenant_id })).status,
  ).toBe(400);
  await req('PATCH', '/settings', { primary_color: '#059669' });
  expect((await req('GET', '/appearance')).body).toEqual({
    primary_color: '#059669',
    sidebar_color: '#ffffff',
  });
  const identity = (await req('GET', '/pwa/apps/' + a.establishment_id, undefined, '')).body;
  expect(identity).toMatchObject({
    establishment_id: a.establishment_id,
    sidebar_color: '#ffffff',
  });
  await req('PATCH', '/settings', {
    primary_color: before.primary_color,
    sidebar_color: before.sidebar_color,
  });
});

describe('disponibilidade bilateral e concorrência de vendas', () => {
  async function controlled(name: string, initial: string) {
    const product = (
      await req('POST', '/products', {
        name,
        price: '5.00',
        stock_policy: 'ON_DELIVERY',
        stock_location_id: a.location.id,
      })
    ).body;
    const balance = (
      await req('POST', '/stock-balances', { product_id: product.id, location_id: a.location.id })
    ).body;
    const entry = await req('POST', '/inventory/adjustments', {
      balance_id: balance.id,
      type: 'PURCHASE',
      quantity: initial,
      reason: 'Saldo para teste de concorrência',
    });
    expect(entry.status, JSON.stringify(entry.body)).toBe(200);
    return { product, balance };
  }
  it('duas confirmações disputam a última unidade e só uma gera fichas e reserva', async () => {
    const { product, balance } = await controlled('Última unidade ' + randomUUID(), '1.000');
    const tables = await Promise.all([freshTable(), freshTable()]);
    const drafts = await Promise.all(tables.map((table) => draft(table, 1, 'POSTPAID', product)));
    const results = await Promise.all(
      drafts.map((order) => req('POST', `/orders/${order.id}/confirm`, {})),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)!.body.error.code).toBe('OUT_OF_STOCK');
    expect((await Promise.all(drafts.map(tickets))).flat()).toHaveLength(1);
    expect(await view(a.actor).get('stock_balances', balance.id)).toMatchObject({
      physical_quantity: '1.000',
      reserved_quantity: '1.000',
    });
    const menu = (await req('GET', '/catalog/operational')).body;
    expect(menu.products.find((item: Row) => item.id === product.id).stock.available).toBe(0);
    const publicMenu = await app.inject({
      method: 'GET',
      url: `/api/v1/public/${await unitSlug()}/menu`,
    });
    expect(
      publicMenu.json().products.find((item: Row) => item.id === product.id).stock.available,
    ).toBe(0);
    const other = (await req('GET', '/catalog/operational', undefined, tokenB)).body;
    expect(other.products.some((item: Row) => item.id === product.id)).toBe(false);
  });
  it('soma receitas e variações compartilhadas e separa o saldo próprio', async () => {
    const { product, balance } = await controlled('Ingrediente ' + randomUUID(), '2.000');
    const shared = (
      await req('POST', '/product-variants', {
        product_id: product.id,
        name: 'Compartilhada',
        price: '5.00',
      })
    ).body;
    const own = (
      await req('POST', '/product-variants', {
        product_id: product.id,
        name: 'Própria',
        price: '5.00',
        stock_mode: 'OWN',
      })
    ).body;
    const ownBalance = (
      await req('POST', '/stock-balances', {
        product_id: product.id,
        variant_id: own.id,
        location_id: a.location.id,
      })
    ).body;
    await req('POST', '/inventory/adjustments', {
      balance_id: ownBalance.id,
      type: 'PURCHASE',
      quantity: '1.000',
      reason: 'Saldo da variação de teste',
    });
    const recipeProduct = (
      await req('POST', '/products', {
        name: 'Receita ' + randomUUID(),
        price: '5.00',
        stock_policy: 'RECIPE',
      })
    ).body;
    const recipe = (await req('POST', '/recipes', { product_id: recipeProduct.id })).body;
    expect(
      (
        await req('POST', '/recipe-items', {
          recipe_id: recipe.id,
          ingredient_id: product.id,
          quantity: '0.750',
        })
      ).status,
    ).toBe(200);
    const table = await freshTable();
    const create = (items: Row[]) =>
      req('POST', '/orders', {
        table_id: table.id,
        source: 'POS',
        payment_policy: 'POSTPAID',
        items,
      });
    const overShared = await create([
      { product_id: product.id, quantity: 2, modifiers: [] },
      { product_id: product.id, variant_id: shared.id, quantity: 1, modifiers: [] },
    ]);
    expect(overShared.body.error.code).toBe('OUT_OF_STOCK');
    const overRecipe = await create([
      { product_id: product.id, quantity: 1, modifiers: [] },
      { product_id: recipeProduct.id, quantity: 2, modifiers: [] },
    ]);
    expect(overRecipe.body.error.code).toBe('OUT_OF_STOCK');
    const menu = (await req('GET', '/catalog/operational')).body;
    expect(menu.products.find((item: Row) => item.id === recipeProduct.id).stock.available).toBe(2);
    expect(menu.variants.find((item: Row) => item.id === own.id).stock.available).toBe(1);
    expect(
      JSON.stringify(menu.products.find((item: Row) => item.id === recipeProduct.id).stock),
    ).not.toContain(balance.id);
    const valid = await create([
      { product_id: product.id, quantity: 2, modifiers: [] },
      { product_id: product.id, variant_id: own.id, quantity: 1, modifiers: [] },
    ]);
    expect(valid.status, JSON.stringify(valid.body)).toBe(200);
    expect((await req('POST', `/orders/${valid.body.id}/confirm`, {})).status).toBe(200);
  });
  it('cliente não cria pedido sem saldo e sua reserva de pagamento não pode ser vendida no balcão', async () => {
    const { product, balance } = await controlled('Cliente reserva ' + randomUUID(), '1.000');
    const table = await freshTable(),
      client = (await visitor(table)).body.token;
    const input = {
      table_id: table.id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: product.id, quantity: 2, modifiers: [] }],
    };
    expect((await req('POST', '/public/orders', input, client)).body.error.code).toBe(
      'OUT_OF_STOCK',
    );
    const order = (
      await req(
        'POST',
        '/public/orders',
        { ...input, items: [{ ...input.items[0], quantity: 1 }] },
        client,
      )
    ).body;
    const intent = await req('POST', '/payments/intents', { order_id: order.id }, client);
    expect(intent.status, JSON.stringify(intent.body)).toBe(200);
    const counter = await req('POST', '/orders/counter', {
      items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
      expected_total: '5.00',
      method: 'PIX_MANUAL',
      deliver_available: true,
    });
    expect(counter.body.error.code).toBe('OUT_OF_STOCK');
    const paid = await req('POST', '/sandbox/pay', { intent_id: intent.body.id }, client);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.requires_review).toBeFalsy();
    expect(await view(a.actor).get('stock_balances', balance.id)).toMatchObject({
      physical_quantity: '1.000',
      reserved_quantity: '1.000',
    });
    expect(await tickets(order)).toHaveLength(1);
  });
});

describe('cardápio online e retirada pelo cliente', () => {
  async function counterClient(name = 'Cliente online') {
    const response = await req(
      'POST',
      `/public/${await unitSlug()}/counter-sessions`,
      { name, phone: '11955554444' },
      '',
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  }
  it('lê uma mesa somente da unidade atual sem ocupar ou cadastrar cliente', async () => {
    const table = await freshTable();
    const before = (await view(a.actor).list('customers')).length;
    const result = await req(
      'POST',
      `/public/${await unitSlug()}/tables/resolve`,
      { table_code: table.public_code },
      '',
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: table.id,
      number: table.number,
      table_code: table.public_code,
    });
    expect((await view(a.actor).list('customers')).length).toBe(before);
    expect(await view(a.actor).list('table_sessions', sql`table_id=${table.id}`)).toHaveLength(0);
    const foreign = await req(
      'POST',
      `/public/${await unitSlug()}/tables/resolve`,
      { table_code: b.tables[0].public_code },
      '',
    );
    expect(foreign.status).toBe(404);
    const cross = await app.inject({
      method: 'POST',
      url: `/api/v1/public/${await unitSlug()}/counter-sessions`,
      headers: { 'X-Mesa-Establishment': b.establishment_id },
      payload: { name: 'Outro', phone: '11955554444' },
    });
    expect(cross.statusCode).toBe(403);
  });
  it('cliente cria avulso pré-pago, recebe fichas após pagar e retira sem criar mesa', async () => {
    const client = await counterClient(),
      other = await counterClient();
    const sessionsBefore = (await view(a.actor).list('table_sessions')).length;
    expect(client).toMatchObject({ service_mode: 'COUNTER', table_id: null });
    const product = (
      await req('POST', '/products', {
        name: 'Retirada cliente ' + randomUUID(),
        price: '7.00',
        stock_policy: 'ON_DELIVERY',
        stock_location_id: a.location.id,
      })
    ).body;
    const balance = (
      await req('POST', '/stock-balances', { product_id: product.id, location_id: a.location.id })
    ).body;
    await req('POST', '/inventory/adjustments', {
      balance_id: balance.id,
      type: 'PURCHASE',
      quantity: '1.000',
      reason: 'Saldo de retirada do teste',
    });
    const input = { items: [{ product_id: product.id, quantity: 1, modifiers: [] }] };
    expect((await req('POST', '/public/counter/orders', input, tokenA)).status).toBe(403);
    expect(
      (
        await req(
          'POST',
          '/public/counter/orders',
          { ...input, table_id: a.tables[0].id },
          client.token,
        )
      ).status,
    ).toBe(400);
    const key = randomUUID();
    const created = await req('POST', '/public/counter/orders', input, client.token, key);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const order = created.body;
    expect(order).toMatchObject({
      service_mode: 'COUNTER',
      source: 'CUSTOMER',
      table_id: null,
      tab_id: null,
      payment_policy_snapshot: 'PREPAID',
      status: 'PENDING_PAYMENT',
      customer_name: 'Cliente online',
    });
    expect((await req('POST', '/public/counter/orders', input, client.token, key)).body.id).toBe(
      order.id,
    );
    expect(await tickets(order)).toHaveLength(0);
    expect((await req('GET', `/orders/${order.id}`, undefined, other.token)).status).toBe(403);
    const forgedTable = await req(
      'POST',
      '/public/orders',
      { ...input, table_id: a.tables[0].id, source: 'CUSTOMER', payment_policy: 'PREPAID' },
      client.token,
    );
    expect(forgedTable.status).toBe(403);
    const intent = await req('POST', '/payments/intents', { order_id: order.id }, client.token);
    expect(intent.status, JSON.stringify(intent.body)).toBe(200);
    expect((await req('POST', '/public/counter/orders', input, other.token)).body.error.code).toBe(
      'OUT_OF_STOCK',
    );
    const paid = await req('POST', '/sandbox/pay', { intent_id: intent.body.id }, client.token);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.requires_review).toBeFalsy();
    const current = await view(a.actor).get('orders', order.id);
    const tab = await view(a.actor).get('tabs', current.tab_id);
    expect(tab).toMatchObject({
      mode: 'COUNTER',
      session_id: null,
      owner_customer_id: order.customer_id,
    });
    const myTabs = (await req('GET', '/my-tabs', undefined, client.token)).body;
    expect(myTabs).toHaveLength(1);
    expect(myTabs[0].financial.balance).toBe('0.00');
    expect((await req('GET', '/my-tabs', undefined, other.token)).body).toHaveLength(0);
    const mine = (await req('GET', '/my-tickets', undefined, client.token)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ service_mode: 'COUNTER', table_id: null, status: 'AVAILABLE' });
    expect((await req('POST', `/tickets/${mine[0].id}/request`, {}, client.token)).status).toBe(
      409,
    );
    const receipt = await req('GET', `/orders/${order.id}/receipt`);
    expect(receipt.body).toMatchObject({
      service_mode: 'COUNTER',
      customer_name: 'Cliente online',
    });
    expect(receipt.body.totals).toMatchObject({ paid: '7.00', balance: '0.00' });
    expect(
      (await req('POST', `/tickets/${mine[0].id}/redeem`, { token: mine[0].token })).status,
    ).toBe(200);
    expect((await view(a.actor).get('tabs', tab.id)).status).toBe('CLOSED');
    expect(await view(a.actor).get('stock_balances', balance.id)).toMatchObject({
      physical_quantity: '0.000',
      reserved_quantity: '0.000',
    });
    expect((await view(a.actor).list('table_sessions')).length).toBe(sessionsBefore);
    const tableClient = (await visitor(await freshTable())).body;
    expect((await req('POST', '/public/counter/orders', input, tableClient.token)).status).toBe(
      403,
    );
  });
});

it('credenciais da equipe resolvem o aplicativo por perfil e redefinem senha apenas por admin geral', async () => {
  const role = a.roles.find((role: Row) => role.name === 'Garçom')!;
  const account = 'credentials-' + randomUUID().slice(0, 8) + '@test.local';
  const oldPassword = 'OldCredentialsTestOnly1!',
    nextPassword = 'NewCredentialsTestOnly1!';
  const created = await req('POST', '/staff', {
    name: 'Credenciais teste',
    email: account,
    password: oldPassword,
    role_id: role.id,
  });
  expect(created.status).toBe(200);
  const memberId = created.body.membership_id;
  const staff = await req('GET', '/staff');
  const member = staff.body.find((row: Row) => row.id === memberId);
  expect(member).toMatchObject({ access_surface: 'waiter', email: account });
  const roles = await req('GET', '/roles');
  expect(roles.body.find((row: Row) => row.name === 'Cozinha').access_surface).toBe('kitchen');
  expect(roles.body.find((row: Row) => row.name === 'Caixa').access_surface).toBe('admin');
  const login = await req(
    'POST',
    '/auth/login',
    { email: account, password: oldPassword, establishment_slug: await unitSlug() },
    '',
  );
  expect(login.status).toBe(200);
  expect(
    (await req('POST', `/staff/${memberId}/password`, { password: nextPassword }, waiter1)).status,
  ).toBe(403);
  const own = staff.body.find((row: Row) => row.user_id === a.actor.id);
  expect((await req('POST', `/staff/${own.id}/password`, { password: nextPassword })).status).toBe(
    409,
  );
  expect(
    (await req('POST', `/staff/${memberId}/password`, { password: nextPassword }, tokenB)).status,
  ).toBe(404);
  expect((await req('POST', `/staff/${memberId}/password`, { password: 'short' })).status).toBe(
    400,
  );
  const key = randomUUID();
  const reset = await req(
    'POST',
    `/staff/${memberId}/password`,
    { password: nextPassword },
    tokenA,
    key,
  );
  expect(reset).toMatchObject({ status: 200, body: { id: memberId, password_updated: true } });
  expect(
    (await req('POST', `/staff/${memberId}/password`, { password: nextPassword }, tokenA, key))
      .body,
  ).toEqual(reset.body);
  expect((await req('GET', '/tables', undefined, login.body.token)).status).toBe(401);
  expect(
    (
      await req(
        'POST',
        '/auth/login',
        { email: account, password: oldPassword, establishment_slug: await unitSlug() },
        '',
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await req(
        'POST',
        '/auth/login',
        { email: account, password: nextPassword, establishment_slug: await unitSlug() },
        '',
      )
    ).status,
  ).toBe(200);
  const audits = await view(a.actor).list('audit_logs', sql`aggregate_id=${memberId}`);
  expect(audits.filter((row: Row) => row.action === 'staff.password_reset')).toHaveLength(1);
  const records = await view(a.actor).list('idempotency_records', sql`idempotency_key=${key}`);
  expect(JSON.stringify([...audits, ...records])).not.toContain(nextPassword);
  expect(JSON.stringify((await req('GET', '/staff')).body)).not.toContain(nextPassword);
});

describe('entrega de todas as fichas do pedido', () => {
  async function product(policy: string, kitchen = false) {
    const result = await req('POST', '/products', {
      name: 'Entrega lote ' + policy + ' ' + randomUUID().slice(0, 5),
      price: '2.00',
      stock_policy: policy,
      stock_location_id: a.location.id,
      requires_production: kitchen,
      sector: kitchen ? 'cozinha' : 'bar',
    });
    expect(result.status).toBe(200);
    expect(
      (
        await req('POST', '/stock-balances', {
          product_id: result.body.id,
          location_id: a.location.id,
        })
      ).status,
    ).toBe(200);
    if (['ON_CONFIRMATION', 'ON_DELIVERY', 'ON_PRODUCTION'].includes(policy))
      expect(
        (
          await req('POST', '/inventory/adjustments', {
            balance_id: (
              await view(a.actor).list(
                'stock_balances',
                sql`product_id=${result.body.id} AND location_id=${a.location.id}`,
              )
            )[0].id,
            type: 'PURCHASE',
            quantity: '10.000',
            reason: 'Saldo de teste lote',
          })
        ).status,
      ).toBe(200);
    return result.body;
  }
  it('conclui cozinha e todas as políticas de estoque uma única vez, preservando entregues e canceladas', async () => {
    const direct = await product('NO_CONTROL'),
      confirmation = await product('ON_CONFIRMATION'),
      delivery = await product('ON_DELIVERY'),
      production = await product('ON_PRODUCTION', true),
      ingredient = await product('ON_DELIVERY'),
      recipe = await product('RECIPE', true);
    expect(
      (
        await req('POST', '/recipe-items', {
          recipe_id: (await req('POST', '/recipes', { product_id: recipe.id })).body.id,
          ingredient_id: ingredient.id,
          quantity: '0.500',
        })
      ).status,
    ).toBe(200);
    const quantities = [3, 2, 2, 3, 2],
      products = [direct, confirmation, delivery, production, recipe];
    const draftOrder = await req('POST', '/orders', {
      table_id: (await freshTable()).id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: products.map((p, index) => ({
        product_id: p.id,
        quantity: quantities[index],
        modifiers: [],
      })),
    });
    expect(draftOrder.status).toBe(200);
    const order = (await req('POST', `/orders/${draftOrder.body.id}/confirm`, {})).body;
    const all = await tickets(order),
      items = await view(a.actor).list('order_items', sql`order_id=${order.id}`);
    const of = (p: Row) =>
      all.filter((t) => t.order_item_id === items.find((i) => i.product_id === p.id)!.id);
    expect(
      (
        await req('POST', `/tickets/${of(direct)[0].id}/redeem`, {
          token: (await req('GET', `/tickets/${of(direct)[0].id}`)).body.token,
        })
      ).status,
    ).toBe(200);
    await atomic(a.actor, randomUUID(), 'test.cancel-ticket', {}, async (s) => {
      await s.update('tickets', of(direct)[1].id, { status: 'CANCELLED' });
      return { id: of(direct)[1].id };
    });
    const jobs = await view(a.actor).list('production_jobs');
    const productionJobs = of(production).map((t) => jobs.find((job) => job.ticket_id === t.id)!);
    await req('POST', `/production/jobs/${productionJobs[0].id}/status`, { status: 'PREPARING' });
    await req('POST', `/production/jobs/${productionJobs[1].id}/status`, { status: 'PREPARING' });
    await req('POST', `/production/jobs/${productionJobs[1].id}/status`, { status: 'READY' });
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(
      keys.map((key) => req('POST', `/orders/${order.id}/deliver-tickets`, {}, tokenA, key)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.delivered_count).sort((x, y) => x - y)).toEqual([0, 10]);
    const winner = results.findIndex((r) => r.body.delivered_count === 10);
    expect(results[winner].body).toMatchObject({
      completed_production_count: 4,
      already_delivered_count: 1,
      cancelled_count: 1,
    });
    expect(
      (await req('POST', `/orders/${order.id}/deliver-tickets`, {}, tokenA, keys[winner])).body,
    ).toEqual(results[winner].body);
    const after = await tickets(order);
    expect(after.filter((t) => t.status === 'REDEEMED')).toHaveLength(11);
    expect(after.find((t) => t.id === of(direct)[1].id)?.status).toBe('CANCELLED');
    for (const [p, physical] of [
      [confirmation, '8.000'],
      [delivery, '8.000'],
      [production, '7.000'],
      [ingredient, '9.000'],
    ] as const) {
      expect(
        (
          await view(a.actor).list(
            'stock_balances',
            sql`product_id=${p.id} AND location_id=${a.location.id}`,
          )
        )[0],
      ).toMatchObject({ physical_quantity: physical, reserved_quantity: '0.000' });
    }
    for (const t of after.filter((t) => t.status === 'REDEEMED'))
      expect(
        await view(a.actor).list('ticket_events', sql`ticket_id=${t.id} AND event='REDEEMED'`),
      ).toHaveLength(1);
    for (const t of [...of(production), ...of(recipe)])
      expect((await view(a.actor).list('production_jobs', sql`ticket_id=${t.id}`))[0].status).toBe(
        'READY',
      );
    expect(
      (await req('GET', '/production/jobs')).body.some((job: Row) => job.order_id === order.id),
    ).toBe(false);
    expect(
      await view(a.actor).list(
        'audit_logs',
        sql`aggregate_id=${order.id} AND action='order.tickets_delivered'`,
      ),
    ).toHaveLength(1);
  });
  it('valida permissões, pagamento e chamados antes de concluir o lote, sem alterações parciais', async () => {
    const drink = await product('NO_CONTROL'),
      food = await product('ON_PRODUCTION', true),
      table = await freshTable(),
      customer = await visitor(table);
    const draftOrder = await req(
      'POST',
      '/public/orders',
      {
        table_id: table.id,
        source: 'CUSTOMER',
        payment_policy: 'PREPAID',
        items: [drink, food].map((p) => ({ product_id: p.id, quantity: 1, modifiers: [] })),
      },
      customer.body.token,
    );
    expect(draftOrder.status).toBe(200);
    const order = draftOrder.body;
    expect((await req('POST', `/orders/${order.id}/deliver-tickets`, {})).status).toBe(409);
    const intent = await req(
      'POST',
      '/payments/intents',
      { order_id: order.id },
      customer.body.token,
    );
    const paid = await req(
      'POST',
      '/sandbox/pay',
      { intent_id: intent.body.id },
      customer.body.token,
    );
    expect(paid.status).toBe(200);
    const all = await tickets(order),
      kitchen = all.find((t) => t.status === 'PENDING')!,
      available = all.find((t) => t.status === 'AVAILABLE')!;
    const job = (await view(a.actor).list('production_jobs', sql`ticket_id=${kitchen.id}`))[0];
    expect(
      (await req('POST', `/orders/${order.id}/deliver-tickets`, {}, customer.body.token)).status,
    ).toBe(403);
    expect((await req('POST', `/orders/${order.id}/deliver-tickets`, {}, tokenB)).status).toBe(404);
    expect(
      (await req('POST', `/orders/${order.id}/deliver-tickets`, { ticket_ids: [available.id] }))
        .status,
    ).toBe(400);
    expect((await req('POST', `/orders/${order.id}/deliver-tickets`, {}, waiter1)).status).toBe(
      403,
    );
    expect((await view(a.actor).get('production_jobs', job.id)).status).toBe('PENDING');
    expect((await tickets(order)).every((t) => t.status !== 'REDEEMED')).toBe(true);
    const request = await req('POST', `/tickets/${available.id}/request`, {}, customer.body.token);
    expect(
      (await req('POST', `/service-requests/${request.body.id}/claim`, {}, waiter1)).status,
    ).toBe(200);
    expect((await req('POST', `/orders/${order.id}/deliver-tickets`, {})).status).toBe(409);
    expect((await view(a.actor).get('production_jobs', job.id)).status).toBe('PENDING');
    expect((await view(a.actor).get('service_requests', request.body.id)).status).toBe('CLAIMED');
    expect((await view(a.actor).get('tickets', available.id)).status).toBe('ASSIGNED');
    await req('POST', `/service-requests/${request.body.id}/cancel`, {});
    expect(
      (
        await req('POST', `/payments/${paid.body.payment.id}/refund`, {
          amount: '4.00',
          tab_id: paid.body.order.tab_id,
          reason: 'Estorno antes de entregar',
        })
      ).status,
    ).toBe(200);
    expect((await req('POST', `/orders/${order.id}/deliver-tickets`, {})).status).toBe(402);
    expect((await view(a.actor).get('production_jobs', job.id)).status).toBe('PENDING');
    expect((await tickets(order)).every((t) => t.status !== 'REDEEMED')).toBe(true);
    expect(
      await view(a.actor).list(
        'stock_movements',
        sql`ticket_id=${kitchen.id} AND type='CONSUMPTION'`,
      ),
    ).toHaveLength(0);
    expect(
      (await req('POST', `/orders/${order.id}/cancel`, { reason: 'Cancelado após estorno' }))
        .status,
    ).toBe(200);
    expect((await req('POST', `/orders/${order.id}/deliver-tickets`, {})).status).toBe(409);
  });
});

it('QR da mesa emite PDF e fila térmica isolados, mantém código e congela a impressão no PrintBridge', async () => {
  const table = await freshTable();
  const counts = async () =>
    Promise.all(
      (
        ['orders', 'tickets', 'payments', 'customers', 'table_sessions', 'stock_movements'] as const
      ).map(async (table) => [table, (await view(a.actor).list(table)).length]),
    );
  const before = await counts();
  const read = await req('GET', `/tables/${table.id}/qr?format=LABEL`, undefined, waiter1);
  expect(read.status).toBe(200);
  expect(read.body).toMatchObject({
    kind: 'TABLE_QR',
    table_id: table.id,
    table_number: table.number,
    format: 'LABEL',
  });
  const link = new URL(read.body.url);
  expect(link.pathname).toBe('/' + (await unitSlug()) + '/');
  expect(link.searchParams.get('table')).toBe(table.public_code);
  expect([...link.searchParams.keys()]).toEqual(['table']);
  expect((await req('GET', `/tables/${table.id}/qr`, undefined, tokenB)).status).toBe(404);
  expect((await req('GET', `/tables/${table.id}/qr?format=BAD`)).status).toBe(400);
  expect((await req('GET', `/tables/${table.id}/qr`, undefined, '')).status).toBe(401);
  const pdf = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${table.id}/qr.pdf?format=58`,
    headers: { authorization: 'Bearer ' + tokenA },
  });
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers['content-type']).toContain('application/pdf');
  expect(pdf.rawPayload.toString('latin1')).toContain('/FontFile2');
  const agent = (
    await req('POST', '/print/agents', { name: 'Estação QR', transport: 'PRINTBRIDGE' })
  ).body;
  const otherAgent = (
    await req('POST', '/print/agents', { name: 'Outra estação QR', transport: 'PRINTBRIDGE' })
  ).body;
  for (const format of ['pdf', 'escpos']) {
    const printer = (await req('POST', '/printers', { name: 'QR ' + format, sector: 'mesa-qr' }))
        .body,
      key = randomUUID();
    const input = { printer_id: printer.id, paper_width: 58 };
    const queued = await req('POST', `/tables/${table.id}/qr/print`, input, waiter1, key);
    expect(queued.status).toBe(200);
    const id = queued.body.id;
    expect((await req('POST', `/tables/${table.id}/qr/print`, input, waiter1, key)).body).toEqual(
      queued.body,
    );
    const saved = await view(a.actor).get('print_jobs', id);
    expect(saved).toMatchObject({
      document_kind: 'TABLE_QR',
      source_table_id: table.id,
      ticket_id: null,
      receipt_snapshot: null,
      paper_width: 58,
    });
    expect(
      (await req('POST', '/print/jobs/claim', { printer_ids: [printer.id] }, agent.token)).body,
    ).toMatchObject({ id, document_kind: 'TABLE_QR' });
    const document = await req('GET', `/print/jobs/${id}/document`, undefined, agent.token);
    expect(document.body).toMatchObject({ kind: 'TABLE_QR', url: read.body.url });
    expect((await req('GET', `/tables/qr/jobs/${id}`, undefined, tokenB)).status).toBe(404);
    const prepared = await req(
      'POST',
      `/print/jobs/${id}/bridge/prepare`,
      { origin: 'http://localhost:5173', printer_id: 'cups:qr-' + format, format, paper_width: 80 },
      agent.token,
    );
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    expect(prepared.body.paperWidth).toBe(58);
    const wire = () =>
      app.inject({
        method: 'GET',
        url: `/api/v1/print/jobs/${id}/bridge/document?generation=${prepared.body.generation}`,
        headers: { authorization: 'Bearer ' + agent.token },
      });
    const first = await wire();
    expect(first.statusCode).toBe(200);
    if (format === 'pdf') expect(first.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    else expect(first.rawPayload.includes(Buffer.from(read.body.url))).toBe(true);
    await atomic(a.actor, randomUUID(), 'test.qr-rename', {}, async (s) => {
      await s.update('dining_tables', table.id, {
        number: format === 'pdf' ? 'QR novo' : 'QR final',
      });
      return { updated: true };
    });
    expect((await wire()).rawPayload.equals(first.rawPayload)).toBe(true);
    expect(
      (
        await req(
          'POST',
          `/print/jobs/${id}/bridge/prepare`,
          { origin: 'http://localhost:5173', printer_id: 'cups:qr', format, paper_width: 58 },
          otherAgent.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (await req('POST', `/print/jobs/${id}/cancel`, { reason: 'Conferência de etiqueta' })).status,
    ).toBe(200);
    expect((await wire()).statusCode).toBe(409);
    expect((await req('GET', `/tables/qr/jobs/${id}`)).body.status).toBe('CANCELLED');
  }
  expect(await counts()).toEqual(before);
  expect((await view(a.actor).get('dining_tables', table.id)).public_code).toBe(table.public_code);
  await atomic(a.actor, randomUUID(), 'test.qr-disable', {}, async (s) => {
    await s.update('dining_tables', table.id, { enabled: false });
    return { updated: true };
  });
  expect((await req('GET', `/tables/${table.id}/qr`)).status).toBe(409);
});

describe('funcionamento semanal e visibilidade dos cardápios', () => {
  const closedHours = () => ({
    enabled: true,
    timezone: 'America/Sao_Paulo',
    days: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      enabled: false,
      all_day: false,
      periods: [],
    })),
  });
  it('valida a agenda, exige permissão e mantém as configurações isoladas por unidade', async () => {
    const before = (await req('GET', '/settings')).body;
    const other = (await req('GET', '/settings', undefined, tokenB)).body;
    try {
      expect(
        (
          await req(
            'PATCH',
            '/settings',
            { opening_hours: closedHours(), show_out_of_stock: false },
            waiter1,
          )
        ).status,
      ).toBe(403);
      expect((await req('PATCH', '/settings', { show_out_of_stock: 'false' })).status).toBe(400);
      expect(
        (await req('PATCH', '/settings', { opening_hours: { enabled: 'true', days: 'invalid' } }))
          .status,
      ).toBe(400);
      const invalid = closedHours();
      invalid.days[0].enabled = true;
      expect((await req('PATCH', '/settings', { opening_hours: invalid })).status).toBe(400);
      expect(
        (
          await req('PATCH', '/settings', {
            opening_hours: closedHours(),
            show_out_of_stock: false,
          })
        ).status,
      ).toBe(200);
      const after = (await req('GET', '/settings', undefined, tokenB)).body;
      expect(after.opening_hours).toEqual(other.opening_hours);
      expect(after.show_out_of_stock).toBe(other.show_out_of_stock);
    } finally {
      await req('PATCH', '/settings', {
        opening_hours: before.opening_hours,
        is_open: Boolean(before.is_open),
        show_out_of_stock: Boolean(before.show_out_of_stock),
      });
    }
  });
  it('bloqueia novos pedidos fora da agenda no servidor, incluindo cliente de mesa e retirada', async () => {
    const before = (await req('GET', '/settings')).body;
    const table = await freshTable();
    const tableClient = (await visitor(table)).body;
    const pickup = (
      await req(
        'POST',
        '/public/' + (await unitSlug()) + '/counter-sessions',
        { name: 'Cliente horários', phone: '11999998888' },
        '',
      )
    ).body;
    const product = (
      await req('POST', '/products', {
        name: 'Pedido em horário ' + randomUUID(),
        price: '3.00',
        stock_policy: 'NO_CONTROL',
      })
    ).body;
    const items = [{ product_id: product.id, quantity: 1, modifiers: [] }];
    const pending = await req('POST', '/public/counter/orders', { items }, pickup.token);
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    const intent = await req(
      'POST',
      '/payments/intents',
      { order_id: pending.body.id },
      pickup.token,
    );
    expect(intent.status, JSON.stringify(intent.body)).toBe(200);
    try {
      expect(
        (await req('PATCH', '/settings', { opening_hours: closedHours(), is_open: true })).status,
      ).toBe(200);
      const menu = (await req('GET', '/public/' + (await unitSlug()) + '/menu', undefined, ''))
        .body;
      expect(menu.establishment).toMatchObject({ is_open: false, accepting_orders: true });
      expect(
        (await req('GET', '/public/' + (await unitSlug()) + '/opening-hours', undefined, '')).body
          .reason,
      ).toBe('OUTSIDE_HOURS');
      const count = (await view(a.actor).list('orders')).length;
      for (const [path, input, token] of [
        [
          '/orders',
          { table_id: table.id, source: 'POS', payment_policy: 'POSTPAID', items },
          tokenA,
        ],
        [
          '/public/orders',
          { table_id: table.id, source: 'CUSTOMER', payment_policy: 'PREPAID', items },
          tableClient.token,
        ],
        ['/public/counter/orders', { items }, pickup.token],
      ] as const) {
        const result = await req('POST', path, input, token);
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(result.body.error.message).toContain('fora do horário');
      }
      expect((await view(a.actor).list('orders')).length).toBe(count);
      const paid = await req('POST', '/sandbox/pay', { intent_id: intent.body.id }, pickup.token);
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      expect(paid.body.requires_review).toBeFalsy();
      expect((await req('GET', '/orders/' + pending.body.id)).body.status).toBe('CONFIRMED');
      const allDay = closedHours();
      allDay.days = allDay.days.map((day) => ({ ...day, enabled: true, all_day: true }));
      expect((await req('PATCH', '/settings', { opening_hours: allDay })).status).toBe(200);
      const reopened = await req('POST', '/orders', {
        table_id: table.id,
        source: 'POS',
        payment_policy: 'POSTPAID',
        items,
      });
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    } finally {
      await req('PATCH', '/settings', {
        opening_hours: before.opening_hours,
        is_open: Boolean(before.is_open),
      });
    }
  });
  it('oculta esgotados no servidor, preserva cadastro e produtos com variação própria disponível', async () => {
    const before = (await req('GET', '/settings')).body;
    const product = (
      await req('POST', '/products', {
        name: 'Visibilidade ' + randomUUID(),
        price: '5.00',
        stock_policy: 'ON_DELIVERY',
        stock_location_id: a.location.id,
      })
    ).body;
    const noControl = (
      await req('POST', '/products', {
        name: 'Sem controle ' + randomUUID(),
        price: '5.00',
        stock_policy: 'NO_CONTROL',
      })
    ).body;
    const own = (
      await req('POST', '/product-variants', {
        product_id: product.id,
        name: 'Saldo próprio',
        price: '7.00',
        stock_mode: 'OWN',
      })
    ).body;
    const balance = (
      await req('POST', '/stock-balances', {
        product_id: product.id,
        variant_id: own.id,
        location_id: a.location.id,
      })
    ).body;
    try {
      expect((await req('PATCH', '/settings', { show_out_of_stock: true })).status).toBe(200);
      expect(
        (await req('GET', '/catalog/operational')).body.products.some(
          (item: Row) => item.id === product.id,
        ),
      ).toBe(true);
      expect((await req('PATCH', '/settings', { show_out_of_stock: false })).status).toBe(200);
      const paths = ['/catalog/operational', '/public/' + (await unitSlug()) + '/menu'];
      for (const path of paths) {
        const catalog = (await req('GET', path)).body;
        expect(catalog.products.some((item: Row) => item.id === product.id)).toBe(false);
        expect(catalog.variants.some((item: Row) => item.id === own.id)).toBe(false);
        expect(catalog.products.some((item: Row) => item.id === noControl.id)).toBe(true);
      }
      expect((await req('GET', '/products')).body.some((item: Row) => item.id === product.id)).toBe(
        true,
      );
      expect(
        (
          await req('POST', '/inventory/adjustments', {
            balance_id: balance.id,
            type: 'PURCHASE',
            quantity: '1.000',
            reason: 'Teste de variação disponível',
          })
        ).status,
      ).toBe(200);
      for (const path of paths)
        expect(
          (await req('GET', path)).body.products.some((item: Row) => item.id === product.id),
        ).toBe(true);
      expect(
        (await req('GET', '/products/operational')).body.some(
          (item: Row) => item.id === product.id,
        ),
      ).toBe(true);
    } finally {
      await req('PATCH', '/settings', { show_out_of_stock: Boolean(before.show_out_of_stock) });
    }
  });
});

it('central de solicitações informa destino, tipo, item, observações e responsável sem expor códigos de consumo ou outra unidade', async () => {
  const area = (await req('POST', '/areas', { name: 'Varanda ' + randomUUID().slice(0, 5) })).body;
  const table = await freshTable();
  expect((await req('PATCH', '/tables/' + table.id, { area_id: area.id })).status).toBe(200);
  const client = (await visitor(table)).body;
  const product = (
    await req('POST', '/products', {
      name: 'Solicitação contextual ' + randomUUID().slice(0, 5),
      price: '7.00',
      stock_policy: 'NO_CONTROL',
    })
  ).body;
  const created = await req(
    'POST',
    '/public/orders',
    {
      table_id: table.id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [
        {
          product_id: product.id,
          quantity: 1,
          modifiers: [],
          notes: 'Sem gelo; levar para a varanda.',
        },
      ],
    },
    client.token,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const intent = (
    await req('POST', '/payments/intents', { order_id: created.body.id }, client.token)
  ).body;
  expect((await req('POST', '/sandbox/pay', { intent_id: intent.id }, client.token)).status).toBe(
    200,
  );
  const [issued] = await tickets(created.body);
  const request = (await req('POST', `/tickets/${issued.id}/request`, {}, client.token)).body;
  const listed = (await req('GET', '/service-requests', undefined, waiter1)).body.find(
    (item: Row) => item.id === request.id,
  );
  expect(listed.ticket).toMatchObject({
    table_id: table.id,
    table_number: table.number,
    area_id: area.id,
    area_name: area.name,
    delivery_type: 'TABLE_DELIVERY',
    order_id: created.body.id,
    product: product.name,
    notes: 'Sem gelo; levar para a varanda.',
    customer_name: 'Cliente de teste',
  });
  expect(Math.abs(Date.now() - Date.parse(listed.created_at_iso))).toBeLessThan(60000);
  expect(listed.ticket).not.toHaveProperty('token');
  expect(listed.ticket).not.toHaveProperty('token_hash');
  expect(listed.ticket).not.toHaveProperty('token_nonce');
  expect(
    (await req('GET', '/service-requests', undefined, tokenB)).body.some(
      (item: Row) => item.id === request.id,
    ),
  ).toBe(false);
  expect((await req('GET', '/service-requests', undefined, client.token)).status).toBe(403);
  expect((await req('POST', `/service-requests/${request.id}/claim`, {}, waiter1)).status).toBe(
    200,
  );
  const assigned = (await req('GET', '/service-requests', undefined, tokenA)).body.find(
    (item: Row) => item.id === request.id,
  );
  expect(assigned).toMatchObject({ status: 'CLAIMED', claimed_by_name: 'Garçom 1' });
  const document = (await req('GET', `/tickets/${issued.id}`, undefined, waiter1)).body;
  expect(document).toMatchObject({
    area_name: area.name,
    delivery_type: 'TABLE_DELIVERY',
    product: product.name,
  });
  expect(
    (await req('POST', `/tickets/${issued.id}/redeem`, { token: document.token }, waiter2)).status,
  ).toBe(409);
  expect(
    (await req('POST', `/tickets/${issued.id}/redeem`, { token: document.token }, waiter1)).status,
  ).toBe(200);
  expect(
    (await req('GET', '/service-requests')).body.some((item: Row) => item.id === request.id),
  ).toBe(false);
  expect(
    (await req('GET', '/tables')).body.find((item: Row) => item.id === table.id)
      .service_request_count,
  ).toBe(0);
});

it('controle rápido de pedidos abre e renova caixa atomicamente, vincula novos pedidos e preserva turnos anteriores', async () => {
  const before = (await req('GET', '/settings')).body;
  for (const session of (await req('GET', '/cash/sessions')).body.filter(
    (cash: Row) => cash.status === 'OPEN',
  ))
    expect(
      (
        await req('POST', '/cash/sessions/' + session.id + '/close', {
          counted_amount:
            Number(session.expected_amount) < 0 ? '0.00' : String(session.expected_amount),
        })
      ).status,
    ).toBe(200);
  try {
    expect((await req('GET', '/operation/control', undefined, waiter1)).status).toBe(403);
    expect((await req('PATCH', '/operation/control', { is_open: false }, waiter1)).status).toBe(
      403,
    );
    expect((await req('PATCH', '/operation/control', { is_open: false })).status).toBe(200);
    const start = await req('PATCH', '/operation/control', {
      is_open: true,
      open_cash: {
        register_name: 'Caixa operação ' + randomUUID().slice(0, 5),
        opening_amount: '25.00',
      },
    });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect(start.body.sessions).toHaveLength(1);
    const first = start.body.sessions[0];
    expect(start.body).toMatchObject({ is_open: true, order_cash_session_id: first.id });
    const product = (
      await req('POST', '/products', {
        name: 'Vínculo de caixa ' + randomUUID().slice(0, 5),
        price: '7.00',
        stock_policy: 'NO_CONTROL',
      })
    ).body;
    const firstOrder = await draft(await freshTable(), 1, 'POSTPAID', product);
    expect(firstOrder.cash_session_id).toBe(first.id);
    const customerTable = await freshTable(),
      client = (await visitor(customerTable)).body;
    const clientOrder = await req(
      'POST',
      '/public/orders',
      {
        table_id: customerTable.id,
        source: 'CUSTOMER',
        payment_policy: 'PREPAID',
        items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
      },
      client.token,
    );
    expect(clientOrder.status).toBe(200);
    expect(clientOrder.body.cash_session_id).toBe(first.id);
    const register = (
      await req('POST', '/cash-registers', {
        name: 'Segundo operacional ' + randomUUID().slice(0, 5),
      })
    ).body;
    const second = (
      await req('POST', '/cash/sessions', { register_id: register.id, opening_amount: '0.00' })
    ).body;
    expect(
      (await req('PATCH', '/operation/control', { is_open: true, cash_session_id: second.id }))
        .status,
    ).toBe(200);
    const secondOrder = await draft(await freshTable(), 1, 'POSTPAID', product);
    expect(secondOrder.cash_session_id).toBe(second.id);
    const counter = await req('POST', '/orders/counter', {
      items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
      expected_total: '7.00',
      method: 'PIX_MANUAL',
      cash_session_id: first.id,
    });
    expect(counter.status, JSON.stringify(counter.body)).toBe(200);
    expect(counter.body.order.cash_session_id).toBe(first.id);
    const foreignRegister = (
      await req(
        'POST',
        '/cash-registers',
        { name: 'Caixa estrangeiro ' + randomUUID().slice(0, 5) },
        tokenB,
      )
    ).body;
    const foreignCash = (
      await req(
        'POST',
        '/cash/sessions',
        { register_id: foreignRegister.id, opening_amount: '0.00' },
        tokenB,
      )
    ).body;
    expect(
      (await req('PATCH', '/operation/control', { is_open: true, cash_session_id: foreignCash.id }))
        .status,
    ).toBe(404);
    await db.execute(
      sql`UPDATE cash_sessions SET created_at=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 25 HOUR) WHERE tenant_id=${a.tenant_id} AND establishment_id=${a.establishment_id} AND id=${second.id}`,
    );
    expect(
      (await req('GET', '/operation/control')).body.sessions.find(
        (cash: Row) => cash.id === second.id,
      ).overdue,
    ).toBe(true);
    const failed = await req('POST', '/operation/cash/rotate', {
      cash_session_id: second.id,
      counted_amount: '0.00',
      open_cash: { register_id: first.register_id, opening_amount: '0.00' },
    });
    expect(failed.status).toBe(409);
    expect((await view(a.actor).get('cash_sessions', second.id)).status).toBe('OPEN');
    const key = randomUUID(),
      input = {
        cash_session_id: second.id,
        counted_amount: '0.00',
        open_cash: { register_id: second.register_id, opening_amount: '15.00' },
      };
    const rotated = await req('POST', '/operation/cash/rotate', input, tokenA, key);
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    const next = rotated.body.rotation.opened_id;
    expect(next).not.toBe(second.id);
    expect(rotated.body.order_cash_session_id).toBe(next);
    expect(rotated.body.sessions.find((cash: Row) => cash.id === next).overdue).toBe(false);
    expect(
      (await req('POST', '/operation/cash/rotate', input, tokenA, key)).body.rotation.opened_id,
    ).toBe(next);
    expect((await view(a.actor).get('cash_sessions', second.id)).status).toBe('CLOSED');
    expect((await view(a.actor).get('orders', secondOrder.id)).cash_session_id).toBe(second.id);
    expect((await draft(await freshTable(), 1, 'POSTPAID', product)).cash_session_id).toBe(next);
    expect((await req('GET', '/orders/' + secondOrder.id)).body.cash_register_name).toBe(
      register.name,
    );
    expect(
      (await req('GET', '/operation/control', undefined, tokenB)).body.sessions.some(
        (cash: Row) => cash.id === next,
      ),
    ).toBe(false);
    expect((await req('PATCH', '/operation/control', { is_open: false })).status).toBe(200);
    const blocked = await req('POST', '/orders', {
      table_id: (await freshTable()).id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
    });
    expect(blocked.status).toBe(409);
  } finally {
    await req('PATCH', '/settings', {
      is_open: Boolean(before.is_open),
      opening_hours: before.opening_hours,
    });
  }
});
