import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1',
  suffix = randomUUID().slice(0, 8),
  email = 'variant-ui-' + suffix + '@test.local',
  password = 'VariantBrowserOnlyPassword1!';
let fixture: any, token: string, stockProduct: any;
const headers = () => ({ authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
async function login(page: Page) {
  await page.goto(base + '/' + fixture.slug + '/cardapio');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toBeVisible();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Variações Browser ' + suffix,
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
  const response = await request.post(api + '/products', {
    headers: headers(),
    data: { name: 'Produto com saldo ' + suffix, price: '10.00', stock_policy: 'ON_DELIVERY' },
  });
  expect(response.ok()).toBe(true);
  stockProduct = await response.json();
  const variant = await (
    await request.post(api + '/product-variants', {
      headers: headers(),
      data: {
        product_id: stockProduct.id,
        name: 'Caixa com saldo',
        price: '50.00',
        stock_mode: 'OWN',
      },
    })
  ).json();
  const balance = await (
    await request.post(api + '/stock-balances', {
      headers: headers(),
      data: {
        product_id: stockProduct.id,
        variant_id: variant.id,
        location_id: fixture.location.id,
      },
    })
  ).json();
  const moved = await request.post(api + '/inventory/adjustments', {
    headers: headers(),
    data: {
      balance_id: balance.id,
      quantity: '3.000',
      type: 'PURCHASE',
      reason: 'Saldo para teste',
    },
  });
  expect(moved.ok()).toBe(true);
});
test('edita o nome padrão desde o cadastro e remove adicionais mantendo uma opção obrigatória', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Adicionar · Produtos', exact: true });
  await create.getByLabel('Nome', { exact: true }).fill('Produto padrão ' + suffix);
  await create.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await expect(create.getByLabel('Nome da variação padrão')).toHaveValue('Padrão');
  await create.getByLabel('Nome da variação padrão').fill('Garrafa 600 ml');
  await create.getByLabel('Preço', { exact: true }).fill('14');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/v1/products'),
  );
  await create.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  const product = await (await saved).json();
  expect(product.default_variant_name).toBe('Garrafa 600 ml');
  await page.getByRole('button', { name: 'Agora não', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await expect(editor.getByRole('heading', { name: 'Variações (1)', exact: true })).toBeVisible();
  for (const name of ['1 litro', '2 litros']) {
    await editor.getByRole('button', { name: 'Nova variação', exact: true }).click();
    const variant = page.getByRole('dialog', { name: 'Nova variação', exact: true });
    await variant.getByLabel('Nome da variação', { exact: true }).fill(name);
    await variant.getByLabel('Preço da variação', { exact: true }).fill('24');
    await variant.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(variant).toHaveCount(0);
  }
  await expect(editor.getByRole('heading', { name: 'Variações (3)', exact: true })).toBeVisible();
  await expect(editor.locator('.product-management-top')).toContainText('3 variação(ões)');
  const defaultName = await editor.getByLabel('Nome da variação padrão').boundingBox(),
    price = await editor.getByLabel('Preço', { exact: true }).boundingBox();
  expect(Math.abs(defaultName!.y - price!.y)).toBeLessThanOrEqual(1);
  await expect(
    editor.getByRole('button', { name: 'Remover variação Garrafa 600 ml', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: '.local/screenshots/product-variants-desktop.png' });
  for (const name of ['1 litro', '2 litros']) {
    await editor.getByRole('button', { name: 'Remover variação ' + name, exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Remover variação', exact: true });
    await expect(confirm).toContainText('preservados');
    await confirm.getByRole('button', { name: 'Remover variação', exact: true }).click();
    await expect(
      editor.getByRole('button', { name: 'Remover variação ' + name, exact: true }),
    ).toHaveCount(0);
  }
  await expect(editor.getByRole('heading', { name: 'Variações (1)', exact: true })).toBeVisible();
  await expect(editor.getByLabel('Nome da variação padrão')).toHaveValue('Garrafa 600 ml');
  await editor.getByLabel('Nome da variação padrão').fill('Unidade original');
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const detail = await (
    await request.get(api + '/products/' + product.id + '/management', { headers: headers() })
  ).json();
  expect(detail.default_variant.name).toBe('Unidade original');
  expect(detail.variant_count).toBe(1);
  expect(detail.variants).toHaveLength(0);
});
test('explica o bloqueio com saldo e mantém os campos e ações alinhados no celular e dark', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Editar ' + stockProduct.name, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await editor.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Remover variação Caixa com saldo', exact: true })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Remover variação', exact: true });
  await confirm.getByRole('button', { name: 'Remover variação', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saldo ou reservas');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark'])
    for (const width of [390, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await expect(editor.getByLabel('Nome da variação padrão')).toBeVisible();
      expect(
        await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: '.local/screenshots/product-variants-' + width + '-' + theme + '.png',
      });
    }
});
