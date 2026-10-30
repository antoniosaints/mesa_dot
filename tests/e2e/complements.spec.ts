import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:35173',
  customer = 'http://127.0.0.1:35174',
  api = 'http://127.0.0.1:33000/api/v1';
const suffix = randomUUID().slice(0, 8),
  email = 'complements-browser-' + suffix + '@test.local',
  password = 'ComplementsBrowserOnly1!';
let fixture: any, token: string;
const headers = (auth = token) => ({
  authorization: 'Bearer ' + auth,
  'Idempotency-Key': randomUUID(),
});
async function login(page: Page) {
  await page.goto(base + '/' + fixture.slug + '/complementos');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.locator('.complement-card')).toHaveCount(2);
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Complementos Browser ' + suffix,
    owner_name: 'Gestora',
    owner_email: email,
    password,
    demo: true,
  });
  const auth = await request.post(api + '/auth/login', {
    data: { email, password, establishment_slug: fixture.slug },
  });
  expect(auth.ok()).toBe(true);
  token = (await auth.json()).token;
});
test('loja instala Gemini, valida modelos e exibe ajuda e resumo no modal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByLabel('Buscar complemento').fill('gemini');
  await expect(page.locator('.complement-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Instalar complemento', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Complemento · Gemini', exact: true });
  await expect(modal).toBeVisible();
  await modal
    .getByLabel('Chave de API do Gemini', { exact: true })
    .fill('browser-only-gemini-secret-123456');
  await modal.getByRole('button', { name: 'Consultar modelos', exact: true }).click();
  await modal.getByRole('button', { name: 'Salvar e ativar Gemini', exact: true }).click();
  await expect(modal.getByLabel('Chave de API do Gemini', { exact: true })).toHaveValue('');
  await expect(modal.getByRole('button', { name: 'Abrir assistente', exact: true })).toBeEnabled();
  await modal.getByRole('button', { name: 'Abrir assistente', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'Assistente Gemini', exact: true });
  await assistant.getByLabel('Mensagem para o assistente').fill('Como entregar uma ficha?');
  await assistant.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(assistant.locator('.ai-message.is-assistant')).toContainText('Resumo de teste');
  await assistant.getByRole('button', { name: 'Resumo', exact: true }).click();
  await assistant.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(assistant.locator('.ai-message.is-assistant')).toHaveCount(2);
  await page.screenshot({ path: '.local/screenshots/complements-assistant-desktop.png' });
  await assistant.getByRole('button', { name: 'Minimizar conversa', exact: true }).click();
  await page.getByLabel('Buscar complemento').fill('');
  await expect(page.locator('.complement-card')).toHaveCount(2);
});
test('OAuth volta para a filial, checkout real não mostra sandbox e confirma fichas pelo servidor', async ({
  page,
  request,
}) => {
  await login(page);
  await page.route('https://auth.mercadopago.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state');
    await route.fulfill({
      status: 302,
      headers: {
        location: base + '/api/v1/complements/mercadopago/callback?state=' + state + '&code=123456',
      },
    });
  });
  const card = page
    .locator('.complement-card')
    .filter({ has: page.getByRole('heading', { name: 'Mercado Pago', exact: true }) });
  await card.getByRole('button', { name: 'Instalar complemento', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Complemento · Mercado Pago', exact: true })
    .getByRole('button', { name: 'Conectar Mercado Pago', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Complemento · Mercado Pago', exact: true }),
  ).toContainText('Conta de homologação');
  const identified = await request.post(api + '/public/' + fixture.slug + '/visitor-sessions', {
    data: {
      name: 'Cliente Browser',
      phone: '+5511999990000',
      table_code: fixture.tables[0].public_code,
    },
  });
  expect(identified.ok()).toBe(true);
  const visitor = await identified.json();
  const orderResponse = await request.post(api + '/public/orders', {
    headers: headers(visitor.token),
    data: {
      table_id: fixture.tables[0].id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: fixture.products[0].id, quantity: 2, modifiers: [] }],
    },
  });
  expect(orderResponse.ok(), await orderResponse.text()).toBe(true);
  const order = await orderResponse.json();
  const intentResponse = await request.post(api + '/payments/intents', {
    headers: headers(visitor.token),
    data: { order_id: order.id },
  });
  expect(intentResponse.ok(), await intentResponse.text()).toBe(true);
  const intent = await intentResponse.json();
  expect(intent.provider).toBe('mercadopago');
  const client = await page.context().newPage();
  await client.addInitScript(
    ({ unit, table, visitor }) => {
      sessionStorage.setItem(
        `mesa:customer:${unit}:bar-customer:${unit}:${table}`,
        JSON.stringify(visitor),
      );
    },
    { unit: fixture.establishment_id, table: fixture.tables[0].public_code, visitor },
  );
  await client.setViewportSize({ width: 390, height: 844 });
  const returnUrl =
    customer +
    '/pwa/apps/' +
    fixture.establishment_id +
    '/?table=' +
    fixture.tables[0].public_code +
    '&payment_return=' +
    intent.id;
  await client.goto(returnUrl);
  const payment = client.getByRole('dialog', { name: 'Pagamento do pedido', exact: true });
  await expect(
    payment.getByRole('link', { name: 'Pagar com Mercado Pago', exact: true }),
  ).toHaveAttribute('href', intent.checkout_url);
  await expect(client.getByRole('button', { name: /Aprovar pagamento sandbox/ })).toHaveCount(0);
  await client.screenshot({ path: '.local/screenshots/complements-payment-mobile.png' });
  // Emulate the provider's return without asserting approval from the redirect parameters.
  await client.route('https://www.mercadopago.com.br/**', (route) =>
    route.fulfill({ status: 302, headers: { location: returnUrl + '&status=approved' } }),
  );
  await payment.getByRole('link', { name: 'Pagar com Mercado Pago', exact: true }).click();
  await expect(payment).toBeVisible();
  await expect(
    payment.getByRole('button', { name: 'Verificar pagamento', exact: true }),
  ).toBeEnabled();
  const before = await request.get(api + '/orders/' + order.id, { headers: headers() });
  expect((await before.json()).tickets).toHaveLength(0);
  await payment.getByRole('button', { name: 'Verificar pagamento', exact: true }).click();
  await expect(payment).toHaveCount(0);
  const after = await request.get(api + '/orders/' + order.id, { headers: headers() });
  expect((await after.json()).tickets).toHaveLength(2);
  await expect(client).toHaveURL(/minhas-fichas/);
  await client.close();
});
test('catálogo e configuração cabem no mobile e no dark sem rolagem horizontal', async ({
  page,
  request,
}) => {
  const configured = await request.post(api + '/complements/gemini/configure', {
    headers: headers(),
    data: { api_key: 'browser-only-gemini-secret-123456', model: 'gemini-3.8-flash' },
  });
  expect(configured.ok()).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  for (const theme of ['light', 'dark'])
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        window.scrollTo(0, 0);
      }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width > 900) {
        const sidebar = await page.locator('.sidebar').boundingBox();
        const workspace = await page.locator('.complements-workspace').boundingBox();
        expect(workspace!.x).toBeGreaterThanOrEqual(sidebar!.width);
      }
      await expect(page.getByRole('heading', { name: 'Complementos', exact: true })).toHaveCount(1);
      await page.screenshot({
        path: '.local/screenshots/complements-store-' + width + '-' + theme + '.png',
        fullPage: true,
      });
      await page
        .locator('.complement-card')
        .filter({ has: page.getByRole('heading', { name: 'Gemini', exact: true }) })
        .getByRole('button', { name: 'Configurar', exact: true })
        .click();
      const modal = page.getByRole('dialog', { name: 'Complemento · Gemini', exact: true });
      await expect(modal).toBeVisible();
      expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({
        path: '.local/screenshots/complements-config-' + width + '-' + theme + '.png',
      });
      await modal
        .locator('.modal-footer')
        .getByRole('button', { name: 'Fechar', exact: true })
        .click();
    }
});
