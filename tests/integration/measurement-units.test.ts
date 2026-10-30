import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool } from '../../packages/database/src/index.js';
import { measurementUnits } from '../../packages/shared/src/measurement-units.js';
let app: Awaited<ReturnType<typeof buildApp>>, token: string, otherToken: string;
let fixture: Awaited<ReturnType<typeof provision>>;
const password = 'MeasurementUnitsTestsOnly1!',
  suffix = randomUUID().slice(0, 8);
async function request(method: string, path: string, body?: unknown, authorization = token) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + authorization, 'Idempotency-Key': randomUUID() },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function call(method: string, path: string, body?: unknown) {
  const response = await request(method, path, body);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Use um banco exclusivo de teste.');
  await migrate();
  fixture = await provision({
    name: 'Medidas ' + suffix,
    owner_name: 'Gestor',
    owner_email: 'units-' + suffix + '@test.local',
    password,
    demo: true,
  });
  const other = await provision({
    name: 'Outras medidas ' + suffix,
    owner_name: 'Outro gestor',
    owner_email: 'other-units-' + suffix + '@test.local',
    password,
  });
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  for (const [unit, email, save] of [
    [fixture, 'units-' + suffix + '@test.local', (value: string) => (token = value)],
    [other, 'other-units-' + suffix + '@test.local', (value: string) => (otherToken = value)],
  ] as const) {
    const response = await request(
      'POST',
      '/auth/login',
      { email, password, establishment_slug: unit.slug },
      '',
    );
    expect(response.statusCode, response.body).toBe(200);
    save(response.json().token);
  }
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('entrega as medidas pré-cadastradas e mantém unidade como padrão sem alterar estoque', async () => {
  expect(await call('GET', '/measurement-units')).toEqual(measurementUnits);
  const [stored] = await pool.query(
    'SELECT code,name,symbol FROM measurement_units ORDER BY sort_order',
  );
  expect(stored).toEqual(measurementUnits);
  expect((await call('GET', '/products')).every((product: any) => product.unit_code === 'UN')).toBe(
    true,
  );
  const product = await call('POST', '/products', {
    name: 'Novo sem medida explícita',
    price: '2.00',
    stock_policy: 'NO_CONTROL',
  });
  expect(product.unit_code).toBe('UN');
  const updated = await call('PATCH', '/products/' + product.id, { price: '3.00' });
  expect(updated.unit_code).toBe('UN');
});
it('aceita apenas unidades conhecidas, preserva atualizações parciais e isola produtos de outras contas', async () => {
  const product = await call('POST', '/products', {
    name: 'Farinha em kg',
    price: '5.00',
    stock_policy: 'ON_DELIVERY',
    unit_code: 'KG',
  });
  expect(product.unit_code).toBe('KG');
  for (const unit_code of ['INVALIDA', '', 'kg', null]) {
    const rejected = await request('PATCH', '/products/' + product.id, { unit_code });
    expect(rejected.statusCode, rejected.body).toBe(400);
  }
  expect((await call('PATCH', '/products/' + product.id, { name: 'Farinha' })).unit_code).toBe(
    'KG',
  );
  expect(
    (await request('PATCH', '/products/' + product.id, { unit_code: 'G' }, otherToken)).statusCode,
  ).toBe(404);
  const management = await call('GET', '/products/' + product.id + '/management');
  expect(management.product.unit_code).toBe('KG');
  expect(
    (await call('GET', '/inventory/catalog')).products.find((item: any) => item.id === product.id)
      .unit_code,
  ).toBe('KG');
});
it('registra a unidade nas movimentações e reposições sem converter valores nem reescrever o histórico', async () => {
  const product = await call('POST', '/products', {
    name: 'Ingrediente de medidas',
    price: '4.00',
    stock_policy: 'ON_DELIVERY',
    unit_code: 'KG',
  });
  const location = (await call('GET', '/stock-locations'))[0];
  const balance = await call('POST', '/products/' + product.id + '/initial-stock', {
    location_id: location.id,
    quantity: '10.000',
    use_for_consumption: true,
  });
  await call('PATCH', '/products/' + product.id, { unit_code: 'G' });
  let management = await call('GET', '/products/' + product.id + '/management');
  expect(management.balances[0].physical_quantity).toBe('10.000');
  expect(management.movements[0].unit_code).toBe('KG');
  const replenishment = await call('POST', '/inventory/replenishments', {
    freight: '0.00',
    discount: '0.00',
    items: [{ balance_id: balance.id, quantity: '1.250', unit_cost: '2.00' }],
  });
  expect(replenishment.items[0]).toMatchObject({
    unit_code: 'G',
    quantity: '1.250',
    physical_after: '11.250',
    line_total: '2.50',
  });
  await call('PATCH', '/products/' + product.id, { unit_code: 'ML' });
  management = await call('GET', '/products/' + product.id + '/management');
  expect(management.balances[0].physical_quantity).toBe('11.250');
  expect(management.movements.find((movement: any) => movement.type === 'PURCHASE').unit_code).toBe(
    'G',
  );
  expect(
    (await call('GET', '/inventory/replenishments/' + replenishment.id)).items[0].unit_code,
  ).toBe('G');
});
it('consome os ingredientes na medida cadastrada e mantém o pedido contado por item', async () => {
  const ingredient = await call('POST', '/products', {
    name: 'Farinha da receita',
    unit_code: 'KG',
    price: '1.00',
    stock_policy: 'ON_DELIVERY',
    enabled: false,
  });
  const location = (await call('GET', '/stock-locations'))[0];
  await call('POST', '/products/' + ingredient.id + '/initial-stock', {
    location_id: location.id,
    quantity: '2.000',
    use_for_consumption: true,
  });
  const product = await call('POST', '/products', {
    name: 'Porção com receita',
    price: '10.00',
    stock_policy: 'RECIPE',
  });
  const recipe = await call('POST', '/recipes', { product_id: product.id });
  await call('POST', '/recipe-items', {
    recipe_id: recipe.id,
    ingredient_id: ingredient.id,
    quantity: '0.050',
  });
  const order = await call('POST', '/orders', {
    table_id: fixture.tables[0].id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 2, modifiers: [] }],
  });
  await call('POST', '/orders/' + order.id + '/confirm', {});
  let management = await call('GET', '/products/' + ingredient.id + '/management');
  expect(management.balances[0].reserved_quantity).toBe('0.100');
  const detail = await call('GET', '/orders/' + order.id);
  expect(detail.tickets).toHaveLength(2);
  for (const ticket of detail.tickets) {
    const document = await call('GET', '/tickets/' + ticket.id);
    await call('POST', '/tickets/' + ticket.id + '/redeem', { token: document.token });
  }
  management = await call('GET', '/products/' + ingredient.id + '/management');
  expect(management.balances[0]).toMatchObject({
    physical_quantity: '1.900',
    reserved_quantity: '0.000',
  });
  expect(management.movements.every((movement: any) => movement.unit_code === 'KG')).toBe(true);
});
