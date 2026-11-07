import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool, view, sql } from '../../packages/database/src/index.js';

let app: Awaited<ReturnType<typeof buildApp>>, fixture: Awaited<ReturnType<typeof provision>>;
let token: string, viewer: string, foreign: string;
const suffix = randomUUID().slice(0, 8),
  password = 'StockLocationTestOnly1!';
async function req(
  method: string,
  path: string,
  payload?: unknown,
  auth = token,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + auth, 'Idempotency-Key': key },
    ...(payload === undefined ? {} : { payload: payload as any }),
  });
}
async function call(method: string, path: string, payload?: unknown, auth = token) {
  const response = await req(method, path, payload, auth);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco exclusivo de teste obrigatório.');
  await migrate();
  fixture = await provision({
    name: 'Depósitos ' + suffix,
    owner_name: 'Gestor',
    owner_email: suffix + '@stock.test',
    password,
    demo: true,
  });
  const other = await provision({
    name: 'Outro depósito ' + suffix,
    owner_name: 'Outro',
    owner_email: 'other-' + suffix + '@stock.test',
    password,
  });
  foreign = other.location.id;
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  token = (
    await call(
      'POST',
      '/auth/login',
      { email: suffix + '@stock.test', password, establishment_slug: fixture.slug },
      '',
    )
  ).token;
  const role = await call('POST', '/roles', {
    name: 'Consulta de estoque',
    permissions: ['inventory.view'],
  });
  await call('POST', '/staff', {
    name: 'Consulta',
    email: 'view-' + suffix + '@stock.test',
    password,
    role_id: role.id,
  });
  viewer = (
    await call(
      'POST',
      '/auth/login',
      { email: 'view-' + suffix + '@stock.test', password, establishment_slug: fixture.slug },
      '',
    )
  ).token;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
const stock = (id: string) => view(fixture.actor).get('stock_balances', id);
async function create() {
  const product = await call('POST', '/products', {
    name: 'Local ' + randomUUID().slice(0, 6),
    price: '5.00',
    stock_policy: 'ON_DELIVERY',
  });
  const balance = await call('POST', '/stock-balances', {
    product_id: product.id,
    location_id: fixture.location.id,
  });
  await call('POST', '/inventory/adjustments', {
    balance_id: balance.id,
    type: 'PURCHASE',
    quantity: '10.000',
    reason: 'Saldo para teste do depósito',
  });
  const destination = await call('POST', '/stock-locations', {
    name: 'Destino ' + randomUUID().slice(0, 6),
    is_default: false,
    color: '#e11d48',
  });
  return { product, balance: await stock(balance.id), destination };
}
it('altera o depósito mantendo ID, quantidades, reservas, históricos e consumo de pedidos antigos e novos', async () => {
  const { product, balance, destination } = await create();
  const own = await call('POST', '/product-variants', {
    product_id: product.id,
    name: 'Saldo próprio',
    price: '8.00',
    stock_mode: 'OWN',
  });
  const separate = await call('POST', '/stock-balances', {
    product_id: product.id,
    variant_id: own.id,
    location_id: fixture.location.id,
  });
  await call('POST', '/inventory/adjustments', {
    balance_id: separate.id,
    type: 'PURCHASE',
    quantity: '5.000',
    reason: 'Saldo separado',
  });
  const replenishment = await call('POST', '/inventory/replenishments', {
    items: [{ balance_id: balance.id, quantity: '2.000' }],
  });
  const order = await call('POST', '/orders', {
    table_id: fixture.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 2, modifiers: [] }],
  });
  await call('POST', '/orders/' + order.id + '/confirm', {});
  const before = await stock(balance.id);
  const detail = await call('GET', '/orders/' + order.id);
  const oldMovements = await view(fixture.actor).list(
    'stock_movements',
    sql`balance_id=${balance.id}`,
  );
  const moved = await call('PATCH', `/stock-balances/${balance.id}/location`, {
    location_id: destination.id,
    version: before.version,
  });
  expect(moved).toMatchObject({
    id: balance.id,
    location_id: destination.id,
    physical_quantity: '12.000',
    reserved_quantity: '2.000',
    version: before.version + 1,
  });
  expect(await view(fixture.actor).list('stock_movements', sql`balance_id=${balance.id}`)).toEqual(
    oldMovements,
  );
  expect(oldMovements.every((m) => m.location_id === fixture.location.id)).toBe(true);
  expect(
    (await call('GET', '/products/' + product.id + '/management')).product.stock_location_id,
  ).toBe(destination.id);
  expect((await view(fixture.actor).get('product_variants', own.id)).stock_location_id).toBe(
    fixture.location.id,
  );
  expect(await stock(separate.id)).toMatchObject({
    location_id: fixture.location.id,
    physical_quantity: '5.000',
    reserved_quantity: '0.000',
  });
  const history = await call('GET', '/inventory/replenishments/' + replenishment.id);
  expect(history.items[0]).toMatchObject({ location_name: fixture.location.name });
  expect(history.items[0].location_color).not.toBe(destination.color);
  const next = await call('POST', '/orders', {
    table_id: fixture.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
  });
  await call('POST', '/orders/' + next.id + '/confirm', {});
  expect((await call('GET', '/orders/' + next.id)).items[0].stock_components[0].balance_id).toBe(
    balance.id,
  );
  expect((await call('GET', '/orders/' + order.id)).items[0].stock_components).toEqual(
    detail.items[0].stock_components,
  );
  for (const ticket of detail.tickets) {
    const document = await call('GET', '/tickets/' + ticket.id);
    await call('POST', '/tickets/' + ticket.id + '/redeem', { token: document.token });
  }
  expect(await stock(balance.id)).toMatchObject({
    location_id: destination.id,
    physical_quantity: '10.000',
    reserved_quantity: '1.000',
  });
  const movements = await view(fixture.actor).list(
    'stock_movements',
    sql`balance_id=${balance.id}`,
  );
  const consumed = movements.filter((m) => m.type === 'CONSUMPTION');
  expect(consumed).toHaveLength(2);
  expect(consumed.every((m) => m.location_id === destination.id)).toBe(true);
});
it('altera apenas o local da variação própria, preservando o estoque compartilhado e atualizando sua origem', async () => {
  const { product, balance, destination } = await create();
  const variant = await call('POST', '/product-variants', {
    product_id: product.id,
    name: 'Própria',
    price: '7.00',
    stock_mode: 'OWN',
  });
  const own = await call('POST', '/stock-balances', {
    product_id: product.id,
    variant_id: variant.id,
    location_id: fixture.location.id,
  });
  await call('POST', '/inventory/adjustments', {
    balance_id: own.id,
    type: 'PURCHASE',
    quantity: '4.000',
    reason: 'Variação própria',
  });
  const before = await stock(own.id);
  await call('PATCH', `/stock-balances/${own.id}/location`, {
    location_id: destination.id,
    version: before.version,
  });
  expect(await stock(own.id)).toMatchObject({
    location_id: destination.id,
    physical_quantity: '4.000',
    reserved_quantity: '0.000',
  });
  expect(await stock(balance.id)).toEqual(balance);
  expect((await view(fixture.actor).get('product_variants', variant.id)).stock_location_id).toBe(
    destination.id,
  );
  expect(
    (await call('GET', '/catalog/operational')).variants.find((v: any) => v.id === variant.id).stock
      .available,
  ).toBe(4);
});
it('bloqueia destino ocupado, edição desatualizada, outra unidade e perfil sem permissão sem modificar quantidades', async () => {
  const { product, balance, destination } = await create();
  await call('POST', '/stock-balances', { product_id: product.id, location_id: destination.id });
  const path = `/stock-balances/${balance.id}/location`,
    body = { location_id: destination.id, version: balance.version };
  expect((await req('PATCH', path, body)).statusCode).toBe(409);
  expect((await req('PATCH', path, { ...body, location_id: foreign })).statusCode).toBe(404);
  expect((await req('PATCH', path, body, viewer)).statusCode).toBe(403);
  expect(
    (await req('PATCH', path, { location_id: fixture.location.id, version: balance.version - 1 }))
      .statusCode,
  ).toBe(409);
  expect(await stock(balance.id)).toEqual(balance);
});
it('serializa a edição concorrente de depósito com a movimentação de quantidade', async () => {
  const { balance, destination } = await create();
  const [move, adjustment] = await Promise.all([
    req('PATCH', `/stock-balances/${balance.id}/location`, {
      location_id: destination.id,
      version: balance.version,
    }),
    req('POST', '/inventory/adjustments', {
      balance_id: balance.id,
      type: 'PURCHASE',
      quantity: '1.000',
      reason: 'Entrada concorrente',
    }),
  ]);
  expect(adjustment.statusCode, adjustment.body).toBe(200);
  expect([200, 409]).toContain(move.statusCode);
  const after = await stock(balance.id);
  expect(after.physical_quantity).toBe('11.000');
  expect(after.reserved_quantity).toBe('0.000');
  expect(after.location_id).toBe(move.statusCode === 200 ? destination.id : fixture.location.id);
});
it('preserva a ficha técnica ao alterar o local de um ingrediente ou de um saldo inativo do produto preparado', async () => {
  const s = view(fixture.actor),
    prepared = fixture.products[3],
    ingredient = fixture.products[4];
  const balances = await s.list('stock_balances');
  const unused = balances.find((balance) => balance.product_id === prepared.id)!;
  const raw = balances.find((balance) => balance.product_id === ingredient.id)!;
  const destination = await call('POST', '/stock-locations', {
    name: 'Ingredientes ' + suffix,
    is_default: false,
  });
  await call('PATCH', `/stock-balances/${unused.id}/location`, {
    location_id: destination.id,
    version: unused.version,
  });
  expect((await s.get('products', prepared.id)).stock_location_id).toBeNull();
  await call('PATCH', `/stock-balances/${raw.id}/location`, {
    location_id: destination.id,
    version: raw.version,
  });
  const order = await call('POST', '/orders', {
    table_id: fixture.tables[3].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: prepared.id, quantity: 1, modifiers: [] }],
  });
  expect((await call('GET', '/orders/' + order.id)).items[0].stock_components).toEqual([
    { balance_id: raw.id, quantity: '0.050' },
  ]);
  expect(await stock(raw.id)).toMatchObject({
    location_id: destination.id,
    physical_quantity: raw.physical_quantity,
    reserved_quantity: raw.reserved_quantity,
  });
});
