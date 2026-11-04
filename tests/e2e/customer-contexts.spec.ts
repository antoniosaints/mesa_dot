import { test } from './test.js';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const api = 'http://127.0.0.1:33000/api/v1';
let fixture: any, owner: any;
async function call(request: APIRequestContext, path: string, token: string, data?: unknown) {
  const response = await request.fetch(api + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function identify(page: Page, counter = false) {
  const modal = page.getByRole('dialog', {
    name: counter ? 'Identificar pedido para retirada' : 'Entrar na mesa',
    exact: true,
  });
  await modal.getByLabel('Seu nome', { exact: true }).fill('Cliente das fichas');
  await modal.getByLabel('Telefone', { exact: true }).fill('11955554444');
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(counter ? '/counter-sessions' : '/visitor-sessions') &&
      response.request().method() === 'POST',
  );
  await modal
    .getByRole('button', { name: counter ? 'Continuar para retirada' : 'Entrar na mesa' })
    .click();
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(modal).toHaveCount(0);
  return result.json();
}
async function order(request: APIRequestContext, customer: any, quantity: number) {
  const counter = customer.service_mode === 'COUNTER';
  const result = await call(
    request,
    counter ? '/public/counter/orders' : '/public/orders',
    customer.token,
    {
      ...(!counter
        ? { table_id: customer.table_id, source: 'CUSTOMER', payment_policy: 'PREPAID' }
        : {}),
      items: [{ product_id: fixture.products[1].id, quantity, modifiers: [] }],
    },
  );
  const payment = await call(request, '/payments/intents', customer.token, { order_id: result.id });
  await call(request, '/sandbox/pay', customer.token, { intent_id: payment.id });
  return call(request, '/orders/' + result.id, owner.token);
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  const suffix = randomUUID().slice(0, 8),
    email = 'customer-context-' + suffix + '@test.local',
    password = 'CustomerContextBrowser1!';
  fixture = await provision({
    name: 'Fichas preservadas ' + suffix,
    owner_name: 'Admin',
    owner_email: email,
    password,
    demo: true,
  });
  owner = await call(request, '/auth/login', '', {
    email,
    password,
    establishment_slug: fixture.slug,
  });
});
test('reúne mesa e retirada sem trocar atendimento e remove avisos de mesa concluída ou liberada', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const base = 'http://127.0.0.1:35174/' + fixture.slug;
  await page.goto(base + '/?table=' + fixture.tables[0].public_code);
  const customer = await identify(page);
  const detail = await order(request, customer, 4);
  for (const ticket of detail.tickets.slice(0, 2)) {
    const document = await call(request, '/tickets/' + ticket.id, owner.token);
    await call(request, '/tickets/' + ticket.id + '/redeem', owner.token, {
      token: document.token,
    });
  }
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Navegação do cliente' });
  await nav.getByRole('button', { name: /Minhas fichas/ }).click();
  const table = page.getByRole('region', {
    name: 'Fichas · Mesa ' + fixture.tables[0].number,
    exact: true,
  });
  await expect(table.locator('.mini-ticket')).toHaveCount(2);
  await expect(page.getByText('2 a concluir', { exact: true })).toBeVisible();
  const delivered = page.locator('.customer-delivered-tickets');
  await expect(delivered).toHaveJSProperty('open', false);
  await expect(delivered.locator('.mini-ticket').first()).not.toBeVisible();
  await delivered.locator('summary').click();
  await expect(delivered.locator('.mini-ticket')).toHaveCount(2);
  await expect(
    delivered.getByRole('region', {
      name: 'Fichas entregues · Mesa ' + fixture.tables[0].number,
      exact: true,
    }),
  ).toBeVisible();
  await delivered.locator('summary').click();
  await expect(delivered.locator('.mini-ticket').first()).not.toBeVisible();
  await page.getByRole('button', { name: 'Pedir para retirada', exact: true }).click();
  const change = page.getByRole('dialog', { name: 'Trocar atendimento?', exact: true });
  await expect(change).toContainText('2 fichas pendentes');
  await change.getByRole('button', { name: 'Manter e ver minhas fichas', exact: true }).click();
  await expect(table.locator('.mini-ticket')).toHaveCount(2);
  await page.getByRole('button', { name: 'Pedir para retirada', exact: true }).click();
  await change.getByRole('button', { name: 'Mudar para retirada', exact: true }).click();
  const counter = await identify(page, true);
  await order(request, counter, 1);
  await page.reload();
  const notice = page.getByRole('region', {
    name: 'Fichas pendentes de outros atendimentos',
    exact: true,
  });
  await expect(notice).toContainText('Mesa ' + fixture.tables[0].number + ': 2');
  await notice.getByRole('button', { name: 'Ver todas as minhas fichas', exact: true }).click();
  const pickup = page.getByRole('region', { name: 'Fichas · Retirada', exact: true });
  await expect(page.locator('.mini-ticket')).toHaveCount(5);
  await expect(table.locator('.mini-ticket')).toHaveCount(2);
  await expect(pickup.locator('.mini-ticket')).toHaveCount(1);
  await expect(page.getByText('3 a concluir', { exact: true })).toBeVisible();
  await expect(page.locator('.mini-ticket:visible')).toHaveCount(3);
  expect(
    await delivered.evaluate((el) => el.previousElementSibling?.getAttribute('aria-label')),
  ).toBe('Fichas · Retirada');
  await expect(page.locator('.venue-pill')).toHaveText('Retirada');
  await expect(page).not.toHaveURL(/table=/);
  await expect(change).toHaveCount(0);
  await table
    .locator('.mini-ticket')
    .filter({ hasText: 'Disponível' })
    .first()
    .getByRole('button', { name: 'Exibir QR e código de barras', exact: true })
    .click();
  await expect(page.locator('.ticket-document img')).toHaveCount(1);
  await expect(page.locator('.ticket-document canvas')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  const requested = page.waitForRequest(
    (request) => /\/tickets\/[^/]+\/request$/.test(request.url()) && request.method() === 'POST',
  );
  await table
    .locator('.mini-ticket')
    .filter({ hasText: 'Disponível' })
    .first()
    .getByRole('button', { name: 'Pedir para trazer', exact: true })
    .click();
  expect((await requested).headers().authorization).toBe('Bearer ' + customer.token);
  await expect(table.locator('.badge').filter({ hasText: 'Solicitada' })).toHaveCount(1);
  await expect(page.locator('.venue-pill')).toHaveText('Retirada');
  await expect(page).not.toHaveURL(/table=/);
  await expect(pickup.getByRole('button', { name: 'Pedir para trazer', exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    animations: 'disabled',
    path: '.local/screenshots/customer-all-tickets-mobile-dark.png',
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator('.mini-ticket')).toHaveCount(5);
  // An unavailable old context is not mistaken for confirmed pending tickets or for an empty history.
  await page.route('**/api/v1/my-tickets', (route) =>
    route.request().headers().authorization === 'Bearer ' + customer.token
      ? route.abort()
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Atualizar fichas', exact: true }).click();
  await expect(table.getByRole('alert')).toContainText('Não foi possível atualizar');
  await expect(
    table.getByRole('button', { name: 'Exibir QR e código de barras', exact: true }).last(),
  ).toBeDisabled();
  await expect(page.locator('.mini-ticket')).toHaveCount(5);
  await page.unroute('**/api/v1/my-tickets');
  await page.getByRole('button', { name: 'Atualizar fichas', exact: true }).click();
  await expect(table.getByRole('alert')).toHaveCount(0);
  for (const ticket of detail.tickets.slice(2)) {
    const document = await call(request, '/tickets/' + ticket.id, owner.token);
    await call(request, '/tickets/' + ticket.id + '/redeem', owner.token, {
      token: document.token,
    });
  }
  await page.getByRole('button', { name: 'Atualizar fichas', exact: true }).click();
  await expect(table).toHaveCount(0);
  await expect(delivered.locator('.badge').filter({ hasText: 'Entregue' })).toHaveCount(4);
  await expect(delivered).toHaveJSProperty('open', false);
  await delivered.locator('summary').click();
  await expect(delivered.locator('.mini-ticket:visible')).toHaveCount(4);
  await delivered.locator('summary').click();
  await nav.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await call(request, '/tables/' + customer.table_id + '/checkout', owner.token, {});
  await call(request, '/tables/' + customer.table_id + '/release', owner.token, {});
  expect(
    (await call(request, '/tables/' + customer.table_id + '/session', owner.token)).session,
  ).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() =>
      page.evaluate(
        (code) => Object.keys(sessionStorage).some((key) => key.endsWith(':' + code)),
        fixture.tables[0].public_code,
      ),
    )
    .toBe(false);
  await nav.getByRole('button', { name: /Minhas fichas/ }).click();
  await expect(table).toHaveCount(0);
  await expect(pickup.locator('.mini-ticket')).toHaveCount(1);
  await page.reload();
  await expect(table).toHaveCount(0);
  await expect(pickup.locator('.mini-ticket')).toHaveCount(1);
  if (await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).count())
    await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: '.local/screenshots/customer-all-tickets-mobile-light.png',
    fullPage: true,
  });
  await nav.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByText('Suas fichas continuam aqui', { exact: true })).toHaveCount(0);
  await expect(page.locator('.venue-pill')).toHaveText('Retirada');
});

test('uma sessão de mesa sem fichas não gera aviso e não mistura unidades', async ({ page }) => {
  const base = 'http://127.0.0.1:35174/' + fixture.slug;
  await page.goto(base + '/?table=' + fixture.tables[1].public_code);
  await identify(page);
  await page.getByRole('button', { name: 'Pedir para retirada', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Trocar atendimento?', exact: true })
    .getByRole('button', { name: 'Mudar para retirada', exact: true })
    .click();
  await identify(page, true);
  await expect(
    page.getByRole('region', { name: 'Fichas pendentes de outros atendimentos', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Navegação do cliente' })
    .getByRole('button', { name: /Minhas fichas/ })
    .click();
  await expect(page.locator('.customer-ticket-group')).toHaveCount(0);
  await expect(
    page.getByText('Suas fichas aparecem após a confirmação do pagamento.', { exact: true }),
  ).toBeVisible();
  await page.goto('http://127.0.0.1:35174/?bar=unrelated-context-' + randomUUID().slice(0, 8));
  await expect(page.locator('.customer-ticket-group,.customer-saved-contexts')).toHaveCount(0);
});
