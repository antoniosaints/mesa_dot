import { test } from './test.js';
test.use({ actionTimeout: 15000 });
import { expect, type APIRequestContext } from '@playwright/test';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { expectMobileListLayout } from './list-layout.js';
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1';
const suffix = randomUUID().slice(0, 8),
  email = 'mobile-lists-' + suffix + '@test.local',
  password = 'MobileListsOnlyPassword1!';
let fixture: any, token: string, category: any;
const longName = 'Nome extenso da listagem ' + suffix + '-' + 'X'.repeat(45);
async function call(request: APIRequestContext, path: string, data?: any, method = 'POST') {
  const response = await request.fetch(api + path, {
    method: data === undefined ? 'GET' : method,
    headers: { authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID(), origin: base },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  const { provision } = await import('../../packages/database/src/provision.js');
  await migrate();
  fixture = await provision({
    name: 'Listas mobile ' + suffix,
    owner_name: 'Admin',
    owner_email: email,
    password,
    demo: true,
  });
  token = (
    await call(request, '/auth/login', { email, password, establishment_slug: fixture.slug })
  ).token;
  for (let index = 0; index < 11; index++)
    await call(request, '/categories', { name: 'Categoria de paginação ' + index });
  category = await call(request, '/categories', { name: longName, color: '#0757f9' });
  await call(
    request,
    '/products/' + fixture.products[1].id,
    { name: longName, category_id: category.id },
    'PATCH',
  );
  await call(
    request,
    '/stock-locations/' + fixture.location.id,
    { name: longName, is_default: true },
    'PATCH',
  );
  await call(request, '/staff', {
    name: longName,
    email: 'worker-' + email,
    password,
    role_id: fixture.roles.find((role: any) => role.name === 'Garçom').id,
  });
  await call(request, '/printers', { name: longName, sector: 'bar' });
  const draft = await call(request, '/orders', {
    table_id: fixture.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 2, modifiers: [] }],
  });
  const order = await call(request, '/orders/' + draft.id + '/confirm', {});
  await call(request, '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: order.tab_id, amount: '1.00' }],
  });
  const key = createECDH('prime256v1');
  key.generateKeys();
  await call(request, '/push/subscriptions', {
    surface: 'admin',
    origin: base,
    device_name: longName,
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/mobile-list-' + suffix,
      keys: {
        p256dh: key.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    },
  });
});
test('listagens expõem dados e ações em 320, 390 e 600px, com nomes longos, filtros, edição e paginação', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await page.goto(base + '/' + fixture.slug + '/dashboard');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.locator('.overview-brief')).toBeVisible();
  const views = [
    ['/dashboard', 'table[aria-label="Mesas em atendimento"]'],
    ['/cardapio', '.catalog-products-table'],
    ['/cardapio?aba=categorias', '.resource-table'],
    ['/salao?aba=mesas', '.resource-table'],
    ['/pedidos', '.orders-table'],
    ['/estoque', '.inventory-overview-table'],
    ['/pagamentos', '.payments-table'],
    ['/financeiro?aba=sales', 'table[aria-label="Registros financeiros"]'],
    ['/equipe', '.team-table'],
    ['/impressao?aba=fila-de-impressao', '.print-queue-table'],
    ['/configuracoes?aba=notificacoes-push', '.push-devices-table'],
  ];
  for (const [path, selector] of views) {
    await page.goto(base + '/' + fixture.slug + path);
    for (const theme of ['light', 'dark'])
      for (const width of [320, 390, 600]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
        await expectMobileListLayout(page.locator(selector));
      }
    await page.screenshot({
      path:
        '.local/screenshots/list-' +
        path.split('?')[0].replaceAll('/', '') +
        '-' +
        (path.split('aba=')[1] ?? 'main') +
        '-mobile.png',
      fullPage: true,
    });
  }
  await page.goto(base + '/' + fixture.slug + '/cardapio?aba=categorias');
  const pagination = page.getByRole('navigation', { name: 'Paginação de Categorias', exact: true });
  await pagination
    .getByRole('button', { name: 'Próxima página em Categorias', exact: true })
    .click();
  await expect(pagination.getByText('Página 2 de 2', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar em Categorias', exact: true }).fill(longName);
  await expect(page.locator('.resource-table tbody tr')).toHaveCount(1);
  await expectMobileListLayout(page.locator('.resource-table'));
  await page.getByRole('button', { name: 'Editar ' + longName, exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Editar · Categorias', exact: true });
  await modal.getByLabel('Nome', { exact: true }).fill(longName + ' revisado');
  await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(
    (await call(request, '/categories')).find((item: any) => item.id === category.id).name,
  ).toBe(longName + ' revisado');
});
