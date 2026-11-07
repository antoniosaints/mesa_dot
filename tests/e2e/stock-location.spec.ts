import { test } from './test.js';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ actionTimeout: 15000 });
const api = 'http://127.0.0.1:33000/api/v1';
const base = 'http://127.0.0.1:35173';
const suffix = randomUUID().slice(0, 8),
  email = 'stock-place-' + suffix + '@test.local',
  password = 'StockPlaceBrowserOnly1!';
let fixture: any, product: any, balance: any, destination: any, second: any, token: string;
const headers = () => ({ authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  const { provision } = await import('../../packages/database/src/provision.js');
  await migrate();
  fixture = await provision({
    name: 'Depósito UI ' + suffix,
    owner_name: 'Gestora',
    owner_email: email,
    password,
    demo: true,
  });
  token = (
    await (
      await request.post(api + '/auth/login', {
        data: { email, password, establishment_slug: fixture.slug },
      })
    ).json()
  ).token;
  const call = async (path: string, data: unknown) => {
    const response = await request.post(api + path, { headers: headers(), data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  product = await call('/products', {
    name: 'Estoque preservado ' + suffix,
    price: '10.00',
    default_variant_name: '600 ml',
    stock_policy: 'ON_DELIVERY',
  });
  balance = await call('/stock-balances', {
    product_id: product.id,
    location_id: fixture.location.id,
  });
  await call('/inventory/adjustments', {
    balance_id: balance.id,
    type: 'PURCHASE',
    quantity: '12.000',
    reason: 'Saldo inicial do teste',
  });
  const order = await call('/orders', {
    table_id: fixture.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 2, modifiers: [] }],
  });
  await call('/orders/' + order.id + '/confirm', {});
  destination = await call('/stock-locations', {
    name: 'Depósito novo ' + suffix,
    is_default: false,
  });
  second = await call('/stock-locations', { name: 'Local final ' + suffix, is_default: false });
});

test('altera depósito pelo produto e pela listagem mobile sem mudar saldo, reserva, histórico nem sobrescrever a origem ao salvar', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/${fixture.slug}/estoque`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await page.getByRole('searchbox', { name: 'Buscar no estoque', exact: true }).fill(product.name);
  const overview = page.locator('.inventory-overview-table');
  await expect(overview.locator('tbody tr')).toHaveCount(1);
  await overview.getByRole('button', { name: 'Gerenciar produto', exact: true }).click();
  const editor = page.getByRole('dialog').first();
  await editor.getByRole('button', { name: 'Alterar local', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Alterar depósito do estoque', exact: true });
  await expect(move).toContainText('12,000');
  await expect(move).toContainText('2,000');
  await move.getByRole('combobox', { name: 'Novo depósito', exact: true }).click();
  await page.getByRole('option', { name: destination.name, exact: true }).click();
  await move.getByRole('button', { name: 'Alterar depósito', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(editor.locator('.product-stock-table')).toContainText(destination.name);
  await expect(overview).toContainText(destination.name);
  await expect(editor.locator('.product-stock-table [data-label="Físico"]')).toHaveText(
    '12,000 un',
  );
  await expect(editor.locator('.product-stock-table [data-label="Reservado"]')).toHaveText(
    '2,000 un',
  );
  await editor.getByRole('tab', { name: 'Estoque e produção', exact: true }).click();
  await expect(
    editor.getByRole('combobox', { name: 'Local de baixa do produto', exact: true }),
  ).toHaveValue(destination.name);
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await page.getByRole('searchbox', { name: 'Buscar no estoque', exact: true }).fill(product.name);
  await expect(overview).toContainText(destination.name);
  await page.setViewportSize({ width: 390, height: 844 });
  await overview.getByRole('button', { name: 'Alterar local', exact: true }).click();
  await move.getByRole('combobox', { name: 'Novo depósito', exact: true }).click();
  await page.getByRole('option', { name: second.name, exact: true }).click();
  await move.getByRole('button', { name: 'Alterar depósito', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(overview).toContainText(second.name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const balances = await (
    await request.get(api + '/inventory/balances', { headers: headers() })
  ).json();
  expect(balances.filter((stock: any) => stock.product_id === product.id)).toEqual([
    expect.objectContaining({
      id: balance.id,
      location_id: second.id,
      physical_quantity: '12.000',
      reserved_quantity: '2.000',
    }),
  ]);
  await overview.getByRole('button', { name: 'Gerenciar produto', exact: true }).click();
  await editor.getByRole('button', { name: 'Locais', exact: true }).click();
  const locations = page.getByRole('dialog', { name: 'Locais de estoque', exact: true });
  await locations.getByRole('button', { name: 'Editar local ' + second.name, exact: true }).click();
  const local = page.getByRole('dialog', { name: 'Editar local', exact: true });
  await local.getByLabel('Nome do local', { exact: true }).fill(second.name + ' editado');
  await local.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(overview).toContainText(second.name + ' editado');
  await locations.getByRole('button', { name: 'Fechar', exact: true }).click();
  await editor.getByRole('tab', { name: 'Movimentações', exact: true }).click();
  const history = editor.locator('.product-movements-table [data-label="Estoque"]');
  expect(await history.count()).toBeGreaterThan(0);
  for (const record of await history.all())
    await expect(record).toContainText(fixture.location.name);
});
