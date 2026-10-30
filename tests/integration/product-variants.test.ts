import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool, view, sql } from '../../packages/database/src/index.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  fixture: Awaited<ReturnType<typeof provision>>,
  token: string,
  otherToken: string,
  waiterToken: string;
const suffix = randomUUID().slice(0, 8),
  password = 'ProductVariantsTestPassword1!';
async function req(method: string, path: string, body?: unknown, auth = token, key = randomUUID()) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + auth, 'Idempotency-Key': key },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function call(method: string, path: string, body?: unknown, auth = token) {
  const response = await req(method, path, body, auth);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Use banco exclusivo de testes.');
  await migrate();
  fixture = await provision({
    name: 'Variações ' + suffix,
    owner_name: 'Gestor',
    owner_email: 'variants-' + suffix + '@test.local',
    password,
    demo: true,
  });
  const other = await provision({
    name: 'Outra conta ' + suffix,
    owner_name: 'Outro gestor',
    owner_email: 'variants-other-' + suffix + '@test.local',
    password,
  });
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  token = (
    await call(
      'POST',
      '/auth/login',
      { email: 'variants-' + suffix + '@test.local', password, establishment_slug: fixture.slug },
      '',
    )
  ).token;
  otherToken = (
    await call(
      'POST',
      '/auth/login',
      {
        email: 'variants-other-' + suffix + '@test.local',
        password,
        establishment_slug: other.slug,
      },
      '',
    )
  ).token;
  await call('POST', '/staff', {
    name: 'Garçom',
    email: 'variants-waiter-' + suffix + '@test.local',
    password,
    role_id: fixture.roles.find((role) => role.name === 'Garçom')!.id,
  });
  waiterToken = (
    await call(
      'POST',
      '/auth/login',
      {
        email: 'variants-waiter-' + suffix + '@test.local',
        password,
        establishment_slug: fixture.slug,
      },
      '',
    )
  ).token;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('cria uma variação padrão obrigatória, permite renomear e não aceita apagar o seu nome', async () => {
  const product = await call('POST', '/products', {
    name: 'Produto base',
    price: '14.00',
    stock_policy: 'NO_CONTROL',
  });
  expect(product.default_variant_name).toBe('Padrão');
  let management = await call('GET', '/products/' + product.id + '/management');
  expect(management.variant_count).toBe(1);
  expect(management.default_variant).toMatchObject({
    name: 'Padrão',
    price: '14.00',
    is_default: true,
    removable: false,
  });
  await call('PATCH', '/products/' + product.id, { default_variant_name: '  Garrafa 600 ml  ' });
  management = await call('GET', '/products/' + product.id + '/management');
  expect(management.default_variant.name).toBe('Garrafa 600 ml');
  for (const value of ['', '   ', null])
    expect(
      (await req('PATCH', '/products/' + product.id, { default_variant_name: value })).statusCode,
    ).toBe(400);
  expect((await req('DELETE', '/product-variants/' + product.id)).statusCode).toBe(404);
  await expect(
    pool.query("UPDATE products SET default_variant_name='' WHERE id=?", [product.id]),
  ).rejects.toThrow();
  const order = await call('POST', '/orders', {
    table_id: fixture.tables[0].id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
  });
  const detail = await call('GET', '/orders/' + order.id);
  expect(detail.items[0]).toMatchObject({
    variant_id: null,
    unit_price: '14.00',
    name_snapshot: 'Produto base - Garrafa 600 ml',
  });
});
it('remove todas as adicionais de forma concorrente e mantém a padrão disponível', async () => {
  const product = await call('POST', '/products', {
    name: 'Produto com opções',
    default_variant_name: 'Unidade',
    price: '5.00',
    stock_policy: 'NO_CONTROL',
  });
  const variants = [];
  for (const name of ['Dupla', 'Tripla'])
    variants.push(
      await call('POST', '/product-variants', { product_id: product.id, name, price: '10.00' }),
    );
  expect((await call('GET', '/products/' + product.id + '/management')).variant_count).toBe(3);
  const results = await Promise.all(
    variants.map((variant) => req('DELETE', '/product-variants/' + variant.id)),
  );
  for (const result of results) expect(result.statusCode, result.body).toBe(200);
  const management = await call('GET', '/products/' + product.id + '/management');
  expect(management.variants).toHaveLength(0);
  expect(management.variant_count).toBe(1);
  expect(management.default_variant.name).toBe('Unidade');
  const stored = await view(fixture.actor).list('product_variants', sql`product_id=${product.id}`);
  expect(stored).toHaveLength(2);
  expect(stored.every((variant) => !variant.enabled && variant.deleted_at)).toBe(true);
});
it('preserva pedidos e fichas anteriores e impede usar, reativar ou alterar a variação removida', async () => {
  const product = await call('POST', '/products', {
    name: 'Consumo histórico',
    price: '4.00',
    stock_policy: 'NO_CONTROL',
  });
  const variant = await call('POST', '/product-variants', {
    product_id: product.id,
    name: 'Especial',
    price: '7.00',
  });
  expect(
    (await req('DELETE', '/product-variants/' + variant.id, undefined, otherToken)).statusCode,
  ).toBe(404);
  expect(
    (await req('DELETE', '/product-variants/' + variant.id, undefined, waiterToken)).statusCode,
  ).toBe(403);
  const body = {
    table_id: fixture.tables[1].id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, variant_id: variant.id, quantity: 1, modifiers: [] }],
  };
  const order = await call('POST', '/orders', body);
  await call('POST', '/orders/' + order.id + '/confirm', {});
  await call('DELETE', '/product-variants/' + variant.id);
  const original = await call('GET', '/orders/' + order.id);
  expect(original.items[0]).toMatchObject({
    variant_id: variant.id,
    name_snapshot: 'Consumo histórico - Especial',
    unit_price: '7.00',
  });
  const ticket = await call('GET', '/tickets/' + original.tickets[0].id);
  await call('POST', '/tickets/' + ticket.id + '/redeem', { token: ticket.token });
  expect((await req('POST', '/orders', body)).statusCode).toBe(400);
  expect(
    (await req('PATCH', '/product-variants/' + variant.id, { enabled: true })).statusCode,
  ).toBe(404);
  expect((await call('GET', '/product-variants')).some((item: any) => item.id === variant.id)).toBe(
    false,
  );
  const menu = await call('GET', '/public/' + fixture.slug + '/menu', undefined, '');
  expect(menu.variants.some((item: any) => item.id === variant.id)).toBe(false);
  const key = randomUUID();
  expect(
    (await req('DELETE', '/product-variants/' + variant.id, undefined, token, key)).statusCode,
  ).toBe(200);
  expect(
    (await req('DELETE', '/product-variants/' + variant.id, undefined, token, key)).statusCode,
  ).toBe(200);
});
it('bloqueia exclusão com saldo/reserva, preserva o histórico e rejeita reposição de variação removida', async () => {
  const product = await call('POST', '/products', {
    name: 'Estoque por opção',
    price: '4.00',
    stock_policy: 'ON_DELIVERY',
  });
  const variant = await call('POST', '/product-variants', {
    product_id: product.id,
    name: 'Caixa',
    price: '8.00',
    stock_mode: 'OWN',
  });
  const balance = await call('POST', '/stock-balances', {
    location_id: fixture.location.id,
    product_id: product.id,
    variant_id: variant.id,
  });
  await call('POST', '/inventory/adjustments', {
    balance_id: balance.id,
    quantity: '5.000',
    type: 'PURCHASE',
    reason: 'Entrada de teste',
  });
  expect((await req('DELETE', '/product-variants/' + variant.id)).statusCode).toBe(409);
  const order = await call('POST', '/orders', {
    table_id: fixture.tables[2].id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, variant_id: variant.id, quantity: 2, modifiers: [] }],
  });
  await call('POST', '/orders/' + order.id + '/confirm', {});
  expect((await req('DELETE', '/product-variants/' + variant.id)).statusCode).toBe(409);
  const detail = await call('GET', '/orders/' + order.id);
  for (const item of detail.tickets) {
    const ticket = await call('GET', '/tickets/' + item.id);
    await call('POST', '/tickets/' + item.id + '/redeem', { token: ticket.token });
  }
  await call('POST', '/inventory/adjustments', {
    balance_id: balance.id,
    quantity: '-3.000',
    type: 'LOSS',
    reason: 'Saída de teste',
  });
  await call('DELETE', '/product-variants/' + variant.id);
  const management = await call('GET', '/products/' + product.id + '/management');
  expect(management.archived_variants[0].name).toBe('Caixa');
  expect(management.movements.length).toBeGreaterThan(0);
  expect(management.balances[0].physical_quantity).toBe('0.000');
  expect(
    (
      await req('POST', '/inventory/adjustments', {
        balance_id: balance.id,
        quantity: '1.000',
        type: 'PURCHASE',
        reason: 'Nova compra',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await req('POST', '/inventory/replenishments', {
        freight: '0.00',
        discount: '0.00',
        items: [{ balance_id: balance.id, quantity: '1.000' }],
      })
    ).statusCode,
  ).toBe(409);
});
