import { expectMobileModalLayout } from './modal-layout.js';
import { test } from './test.js';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const password = 'E2ETestPasswordOnly1!';
let fixture: any, email: string, slug: string, staffToken: string, waiterEmail: string;
let staffSession: any;
let database: typeof import('../../packages/database/src/index.js');
async function expectMobileTableHeader(dialog: Locator) {
  await expectMobileModalLayout(dialog);
  const header = dialog.locator(':scope > .section-head');
  const title = header.getByRole('heading', { level: 2 });
  const close = header.getByRole('button', { name: 'Fechar', exact: true });
  const actions = header.locator('.modal-header-actions');
  const qr = actions.getByRole('button', { name: 'QR Code da mesa', exact: true });
  const scan = actions.getByRole('button', { name: 'Ler ficha', exact: true });
  for (const control of [title, close, qr, scan])
    await expect(control).toBeInViewport({ ratio: 1 });
  await expect(scan.locator('span', { hasText: 'Ler ficha' })).toBeVisible();
  const [heading, closing, buttons, qrBox, scanBox] = await Promise.all(
    [title, close, actions, qr, scan].map((element) => element.boundingBox()),
  );
  expect(heading!.x + heading!.width).toBeLessThanOrEqual(closing!.x);
  expect(buttons!.y).toBeGreaterThanOrEqual(
    Math.max(heading!.y + heading!.height, closing!.y + closing!.height),
  );
  expect(qrBox!.x + qrBox!.width).toBeLessThan(scanBox!.x);
  expect(Math.abs(qrBox!.width - scanBox!.width)).toBeLessThan(1);
  expect(Math.min(qrBox!.height, scanBox!.height)).toBeGreaterThanOrEqual(42);
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}
async function staffApi(request: APIRequestContext, path: string, body?: unknown) {
  const key = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await request.fetch(`http://127.0.0.1:33000/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${staffToken}`, 'Idempotency-Key': key },
      ...(body === undefined ? {} : { data: body }),
    });
    const retryAfter = Number(r.headers()['retry-after'] ?? 1);
    if (r.status() === 429 && attempt < 2 && retryAfter > 0 && retryAfter <= 30) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  }
  throw new Error('Limite de requisições do ambiente de teste não liberado.');
}
async function login(page: Page, port: number, account = email, interactive = false) {
  if (account === email && !interactive) {
    await page.goto(
      `http://127.0.0.1:${port}${port === 35173 ? (account === email && !interactive ? '/dashboard' : '/entrar') : ''}`,
    );
    await page.evaluate(
      (value) => sessionStorage.setItem('bar-staff', JSON.stringify(value)),
      staffSession,
    );
    await page.reload();
    return;
  }
  await page.goto(
    `http://127.0.0.1:${port}${port === 35173 ? (account === email && !interactive ? '/dashboard' : '/entrar') : ''}`,
  );
  await page.getByRole('combobox', { name: 'Empresa', exact: true }).fill(fixture.slug);
  await page.getByRole('option', { name: 'BOTECO DA ESQUINA', exact: true }).click();
  await expect(page.getByLabel('Estabelecimento', { exact: true })).toHaveCount(0);
  await page.getByLabel('E-mail', { exact: true }).fill(account);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
}
test.beforeAll(async ({ request }) => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DOCUMENT_KEY = 'a'.repeat(64);
  process.env.NODE_ENV = 'test';
  database = await import('../../packages/database/src/index.js');
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  slug = `e2e-${randomUUID().slice(0, 8)}`;
  email = `${slug}@test.local`;
  fixture = await provision({
    slug,
    name: 'Boteco da Esquina',
    owner_email: email,
    owner_name: 'Antonio',
    password,
    demo: true,
  });
  const response = await request.post('http://127.0.0.1:33000/api/v1/auth/login', {
    data: { email, password, establishment_slug: slug },
  });
  expect(response.ok()).toBeTruthy();
  staffSession = { ...(await response.json()), slug };
  staffToken = staffSession.token;
  waiterEmail = 'garcom-' + slug + '@test.local';
  await staffApi(request, '/staff', {
    name: 'Garçom E2E',
    email: waiterEmail,
    password,
    role_id: fixture.roles.find((role: any) => role.name === 'Garçom').id,
  });
});
// Keep browser scenarios within the real API request budget rather than weakening rate limits.
test.beforeEach(async ({ request }) => {
  test.setTimeout(90000);
  const response = await request.get('http://127.0.0.1:33000/api/v1/appearance', {
    headers: { authorization: `Bearer ${staffToken}` },
  });
  expect(response.ok() || response.status() === 429).toBeTruthy();
  const headers = response.headers();
  const remaining = Number(headers['x-ratelimit-remaining'] ?? 600);
  if (
    response.status() === 429 ||
    remaining <
      (/^(produto centraliza|paginação compartilhada)/.test(test.info().title) ? 500 : 200)
  ) {
    const seconds = Number(headers['retry-after'] ?? headers['x-ratelimit-reset']);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
});
test('admin responsivo cadastra produto e atende pedido pós-pago', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 35173, email, true);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.locator('.overview-kpi')).toHaveCount(8);
  await page.screenshot({ path: 'docs/screenshots/admin-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Nome', { exact: true })).toBeFocused();
  await page.getByRole('dialog').getByLabel('Nome', { exact: true }).fill('Suco natural E2E');
  await page.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await page.getByLabel('Preço', { exact: true }).fill('9.00');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Criar estoque do novo produto?', exact: true })
    .getByRole('button', { name: 'Agora não', exact: true })
    .click();
  await expect(page.getByText('Suco natural E2E', { exact: true })).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'Buscar em Produtos', exact: true })
    .fill('Suco natural');
  await expect(page.locator('.resource-panel').first().locator('tbody tr')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Buscar em Produtos', exact: true }).fill('');
  await page.getByRole('button', { name: 'Salão e mesas' }).click();
  await page.locator('.table-card').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerveja Pilsen 600 ml' }).click();
  await page.getByRole('button', { name: 'Confirmar pedido pós-pago' }).click();
  await expect(page.getByText('Pedido confirmado. Fichas geradas.')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('.overview-kpi')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect
    .poll(async () =>
      page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'docs/screenshots/admin-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});
test('cliente paga, solicita ficha, garçom entrega e libera mesa; eventos via worker', async ({
  browser,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: `E${randomUUID().slice(0, 5)}`,
    capacity: 4,
  });
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customer = await customerContext.newPage();
  const waiterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const waiter = await waiterContext.newPage();
  await customer.goto(`http://127.0.0.1:35174/?bar=${slug}&table=${table.public_code}`);
  await customer.getByLabel('Seu nome', { exact: true }).fill('Cliente E2E');
  await customer.getByLabel('Telefone', { exact: true }).fill('11988887777');
  await customer.getByRole('button', { name: 'Entrar na mesa' }).click();
  await expect(customer.getByRole('button', { name: 'Minhas fichas' })).toBeVisible();
  await customer.getByRole('button', { name: 'Cerveja Pilsen 600 ml' }).click();
  await customer.getByRole('button', { name: 'Adicionar ao pedido' }).click();
  await customer.getByRole('button', { name: 'Ver meu pedido', exact: true }).click();
  await customer.getByRole('button', { name: 'Ir para pagamento' }).click();
  await expect(customer.getByText('AMBIENTE SANDBOX')).toBeVisible();
  await customer.getByRole('button', { name: 'Simular aprovação do pagamento' }).click();
  await expect(customer.getByRole('heading', { name: 'Cerveja Pilsen 600 ml' })).toBeVisible();
  await expect(customer.getByRole('button', { name: 'Pedir para trazer' })).toBeVisible();
  await customer.screenshot({ path: 'docs/screenshots/customer-mobile.png', fullPage: true });
  await login(waiter, 35175, waiterEmail);
  await expect(waiter.getByRole('heading', { name: 'Vamos cuidar do salão.' })).toBeVisible();
  await expect(waiter.getByRole('button', { name: 'Entregas', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await customer.getByRole('button', { name: 'Pedir para trazer' }).click();
  await expect(waiter.getByRole('button', { name: 'Chamados (1)' })).toBeVisible({
    timeout: 10000,
  });
  const alertTable = waiter.locator('.table-card').filter({ hasText: table.number });
  await expect(alertTable).toHaveClass(/has-client-request/);
  await expect(alertTable.getByText('1 solicitação(ões)', { exact: true })).toBeVisible();
  await alertTable.scrollIntoViewIfNeeded();
  await waiter.screenshot({ path: 'docs/screenshots/waiter-client-alert.png' });
  await expect(waiter.getByRole('region', { name: 'Solicitações de clientes' })).toBeVisible();
  await expect(
    waiter.getByRole('status').filter({ hasText: 'Cliente na mesa ' + table.number }),
  ).toBeVisible();
  await alertTable.click();
  await expectMobileTableHeader(
    waiter.getByRole('dialog', { name: `Mesa ${table.number}`, exact: true }),
  );
  await expect(waiter.getByRole('tab', { name: 'Resumo da mesa', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await waiter
    .getByRole('dialog')
    .getByRole('button', { name: 'Ver solicitações', exact: true })
    .click();
  await expect(waiter.getByRole('tab', { name: /^Entregas/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(waiter.getByRole('tab', { name: /^Entregas/ })).toBeInViewport({ ratio: 1 });
  await waiter.getByRole('dialog').getByRole('button', { name: 'Entregar', exact: true }).click();
  await expect(
    waiter
      .getByRole('dialog', { name: 'Confirmar entrega da ficha' })
      .getByRole('heading', { name: 'Cerveja Pilsen 600 ml' }),
  ).toBeVisible();
  await waiter.screenshot({ path: 'docs/screenshots/waiter-delivery-confirmation.png' });
  await waiter.getByRole('button', { name: 'Confirmar entrega ao cliente' }).click();
  await expect(
    waiter.getByText('Entrega confirmada. Ficha utilizada uma única vez.'),
  ).toBeVisible();
  const delivered = customer.locator('.customer-delivered-tickets');
  await expect(delivered.locator('summary')).toContainText('Entregues', { timeout: 10000 });
  await expect(delivered).toHaveJSProperty('open', false);
  await delivered.locator('summary').click();
  await expect(delivered.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(alertTable).not.toHaveClass(/has-client-request/, { timeout: 10000 });
  await expect(waiter.getByRole('region', { name: 'Solicitações de clientes' })).not.toBeVisible();
  await waiter.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await waiter.getByRole('button', { name: 'Mesas', exact: true }).click();
  await waiter.locator('.table-card').filter({ hasText: table.number }).click();
  await waiter.getByRole('button', { name: 'Encerrar atendimento', exact: true }).click();
  await expect(waiter.getByRole('heading', { name: 'Tudo certo para finalizar' })).toBeVisible();
  await waiter.getByRole('button', { name: 'Finalizar e liberar mesa', exact: true }).click();
  await expect(waiter.getByText('Mesa finalizada e liberada.', { exact: true })).toBeVisible();
  const detail = await staffApi(request, `/tables/${table.id}/session`);
  expect(detail.session).toBeNull();
  const s = database.view(fixture.actor);
  const outbox = await s.list('outbox_events', database.sql`event='ticket.redeemed'`);
  await expect
    .poll(async () => (await s.get('outbox_events', outbox[0].id)).published_at)
    .toBeTruthy();
  await customerContext.close();
  await waiterContext.close();
});
test('cozinha prepara e disponibiliza ficha', async ({ page, request }) => {
  const table = await staffApi(request, '/tables', {
    number: `K${randomUUID().slice(0, 5)}`,
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[2].id, quantity: 1, modifiers: [] }],
  });
  await staffApi(request, `/orders/${order.id}/confirm`, {});
  await login(page, 35176);
  await expect(page.getByRole('heading', { name: 'Porção de batata' })).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar preparo' }).click();
  await page.getByRole('button', { name: 'Pronto para entregar' }).click();
  await expect(page.getByRole('heading', { name: 'Porção de batata' })).not.toBeVisible();
});

test('abas, busca em selects e toasts preservam os formulários', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Cardápio' }).getByRole('tab')).toHaveCount(3);
  await expect(page.locator('.resource-panel')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Categorias', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Categorias', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const category = `Categoria UX ${randomUUID().slice(0, 5)}`;
  await page.getByRole('dialog').getByLabel('Nome', { exact: true }).fill(category);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Cadastro salvo.' }).last(),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome', { exact: true }).fill('Produto UX com categoria');
  const select = dialog.getByRole('combobox', { name: 'Categoria', exact: true });
  await select.fill(category.toLowerCase());
  await expect(page.getByRole('listbox', { name: 'Opções de Categoria' })).toBeVisible();
  await page.getByRole('option', { name: category, exact: true }).click();
  await expect(select).toHaveValue(category);
  await dialog.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await dialog.getByLabel('Preço', { exact: true }).fill('inválido');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('alert').last()).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Geral', exact: true }).click();
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Produto UX com categoria');
  await dialog.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await dialog.getByLabel('Preço', { exact: true }).fill('9.50');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Criar estoque do novo produto?', exact: true })
    .getByRole('button', { name: 'Agora não', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Produto UX com categoria', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const categorySelect = page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Categoria', exact: true });
  await categorySelect.fill('Opção inexistente');
  await expect(page.getByText('Nenhuma opção encontrada.')).toBeVisible();
  await categorySelect.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await categorySelect.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('tab', { name: 'Produtos', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Categorias', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const [section, label] of [
    ['Cardápio', 'Cardápio'],
    ['Impressão', 'Impressão'],
    ['Configurações', 'Configurações'],
    ['Salão e mesas', 'Salão'],
  ]) {
    await page.getByRole('button', { name: section, exact: true }).click();
    await expect(page.getByRole('tablist', { name: label, exact: true })).toBeVisible();
    await page.screenshot({ path: `.local/screenshots/tabs-${section.replace(/\W/g, '-')}.png` });
  }
});

test('arrastar a seleção de um campo para fora não fecha o modal', async ({ page }) => {
  await login(page, 35173);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await page.getByRole('tab', { name: 'Categorias', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Nome', { exact: true });
  await name.fill('Texto que deve continuar no formulário');
  const bounds = await name.boundingBox();
  if (!bounds) throw new Error('Campo do modal não está visível.');
  const inside = { x: bounds.x + bounds.width - 15, y: bounds.y + bounds.height / 2 };
  const outside = { x: 12, y: 12 };
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(outside.x, outside.y, { steps: 10 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('Texto que deve continuar no formulário');
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.down();
  await page.mouse.move(inside.x, inside.y, { steps: 10 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(outside.x, outside.y);
  await expect(page.getByRole('alertdialog', { name: 'Descartar alterações?' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('confirma o descarte por qualquer saída e preserva os dados ao continuar', async ({
  page,
}) => {
  await login(page, 35173);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await page.getByRole('tab', { name: 'Categorias', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const name = dialog.getByLabel('Nome', { exact: true });
  await name.fill('Dados ainda não salvos');
  const attempts = [
    () => dialog.getByRole('button', { name: 'Fechar', exact: true }).click(),
    () => dialog.getByRole('button', { name: 'Cancelar', exact: true }).click(),
    () => name.press('Escape'),
    () => page.mouse.click(12, 12),
  ];
  const confirmation = page.getByRole('alertdialog', { name: 'Descartar alterações?' });
  for (const attempt of attempts) {
    await attempt();
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Continuar editando' })).toBeFocused();
    await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(name).toHaveValue('Dados ainda não salvos');
  }
  await name.press('Escape');
  await confirmation.getByRole('button', { name: 'Continuar editando' }).press('Escape');
  await expect(name).toHaveValue('Dados ainda não salvos');
  await name.fill('');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(confirmation).not.toBeVisible();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await name.fill('Será descartado');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(name).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Bebidas', exact: true }).click();
  await name.fill('Bebidas alteradas');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
  await name.fill('Bebidas');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(confirmation).not.toBeVisible();
  await page.getByRole('tab', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  await dialog.getByLabel('Disponível', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(dialog.getByLabel('Disponível', { exact: true })).not.toBeChecked();
  await dialog.getByLabel('Disponível', { exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Categoria', exact: true }).fill('Bebidas');
  await page.getByRole('option', { name: 'Bebidas', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Categoria', exact: true })).toHaveValue(
    'Bebidas',
  );
  await dialog.getByRole('button', { name: 'Limpar Categoria', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(confirmation).not.toBeVisible();
});

test('protege políticas, aparência e pedido em montagem sem alterar registros salvos', async ({
  page,
  request,
}) => {
  await login(page, 35173);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Editar informações', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const confirmation = page.getByRole('alertdialog', { name: 'Descartar alterações?' });
  await dialog.getByLabel('Nome', { exact: true }).fill('Nome não salvo');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Nome não salvo');
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  expect((await staffApi(request, '/settings')).name).toBe('Boteco da Esquina');
  await page.getByRole('tab', { name: 'Aparência', exact: true }).click();
  await page.getByRole('button', { name: 'Personalizar cor', exact: true }).click();
  const original = (await staffApi(request, '/appearance')).primary_color;
  await page.getByRole('button', { name: 'Usar cor Rosa', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(dialog.getByLabel('Código hexadecimal')).toHaveValue('#db2777');
  await dialog.getByLabel('Código hexadecimal').fill(original);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(confirmation).not.toBeVisible();
  expect((await staffApi(request, '/appearance')).primary_color).toBe(original);
  await page.getByRole('button', { name: 'Salão e mesas', exact: true }).click();
  await page.locator('.table-card').last().click();
  await dialog.getByRole('tab', { name: 'Novo pedido', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cerveja Pilsen 600 ml' }).click();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(dialog.getByText('Adicionar · 1 no pedido', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remover', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(confirmation).not.toBeVisible();
});

test('cor primária salva na unidade e aplicada nos aplicativos', async ({
  page,
  browser,
  request,
}) => {
  const original = (await staffApi(request, '/appearance')).primary_color;
  try {
    await login(page, 35173);
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('tab', { name: 'Aparência', exact: true }).click();
    await page.getByRole('button', { name: 'Personalizar cor', exact: true }).click();
    await page.getByRole('button', { name: 'Usar cor Violeta', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar aparência', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Cor primária atualizada' }),
    ).toBeVisible();
    expect((await staffApi(request, '/appearance')).primary_color).toBe('#8b5cf6');
    await expect
      .poll(() =>
        page
          .locator('html')
          .evaluate((element) => getComputedStyle(element).getPropertyValue('--blue').trim()),
      )
      .toBe('#8b5cf6');
    await page.evaluate(() => localStorage.removeItem('mesa-primary'));
    await page.reload();
    await expect
      .poll(() =>
        page
          .locator('html')
          .evaluate((element) => getComputedStyle(element).getPropertyValue('--blue').trim()),
      )
      .toBe('#8b5cf6');
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const customer = await context.newPage();
    await customer.goto(
      `http://127.0.0.1:35174/?bar=${slug}&table=${fixture.tables[7].public_code}`,
    );
    await expect
      .poll(() =>
        customer
          .locator('html')
          .evaluate((element) => getComputedStyle(element).getPropertyValue('--blue').trim()),
      )
      .toBe('#8b5cf6');
    await context.close();
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('tab', { name: 'Aparência', exact: true }).click();
    await page.screenshot({ path: 'docs/screenshots/appearance-settings.png', fullPage: true });
  } finally {
    const response = await request.patch('http://127.0.0.1:33000/api/v1/settings', {
      headers: { authorization: `Bearer ${staffToken}`, 'Idempotency-Key': randomUUID() },
      data: { primary_color: original },
    });
    expect(response.ok()).toBeTruthy();
  }
});

test('formulários de caixa e cancelamento usam modais com feedback', async ({ page, request }) => {
  await login(page, 35173);
  await page.getByRole('button', { name: 'Caixa', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir turno', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Abrir turno de caixa', exact: true });
  await dialog.getByRole('combobox', { name: 'Caixa', exact: true }).fill('Caixa principal');
  await page.getByRole('option', { name: 'Caixa principal', exact: true }).click();
  await dialog.getByLabel('Fundo de abertura', { exact: true }).fill('100.00');
  await dialog.getByRole('combobox', { name: 'Caixa', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Opções de Caixa' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Turno de caixa aberto.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sangria', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Registrar sangria', exact: true });
  await dialog.getByLabel('Valor da sangria', { exact: true }).fill('20.00');
  await dialog.getByLabel('Motivo', { exact: true }).fill('Retirada de teste');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sangria registrada.' })).toBeVisible();
  await page.getByRole('button', { name: 'Encerrar turno', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Encerrar turno de caixa', exact: true });
  await dialog.getByLabel('Dinheiro contado no fechamento', { exact: true }).fill('80.00');
  await dialog.getByRole('button', { name: 'Encerrar turno', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Diferença:' })).toBeVisible();
  const table = await staffApi(request, '/tables', {
    number: `U${randomUUID().slice(0, 5)}`,
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 1, modifiers: [] }],
  });
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: order.id.slice(0, 6).toUpperCase() })
    .getByRole('button', { name: 'Ver pedido' })
    .click();
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Cancelar pedido', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await dialog.getByLabel('Motivo do cancelamento', { exact: true }).fill('Cancelamento de teste');
  await dialog.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pedido cancelado.' })).toBeVisible();
  expect((await staffApi(request, `/orders/${order.id}`)).status).toBe('CANCELLED');
});

test('rotas preservam abas, histórico e confirmação de alterações ao voltar', async ({ page }) => {
  await login(page, 35173);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await expect(page).toHaveURL(/\/cardapio$/);
  await page.getByRole('tab', { name: 'Categorias', exact: true }).click();
  await expect(page).toHaveURL(/\/cardapio\?aba=categorias$/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Categorias', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/cardapio$/);
  await expect(page.getByRole('tab', { name: 'Produtos', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goForward();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const field = page.getByRole('dialog').getByLabel('Nome', { exact: true });
  await field.fill('Categoria que não pode ser perdida');
  await page.goBack();
  const confirmation = page.getByRole('alertdialog', { name: 'Descartar alterações?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(page).toHaveURL(/\/cardapio\?aba=categorias$/);
  await expect(field).toHaveValue('Categoria que não pode ser perdida');
  await page.goBack();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await expect(page).toHaveURL(/\/cardapio$/);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('http://127.0.0.1:35173/tela-inexistente');
  await expect(
    page.getByRole('heading', { name: 'Tela não encontrada ou sem acesso' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Voltar ao início' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/dashboard' && !url.search);
});

test('pedido guiado, comanda individual e fichas mantêm contexto em links diretos', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: `UX${randomUUID().slice(0, 4)}`,
    capacity: 4,
  });
  await staffApi(request, '/product-variants', {
    product_id: fixture.products[1].id,
    name: 'Com gás',
    price: '6.00',
    enabled: true,
  });
  let confirmationFailed = false;
  await page.route('**/api/v1/orders/*/confirm', async (route) => {
    if (!confirmationFailed) {
      confirmationFailed = true;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INVALID_STATE', message: 'Falha temporária de confirmação para teste.' },
        }),
      });
    } else await route.continue();
  });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await page.getByRole('combobox', { name: 'Mesa do pedido', exact: true }).fill(table.number);
  await page.getByRole('option', { name: `Mesa ${table.number} · Livre`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar para o pedido' }).click();
  await expect(page).toHaveURL(new RegExp(`/salao/atendimento/${table.id}$`));
  const attendance = page.getByRole('dialog');
  await attendance.getByRole('button', { name: 'Cerveja Pilsen 600 ml' }).click();
  await attendance
    .getByRole('button', { name: 'Aumentar quantidade de Cerveja Pilsen 600 ml' })
    .click();
  await attendance
    .getByLabel('Observação de Cerveja Pilsen 600 ml')
    .fill('Duas garrafas bem geladas');
  await attendance.getByRole('button', { name: 'Confirmar pedido pós-pago' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Falha temporária de confirmação para teste.' }),
  ).toBeVisible();
  await expect(attendance.getByLabel('Observação de Cerveja Pilsen 600 ml')).toBeDisabled();
  expect(
    (await staffApi(request, '/orders')).filter((order: any) => order.table_id === table.id),
  ).toHaveLength(1);
  await attendance.getByRole('button', { name: 'Tentar confirmar pedido', exact: true }).click();
  await expect(attendance.getByRole('tab', { name: 'Comandas e consumo' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(attendance.getByText('2 × Cerveja Pilsen 600 ml', { exact: true })).toBeVisible();
  const first = (await staffApi(request, '/orders')).find(
    (order: any) => order.table_id === table.id,
  );
  expect(first.item_count).toBe(2);
  expect(first.ticket_count).toBe(2);
  expect((await staffApi(request, `/orders/${first.id}`)).items[0].notes).toBe(
    'Duas garrafas bem geladas',
  );
  await attendance.getByRole('button', { name: 'Nova comanda', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Nova comanda', exact: true })
    .getByLabel('Nome da comanda')
    .fill('Conta da Ana');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(attendance.getByRole('combobox', { name: 'Comanda', exact: true })).toHaveValue(
    /Conta da Ana/,
  );
  await expect(attendance.getByRole('tab', { name: 'Novo pedido', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await attendance.getByRole('button', { name: 'Água mineral' }).click();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Variação do produto' })
    .fill('Com gás');
  await page.getByRole('option', { name: 'Com gás · R$ 6,00', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Adicionar ao pedido', exact: true })
    .click();
  await attendance.getByRole('button', { name: 'Confirmar pedido pós-pago' }).click();
  await expect(attendance.getByText('1 × Água mineral - Com gás', { exact: true })).toBeVisible();
  const second = (await staffApi(request, '/orders')).find(
    (order: any) => order.table_id === table.id && order.id !== first.id,
  );
  expect(second.tab_label).toBe('Conta da Ana');
  await attendance
    .getByRole('button', {
      name: `Ver pedido #${second.id.slice(0, 6).toUpperCase()}`,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${second.id}$`));
  await page.reload();
  const detail = page.getByRole('dialog');
  await expect(detail.getByText('Conta da Ana', { exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Fichas deste pedido' })).toBeVisible();
  await detail.getByRole('button', { name: 'Ver ficha', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${second.id}$`));
  await expect(
    detail
      .getByRole('region', { name: 'Ficha selecionada' })
      .getByRole('img', { name: 'QR Code', exact: true }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Abrir ficha na tela de pedidos', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${second.id}/fichas/`));
  await expect(page.getByRole('dialog').getByText(/Mesa .*Conta da Ana.*Pedido/)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${second.id}$`));
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page).toHaveURL(/\/pedidos$/);
  await page.getByRole('tab', { name: /^Fichas/ }).click();
  await expect(page).toHaveURL(/aba=fichas/);
  await page.getByRole('combobox', { name: 'Filtrar por mesa' }).fill(table.number);
  await page.getByRole('option', { name: `Mesa ${table.number}`, exact: true }).click();
  await expect(page.locator('.ticket-context-card').first()).not.toBeVisible();
  await page.getByRole('button', { name: 'Expandir atendimentos', exact: true }).click();
  await expect(page.locator('.ticket-context-card').first()).toBeVisible();
  await expect(page.locator('.ticket-context-card')).toHaveCount(3);
  await expect(
    page.locator('.ticket-context-card').filter({ hasText: 'Conta da Ana' }),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Carregar fichas' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Fichas/ })).toHaveAttribute('aria-selected', 'true');
});

test('fichas separam atendimentos da mesma mesa e expandem comandas e pedidos', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: 'G' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const create = async () => {
    const order = await staffApi(request, '/orders', {
      table_id: table.id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: fixture.products[1].id, quantity: 1, modifiers: [] }],
    });
    return staffApi(request, `/orders/${order.id}/confirm`, {});
  };
  const first = await create();
  const firstDetail = await staffApi(request, `/orders/${first.id}`);
  const ticket = await staffApi(request, '/tickets/' + firstDetail.tickets[0].id);
  await staffApi(request, '/tickets/' + ticket.id + '/redeem', { token: ticket.token });
  await staffApi(request, '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: first.tab_id, amount: first.total }],
  });
  await staffApi(request, `/tables/${table.id}/checkout`, {});
  await staffApi(request, `/tables/${table.id}/release`, {});
  const second = await create();
  const secondDetail = await staffApi(request, `/orders/${second.id}`);
  expect(secondDetail.tickets[0].session_id).not.toBe(firstDetail.tickets[0].session_id);
  await login(page, 35173);
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('tab', { name: /^Fichas/ }).click();
  await page.getByRole('combobox', { name: 'Filtrar por mesa' }).fill(table.number);
  await page.getByRole('option', { name: 'Mesa ' + table.number, exact: true }).click();
  const group = page.locator('.ticket-table-group');
  await expect(group).toHaveCount(1);
  await expect(group).toHaveJSProperty('open', false);
  await group.getByText('Mesa ' + table.number, { exact: true }).click();
  await expect(group.locator('.ticket-attendance-group')).toHaveCount(2);
  await expect(group.getByText('Atendimento atual', { exact: true })).toBeVisible();
  await expect(group.getByText('Atendimento encerrado', { exact: true })).toBeVisible();
  await expect(
    group.locator('.ticket-context-card').filter({ hasText: second.id.slice(0, 6).toUpperCase() }),
  ).toBeVisible();
  await expect(
    group.locator('.ticket-context-card').filter({ hasText: first.id.slice(0, 6).toUpperCase() }),
  ).not.toBeVisible();
  await group.getByText('Atendimento encerrado', { exact: true }).click();
  await expect(
    group.locator('.ticket-context-card').filter({ hasText: first.id.slice(0, 6).toUpperCase() }),
  ).toBeVisible();
  await expect(group.locator('.ticket-tab-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'Recolher atendimentos', exact: true }).click();
  await expect(group.locator('.ticket-context-card').first()).not.toBeVisible();
});

async function prepaidCancellationFixture(request: APIRequestContext) {
  const table = await staffApi(request, '/tables', {
    number: 'C' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'PREPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 1, modifiers: [] }],
  });
  const intent = await staffApi(request, '/payments/intents', { order_id: order.id });
  return staffApi(request, '/sandbox/pay', { intent_id: intent.id });
}
test('estorna o restante no cancelamento e mantém o motivo preenchido', async ({
  page,
  request,
}) => {
  const { order, payment } = await prepaidCancellationFixture(request);
  await staffApi(request, `/payments/${payment.id}/refund`, {
    amount: '1.25',
    tab_id: order.tab_id,
    reason: 'Estorno parcial anterior',
  });
  await login(page, 35173);
  await page.goto(`http://127.0.0.1:35173/pedidos/${order.id}`);
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancelar pedido', exact: true });
  const reason = cancel.getByLabel('Motivo do cancelamento', { exact: true });
  await reason.fill('Cliente desistiu antes da entrega');
  await expect(cancel.getByText(/Ainda é necessário estornar R\$\s*3,75/)).toBeVisible();
  await expect(
    cancel.getByRole('button', { name: 'Confirmar cancelamento', exact: true }),
  ).toBeDisabled();
  await cancel.getByRole('button', { name: 'Estornar pagamento', exact: true }).click();
  const refund = page.getByRole('dialog', { name: 'Estornar pagamento do pedido', exact: true });
  await expect(refund.getByLabel('Valor do estorno')).toHaveValue('3,75');
  await expect(refund.getByLabel('Motivo do estorno')).toHaveValue(
    'Cliente desistiu antes da entrega',
  );
  await refund.getByRole('button', { name: 'Confirmar estorno', exact: true }).click();
  await expect(refund).not.toBeVisible();
  await expect(reason).toHaveValue('Cliente desistiu antes da entrega');
  await expect(
    cancel.getByRole('button', { name: 'Confirmar cancelamento', exact: true }),
  ).toBeEnabled();
  await expect(
    cancel.getByRole('button', { name: 'Confirmar cancelamento', exact: true }),
  ).toBeFocused();
  expect((await staffApi(request, '/payments/' + payment.id)).refunds).toHaveLength(2);
  await cancel.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(cancel).not.toBeVisible();
  expect((await staffApi(request, '/orders/' + order.id)).status).toBe('CANCELLED');
  expect((await staffApi(request, '/tabs/' + order.tab_id)).financial.balance).toBe('0.00');
});
test('atualiza a opção de estorno após bloqueio sem perder o motivo ou estornar automaticamente', async ({
  page,
  request,
}) => {
  const { order, payment } = await prepaidCancellationFixture(request);
  let first = true;
  await page.route('**/api/v1/orders/*/cancellation-context', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (first) {
      first = false;
      body.refund_required_amount = '0.00';
      body.can_cancel = true;
    }
    await route.fulfill({ response, json: body });
  });
  await login(page, 35173);
  await page.goto(`http://127.0.0.1:35173/pedidos/${order.id}`);
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancelar pedido', exact: true });
  await cancel
    .getByLabel('Motivo do cancelamento', { exact: true })
    .fill('Motivo que deve ser preservado');
  await cancel.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(
    cancel.getByRole('button', { name: 'Estornar pagamento', exact: true }),
  ).toBeVisible();
  await expect(cancel.getByLabel('Motivo do cancelamento', { exact: true })).toHaveValue(
    'Motivo que deve ser preservado',
  );
  expect((await staffApi(request, '/payments/' + payment.id)).refunds).toHaveLength(0);
  expect((await staffApi(request, '/orders/' + order.id)).status).toBe('CONFIRMED');
});

test('resumo da mesa separa comandas, entregas, cancelamento e fechamento', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: `RM${randomUUID().slice(0, 4)}`,
    capacity: 4,
  });
  const first = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[0].id, quantity: 2, modifiers: [] }],
  });
  await staffApi(request, `/orders/${first.id}/confirm`, {});
  const session = await staffApi(request, `/tables/${table.id}/session`);
  const secondTab = await staffApi(request, '/tabs', {
    session_id: session.session.id,
    label: 'Conta da Bia',
    mode: 'INDIVIDUAL',
  });
  const second = await staffApi(request, '/orders', {
    table_id: table.id,
    tab_id: secondTab.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 1, modifiers: [] }],
  });
  await staffApi(request, `/orders/${second.id}/confirm`, {});
  const firstDetails = await staffApi(request, `/orders/${first.id}`);
  const doc = await staffApi(request, `/tickets/${firstDetails.tickets[0].id}`);
  await staffApi(request, `/tickets/${doc.id}/redeem`, { token: doc.token });
  await staffApi(request, '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: session.tabs[0].id, amount: '10.00' }],
  });
  await login(page, 35173);
  await page.goto(`http://127.0.0.1:35173/salao/atendimento/${table.id}`);
  const dialog = page.getByRole('dialog', { name: 'Mesa ' + table.number, exact: true });
  await expect(dialog.getByRole('tab', { name: 'Resumo da mesa' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.locator('.attendance-money')).toContainText('R$ 33,00');
  await expect(dialog.locator('.attendance-money')).toContainText('R$ 10,00');
  await expect(dialog.locator('.attendance-money')).toContainText('R$ 23,00');
  await expect(dialog.getByLabel('Resumo das entregas')).toContainText('3 unidades pedidas');
  await expect(dialog.getByLabel('Resumo das entregas')).toContainText('1 entregues');
  await expect(dialog.getByLabel('Resumo das entregas')).toContainText('2 a entregar');
  await expect(dialog.locator('.attendance-comanda')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Já entregues', exact: true }).click();
  await expect(dialog.locator('.attendance-item')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Todos os itens', exact: true }).click();
  await dialog
    .getByRole('button', {
      name: `Cancelar pedido #${second.id.slice(0, 6).toUpperCase()}`,
      exact: true,
    })
    .click();
  const cancel = page.getByRole('dialog', { name: 'Cancelar pedido', exact: true });
  await cancel.getByLabel('Motivo do cancelamento').fill('Cliente desistiu antes da entrega');
  await cancel.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(cancel).not.toBeVisible();
  await expect(dialog.locator('.attendance-money')).toContainText('R$ 28,00');
  await expect(dialog.locator('.attendance-money')).toContainText('R$ 18,00');
  await expect(dialog.getByLabel('Resumo das entregas')).toContainText('1 a entregar');
  await expect(dialog.getByText('Cancelado · fora do total')).toBeVisible();
  await dialog.getByRole('button', { name: 'Ir para fechamento', exact: true }).click();
  const review = page.getByRole('dialog', { name: /Revisão de fechamento/ });
  await expect(review).toContainText('1 ficha(s) ainda precisam ser entregues ou canceladas.');
  await review.getByRole('button', { name: 'Receber saldo', exact: true }).click();
  const receive = page.getByRole('dialog', { name: 'Registrar recebimento', exact: true });
  await expect(receive.getByLabel('Valor a receber')).toHaveValue('18,00');
  await receive.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await review.getByRole('button', { name: 'Voltar à mesa', exact: true }).click();
  await dialog.getByRole('button', { name: 'Abrir outra comanda', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Nova comanda', exact: true })
    .getByLabel('Nome da comanda')
    .fill('Conta do Leo');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'Novo pedido', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('combobox', { name: 'Comanda', exact: true })).toHaveValue(
    /Conta do Leo/,
  );
  await dialog.getByRole('button', { name: 'Cerveja Pilsen 600 ml' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Comanda', exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Abrir outra comanda', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Remover', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Resumo da mesa' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const width = await dialog.evaluate((node) => ({
    scroll: node.scrollWidth,
    client: node.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count()) {
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  }
  await dialog.evaluate((node) => node.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/mesa-resumo-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await dialog.evaluate((node) => node.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/mesa-resumo-e2e.png' });
});

test('máscara monetária salva inteiros, centavos e valores colados nas variações', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const suffix of ['A', 'B'])
    await staffApi(request, '/products', {
      name: 'Produto extra máscara ' + suffix,
      price: '2.00',
      stock_policy: 'NO_CONTROL',
    });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar em Produtos' }).fill('Cerveja Pilsen 600 ml');
  await page.getByRole('button', { name: 'Editar Cerveja Pilsen 600 ml', exact: true }).click();
  const product = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await product.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await product.getByRole('button', { name: 'Nova variação', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova variação', exact: true });
  const name = `1L máscara ${randomUUID().slice(0, 4)}`;
  await dialog.getByLabel('Nome da variação', { exact: true }).fill(name);
  const price = dialog.getByLabel('Preço da variação', { exact: true });
  await price.fill('14');
  await dialog.getByLabel('Nome da variação', { exact: true }).click();
  await expect(price).toHaveValue('14,00');
  const saved = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith('/api/v1/product-variants'),
  );
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  expect((await saved).postDataJSON().price).toBe('14.00');
  await expect(dialog).not.toBeVisible();
  const row = product.locator('.product-config-list article').filter({ hasText: name });
  await row.getByRole('button', { name: /^Editar/ }).click();
  const edit = page.getByRole('dialog', { name: 'Editar variação', exact: true });
  await expect(edit.getByLabel('Preço da variação', { exact: true })).toHaveValue('14,00');
  await edit.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await row.getByRole('button', { name: /^Editar/ }).click();
  const editPrice = edit.getByLabel('Preço da variação', { exact: true });
  await editPrice.fill('');
  await editPrice.pressSequentially('14,50');
  await edit.getByLabel('Nome da variação', { exact: true }).click();
  await expect(editPrice).toHaveValue('14,50');
  await editPrice.fill('-14');
  await edit.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('não aceita valor negativo');
  await expect(edit).toBeVisible();
  await editPrice.fill('1000000000000');
  await edit.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('12 dígitos');
  await editPrice.fill('R$ 1.234,56');
  await edit.getByLabel('Nome da variação', { exact: true }).click();
  await expect(editPrice).toHaveValue('1.234,56');
  const changed = page.waitForRequest(
    (req) => req.method() === 'PATCH' && req.url().includes('/api/v1/product-variants/'),
  );
  await edit.getByRole('button', { name: 'Salvar', exact: true }).click();
  expect((await changed).postDataJSON().price).toBe('1234.56');
  await expect(edit).not.toBeVisible();
  expect(
    (await staffApi(request, '/product-variants')).find((item: any) => item.name === name).price,
  ).toBe('1234.56');
  await row.getByRole('button', { name: /^Editar/ }).click();
  await expect(edit.getByLabel('Preço da variação', { exact: true })).toHaveValue('1.234,56');
  await edit.getByLabel('Preço da variação', { exact: true }).fill('14,50');
  await edit.getByLabel('Nome da variação', { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (
    let count = await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count();
    count > 0;
    count--
  )
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.screenshot({ path: 'docs/screenshots/valores-maska.png' });
  expect(errors).toEqual([]);
});

test('gestão da mesa mantém fluxos no layout de três painéis e no celular', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const table = await staffApi(request, '/tables', {
    number: `V05-${randomUUID().slice(0, 3)}`,
    capacity: 4,
  });
  const first = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [
      { product_id: fixture.products[0].id, quantity: 2, modifiers: [] },
      { product_id: fixture.products[1].id, quantity: 1, modifiers: [] },
      { product_id: fixture.products[2].id, quantity: 1, modifiers: [] },
    ],
  });
  await staffApi(request, `/orders/${first.id}/confirm`, {});
  const service = await staffApi(request, `/tables/${table.id}/session`);
  const ana = await staffApi(request, '/tabs', {
    session_id: service.session.id,
    label: 'Conta da Ana',
    mode: 'INDIVIDUAL',
  });
  const second = await staffApi(request, '/orders', {
    table_id: table.id,
    tab_id: ana.id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [
      { product_id: fixture.products[3].id, quantity: 1, modifiers: [], notes: 'Sem açúcar' },
    ],
  });
  await staffApi(request, `/orders/${second.id}/confirm`, {});
  const firstDetail = await staffApi(request, `/orders/${first.id}`);
  const ticket = await staffApi(
    request,
    `/tickets/${firstDetail.tickets.find((item: any) => item.product === 'Cerveja Pilsen 600 ml').id}`,
  );
  await staffApi(request, `/tickets/${ticket.id}/redeem`, { token: ticket.token });
  await staffApi(request, '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: service.tabs[0].id, amount: '20.00' }],
  });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await login(page, 35173);
  const attendanceUrl = `http://127.0.0.1:35173/${fixture.slug}/salao/atendimento/${table.id}`;
  await page.goto(attendanceUrl);
  const dialog = page.getByRole('dialog', { name: `Mesa ${table.number}`, exact: true });
  await expect(dialog.getByRole('heading', { name: /Gerenciar pedidos/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  const toggleLight = page.getByRole('button', { name: 'Ativar tema claro', exact: true });
  if (await toggleLight.isVisible()) await toggleLight.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto(attendanceUrl);
  await expect(dialog.getByRole('heading', { name: /Gerenciar pedidos/ })).toBeVisible();
  const catalog = dialog.getByLabel('Cardápio da mesa', { exact: true });
  const operation = dialog.getByLabel('Gestão do atendimento', { exact: true });
  const summary = dialog.getByLabel('Resumo e ações da mesa', { exact: true });
  await expect(catalog).toBeVisible();
  await expect(operation).toBeVisible();
  await expect(summary).toBeVisible();
  const boxes = await Promise.all([catalog, operation, summary].map((pane) => pane.boundingBox()));
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
  await expect(summary.locator('.attendance-money')).toContainText('R$ 87,00');
  await expect(summary.locator('.attendance-money')).toContainText('R$ 67,00');
  await expect(operation.getByText('Sem açúcar', { exact: true })).toBeVisible();
  await expect(dialog.locator('.table-mobile-navigation')).toBeHidden();
  await page.screenshot({ path: 'docs/screenshots/mesa-design-system-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(operation).toBeVisible();
  await expect(catalog).not.toBeVisible();
  for (const width of [320, 390, 600]) {
    await page.setViewportSize({ width, height: 844 });
    await expectMobileTableHeader(dialog);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/screenshots/mesa-header-mobile-light.png' });
  await operation.getByRole('button', { name: 'Gerenciar entregas', exact: true }).click();
  const deliveries = operation.getByRole('tab', { name: 'Entregas', exact: true });
  await expect(deliveries).toHaveAttribute('aria-selected', 'true');
  await expect(deliveries).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '.local/screenshots/mesa-deliveries-active-mobile.png' });
  await dialog.getByRole('tab', { name: 'Cardápio', exact: true }).click();
  await expect(operation).not.toBeVisible();
  await dialog.getByRole('tab', { name: 'Atendimento', exact: true }).click();
  await expect(deliveries).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 360, height: 844 });
  await expect(deliveries).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(deliveries).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(deliveries).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('tab', { name: 'Resumo e ações', exact: true }).click();
  await expect(summary).toBeVisible();
  await summary.getByRole('button', { name: 'Adicionar pagamento', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Registrar recebimento', exact: true });
  await expect(payment.getByLabel('Valor a receber')).toHaveValue(/,00$/);
  await payment.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/mesa-design-system-mobile-resumo.png' });
  await dialog.getByRole('tab', { name: 'Resumo e ações', exact: true }).press('Home');
  await expect(dialog.getByRole('tab', { name: 'Cardápio', exact: true })).toBeFocused();
  await expect(catalog).toBeVisible();
  await catalog
    .getByRole('group', { name: 'Categorias do cardápio' })
    .getByRole('button', { name: 'Bebidas', exact: true })
    .click();
  await expect(catalog.getByRole('button', { name: /Porção de batata/ })).not.toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/mesa-design-system-mobile-cardapio.png' });
  await catalog.getByRole('button', { name: /Caipirinha da casa/ }).click();
  await expect(operation).toBeVisible();
  await expect(
    operation.getByRole('heading', { name: 'Resumo do pedido', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Comanda', exact: true })).toBeDisabled();
  const sizes = await dialog.evaluate((node) => ({
    scroll: node.scrollWidth,
    width: node.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Continuar editando', exact: true })
    .click();
  await operation.getByRole('button', { name: 'Remover', exact: true }).click();
  expect(
    (await staffApi(request, '/orders')).filter((order: any) => order.table_id === table.id),
  ).toHaveLength(2);
});

test('pedidos usa filtros combinados, paginação, ordenação e cards no celular', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: `LIST-${randomUUID().slice(0, 4)}`,
    capacity: 4,
  });
  const created: any[] = [];
  for (let quantity = 1; quantity <= 13; quantity++) {
    const order = await staffApi(request, '/orders', {
      table_id: table.id,
      source: quantity % 2 ? 'WAITER' : 'POS',
      payment_policy: 'POSTPAID',
      items: [
        {
          product_id: fixture.products[1].id,
          quantity,
          modifiers: [],
          notes: quantity === 1 ? 'Sem gelo' : '',
        },
      ],
    });
    await staffApi(request, `/orders/${order.id}/confirm`, {});
    created.push(order);
  }
  await staffApi(request, `/orders/${created[12].id}/cancel`, {
    reason: 'Cliente desistiu antes do atendimento',
  });
  const detail = await staffApi(request, `/orders/${created[0].id}`);
  const ticket = await staffApi(request, `/tickets/${detail.tickets[0].id}`);
  await staffApi(request, `/tickets/${ticket.id}/redeem`, { token: ticket.token });
  await page.setViewportSize({ width: 1536, height: 1100 });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
  const lightTheme = page.getByRole('button', { name: 'Ativar tema claro', exact: true });
  if (await lightTheme.isVisible()) await lightTheme.click();
  await expect(page.getByLabel('Indicadores dos pedidos')).toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrar por mesa' }).fill(table.number);
  await page.getByRole('option', { name: `Mesa ${table.number}`, exact: true }).click();
  const list = page.getByRole('table', { name: 'Lista de pedidos', exact: true });
  await expect(list.locator('tbody tr')).toHaveCount(10);
  await expect(
    page.getByRole('navigation', { name: 'Paginação de Pedidos', exact: true }),
  ).toContainText('de 13');
  await page.getByRole('button', { name: 'Próxima página de pedidos', exact: true }).click();
  await expect(list.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Pedidos por página', exact: true }).click();
  await page.getByRole('option', { name: '25 por página', exact: true }).click();
  await expect(list.locator('tbody tr')).toHaveCount(13);
  await expect(
    page.getByRole('navigation', { name: 'Paginação de Pedidos', exact: true }),
  ).toContainText('Página 1 de 1');
  await page.getByRole('button', { name: 'Ordenar por total', exact: true }).click();
  await expect(list.locator('tbody tr').first().locator('.order-value-cell')).toContainText(
    'R$ 5,00',
  );
  await page.getByRole('button', { name: 'Ordenar por total', exact: true }).click();
  await expect(list.locator('tbody tr').first().locator('.order-value-cell')).toContainText(
    'R$ 65,00',
  );
  await page.getByRole('combobox', { name: 'Origem do pedido', exact: true }).click();
  await page.getByRole('option', { name: 'Garçom', exact: true }).click();
  await expect(list.locator('tbody tr')).toHaveCount(7);
  await page.getByRole('combobox', { name: 'Situação da entrega', exact: true }).click();
  await page.getByRole('option', { name: 'Entregues', exact: true }).click();
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await expect(list).toContainText(`#${created[0].id.slice(0, 6).toUpperCase()}`);
  const compactRow = list.locator('tbody tr').first();
  const geometry = await compactRow.evaluate((element) => {
    const parts = [
      ...element.querySelectorAll('.order-reference, .order-id time, .order-source'),
    ].map((part) => part.getBoundingClientRect());
    return {
      height: element.getBoundingClientRect().height,
      centers: parts.map((part) => part.top + part.height / 2),
    };
  });
  expect(geometry.height).toBeLessThanOrEqual(55);
  expect(Math.max(...geometry.centers) - Math.min(...geometry.centers)).toBeLessThan(1);
  await page.screenshot({ path: 'docs/screenshots/pedidos-linhas-compactas-claro.png' });
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(compactRow.locator('.order-id')).toContainText('Garçom');
  await page.screenshot({ path: 'docs/screenshots/pedidos-linhas-compactas-escuro.png' });
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await list.getByRole('button', { name: 'Ver pedido', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${created[0].id}$`));
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Buscar pedidos e fichas', exact: true })
    .fill(ticket.public_number);
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('tab', { name: /^Fichas/ }).click();
  await page.getByRole('button', { name: 'Expandir atendimentos', exact: true }).click();
  await expect(page.locator('.ticket-context-card')).toHaveCount(1);
  await page.getByRole('tab', { name: /^Pedidos/ }).click();
  await page
    .getByRole('searchbox', { name: 'Buscar pedidos e fichas', exact: true })
    .fill('pedido inexistente xyz');
  await expect(
    page.getByRole('heading', { name: 'Nenhum pedido encontrado', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filtrar por mesa' }).fill(table.number);
  await page.getByRole('option', { name: `Mesa ${table.number}`, exact: true }).click();
  await expect(page.getByRole('button', { name: /^Filtros/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const row = list.locator('tbody tr').first();
  await expect(row.getByRole('button', { name: 'Ver pedido', exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/pedidos-design-system-mobile.png' });
  await row.getByRole('button', { name: 'Ver pedido', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.setViewportSize({ width: 1536, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/pedidos-design-system-desktop.png' });
});

test('catálogo organiza categorias, filtros, disponibilidade e edição lateral protegida', async ({
  page,
  request,
}) => {
  const category = await staffApi(request, '/categories', {
    name: 'Catálogo visual ' + randomUUID().slice(0, 4),
    sort_order: 0,
  });
  const created: any[] = [];
  for (let i = 1; i <= 12; i++)
    created.push(
      await staffApi(request, '/products', {
        name: `Produto visual ${String(i).padStart(2, '0')}`,
        description: 'Produto para validar a gestão visual do cardápio.',
        category_id: category.id,
        price: (i * 3).toFixed(2),
        enabled: i !== 12,
        stock_policy: i === 2 ? 'RECIPE' : 'NO_CONTROL',
        requires_production: i === 2,
        sector: 'bar',
      }),
    );
  await page.setViewportSize({ width: 1700, height: 1100 });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  const light = page.getByRole('button', { name: 'Ativar tema claro', exact: true });
  if (await light.isVisible()) await light.click();
  const categoryButton = page
    .getByRole('navigation', { name: 'Filtrar produtos por categoria' })
    .getByRole('button')
    .filter({ hasText: category.name });
  await categoryButton.click();
  const table = page.locator('.catalog-products-table');
  await expect(table.locator('tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Próxima página em Produtos', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await page
    .getByRole('group', { name: 'Disponibilidade dos produtos' })
    .getByRole('button', { name: /Ativos/ })
    .click();
  await expect(table.locator('tbody tr')).toHaveCount(10);
  await expect(
    page.getByRole('navigation', { name: 'Paginação de Produtos', exact: true }),
  ).toContainText('de 11');
  await page.getByRole('combobox', { name: 'Filtrar estoque de produtos' }).fill('Ficha técnica');
  await page.getByRole('option', { name: 'Ficha técnica', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Filtrar estoque de produtos' }).fill('Todos');
  await page.getByRole('option', { name: 'Todos', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar em Produtos' }).fill('Produto visual 01');
  const toggle = page.getByRole('switch', { name: 'Disponibilidade de Produto visual 01' });
  await toggle.click();
  await page
    .getByRole('group', { name: 'Disponibilidade dos produtos' })
    .getByRole('button', { name: /Inativos/ })
    .click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page
    .getByRole('group', { name: 'Disponibilidade dos produtos' })
    .getByRole('button', { name: /Todos/ })
    .click();
  await page.getByRole('searchbox', { name: 'Buscar em Produtos' }).fill('');
  await page.getByRole('button', { name: 'Editar Produto visual 01', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await expect(editor.getByLabel('Nome', { exact: true })).toBeFocused();
  await editor.getByLabel('Nome', { exact: true }).fill('Produto visual alterado');
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Descartar alterações?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(editor.getByLabel('Nome', { exact: true })).toHaveValue('Produto visual alterado');
  await editor.getByRole('tab', { name: 'Preços e variações' }).click();
  await editor.getByLabel('Preço', { exact: true }).fill('14,50');
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const saved = await staffApi(request, '/products');
  expect(saved.find((p: any) => p.id === created[0].id).price).toBe('14.50');
  await page.getByRole('searchbox', { name: 'Buscar em Produtos' }).fill('');
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count())
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.getByRole('button', { name: 'Editar Produto visual 02', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/produtos-design-system-desktop.png' });
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () =>
      page.locator('.sidebar').evaluate((node) => node.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    page.getByRole('button', { name: 'Editar Produto visual 02', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/screenshots/produtos-design-system-mobile.png' });
  await page.getByRole('button', { name: 'Editar Produto visual 02', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Salvar', exact: true })).toBeInViewport();
  await editor.getByRole('tab', { name: 'Preços e variações' }).click();
  await editor.getByRole('button', { name: 'Nova variação' }).click();
  const variant = page.getByRole('dialog', { name: 'Nova variação', exact: true });
  await variant.getByLabel('Nome da variação').fill('Grande');
  await variant.getByLabel('Preço da variação').fill('18');
  await variant.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor.getByText('Grande', { exact: true })).toBeVisible();
  await editor.getByRole('tab', { name: 'Geral', exact: true }).click();
  await editor.getByRole('button', { name: 'Limpar Categoria' }).click();
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(
    (await staffApi(request, '/products')).find((p: any) => p.id === created[1].id).category_id,
  ).toBeNull();
});

test('pedido compacto acumula cliques e preserva personalizações distintas', async ({
  page,
  request,
}) => {
  const simple = await staffApi(request, '/products', {
    name: 'Bebida compacta ' + randomUUID().slice(0, 4),
    price: '12.50',
    stock_policy: 'NO_CONTROL',
    enabled: true,
    requires_production: false,
    sector: 'bar',
  });
  const custom = await staffApi(request, '/products', {
    name: 'Bebida com opções ' + randomUUID().slice(0, 4),
    price: '10.00',
    stock_policy: 'NO_CONTROL',
    enabled: true,
    requires_production: false,
    sector: 'bar',
  });
  await staffApi(request, '/product-variants', {
    product_id: custom.id,
    name: 'Grande',
    price: '15.00',
    enabled: true,
  });
  const table = await staffApi(request, '/tables', {
    number: 'COM-' + randomUUID().slice(0, 4),
    capacity: 4,
  });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await login(page, 35173);
  const dialog = page.getByRole('dialog', { name: `Mesa ${table.number}`, exact: true });
  const light = page.getByRole('button', { name: 'Ativar tema claro', exact: true });
  // The preference is changed only in this isolated browser context.
  if (await light.isVisible()) await light.click();
  await page.goto(`http://127.0.0.1:35173/salao/atendimento/${table.id}`);
  const card = dialog
    .getByLabel('Cardápio da mesa', { exact: true })
    .getByRole('button', { name: new RegExp(simple.name) });
  await card.click();
  await card.click();
  await card.click();
  const lines = dialog.locator('.draft-line');
  await expect(lines).toHaveCount(1);
  await expect(lines.first().locator('.quantity-controls>span')).toHaveText('3');
  await expect(lines.first().locator('.draft-line-total')).toHaveText(/37,50/);
  const lineBox = await lines.first().boundingBox();
  expect(lineBox!.height).toBeLessThan(120);
  await page.screenshot({ path: 'docs/screenshots/pedido-compacto-desktop.png' });
  await lines
    .first()
    .getByRole('button', { name: 'Diminuir quantidade de ' + simple.name, exact: true })
    .click();
  await expect(lines.first().locator('.quantity-controls>span')).toHaveText('2');
  await lines
    .first()
    .getByLabel('Observação de ' + simple.name)
    .fill('Sem gelo');
  await card.click();
  await expect(lines).toHaveCount(2);
  await expect(lines.first().getByLabel('Observação de ' + simple.name)).toHaveValue('Sem gelo');
  await card.click();
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1).locator('.quantity-controls>span')).toHaveText('2');
  for (let i = 0; i < 2; i++) {
    await dialog
      .getByLabel('Cardápio da mesa', { exact: true })
      .getByRole('button', { name: new RegExp(custom.name) })
      .click();
    const picker = page.getByRole('dialog', { name: 'Adicionar · ' + custom.name, exact: true });
    await picker.getByRole('combobox', { name: 'Variação do produto' }).fill('Grande');
    await page.getByRole('option', { name: /Grande/ }).click();
    await picker.getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
  }
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(2).locator('.quantity-controls>span')).toHaveText('2');
  await expect(dialog.locator('.draft-summary>.order-total')).toContainText('80,00');
  await page.screenshot({ path: 'docs/screenshots/pedido-compacto-personalizacoes.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByLabel('Gestão do atendimento', { exact: true })).toBeVisible();
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pedido-compacto-mobile.png' });
  await dialog.getByRole('button', { name: 'Confirmar pedido pós-pago' }).click();
  await expect(lines).toHaveCount(0);
  const orders = (await staffApi(request, '/orders')).filter(
    (order: any) => order.table_id === table.id,
  );
  expect(orders).toHaveLength(1);
  const saved = await staffApi(request, '/orders/' + orders[0].id);
  expect(saved.items).toHaveLength(3);
  expect(saved.items.map((line: any) => line.quantity)).toEqual([2, 2, 2]);
  expect(saved.total).toBe('80.00');
});

test('leitura rápida baixa uma ficha por código e bloqueia repetição, outra mesa e preparo', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: 'SCAN-' + randomUUID().slice(0, 3),
    capacity: 4,
  });
  const other = await staffApi(request, '/tables', {
    number: 'OUT-' + randomUUID().slice(0, 3),
    capacity: 4,
  });
  async function issue(tableId: string, productId: string, quantity = 1) {
    const order = await staffApi(request, '/orders', {
      table_id: tableId,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: productId, quantity, modifiers: [] }],
    });
    await staffApi(request, `/orders/${order.id}/confirm`, {});
    const detail = await staffApi(request, '/orders/' + order.id);
    return Promise.all(
      detail.tickets.map((ticket: any) => staffApi(request, '/tickets/' + ticket.id)),
    );
  }
  const [tickets, foreign, pending] = await Promise.all([
    issue(table.id, fixture.products[1].id, 2),
    issue(other.id, fixture.products[1].id),
    issue(table.id, fixture.products[2].id),
  ]);
  let redemptions = 0;
  page.on('request', (request) => {
    if (/\/tickets\/[^/]+\/redeem$/.test(request.url())) redemptions++;
  });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await login(page, 35173);
  const light = page.getByRole('button', { name: 'Ativar tema claro', exact: true });
  if (await light.isVisible()) await light.click();
  await page.goto(`http://127.0.0.1:35173/salao/atendimento/${table.id}`);
  const tableDialog = page.getByRole('dialog', { name: `Mesa ${table.number}`, exact: true });
  await tableDialog.getByRole('button', { name: 'Ler ficha', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: 'Leitura rápida de fichas', exact: true });
  const input = scanner.getByLabel('Código da ficha', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('invalido');
  await input.press('Enter');
  await expect(scanner.getByRole('alert')).toContainText('Código inválido');
  await input.fill(foreign[0].token);
  await expect(scanner.getByRole('alert')).toContainText('limitada à Mesa');
  expect(redemptions).toBe(0);
  await input.fill(pending[0].token);
  await expect(scanner.getByRole('alert')).toContainText('indisponível');
  expect(redemptions).toBe(0);
  await input.fill(tickets[0].token);
  await expect(
    scanner.getByText('Entrega registrada. Ficha baixada automaticamente.', { exact: true }),
  ).toBeVisible();
  await expect(scanner.getByLabel('Entregas realizadas nesta leitura')).toContainText(
    '1 ficha(s) baixada(s)',
  );
  await expect(input).toBeFocused();
  await input.fill(tickets[0].token);
  await expect(scanner.getByRole('status')).toContainText('já foi baixada nesta leitura');
  expect(redemptions).toBe(1);
  await page.screenshot({ path: 'docs/screenshots/leitura-rapida-mesa.png' });
  await scanner.getByRole('button', { name: 'Concluir leitura' }).click();
  await expect(tableDialog.locator('.attendance-progress')).toContainText('1 entregues');
  await tableDialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Ler ficha', exact: true }).click();
  await input.fill(tickets[0].token);
  await expect(scanner.getByRole('alert')).toContainText('já foi entregue');
  await input.fill(tickets[1].token);
  await expect(
    scanner.getByText('Entrega registrada. Ficha baixada automaticamente.', { exact: true }),
  ).toBeVisible();
  expect(redemptions).toBe(2);
  expect((await staffApi(request, '/tickets/' + foreign[0].id)).status).toBe('AVAILABLE');
  expect((await staffApi(request, '/tickets/' + tickets[1].id)).status).toBe('REDEEMED');
});

test('câmera decodifica QR e Code 128, evita repetição e libera o dispositivo ao fechar', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: 'CAM-' + randomUUID().slice(0, 3),
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 2, modifiers: [] }],
  });
  await staffApi(request, `/orders/${order.id}/confirm`, {});
  const detail = await staffApi(request, '/orders/' + order.id);
  const docs = await Promise.all(
    detail.tickets.map((t: any) => staffApi(request, '/tickets/' + t.id)),
  );
  const { default: QRCode } = await import('qrcode');
  const { default: bwipjs } = await import('bwip-js/node');
  const qr = await QRCode.toDataURL(docs[0].token, { width: 340, margin: 4 });
  const barcode =
    'data:image/png;base64,' +
    (
      await bwipjs.toBuffer({
        bcid: 'code128',
        text: docs[1].token,
        scale: 2,
        height: 25,
        padding: 20,
      })
    ).toString('base64');
  await page.addInitScript(
    ({ initial }) => {
      const state = window as any;
      state.__cameraStreams = [];
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext('2d')!;
        state.__setCameraImage = async (source: string) => {
          const image = new Image();
          image.src = source;
          await image.decode();
          context.fillStyle = 'white';
          context.fillRect(0, 0, 1280, 720);
          context.drawImage(image, (1280 - image.width) / 2, (720 - image.height) / 2);
        };
        await state.__setCameraImage(initial);
        const stream = canvas.captureStream(8);
        state.__cameraStreams.push(stream);
        return stream;
      };
    },
    { initial: qr },
  );
  let redemptions = 0;
  page.on('request', (r) => {
    if (/\/tickets\/[^/]+\/redeem$/.test(r.url())) redemptions++;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/pedidos');
  await page.getByRole('button', { name: 'Ler ficha', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: 'Leitura rápida de fichas', exact: true });
  await scanner.getByRole('button', { name: 'Câmera', exact: true }).click();
  await expect(scanner.getByLabel('Entregas realizadas nesta leitura')).toContainText(
    '1 ficha(s) baixada(s)',
  );
  await expect(scanner.getByRole('status').filter({ hasText: 'Enquadre' })).toBeVisible();
  await page.evaluate(async (source) => (window as any).__setCameraImage(source), barcode);
  await expect(scanner.getByLabel('Entregas realizadas nesta leitura')).toContainText(
    '2 ficha(s) baixada(s)',
  );
  expect(redemptions).toBe(2);
  await page.screenshot({ path: 'docs/screenshots/leitura-rapida-camera-mobile.png' });
  await scanner.getByRole('button', { name: 'Concluir leitura' }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__cameraStreams.every((s: MediaStream) =>
        s.getTracks().every((t) => t.readyState === 'ended'),
      ),
    ),
  ).toBe(true);
  expect((await staffApi(request, '/tickets/' + docs[1].id)).status).toBe('REDEEMED');
  await page.getByRole('button', { name: 'Ler ficha', exact: true }).click();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('blocked', 'NotAllowedError');
    };
  });
  await scanner.getByRole('button', { name: 'Câmera', exact: true }).click();
  await expect(scanner.getByRole('alert')).toContainText('não autorizado');
  await scanner.getByRole('button', { name: 'Leitor / código', exact: true }).click();
  await expect(scanner.getByLabel('Código da ficha', { exact: true })).toBeFocused();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      new Promise<MediaStream>((resolve) => {
        (window as any).__resolveCamera = resolve;
      });
  });
  await scanner.getByRole('button', { name: 'Câmera', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).__resolveCamera === 'function');
  await scanner.getByRole('button', { name: 'Leitor / código', exact: true }).click();
  await page.evaluate(() => {
    const pending = document.createElement('canvas').captureStream(1);
    (window as any).__pendingCamera = pending;
    (window as any).__resolveCamera(pending);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__pendingCamera
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === 'ended'),
      ),
    )
    .toBe(true);
});

test('produto centraliza variações, locais, saldos, movimentos, ficha e adicionais no mesmo modal', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 4),
    name = 'Produto central ' + suffix,
    place = 'Depósito ' + suffix,
    groupName = 'Opções ' + suffix;
  await page.setViewportSize({ width: 1536, height: 1050 });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  const light = page.getByRole('button', { name: 'Ativar tema claro', exact: true });
  if (await light.isVisible()) await light.click();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  let product = page.getByRole('dialog', { name: 'Adicionar · Produtos', exact: true });
  await product.getByLabel('Nome', { exact: true }).fill(name);
  await product.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await product.getByLabel('Preço', { exact: true }).fill('12');
  await product.getByRole('tab', { name: 'Estoque e produção', exact: true }).click();
  await product.getByRole('combobox', { name: 'Baixa de estoque', exact: true }).fill('Na entrega');
  await page.getByRole('option', { name: 'Na entrega', exact: true }).click();
  await product.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Criar estoque do novo produto?', exact: true })
    .getByRole('button', { name: 'Agora não', exact: true })
    .click();
  product = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await product.getByRole('tab', { name: 'Estoques e locais', exact: true }).click();
  await product.getByRole('button', { name: 'Locais', exact: true }).click();
  const places = page.getByRole('dialog', { name: 'Locais de estoque', exact: true });
  await places.getByRole('button', { name: 'Novo local', exact: true }).click();
  const newPlace = page.getByRole('dialog', { name: 'Novo local de estoque', exact: true });
  await newPlace.getByLabel('Nome do local').fill(place);
  await newPlace.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(places.getByText(place, { exact: true })).toBeVisible();
  await places.getByRole('button', { name: 'Fechar', exact: true }).click();
  async function balance(own = false) {
    await product.getByRole('button', { name: 'Vincular estoque', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Vincular estoque ao produto', exact: true });
    await form.getByRole('combobox', { name: 'Local de estoque', exact: true }).fill(place);
    await page.getByRole('option', { name: place, exact: true }).click();
    if (own) {
      await form.getByRole('combobox', { name: 'Estoque de', exact: true }).fill('Grande');
      await page.getByRole('option', { name: 'Grande · saldo próprio', exact: true }).click();
    }
    await form.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(form).not.toBeVisible();
  }
  async function purchase(text: string, amount: string) {
    const row = product.getByRole('row').filter({ hasText: text });
    await row.getByRole('button', { name: 'Movimentar', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Movimentar estoque', exact: true });
    await form.getByLabel('Quantidade', { exact: true }).fill(amount);
    await form.getByLabel('Motivo', { exact: true }).fill('Entrada de teste ' + suffix);
    await form.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(form).not.toBeVisible();
  }
  await balance();
  await purchase('Produto / compartilhado', '10');
  await product.getByRole('tab', { name: 'Estoque e produção', exact: true }).click();
  await product
    .getByRole('combobox', { name: 'Local de baixa do produto', exact: true })
    .fill(place);
  await page.getByRole('option', { name: place, exact: true }).click();
  await product.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await product.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await product.getByRole('button', { name: 'Nova variação', exact: true }).click();
  const variantForm = page.getByRole('dialog', { name: 'Nova variação', exact: true });
  await variantForm.getByLabel('Nome da variação').fill('Grande');
  await variantForm.getByLabel('Preço da variação').fill('18');
  await variantForm
    .getByRole('combobox', { name: 'Estoque da variação', exact: true })
    .fill('Saldo próprio');
  await page.getByRole('option', { name: 'Saldo próprio por variação', exact: true }).click();
  await variantForm.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(variantForm).not.toBeVisible();
  await product.getByRole('tab', { name: 'Estoques e locais', exact: true }).click();
  await balance(true);
  await purchase('Grande', '5,000');
  await product
    .getByRole('row')
    .filter({ hasText: 'Grande' })
    .getByRole('button', { name: /Histórico/ })
    .click();
  await expect(product.getByRole('tab', { name: 'Movimentações', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    product.getByRole('combobox', { name: 'Filtrar movimentações por estoque' }),
  ).toHaveValue(new RegExp(place));
  await expect(product.getByText('Compra', { exact: true })).toBeVisible();
  await product
    .getByRole('searchbox', { name: 'Buscar movimentação do produto' })
    .fill('movimento inexistente');
  await expect(
    product.getByText('Nenhuma movimentação encontrada.', { exact: true }),
  ).toBeVisible();
  await product.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(
    product.getByRole('combobox', { name: 'Filtrar movimentações por estoque' }),
  ).toHaveValue('Todos os estoques');
  await product.getByRole('tab', { name: 'Ficha técnica', exact: true }).click();
  await product.getByRole('button', { name: 'Criar ficha técnica', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Criar ficha técnica', exact: true });
  await recipe.getByRole('button', { name: 'Criar ficha', exact: true }).click();
  await product.getByRole('button', { name: 'Adicionar ingrediente', exact: true }).click();
  const ingredient = page.getByRole('dialog', { name: 'Adicionar ingrediente', exact: true });
  await ingredient.getByRole('combobox', { name: 'Ingrediente', exact: true }).fill('Cachaça');
  await page.getByRole('option', { name: 'Cachaça (ingrediente)', exact: true }).click();
  await ingredient.getByLabel('Quantidade por unidade').fill('0,050');
  await ingredient.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(product.getByText('0,050 un por unidade vendida')).toBeVisible();
  await product.getByRole('tab', { name: 'Adicionais', exact: true }).click();
  await product.getByRole('button', { name: 'Gerenciar grupos e adicionais', exact: true }).click();
  const groups = page.getByRole('dialog', { name: 'Grupos e adicionais', exact: true });
  await groups.getByRole('button', { name: 'Novo grupo', exact: true }).click();
  const group = page.getByRole('dialog', { name: 'Novo grupo de adicionais', exact: true });
  await group.getByLabel('Nome do grupo').fill(groupName);
  await group.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(group).not.toBeVisible();
  await groups.getByRole('button', { name: 'Novo adicional', exact: true }).click();
  const addon = page.getByRole('dialog', { name: 'Novo adicional', exact: true });
  await addon.getByLabel('Nome do adicional').fill('Gelo especial');
  await addon.getByLabel('Preço do adicional').fill('1,50');
  await addon.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(addon).not.toBeVisible();
  await groups.getByRole('button', { name: 'Fechar', exact: true }).click();
  await product.getByRole('button', { name: 'Vincular grupo', exact: true }).click();
  const link = page.getByRole('dialog', { name: 'Vincular grupo de adicionais', exact: true });
  await link.getByRole('combobox', { name: 'Grupo de adicionais', exact: true }).fill(groupName);
  await page.getByRole('option', { name: groupName, exact: true }).click();
  await link.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(product.getByText('Gelo especial · R$ 1,50')).toBeVisible();
  await product.getByRole('tab', { name: 'Estoques e locais', exact: true }).click();
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count())
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.screenshot({ path: 'docs/screenshots/produto-gestao-centralizada.png' });
  const saved = (await staffApi(request, '/products')).find((p: any) => p.name === name);
  const info = await staffApi(request, `/products/${saved.id}/management`);
  expect(info.balances).toHaveLength(2);
  expect(info.variants[0].stock_mode).toBe('OWN');
  expect(info.recipe_items[0].quantity).toBe('0.050');
  expect(info.links).toHaveLength(1);
  await product.getByRole('tab', { name: 'Geral', exact: true }).click();
  await product
    .getByLabel('Descrição', { exact: true })
    .fill('Descrição temporária para revisar a prévia.');
  await expect(product.locator('.product-context-card')).toContainText('Descrição temporária');
  await product.getByRole('tab', { name: 'Estoque e produção', exact: true }).click();
  await product
    .getByRole('combobox', { name: 'Baixa de estoque', exact: true })
    .fill('Na produção');
  await page.getByRole('option', { name: 'Na produção', exact: true }).click();
  await expect(product.locator('.product-overview')).toContainText('Produção · bar');
  await expect(
    product.getByText(
      'A baixa Na produção exige preparo, mesmo com a opção Exige produção desligada.',
    ),
  ).toBeVisible();
  await product.getByRole('combobox', { name: 'Baixa de estoque', exact: true }).fill('Na entrega');
  await page.getByRole('option', { name: 'Na entrega', exact: true }).click();
  await product.getByRole('tab', { name: 'Geral', exact: true }).click();
  await product.getByRole('button', { name: 'Configurar preços', exact: true }).click();
  await expect(
    product.getByRole('tab', { name: 'Preços e variações', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await product.getByRole('searchbox', { name: 'Buscar variação' }).fill('inexistente');
  await expect(product.getByText('Nenhuma variação corresponde à busca.')).toBeVisible();
  await product.getByRole('searchbox', { name: 'Buscar variação' }).fill('Grande');
  await expect(product.getByRole('button', { name: 'Editar variação Grande' })).toBeVisible();
  await product.getByRole('searchbox', { name: 'Buscar variação' }).fill('');
  const productTabs = [
    'Geral',
    'Preços e variações',
    'Estoque e produção',
    'Estoques e locais',
    'Movimentações',
    'Ficha técnica',
    'Adicionais',
  ];
  for (const [index, tab] of productTabs.entries()) {
    await product.getByRole('tab', { name: tab, exact: true }).click();
    await expect(product.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
    expect(await product.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `.local/screenshots/produto-aba-${index}-desktop.png` });
  }
  await product.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Descartar alterações?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await product.getByRole('tab', { name: 'Geral', exact: true }).click();
  await expect(product.getByLabel('Descrição', { exact: true })).toHaveValue(
    'Descrição temporária para revisar a prévia.',
  );
  await product.getByLabel('Descrição', { exact: true }).fill(info.product.description ?? '');
  await product.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await page.getByRole('button', { name: 'Estoque', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar no estoque' }).fill(name);
  await page
    .getByRole('row')
    .filter({ hasText: 'Grande' })
    .getByRole('button', { name: 'Gerenciar produto', exact: true })
    .click();
  await expect(
    product.getByRole('tab', { name: 'Estoques e locais', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  expect(await product.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/produto-gestao-mobile.png' });
  for (const [index, tab] of productTabs.entries()) {
    await product.getByRole('tab', { name: tab, exact: true }).click();
    await expect(product.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
    expect(await product.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `.local/screenshots/produto-aba-${index}-mobile.png` });
  }
  await product.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'Grande' })
    .getByRole('button', { name: 'Gerenciar produto', exact: true })
    .click();
  for (const tab of productTabs) {
    await product.getByRole('tab', { name: tab, exact: true }).click();
    expect(await product.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: '.local/screenshots/produto-mobile-dark.png' });
  await page.setViewportSize({ width: 320, height: 844 });
  for (const tab of productTabs) {
    await product.getByRole('tab', { name: tab, exact: true }).click();
    expect(await product.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
});

test('gestor só de catálogo edita preço sem alterar a origem de estoque da variação', async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 6),
    account = 'catalog-' + suffix + '@test.local';
  const role = await staffApi(request, '/roles', {
    name: 'Catálogo ' + suffix,
    permissions: ['catalog.manage'],
  });
  await staffApi(request, '/staff', {
    name: 'Gestor de catálogo',
    email: account,
    password,
    role_id: role.id,
  });
  const location = await staffApi(request, '/stock-locations', {
    name: 'Origem restrita ' + suffix,
    is_default: false,
  });
  const product = await staffApi(request, '/products', {
    name: 'Catálogo restrito ' + suffix,
    price: '10.00',
    enabled: true,
    stock_policy: 'ON_DELIVERY',
    stock_location_id: location.id,
  });
  const variant = await staffApi(request, '/product-variants', {
    product_id: product.id,
    name: 'Especial ' + suffix,
    price: '15.00',
    enabled: true,
    stock_mode: 'OWN',
    stock_location_id: location.id,
  });
  await login(page, 35173, account, true);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await page.getByRole('button', { name: 'Editar ' + product.name, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await expect(editor.getByRole('tab', { name: 'Estoques e locais', exact: true })).toHaveCount(0);
  await editor.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Editar variação ' + variant.name, exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Editar variação', exact: true });
  await expect(
    form.getByRole('combobox', { name: 'Local de baixa da variação', exact: true }),
  ).toHaveCount(0);
  await form.getByLabel('Preço da variação').fill('17,50');
  await form.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(form).not.toBeVisible();
  const saved = (await staffApi(request, '/product-variants')).find(
    (v: any) => v.id === variant.id,
  );
  expect(saved.price).toBe('17.50');
  expect(saved.stock_location_id).toBe(location.id);
  expect(saved.stock_mode).toBe('OWN');
});

test('financeiro do titular reúne receita, saldo, caixa e filtros em desktop e celular', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const suffix = randomUUID().slice(0, 6);
  const unit = await staffApi(request, '/establishments', {
    name: 'Unidade financeira de teste ' + suffix,
  });
  const response = await request.post('http://127.0.0.1:33000/api/v1/auth/login', {
    data: { email, password, establishment_slug: unit.slug },
  });
  expect(response.ok()).toBeTruthy();
  const ownSession = { ...(await response.json()), slug: unit.slug };
  const call = async (path: string, body?: unknown) => {
    const r = await request.fetch(`http://127.0.0.1:33000/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${ownSession.token}`, 'Idempotency-Key': randomUUID() },
      ...(body === undefined ? {} : { data: body }),
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const product = await call('/products', {
    name: 'Produto financeiro UI',
    price: '10.00',
    stock_policy: 'NO_CONTROL',
    sector: 'bar',
  });
  const tables = await call('/tables');
  const order = await call('/orders', {
    table_id: tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 3, modifiers: [] }],
  });
  const confirmed = await call(`/orders/${order.id}/confirm`, {});
  const registers = await call('/cash-registers');
  const cash = await call('/cash/sessions', {
    register_id: registers[0].id,
    opening_amount: '100.00',
  });
  const payment = await call('/payments/manual', {
    method: 'CASH',
    cash_session_id: cash.id,
    allocations: [{ tab_id: confirmed.tab_id, amount: '20.00' }],
  });
  await call(`/payments/${payment.id}/refund`, {
    amount: '5.00',
    tab_id: confirmed.tab_id,
    cash_session_id: cash.id,
    reason: 'Estorno teste financeiro UI',
  });
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.goto('http://127.0.0.1:35173');
  await page.evaluate(
    (value) => sessionStorage.setItem('bar-staff', JSON.stringify(value)),
    ownSession,
  );
  await page.goto('http://127.0.0.1:35173/financeiro');
  await expect(page.getByRole('heading', { name: 'Financeiro', exact: true })).toBeVisible();
  await expect(
    page
      .locator('.finance-kpi')
      .filter({ has: page.getByText('Faturamento líquido', { exact: true }) }),
  ).toContainText('R$ 30,00');
  await expect(page.locator('.finance-kpi').filter({ hasText: 'Recebido líquido' })).toContainText(
    'R$ 15,00',
  );
  await expect(page.locator('.finance-kpi').filter({ hasText: 'Em aberto agora' })).toContainText(
    'R$ 15,00',
  );
  await expect(page.locator('.finance-cash-total')).toContainText('R$ 115,00');
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await expect(page.locator('.finance-donut').first()).toHaveCSS(
    'background-image',
    /conic-gradient/,
  );
  await page.screenshot({ path: 'docs/screenshots/financeiro-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Suprimento', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Valor', { exact: true }).fill('10,00');
  await page
    .getByRole('dialog')
    .getByLabel('Motivo', { exact: true })
    .fill('Suprimento financeiro UI');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.finance-cash-total')).toContainText('R$ 125,00');
  await page.getByRole('tab', { name: 'Pagamentos', exact: true }).click();
  await expect(page).toHaveURL(/aba=payments/);
  await expect(page.locator('.finance-records tbody')).toContainText('R$ 5,00');
  await page.getByLabel('Forma ou tipo financeiro').selectOption('CASH');
  await expect(page.locator('.finance-records tbody tr')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar página' }).click();
  expect((await download).suggestedFilename()).toContain('financeiro-payments');
  await page.getByRole('tab', { name: 'Contas a receber', exact: true }).click();
  await expect(page.locator('.finance-records tbody')).toContainText('R$ 15,00');
  await page.getByRole('tab', { name: 'Vendas', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar no financeiro' }).fill(order.id);
  await expect(page.locator('.finance-records tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: /Detalhes do pedido/ }).click();
  await expect(page.getByRole('dialog')).toContainText('R$ 30,00');
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('tab', { name: 'Caixa', exact: true }).click();
  await expect(page.locator('.finance-records tbody')).toContainText('Suprimento financeiro UI');
  await page.getByRole('button', { name: 'Fechar caixa', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Dinheiro contado').fill('124,00');
  await page.getByRole('button', { name: 'Confirmar fechamento', exact: true }).click();
  await expect(page.locator('.finance-state')).toContainText('Sem turno aberto');
  await page.getByRole('tab', { name: 'Fechamentos', exact: true }).click();
  await expect(page.locator('.finance-records tbody')).toContainText('-R$ 1,00');
  await page.getByRole('tab', { name: 'Fluxo de recebimentos', exact: true }).click();
  await expect(page.locator('.finance-flow-days')).toContainText('R$ 15,00');
  // Another unit of the same account is readable but cannot receive mutations using this session.
  await page.getByRole('combobox', { name: 'Unidade financeira' }).click();
  await page.getByRole('option', { name: 'Boteco da Esquina', exact: true }).click();
  await expect(
    page.locator('.finance-cash').getByRole('button', { name: 'Fechar caixa', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Para movimentar este caixa, entre na unidade correspondente.'),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Unidade financeira' }).click();
  await page.getByRole('option', { name: unit.name, exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
  await expect(page.locator('.finance-kpi')).toHaveCount(5);
  await expect(page.locator('.finance-records tbody tr')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Fechar notificação', exact: true })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('heading', { name: 'Financeiro', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/financeiro-mobile.png', fullPage: true });
  await page.getByLabel('Atalho de período').selectOption('yesterday');
  await expect(page.getByText('Nenhum registro encontrado para estes filtros.')).toBeVisible();
  await expect(page.locator('.finance-kpi').filter({ hasText: 'Em aberto agora' })).toContainText(
    'R$ 15,00',
  );
  expect(unit.id).toBeTruthy();
  expect(errors).toEqual([]);
});

test('recebimento Pix da mesa entra no turno selecionado e aparece separado do dinheiro físico no financeiro', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: 'PIX-' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const register = await staffApi(request, '/cash-registers', {
    name: 'Caixa Pix ' + randomUUID().slice(0, 5),
  });
  const cash = await staffApi(request, '/cash/sessions', {
    register_id: register.id,
    opening_amount: '0.00',
  });
  const draft = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 12, modifiers: [] }],
  });
  const order = await staffApi(request, `/orders/${draft.id}/confirm`, {});
  expect(order.cash_session_id).toBe(cash.id);
  await login(page, 35173);
  await page.goto(`http://127.0.0.1:35173/salao/atendimento/${table.id}`);
  const management = page.getByRole('dialog', { name: 'Mesa ' + table.number, exact: true });
  await management.getByRole('button', { name: 'Adicionar pagamento', exact: true }).click();
  const receiving = page.getByRole('dialog', { name: 'Registrar recebimento', exact: true });
  await expect(
    receiving.getByRole('combobox', { name: 'Turno de caixa', exact: true }),
  ).toHaveValue(register.name + ' · Turno ' + cash.id.slice(0, 8));
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith('/payments/manual') && r.method() === 'POST',
  );
  await receiving.getByRole('button', { name: 'Salvar', exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    method: 'PIX_MANUAL',
    cash_session_id: cash.id,
  });
  await expect(receiving).toHaveCount(0);
  const sessions = await staffApi(request, '/cash/sessions');
  expect(sessions.find((s: any) => s.id === cash.id)).toMatchObject({
    pix_sales: '60.00',
    expected_amount: '0.00',
  });
  await page.goto('http://127.0.0.1:35173/financeiro');
  const card = page.locator('.finance-cash');
  await expect(
    card.locator('.finance-money-list > div').filter({ hasText: 'Pix recebido' }),
  ).toContainText('R$ 60,00');
  await expect(card.locator('.finance-cash-received')).toContainText('R$ 60,00');
  await expect(card.locator('.finance-cash-total')).toContainText('Dinheiro físico esperado');
  await expect(card.locator('.finance-cash-total')).toContainText('R$ 0,00');
});

test('administrador local com todas as permissões não acessa o painel financeiro da conta', async ({
  page,
  request,
}) => {
  const account = `admin-local-finance-${randomUUID()}@test.local`;
  await staffApi(request, '/staff', {
    name: 'Admin local financeiro',
    email: account,
    password,
    role_id: fixture.roles.find((r: any) => r.name === 'Administrador').id,
  });
  await login(page, 35173, account);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Painel financeiro', exact: true })).toHaveCount(0);
  await page.goto(`http://127.0.0.1:35173/${fixture.slug}/financeiro`);
  await expect(
    page.getByRole('heading', { name: 'Tela não encontrada ou sem acesso' }),
  ).toBeVisible();
  const auth = await request.post('http://127.0.0.1:33000/api/v1/auth/login', {
    data: { email: account, password, establishment_slug: slug },
  });
  expect(auth.ok()).toBeTruthy();
  const session = await auth.json();
  expect(session.actor.isAccountAdmin).toBe(false);
  const report = await request.get(
    'http://127.0.0.1:33000/api/v1/finance/dashboard?start=2026-10-01&end=2026-10-28',
    { headers: { authorization: `Bearer ${session.token}` } },
  );
  expect(report.status()).toBe(403);
});

test('financeiro recupera as unidades após falha temporária sem manter erro antigo', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/v1/finance/context', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Unidades temporariamente indisponíveis' } }),
        })
      : route.continue(),
  );
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/financeiro');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Unidades temporariamente indisponíveis' }),
  ).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Unidades temporariamente indisponíveis' }),
  ).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Unidade financeira' }).click();
  await expect(page.getByRole('option', { name: 'Boteco da Esquina', exact: true })).toBeVisible();
});

test('revisão em modal mostra pendências, preserva rascunho e finaliza a mesa em uma ação', async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const table = await staffApi(request, '/tables', {
    number: `REV-${randomUUID().slice(0, 5)}`,
    capacity: 4,
  });
  const draft = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 1, modifiers: [] }],
  });
  const order = await staffApi(request, `/orders/${draft.id}/confirm`, {});
  await page.setViewportSize({ width: 1536, height: 1000 });
  await login(page, 35173);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  if (await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).count())
    await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await page.goto(`http://127.0.0.1:35173/salao/atendimento/${table.id}`);
  const management = page.getByRole('dialog', { name: `Mesa ${table.number}`, exact: true });
  const closeButton = management.getByRole('button', { name: 'Encerrar atendimento', exact: true });
  await expect(closeButton).not.toHaveClass(/is-ready/);
  await closeButton.click();
  const review = page.getByRole('dialog', {
    name: `Revisão de fechamento · Mesa ${table.number}`,
    exact: true,
  });
  await expect(
    review.getByRole('heading', { name: 'Resolva as pendências antes de finalizar' }),
  ).toBeVisible();
  await expect(
    review.getByRole('button', { name: 'Finalizar e liberar mesa', exact: true }),
  ).toHaveCount(0);
  await expect(review).toContainText('1 ficha(s) ainda precisam ser entregues ou canceladas.');
  expect((await staffApi(request, `/tables/${table.id}/session`)).session.status).toBe('OPEN');
  await page.screenshot({ path: 'docs/screenshots/fechamento-pendencias.png' });
  await review.getByRole('button', { name: 'Receber saldo', exact: true }).click();
  const receiving = page.getByRole('dialog', { name: 'Registrar recebimento', exact: true });
  await expect(receiving.getByLabel('Valor a receber')).toHaveValue('5,00');
  await receiving.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(
    review
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Comandas e pagamentos', exact: true }) }),
  ).toContainText('Tudo certo');
  await review.getByRole('button', { name: 'Resolver entregas', exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(management.getByRole('tab', { name: 'Entregas', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await management.getByRole('button', { name: 'Entregar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar entrega ao cliente', exact: true }).click();
  await expect(closeButton).toHaveClass(/is-ready/);
  expect(
    await closeButton.evaluate((button) => getComputedStyle(button, '::before').animationName),
  ).toBe('attendance-ready-left');
  expect(
    await closeButton.evaluate((button) => getComputedStyle(button, '::after').animationName),
  ).toBe('attendance-ready-right');
  await closeButton.screenshot({
    path: 'docs/screenshots/fechamento-pulse.png',
    animations: 'disabled',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await closeButton.evaluate((button) => getComputedStyle(button, '::before').animationName),
  ).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // The server is ready, but a local unsaved cart must remain protected.
  await management.getByRole('button', { name: /^Água mineral/ }).click();
  await expect(closeButton).not.toHaveClass(/is-ready/);
  await closeButton.click();
  await expect(review).toContainText('Há um pedido em montagem nesta tela');
  await expect(
    review.getByRole('button', { name: 'Finalizar e liberar mesa', exact: true }),
  ).toHaveCount(0);
  await review.getByRole('button', { name: 'Voltar ao pedido', exact: true }).click();
  await expect(
    management.getByRole('heading', { name: 'Resumo do pedido', exact: true }),
  ).toBeVisible();
  await management.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(closeButton).toHaveClass(/is-ready/);
  await closeButton.click();
  await expect(review.getByRole('heading', { name: 'Tudo certo para finalizar' })).toBeVisible();
  await expect(
    review.getByRole('button', { name: 'Finalizar e liberar mesa', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Fechar notificação', exact: true })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  await page.screenshot({ path: 'docs/screenshots/fechamento-pronto.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(
    review.getByRole('button', { name: 'Finalizar e liberar mesa', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'docs/screenshots/fechamento-mobile.png' });
  await review.getByRole('button', { name: 'Finalizar e liberar mesa', exact: true }).click();
  await expect(page).toHaveURL(/\/salao$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Mesa finalizada e liberada.', { exact: true })).toBeVisible();
  const result = await staffApi(request, `/tables/${table.id}/session`);
  expect(result.session).toBeNull();
  const tabs = await database.view(fixture.actor).list('tabs', database.sql`id=${order.tab_id}`);
  expect(tabs[0].status).toBe('CLOSED');
  expect(errors).toEqual([]);
});

test('caixas organizam turno, suprimento, sangria, extrato e conferência no desktop e celular', async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1080 });
  await login(page, 35173);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  if (await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).count())
    await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await page.goto('http://127.0.0.1:35173/caixa');
  await expect(page.getByRole('heading', { name: 'Caixas', exact: true })).toBeVisible();
  const name = 'Caixa balcão ' + randomUUID().slice(0, 5);
  await page.getByRole('button', { name: 'Novo caixa', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Novo caixa', exact: true });
  await create.getByLabel('Nome do caixa').fill(name);
  await create.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('tab', { name: /^Caixas/ }).click();
  await page.getByRole('searchbox', { name: 'Buscar caixas cadastrados' }).fill(name);
  const card = page
    .locator('.cash-register-grid article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card).toContainText('Disponível');
  await card.getByRole('button', { name: 'Abrir turno neste caixa', exact: true }).click();
  const opening = page.getByRole('dialog', { name: 'Abrir turno de caixa', exact: true });
  await opening.getByLabel('Fundo de abertura').fill('100,00');
  await expect(opening.getByRole('combobox', { name: 'Caixa', exact: true })).toHaveValue(name);
  await opening.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(card).toContainText('Aberto');
  await expect(
    card.getByRole('button', { name: 'Abrir turno neste caixa', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: 'Turnos', exact: true }).click();
  await expect(page.locator('.cash-expected')).toContainText('R$ 100,00');
  await page.getByRole('button', { name: 'Suprimento', exact: true }).click();
  let form = page.getByRole('dialog', { name: 'Registrar suprimento', exact: true });
  await form.getByLabel('Valor do suprimento').fill('30,00');
  await form.getByLabel('Motivo', { exact: true }).fill('Troco para operação E2E');
  await form.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.cash-expected')).toContainText('R$ 130,00');
  await page.getByRole('button', { name: 'Sangria', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Registrar sangria', exact: true });
  await form.getByLabel('Valor da sangria').fill('20,00');
  await form.getByLabel('Motivo', { exact: true }).fill('Retirada conferida E2E');
  await form.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.cash-expected')).toContainText('R$ 110,00');
  const sessions = await staffApi(request, '/cash/sessions'),
    cash = sessions.find((s: any) => s.register_name === name && s.status === 'OPEN');
  expect(cash).toBeTruthy();
  const table = await staffApi(request, '/tables', {
    number: 'CX-' + randomUUID().slice(0, 4),
    capacity: 4,
  });
  const draft = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 8, modifiers: [] }],
  });
  const order = await staffApi(request, `/orders/${draft.id}/confirm`, {});
  await staffApi(request, '/payments/manual', {
    method: 'CASH',
    cash_session_id: cash.id,
    allocations: [{ tab_id: order.tab_id, amount: '20.00' }],
  });
  await staffApi(request, '/payments/manual', {
    method: 'PIX_MANUAL',
    cash_session_id: cash.id,
    allocations: [{ tab_id: order.tab_id, amount: '10.00' }],
  });
  await page.getByRole('button', { name: 'Atualizar caixas', exact: true }).click();
  await expect(page.locator('.cash-expected')).toContainText('R$ 130,00');
  await expect(page.locator('.cash-digital').first()).toContainText('R$ 10,00');
  await page.getByRole('searchbox', { name: 'Buscar turnos de caixa' }).fill(name);
  await expect(page.locator('.cash-history tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Fechar notificação', exact: true })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  await page.getByRole('heading', { name: 'Histórico de turnos', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('heading', { name: 'Caixas', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/caixas-desktop.png', fullPage: true });
  await page
    .locator('.cash-history')
    .getByRole('button', { name: /Ver extrato do turno/ })
    .click();
  let detail = page.getByRole('dialog', { name: /^Extrato ·/ });
  await expect(detail).toContainText('Troco para operação E2E');
  await expect(detail).toContainText('Retirada conferida E2E');
  await detail.getByRole('button', { name: 'Fechar consulta', exact: true }).click();
  await page.getByRole('tab', { name: /^Movimentações/ }).click();
  await page.getByLabel('Tipo de movimentação', { exact: true }).selectOption('WITHDRAWAL');
  await page
    .getByRole('searchbox', { name: 'Buscar movimentações de caixa' })
    .fill('Retirada conferida E2E');
  await expect(page.locator('.cash-movements tbody tr')).toHaveCount(1);
  await expect(page.locator('.cash-movements tbody')).toContainText('-R$ 20,00');
  await page.getByRole('tab', { name: 'Turnos', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect
    .poll(async () => page.locator('.sidebar').evaluate((n) => n.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'docs/screenshots/caixas-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Encerrar turno', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Encerrar turno de caixa', exact: true });
  await expect(form).toContainText('R$ 130,00');
  await form.getByLabel('Dinheiro contado no fechamento').fill('125,00');
  await form.getByRole('button', { name: 'Encerrar turno', exact: true }).click();
  await expect(page.locator('.cash-history tbody')).toContainText('-R$ 5,00');
  await page
    .locator('.cash-history')
    .getByRole('button', { name: /Ver extrato do turno/ })
    .click();
  detail = page.getByRole('dialog', { name: /^Extrato ·/ });
  await expect(detail).toContainText('Encerrado por Antonio');
  await expect(detail.locator('.cash-detail-totals')).toContainText('R$ 125,00');
  await expect(detail.getByRole('button', { name: 'Encerrar turno', exact: true })).toHaveCount(0);
  expect(await detail.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  await detail.getByRole('button', { name: 'Fechar consulta', exact: true }).click();
  await page.getByRole('tab', { name: /^Caixas/ }).click();
  await card.getByRole('button', { name: 'Editar caixa ' + name, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar caixa', exact: true });
  await edit.getByLabel('Nome do caixa').fill(name + ' Centro');
  await edit.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('heading', { name: name + ' Centro', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Turnos', exact: true }).click();
  await page.getByLabel('Situação do turno', { exact: true }).selectOption('OPEN');
  await expect(
    page.getByText('Nenhum turno encontrado para estes filtros.', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('cupons por pedido e comanda baixam PDF, abrem impressão e chegam à térmica pelo agente', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const net = await import('node:net'),
    { spawn } = await import('node:child_process'),
    fs = await import('node:fs/promises');
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (b) => chunks.push(Buffer.from(b)));
    socket.on('end', () => {
      received.push(Buffer.concat(chunks));
      socket.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  let agent: ReturnType<typeof spawn> | undefined;
  try {
    const printer = await staffApi(request, '/printers', {
      name: 'Térmica cupons teste',
      sector: 'conta-cupom',
    });
    const issued = await staffApi(request, '/print/agents', { name: 'Agente local de cupons E2E' });
    agent = spawn(process.execPath, ['--import', 'tsx', 'apps/print-agent/src/index.ts'], {
      env: {
        ...process.env,
        PRINT_API_URL: 'http://127.0.0.1:33000/api/v1',
        PRINT_AGENT_TOKEN: issued.token,
        PRINT_PRINTERS_JSON: JSON.stringify({
          [printer.id]: { host: '127.0.0.1', port: address.port },
        }),
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const table = await staffApi(request, '/tables', {
      number: 'CP-' + randomUUID().slice(0, 4),
      capacity: 4,
    });
    const draft = await staffApi(request, '/orders', {
      table_id: table.id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [
        {
          product_id: fixture.products[1].id,
          quantity: 2,
          modifiers: [],
          notes: 'Sem gelo. Cupom de teste.',
        },
      ],
    });
    const order = await staffApi(request, `/orders/${draft.id}/confirm`, {});
    await staffApi(request, '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '4.00' }],
    });
    await login(page, 35173);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    if (await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).count())
      await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(`http://127.0.0.1:35173/pedidos/${order.id}`);
    await page.getByRole('button', { name: 'Cupom do pedido', exact: true }).click();
    let receipt = page.getByRole('dialog', { name: 'Cupom do pedido', exact: true });
    async function expectPaperHeight() {
      const dimensions = await receipt.locator('.receipt-preview').evaluate((viewport) => {
        const paper = viewport.querySelector('pre')!;
        return {
          content: paper.scrollHeight,
          paper: paper.clientHeight,
          viewport: viewport.clientHeight,
        };
      });
      // The white paper must contain the entire receipt, even when its viewport scrolls.
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.paper + 1);
      expect(dimensions.viewport).toBeLessThanOrEqual(440);
    }
    await expect(receipt.getByLabel('Prévia do cupom')).toContainText('Água mineral');
    await expect(receipt.getByLabel('Prévia do cupom')).toContainText('TOTAL');
    await expectPaperHeight();
    await page.screenshot({ path: 'docs/screenshots/cupom-altura-corrigida-80mm.png' });
    await receipt.getByRole('button', { name: 'Visualizar PDF', exact: true }).click();
    let pdfPreview = page.getByRole('dialog', { name: 'Prévia PDF do pedido', exact: true });
    await expect(
      pdfPreview.getByRole('img', { name: 'Página 1 do PDF', exact: true }),
    ).toBeVisible();
    let downloaded = page.waitForEvent('download');
    await pdfPreview.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
    let file = await downloaded;
    expect(file.suggestedFilename()).toContain('-80mm.pdf');
    await file.saveAs('tmp/pdfs/e2e-pedido-80.pdf');
    expect((await fs.readFile('tmp/pdfs/e2e-pedido-80.pdf')).subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    await pdfPreview.getByRole('button', { name: 'Fechar prévia', exact: true }).click();
    await receipt.getByLabel('Largura do cupom').selectOption('58');
    await expect(receipt.getByLabel('Prévia do cupom')).toContainText('Sem gelo.');
    await expectPaperHeight();
    await receipt.getByRole('button', { name: 'Visualizar PDF', exact: true }).click();
    pdfPreview = page.getByRole('dialog', { name: 'Prévia PDF do pedido', exact: true });
    await expect(
      pdfPreview.getByRole('img', { name: 'Página 1 do PDF', exact: true }),
    ).toBeVisible();
    downloaded = page.waitForEvent('download');
    await pdfPreview.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
    file = await downloaded;
    expect(file.suggestedFilename()).toContain('-58mm.pdf');
    await file.saveAs('tmp/pdfs/e2e-pedido-58.pdf');
    await pdfPreview.getByRole('button', { name: 'Fechar prévia', exact: true }).click();
    await page.evaluate(() => {
      const original = window.open.bind(window);
      window.open = (...args: Parameters<typeof window.open>) => {
        const popup = original(...args);
        if (popup)
          popup.print = () => {
            popup.document.documentElement.setAttribute('data-print-called', 'yes');
          };
        return popup;
      };
    });
    const popupPromise = page.waitForEvent('popup');
    await receipt.getByRole('button', { name: 'Imprimir pelo navegador', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup.locator('html')).toHaveAttribute('data-print-called', 'yes');
    await expect(popup.locator('body')).toContainText('CUPOM NAO FISCAL');
    await popup.close();
    await receipt.getByRole('button', { name: 'Fechar cupom', exact: true }).click();
    await page.getByRole('button', { name: 'Cupom da comanda', exact: true }).click();
    receipt = page.getByRole('dialog', { name: 'Cupom da comanda', exact: true });
    await expect(receipt.getByLabel('Prévia do cupom')).toContainText('R$ 6,00');
    await expect(receipt.getByLabel('Prévia do cupom')).toContainText('Recebido liquido');
    await receipt
      .getByRole('combobox', { name: 'Impressora do cupom', exact: true })
      .fill('Térmica cupons teste');
    await page
      .getByRole('option', { name: 'Térmica cupons teste · conta-cupom', exact: true })
      .click();
    await receipt.getByRole('button', { name: 'Enviar para térmica', exact: true }).click();
    await expect(
      receipt.getByRole('status').filter({ hasText: 'Envio ao dispositivo concluído.' }),
    ).toBeVisible({ timeout: 20000 });
    await expect.poll(() => received.length).toBe(1);
    expect(received[0].toString()).toContain('CUPOM NAO FISCAL');
    expect(received[0].toString()).toContain('Comanda');
    expect(received[0].toString()).toContain('R$ 6,00');
    expect(received[0].includes(Buffer.from([0x1d, 0x56, 0]))).toBe(true);
    await expect(page.getByRole('button', { name: 'Fechar notificação', exact: true })).toHaveCount(
      0,
      { timeout: 10000 },
    );
    await page.screenshot({ path: 'docs/screenshots/cupom-comanda-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await receipt.getByLabel('Largura do cupom').selectOption('58');
    await expect(receipt.getByLabel('Prévia do cupom')).toBeVisible();
    await expectPaperHeight();
    expect(await receipt.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
    await expect(
      receipt.getByRole('button', { name: 'Visualizar PDF', exact: true }),
    ).toBeInViewport({
      ratio: 1,
    });
    await page.screenshot({ path: 'docs/screenshots/cupom-mobile.png' });
    await receipt.getByRole('button', { name: 'Fechar cupom', exact: true }).click();
    const details = await staffApi(request, `/orders/${order.id}`);
    for (const t of details.tickets) {
      const d = await staffApi(request, `/tickets/${t.id}`);
      await staffApi(request, `/tickets/${t.id}/redeem`, { token: d.token });
    }
    await staffApi(request, '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: order.tab_id, amount: '6.00' }],
    });
    const service = await staffApi(request, `/tables/${table.id}/session`);
    await staffApi(request, `/tables/${table.id}/finalize`, { session_id: service.session.id });
    await page.reload();
    await page.getByRole('button', { name: 'Cupom da comanda', exact: true }).click();
    receipt = page.getByRole('dialog', { name: 'Cupom da comanda', exact: true });
    await expect(receipt.getByLabel('Prévia do cupom')).toContainText('Comanda encerrada');
    await expect(receipt.getByLabel('Prévia do cupom')).toContainText('R$ 0,00');
    expect(errors).toEqual([]);
  } finally {
    agent?.kill('SIGTERM');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('pagamentos organizam recebimentos, filtram por comanda e preservam o estorno parcial no desktop e celular', async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const table = await staffApi(request, '/tables', {
    number: 'P' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[3].id, quantity: 3, modifiers: [] }],
  });
  const confirmed = await staffApi(request, `/orders/${order.id}/confirm`, {});
  const payment = await staffApi(request, '/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: confirmed.tab_id, amount: '10.00' }],
  });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/pagamentos');
  await expect(page.getByRole('heading', { name: 'Pagamentos', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar pagamentos' }).fill(table.number);
  const row = page
    .getByRole('table', { name: 'Lista de pagamentos' })
    .locator('tbody tr')
    .filter({ hasText: '#' + payment.id.slice(0, 6).toUpperCase() });
  await expect(row).toContainText('Pix manual');
  await expect(row).toContainText('Mesa ' + table.number);
  expect(await row.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(65);
  await row.getByRole('button', { name: /Ver pagamento/ }).click();
  const detail = page.getByRole('dialog', {
    name: 'Pagamento #' + payment.id.slice(0, 6).toUpperCase(),
    exact: true,
  });
  await expect(
    detail.getByText('Nenhum estorno registrado neste recebimento.', { exact: true }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Estornar pagamento', exact: true }).click();
  let refund = page.getByRole('dialog', { name: 'Estornar pagamento', exact: true });
  await refund.getByRole('textbox', { name: 'Valor do estorno', exact: true }).fill('11,00');
  await refund.getByLabel('Motivo do estorno').fill('Ajuste de teste da tela de pagamentos');
  await refund.getByRole('button', { name: 'Confirmar estorno', exact: true }).click();
  await expect(refund.getByRole('alert')).toContainText('até');
  await refund.getByRole('textbox', { name: 'Valor do estorno', exact: true }).fill('3,00');
  await refund.getByRole('button', { name: 'Confirmar estorno', exact: true }).click();
  await expect(refund).toHaveCount(0);
  await expect(detail).toContainText('Estorno parcial');
  await expect(detail).toContainText('Ajuste de teste da tela de pagamentos');
  await expect(detail.locator('.payment-amounts')).toContainText('R$ 7,00');
  await detail.getByRole('button', { name: 'Fechar detalhes', exact: true }).click();
  await expect(row).toContainText('Estorno parcial');
  await expect(page.getByLabel('Resumo dos pagamentos filtrados')).toContainText('R$ 7,00');
  await page.getByRole('tab', { name: /Com estorno/ }).click();
  await expect(row).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const csv = await download;
  const fs = await import('node:fs/promises');
  const text = await fs.readFile((await csv.path())!, 'utf8');
  expect(text).toContain('7.00');
  expect(text).toContain(table.number);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'docs/screenshots/pagamentos-desktop.png', fullPage: true });
  await page.getByRole('searchbox', { name: 'Buscar pagamentos' }).fill('inexistente-xyz');
  await expect(
    page.getByText(
      'Nenhum pagamento corresponde aos filtros. Ajuste a busca ou limpe os filtros.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((n) => n.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/screenshots/pagamentos-mobile.png', fullPage: true });
  await row.getByRole('button', { name: /Estornar pagamento/ }).click();
  refund = page.getByRole('dialog', { name: 'Estornar pagamento', exact: true });
  await refund.getByLabel('Motivo do estorno').fill('Não perder os dados');
  await refund.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('alterações');
  await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  expect(await refund.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pagamento-estorno-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('detalhe do pedido exibe ficha no próprio modal, troca códigos, reimprime e atualiza a entrega', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const product = await staffApi(request, '/products', {
    name: 'Suco do pedido ' + randomUUID().slice(0, 4),
    price: '12.50',
    stock_policy: 'NO_CONTROL',
    sector: 'bar',
  });
  const table = await staffApi(request, '/tables', {
    number: 'D' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 3, modifiers: [], notes: 'Sem gelo' }],
  });
  await staffApi(request, `/orders/${order.id}/confirm`, {});
  const tickets = (await staffApi(request, `/orders/${order.id}`)).tickets;
  const first = await staffApi(request, '/tickets/' + tickets[0].id);
  await staffApi(request, '/tickets/' + first.id + '/redeem', { token: first.token });
  await staffApi(request, '/printers', { name: 'Térmica isolada do modal', sector: 'bar' });
  const ref = '#' + order.id.slice(0, 6).toUpperCase();
  await login(page, 35173);
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await page.goto(`http://127.0.0.1:35173/salao/atendimento/${table.id}`);
  const attendance = page.getByRole('dialog', { name: 'Mesa ' + table.number, exact: true });
  await attendance.getByRole('button', { name: 'Ver pedido ' + ref, exact: true }).click();
  let detail = page.getByRole('dialog', { name: 'Pedido ' + ref, exact: true });
  await expect(detail.getByLabel('Resumo do pedido')).toContainText('R$ 37,50');
  await expect(
    detail.getByRole('combobox', { name: 'Ficha em visualização', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(detail.getByLabel('Resumo do pedido')).toContainText('1');
  await expect(detail).toContainText('Sem gelo');
  const available = detail
    .locator('.ticket-context-card')
    .filter({ hasText: tickets[1].public_number });
  await available.getByRole('button', { name: 'Ver ficha', exact: true }).click();
  let preview = detail.getByRole('region', { name: 'Ficha selecionada' });
  await expect(preview.getByRole('img', { name: 'QR Code', exact: true })).toHaveAttribute(
    'src',
    /^data:image/,
  );
  await expect(page).toHaveURL(new RegExp(`/salao/atendimento/${table.id}$`));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await detail.locator('.order-detail-main').evaluate((n) => {
    n.scrollTop = 0;
  });
  await page.screenshot({ path: 'docs/screenshots/pedido-detalhe-desktop.png' });
  await preview.getByRole('button', { name: 'Código de barras', exact: true }).click();
  await expect(preview.getByLabel('Código de barras Code 128', { exact: true })).toBeVisible();
  await expect(preview.getByRole('img', { name: 'QR Code', exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Solicitar segunda via', exact: true }).click();
  const reprint = page.getByRole('dialog', { name: 'Solicitar segunda via', exact: true });
  await reprint.getByLabel('Motivo da segunda via').fill('Conferência do modal de pedido');
  await reprint.getByRole('button', { name: 'Solicitar segunda via', exact: true }).click();
  await expect(reprint).toHaveCount(0);
  expect(
    (await staffApi(request, '/print/jobs')).filter(
      (j: any) => j.ticket_id === tickets[1].id && j.is_copy,
    ),
  ).toHaveLength(1);
  await available.getByRole('button', { name: 'Entregar', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmar entrega da ficha', exact: true })
    .getByRole('button', { name: 'Confirmar entrega ao cliente', exact: true })
    .click();
  await expect(preview.getByText('Esta ficha já foi entregue', { exact: true })).toBeVisible();
  await expect(preview.getByLabel('Código de barras Code 128', { exact: true })).toHaveCount(0);
  await expect(detail.getByLabel('Resumo do pedido').locator('.is-delivered strong')).toHaveText(
    '2',
  );
  await detail.getByRole('button', { name: 'Voltar à mesa', exact: true }).click();
  await expect(attendance).toBeVisible();
  await page.goto(`http://127.0.0.1:35173/pedidos/${order.id}`);
  detail = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Pedido ' + ref, exact: false }) });
  await expect(detail).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((n) => n.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await expectMobileModalLayout(detail);
  const last = detail.locator('.ticket-context-card').filter({ hasText: tickets[2].public_number });
  await last.getByRole('button', { name: 'Ver ficha', exact: true }).click();
  preview = detail.getByRole('region', { name: 'Ficha selecionada' });
  await expect(preview.getByRole('img', { name: 'QR Code', exact: true })).toBeVisible();
  await expect(preview.getByRole('img', { name: 'QR Code', exact: true })).toBeInViewport();
  await expect
    .poll(async () => {
      const qr = await preview.getByRole('img', { name: 'QR Code', exact: true }).boundingBox();
      const footer = await detail.locator('.modal-footer').boundingBox();
      return Boolean(qr && footer && qr.y + qr.height <= footer.y);
    })
    .toBe(true);
  await expect(
    detail.getByRole('button', { name: 'Cancelar pedido', exact: true }),
  ).toBeInViewport();
  expect(await detail.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pedido-detalhe-mobile.png' });
  const external = await staffApi(request, '/tickets/' + tickets[2].id);
  await staffApi(request, '/tickets/' + external.id + '/redeem', { token: external.token });
  await expect(detail.getByLabel('Resumo do pedido').locator('.is-delivered strong')).toHaveText(
    '3',
    { timeout: 20000 },
  );
  await expect(preview.getByText('Esta ficha já foi entregue', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('produção compartilha fila clara no painel e na cozinha com filtros, observações e atualização entre operadores', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const kitchenProduct = await staffApi(request, '/products', {
    name: 'Prato da cozinha ' + randomUUID().slice(0, 4),
    price: '20.00',
    stock_policy: 'NO_CONTROL',
    requires_production: true,
    sector: 'cozinha',
  });
  const barProduct = await staffApi(request, '/products', {
    name: 'Suco do bar ' + randomUUID().slice(0, 4),
    price: '8.00',
    stock_policy: 'NO_CONTROL',
    requires_production: true,
    sector: 'bar',
  });
  const table = await staffApi(request, '/tables', {
    number: 'C' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [
      {
        product_id: kitchenProduct.id,
        quantity: 2,
        modifiers: [],
        notes: 'Alergia a amendoim. Molho separado.',
      },
      { product_id: barProduct.id, quantity: 1, modifiers: [], notes: 'Sem gelo' },
    ],
  });
  await staffApi(request, `/orders/${order.id}/confirm`, {});
  const kitchenEmail = 'kitchen-' + randomUUID().slice(0, 8) + '@test.local';
  await staffApi(request, '/staff', {
    name: 'Cozinha de testes',
    email: kitchenEmail,
    password,
    role_id: fixture.roles.find((r: any) => r.name === 'Cozinha').id,
  });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  const ticketReads: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/tickets\//.test(r.url())) ticketReads.push(r.url());
  });
  await page.goto('http://127.0.0.1:35173/producao');
  await expect(page.getByRole('heading', { name: 'Produção', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar na produção', exact: true }).fill(table.number);
  await expect(page.locator('.production-job')).toHaveCount(3);
  await expect(page.getByLabel('Resumo da produção filtrada')).toContainText('3');
  await page.getByRole('combobox', { name: 'Setor da produção', exact: true }).fill('cozinha');
  await page.getByRole('option', { name: 'cozinha', exact: true }).click();
  await expect(page.locator('.production-job')).toHaveCount(2);
  await expect(page.locator('.production-job-notes').first()).toContainText('Alergia a amendoim');
  await page
    .locator('.production-job')
    .first()
    .getByRole('button', { name: 'Iniciar preparo', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Em preparo', exact: true }).locator('.production-job'),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Fechar notificação', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/producao-desktop.png', fullPage: true });
  expect(ticketReads).toEqual([]);
  await page
    .getByRole('searchbox', { name: 'Buscar na produção', exact: true })
    .fill('inexistente-xyz');
  await expect(
    page.getByText('Nenhum item corresponde aos filtros. Ajuste a busca ou limpe os filtros.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    kitchen = await context.newPage();
  kitchen.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(kitchen, 35176, kitchenEmail);
    await expect(kitchen.getByRole('heading', { name: 'Produção', exact: true })).toBeVisible();
    await kitchen
      .getByRole('searchbox', { name: 'Buscar na produção', exact: true })
      .fill(table.number);
    await kitchen
      .getByRole('group', { name: 'Situação da produção', exact: true })
      .getByRole('button', { name: 'Em preparo', exact: true })
      .click();
    await expect(kitchen.locator('.production-job')).toHaveCount(1);
    expect(
      await kitchen.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await kitchen.evaluate(() => window.scrollTo(0, 0));
    await kitchen.screenshot({ path: 'docs/screenshots/producao-mobile.png', fullPage: true });
    const job = (await staffApi(request, '/production/jobs')).find(
      (j: any) => j.order_id === order.id && j.status === 'PREPARING',
    );
    await kitchen.getByRole('button', { name: 'Pronto para entregar', exact: true }).click();
    await expect(
      kitchen.getByText('Item pronto. Ficha liberada para a entrega pelo garçom.', { exact: true }),
    ).toBeVisible();
    expect((await staffApi(request, '/tickets/' + job.ticket_id)).status).toBe('AVAILABLE');
    await expect(
      page.getByRole('region', { name: 'Em preparo', exact: true }).locator('.production-job'),
    ).toHaveCount(0, { timeout: 20000 });
    await page.route('**/api/v1/production/jobs', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Falha de leitura simulada' } }),
      }),
    );
    await page.getByRole('button', { name: 'Recarregar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('últimos dados');
    await page.unroute('**/api/v1/production/jobs');
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('financeiro carrega vendas diretamente da visão geral e movimentações entre abas equivalentes', async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const product = await staffApi(request, '/products', {
    name: 'Regressão das abas financeiras',
    price: '12.00',
    stock_policy: 'NO_CONTROL',
  });
  const table = await staffApi(request, '/tables', {
    number: 'F' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
  });
  await staffApi(request, `/orders/${order.id}/confirm`, {});
  const registers = await staffApi(request, '/cash-registers');
  const cash = await staffApi(request, '/cash/sessions', {
    register_id: registers[0].id,
    opening_amount: '0.00',
  });
  const movementReason = 'Suprimento para regressão de navegação';
  await staffApi(request, '/cash/movements', {
    cash_session_id: cash.id,
    type: 'SUPPLY',
    amount: '5.00',
    reason: movementReason,
  });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/financeiro');
  const reference = '#' + order.id.slice(0, 6).toUpperCase();
  await expect(page.locator('.finance-records tbody')).toContainText(reference);
  // Both tabs request sales with the same untouched filters. Repeat to avoid
  // relying on the periodic refresh accidentally restoring the missing rows.
  for (let pass = 0; pass < 2; pass++) {
    await page.getByRole('tab', { name: 'Vendas', exact: true }).click();
    await expect(page).toHaveURL(/aba=sales/);
    await expect(page.locator('.finance-records tbody')).toContainText(reference, {
      timeout: 4000,
    });
    await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
    await expect(page.locator('.finance-records tbody')).toContainText(reference, {
      timeout: 4000,
    });
  }
  await page.getByRole('tab', { name: 'Caixa', exact: true }).click();
  await expect(page.locator('.finance-records tbody')).toContainText(movementReason);
  await page.getByRole('tab', { name: 'Fluxo de recebimentos', exact: true }).click();
  await expect(page.locator('.finance-records tbody')).toContainText(movementReason, {
    timeout: 4000,
  });
  await page.getByRole('tab', { name: 'Caixa', exact: true }).click();
  await expect(page.locator('.finance-records tbody')).toContainText(movementReason, {
    timeout: 4000,
  });
  await page.getByRole('tab', { name: 'Vendas', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Buscar no financeiro', exact: true })
    .fill('inexistente-xyz');
  await expect(
    page.getByText('Nenhum registro encontrado para estes filtros.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Buscar no financeiro', exact: true }),
  ).toHaveValue('');
  await expect(page.locator('.finance-records tbody')).toContainText(reference);
  await page.getByRole('tab', { name: 'Vendas', exact: true }).click();
  await expect(page.locator('.finance-records tbody')).toContainText(reference);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'docs/screenshots/financeiro-vendas-regressao.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('PrintBridge oficial conecta, imprime PDF e ESC/POS e exige nova via para resultado incerto', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const submissions = new Map<string, { id: string; params: any; state: string }>();
  let uncertain = true;
  await page.routeWebSocket('wss://localhost:17861/v1', (socket) => {
    socket.onMessage((message) => {
      const rpc = JSON.parse(String(message));
      let result: any;
      switch (rpc.method) {
        case 'hello':
          result = { protocolVersion: 1 };
          break;
        case 'pair.request':
          result = { pairingId: 'e2e-native-pairing' };
          break;
        case 'pair.poll':
          result = { token: 'test-only-native-credential' };
          break;
        case 'authenticate':
          result = {};
          break;
        case 'printers.list':
          result = [
            { id: 'native-pdf', name: 'Driver PDF teste', isDefault: true, status: 'unknown' },
            {
              id: 'native-raw',
              name: 'Térmica ESC POS teste',
              isDefault: false,
              status: 'unknown',
            },
          ];
          break;
        case 'jobs.submit': {
          const old = submissions.get(rpc.params.idempotencyKey);
          if (old) expect(rpc.params).toEqual(old.params);
          const record = old ?? {
            id: randomUUID(),
            params: rpc.params,
            state: rpc.params.format === 'escpos' && uncertain ? 'unknown' : 'submitted',
          };
          submissions.set(rpc.params.idempotencyKey, record);
          result = { jobId: record.id };
          break;
        }
        case 'jobs.get': {
          const record = [...submissions.values()].find((item) => item.id === rpc.params.jobId)!;
          result = {
            id: record.id,
            printerId: record.params.printerId,
            state: record.state,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            spoolerId: null,
            error: record.state === 'unknown' ? 'Resultado incerto de teste' : null,
          };
          break;
        }
        default:
          throw new Error('RPC inesperado: ' + rpc.method);
      }
      socket.send(JSON.stringify({ version: 1, id: rpc.id, result }));
    });
  });
  const printers: { id: string; name: string }[] = [],
    products: { id: string }[] = [];
  for (const sector of ['bridge-pdf', 'bridge-raw']) {
    printers.push(await staffApi(request, '/printers', { name: 'Local ' + sector, sector }));
    products.push(
      await staffApi(request, '/products', {
        name: 'Produto ' + sector,
        price: '12.50',
        stock_policy: 'NO_CONTROL',
        sector,
      }),
    );
  }
  const table = await staffApi(request, '/tables', {
    number: 'PB-' + randomUUID().slice(0, 4),
    capacity: 4,
  });
  const draft = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: products.map((product) => ({ product_id: product.id, quantity: 1, modifiers: [] })),
  });
  const order = await staffApi(request, `/orders/${draft.id}/confirm`, {});
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/impressao?aba=printbridge');
  await page.getByRole('button', { name: 'Conectar PrintBridge', exact: true }).click();
  await expect(
    page.getByText('PrintBridge conectado. Confira os vínculos e ative a fila.'),
  ).toBeVisible();
  for (const [index, name] of ['Driver PDF teste', 'Térmica ESC POS teste'].entries()) {
    await page
      .getByRole('combobox', { name: 'Impressora local para ' + printers[index].name })
      .click();
    await page.getByRole('option', { name, exact: false }).click();
  }
  await page.getByLabel('Formato de ' + printers[1].name).selectOption('escpos');
  await page.getByRole('button', { name: 'Ativar fila local', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pausar novos envios', exact: true }),
  ).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name: 'Pedidos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fila local ativa', exact: true })).toBeVisible();
  // A full navigation restores the same persistent station and native authorization.
  await page.goto('http://127.0.0.1:35173/impressao?aba=printbridge');
  await expect(
    page.getByRole('button', { name: 'Pausar novos envios', exact: true }),
  ).toBeVisible();
  const jobs = async () =>
    (await staffApi(request, '/print/jobs')).filter((job: any) =>
      printers.some((printer) => printer.id === job.printer_id),
    );
  await expect
    .poll(
      async () =>
        (await jobs())
          .map((job: any) => job.status)
          .sort()
          .join(','),
      { timeout: 25000 },
    )
    .toBe('COMPLETED,FAILED');
  expect(submissions.size).toBe(2);
  const firstPdf = [...submissions.values()].find((item) => item.params.format === 'pdf')!;
  expect(Buffer.from(firstPdf.params.data, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  expect(firstPdf.params.options.fitToPage).toBe(false);
  await page.getByRole('tab', { name: 'Fila de impressão', exact: true }).click();
  const failed = page
    .locator('.print-queue-table tbody tr')
    .filter({ hasText: 'Resultado incerto' });
  await expect(failed).toHaveCount(1);
  await failed.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmar nova via', exact: true });
  await expect(confirm).toContainText('Confira a fila do sistema e a saída física');
  await confirm
    .getByLabel('Motivo da nova via', { exact: false })
    .fill('Saída e fila verificadas no ambiente simulado');
  uncertain = false;
  await confirm.getByRole('button', { name: 'Solicitar nova via', exact: true }).click();
  await expect
    .poll(async () => (await jobs()).every((job: any) => job.status === 'COMPLETED'), {
      timeout: 20000,
    })
    .toBe(true);
  expect(submissions.size).toBe(3);
  const copy = [...submissions.values()].filter((item) => item.params.format === 'escpos').at(-1)!;
  expect(Buffer.from(copy.params.data, 'base64').toString('ascii')).toContain('SEGUNDA VIA');
  const receipt = await staffApi(request, `/orders/${order.id}/receipt/print`, {
    printer_id: printers[0].id,
    paper_width: 58,
  });
  await expect
    .poll(async () => (await jobs()).find((job: any) => job.id === receipt.id)?.status, {
      timeout: 15000,
    })
    .toBe('COMPLETED');
  const receiptPdf = [...submissions.values()].at(-1)!;
  expect(Buffer.from(receiptPdf.params.data, 'base64').toString('latin1')).toMatch(
    /\/MediaBox \[0 0 164\.\d+/,
  );
  expect((await staffApi(request, `/orders/${order.id}`)).tickets).toHaveLength(2);
  await page.getByRole('tab', { name: 'PrintBridge', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'PrintBridge', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count())
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.screenshot({ path: 'docs/screenshots/printbridge-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/printbridge-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('equipe identifica, filtra, altera perfil e confirma desativação sem perder contexto no celular', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/equipe');
  await expect(page.getByRole('heading', { name: 'Equipe', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Funcionários da unidade' })).toContainText(email);
  const ownerRow = page.locator('.team-table tbody tr').filter({ hasText: email });
  await expect(
    ownerRow.getByRole('button', { name: 'Desativar acesso de Antonio', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Adicionar funcionário', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Adicionar funcionário', exact: true });
  await dialog.getByLabel('Nome', { exact: true }).fill('João da Equipe');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: 'Descartar alterações?', exact: true });
  await discard.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('João da Equipe');
  const newEmail = `team-${randomUUID()}@test.local`;
  await dialog.getByLabel('E-mail', { exact: true }).fill(newEmail);
  await dialog.getByLabel('Senha inicial', { exact: true }).fill(password);
  await dialog.getByRole('combobox', { name: 'Perfil', exact: true }).click();
  await page.getByRole('option', { name: 'Garçom', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cadastrar funcionário', exact: true }).click();
  await expect(page.getByText('Funcionário cadastrado.', { exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Copiar credenciais · João da Equipe', exact: true })
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
  await page.getByRole('searchbox', { name: 'Buscar funcionários' }).fill('joao');
  await expect(page.locator('.team-table tbody tr')).toHaveCount(1);
  const row = page.locator('.team-table tbody tr').filter({ hasText: newEmail });
  await expect(row).toContainText(newEmail);
  await row.getByRole('button', { name: 'Ver funcionário João da Equipe', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Funcionário · João da Equipe', exact: true });
  await expect(dialog).toContainText('Sem acesso de admin geral');
  await dialog.getByRole('button', { name: 'Alterar perfil de acesso', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Alterar perfil de acesso', exact: true });
  await edit.getByRole('combobox', { name: 'Perfil', exact: true }).click();
  await page.getByRole('option', { name: 'Cozinha', exact: true }).click();
  await edit.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
  await expect(dialog).toContainText('Cozinha');
  await dialog.getByRole('button', { name: 'Fechar detalhes', exact: true }).click();
  await row
    .getByRole('button', { name: 'Desativar acesso de João da Equipe', exact: true })
    .click();
  let confirm = page.getByRole('alertdialog', {
    name: 'Desativar acesso do funcionário?',
    exact: true,
  });
  await expect(confirm).toContainText('O histórico das operações será preservado');
  await confirm.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(row).toContainText('Ativo');
  await row
    .getByRole('button', { name: 'Desativar acesso de João da Equipe', exact: true })
    .click();
  confirm = page.getByRole('alertdialog', {
    name: 'Desativar acesso do funcionário?',
    exact: true,
  });
  await confirm.getByRole('button', { name: 'Confirmar desativação', exact: true }).click();
  await expect(row).toContainText('Desativado');
  await page.getByLabel('Situação do funcionário', { exact: true }).selectOption('active');
  await expect(
    page.getByText('Nenhum funcionário corresponde aos filtros.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filtrar por perfil' }).click();
  await page.getByRole('option', { name: 'Cozinha', exact: true }).click();
  await expect(row).toBeVisible();
  await expect
    .poll(async () =>
      (await page.locator('.team-table tbody tr').allTextContents()).every((text) =>
        text.includes('Cozinha'),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Ativar acesso de João da Equipe', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Ativar acesso do funcionário?', exact: true })
    .getByRole('button', { name: 'Confirmar ativação', exact: true })
    .click();
  await expect(row).toContainText('Ativo');
  const records = await staffApi(request, '/staff');
  expect(records.find((m: any) => m.email === newEmail)).toMatchObject({
    enabled: 1,
    role_name: 'Cozinha',
    is_account_admin: 0,
  });
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  const sortResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/staff?') &&
      new URL(r.url()).searchParams.get('direction') === 'desc',
  );
  await page
    .getByRole('columnheader', { name: 'Funcionário', exact: false })
    .getByRole('button')
    .click();
  await sortResponse;
  await expect(
    page.getByRole('columnheader', { name: 'Funcionário', exact: false }),
  ).toHaveAttribute('aria-sort', 'descending');
  await expect(page.getByRole('button', { name: 'Recarregar', exact: true })).toBeEnabled();
  let failReads = true;
  await page.route('**/api/v1/staff**', async (route) => {
    if (failReads && route.request().method() === 'GET') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Falha de leitura de teste' } }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Recarregar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Falha de leitura de teste');
  await expect(page.locator('.team-table')).toContainText('João da Equipe');
  failReads = false;
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const filterBottoms = await page
    .locator('.team-filters > label')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().bottom));
  expect(Math.max(...filterBottoms) - Math.min(...filterBottoms)).toBeLessThan(2);
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count())
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.screenshot({ path: 'docs/screenshots/team-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ver funcionário João da Equipe', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Funcionário · João da Equipe', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Fechar detalhes', exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/team-mobile-detail.png', fullPage: false });
  await dialog.getByRole('button', { name: 'Fechar detalhes', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/team-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('paginação compartilhada cobre servidor, cadastros, saldos, movimentos e fila de impressão', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tag = 'Pager-' + randomUUID().slice(0, 5);
  const role = fixture.roles.find((r: any) => r.name === 'Garçom');
  const product = await staffApi(request, '/products', {
    name: tag + ' Produto',
    price: '1.00',
    stock_policy: 'NO_CONTROL',
    sector: tag,
  });
  const locations = [];
  for (let i = 0; i < 13; i++) {
    await staffApi(request, '/staff', {
      name: `${tag} Equipe ${String(i).padStart(2, '0')}`,
      email: `${tag}-${i}@test.local`,
      password,
      role_id: role.id,
    });
    await staffApi(request, '/areas', { name: `${tag} Área ${i}` });
    const location = await staffApi(request, '/stock-locations', {
      name: `${tag} Local ${i}`,
      is_default: false,
    });
    locations.push(location);
    const balance = await staffApi(request, '/stock-balances', {
      product_id: product.id,
      location_id: location.id,
      variant_id: null,
    });
    await staffApi(request, '/inventory/adjustments', {
      balance_id: balance.id,
      type: 'PURCHASE',
      quantity: '1.000',
      reason: tag + ' Compra',
    });
  }
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/equipe');
  await page.getByRole('searchbox', { name: 'Buscar funcionários' }).fill(tag);
  const team = page.getByRole('navigation', { name: 'Paginação de Equipe', exact: true });
  await expect(team).toContainText('de 13');
  await expect(page.locator('.team-table tbody tr')).toHaveCount(10);
  let release: () => void = () => {};
  let intercepted = false;
  await page.route('**/api/v1/staff?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('page') === '2' && !intercepted) {
      intercepted = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.continue();
  });
  await team.getByRole('button', { name: 'Próxima página da equipe', exact: true }).click();
  await expect(page.locator('.table-loading .mesa-loading-svg').first()).toBeVisible();
  await expect(
    team.getByRole('button', { name: 'Próxima página da equipe', exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: 'docs/screenshots/pagination-loading.png', fullPage: false });
  await expect.poll(() => intercepted).toBe(true);
  release();
  await expect(page.locator('.team-table tbody tr')).toHaveCount(3);
  await expect(team).toContainText('11–13');
  await team.getByRole('button', { name: 'Primeira página em Equipe', exact: true }).click();
  await expect(page.locator('.team-table tbody tr')).toHaveCount(10);
  await page.getByLabel('Funcionários por página', { exact: true }).selectOption('20');
  await expect(page.locator('.team-table tbody tr')).toHaveCount(13);
  await expect(
    team.getByRole('button', { name: 'Próxima página da equipe', exact: true }),
  ).toBeDisabled();
  await page.getByRole('searchbox', { name: 'Buscar funcionários' }).fill('sem-resultados-' + tag);
  await expect(team).toContainText('0–0');
  await expect(team).toContainText('de 0');
  await page.goto('http://127.0.0.1:35173/salao?aba=areas');
  const area = page
    .locator('.resource-panel')
    .filter({ has: page.getByRole('heading', { name: 'Áreas', exact: true }) });
  await area.getByRole('searchbox', { name: 'Buscar em Áreas', exact: true }).fill(tag);
  const areaPager = page.getByRole('navigation', { name: 'Paginação de Áreas', exact: true });
  await expect(area.locator('tbody tr')).toHaveCount(10);
  await areaPager.getByRole('button', { name: 'Última página em Áreas', exact: true }).click();
  await expect(area.locator('tbody tr')).toHaveCount(3);
  await area
    .getByRole('searchbox', { name: 'Buscar em Áreas', exact: true })
    .fill(tag + ' Área 12');
  await expect(area.locator('tbody tr')).toHaveCount(1);
  await expect(areaPager).toContainText('1–1');
  await page.goto('http://127.0.0.1:35173/estoque');
  await page.getByRole('searchbox', { name: 'Buscar no estoque', exact: true }).fill(tag);
  const inventory = page.getByRole('navigation', {
    name: 'Paginação de Saldos do estoque',
    exact: true,
  });
  await expect(page.locator('.inventory-overview-table tbody tr')).toHaveCount(10);
  await inventory
    .getByRole('button', { name: 'Última página em Saldos do estoque', exact: true })
    .click();
  await expect(page.locator('.inventory-overview-table tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Gerenciar produto', exact: true }).first().click();
  const modal = page.getByRole('dialog').first();
  const stocks = modal.getByRole('navigation', {
    name: 'Paginação de Estoques do produto',
    exact: true,
  });
  await expect(modal.locator('.product-stock-table tbody tr')).toHaveCount(10);
  await stocks
    .getByRole('button', { name: 'Última página em Estoques do produto', exact: true })
    .click();
  await expect(modal.locator('.product-stock-table tbody tr')).toHaveCount(3);
  await modal
    .getByRole('button', { name: /Histórico de/ })
    .first()
    .click();
  await modal
    .getByRole('combobox', { name: 'Filtrar movimentações por estoque', exact: true })
    .click();
  await page.getByRole('option', { name: 'Todos os estoques', exact: true }).click();
  const movements = modal.getByRole('navigation', {
    name: 'Paginação de Movimentações do produto',
    exact: true,
  });
  await movements
    .getByRole('combobox', { name: 'Movimentações do produto por página', exact: true })
    .selectOption('10');
  await expect(modal.locator('.product-movements-table tbody tr')).toHaveCount(10);
  await movements
    .getByRole('button', { name: 'Próxima página em Movimentações do produto', exact: true })
    .click();
  await expect(modal.locator('.product-movements-table tbody tr')).toHaveCount(3);
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await staffApi(request, '/printers', { name: tag + ' Impressora', sector: tag });
  const table = await staffApi(request, '/tables', { number: tag, capacity: 4 });
  const order = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 13, modifiers: [] }],
  });
  const confirmed = await staffApi(request, `/orders/${order.id}/confirm`, {});
  const jobs = await staffApi(request, '/print/jobs');
  await page.goto('http://127.0.0.1:35173/impressao?aba=fila-de-impressao');
  const queue = page.getByRole('navigation', {
    name: 'Paginação de Fila de impressão',
    exact: true,
  });
  await expect(page.getByRole('tabpanel').locator('.print-queue-table tbody tr')).toHaveCount(10);
  await queue
    .getByRole('button', { name: 'Última página em Fila de impressão', exact: true })
    .click();
  await expect(page.getByRole('tabpanel').locator('.print-queue-table tbody tr')).toHaveCount(
    jobs.length % 10 || 10,
  );
  await expect(
    queue.getByRole('button', { name: 'Próxima página em Fila de impressão', exact: true }),
  ).toBeDisabled();
  const register = await staffApi(request, '/cash-registers', { name: tag + ' Caixa' });
  const cash = await staffApi(request, '/cash/sessions', {
    register_id: register.id,
    opening_amount: '0.00',
  });
  for (let i = 0; i < 13; i++) {
    await staffApi(request, '/cash/movements', {
      cash_session_id: cash.id,
      type: 'SUPPLY',
      amount: '1.00',
      reason: tag + ' Suprimento',
    });
    await staffApi(request, '/payments/manual', {
      method: 'PIX_MANUAL',
      allocations: [{ tab_id: confirmed.tab_id, amount: '1.00' }],
    });
  }
  await page.goto('http://127.0.0.1:35173/pagamentos');
  await page.getByRole('searchbox', { name: 'Buscar pagamentos', exact: true }).fill(tag);
  const payments = page.getByRole('navigation', { name: 'Paginação de Pagamentos', exact: true });
  await expect(page.locator('.payments-table tbody tr')).toHaveCount(10);
  await payments.getByRole('button', { name: 'Próxima página de pagamentos', exact: true }).click();
  await expect(page.locator('.payments-table tbody tr')).toHaveCount(3);
  await page.goto('http://127.0.0.1:35173/caixa?aba=movimentacoes');
  await page
    .getByRole('searchbox', { name: 'Buscar movimentações de caixa', exact: true })
    .fill(tag);
  const cashPager = page.getByRole('navigation', {
    name: 'Paginação de Movimentações de caixa',
    exact: true,
  });
  await expect(page.locator('.cash-movements tbody tr')).toHaveCount(10);
  await cashPager
    .getByRole('button', { name: 'Última página em Movimentações de caixa', exact: true })
    .click();
  await expect(page.locator('.cash-movements tbody tr')).toHaveCount(3);
  await page.goto('http://127.0.0.1:35173/financeiro?aba=flow');
  await page.getByRole('searchbox', { name: 'Buscar no financeiro', exact: true }).fill(tag);
  const finance = page.getByRole('navigation', {
    name: 'Paginação de Registros financeiros',
    exact: true,
  });
  await expect(finance).toContainText('de 13');
  await expect(page.locator('.finance-records tbody tr')).toHaveCount(10);
  await finance.getByRole('button', { name: 'Próxima página financeira', exact: true }).click();
  await expect(page.locator('.finance-records tbody tr')).toHaveCount(3);
  await expect(finance).toContainText('11–13');
  await expect(
    finance.getByRole('button', { name: 'Próxima página financeira', exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pagination-mobile.png', fullPage: false });
  expect(errors).toEqual([]);
});
test('novo produto oferece estoque inicial em modal, permite adiar e aceita quantidade opcional', async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 6),
    name = 'Inicial UI ' + suffix;
  const place = await staffApi(request, '/stock-locations', {
    name: 'Depósito inicial ' + suffix,
    is_default: false,
  });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/cardapio');
  async function create(title: string, keep = false) {
    await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Adicionar · Produtos', exact: true });
    await editor.getByLabel('Nome', { exact: true }).fill(title);
    await editor.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
    await editor.getByLabel('Preço', { exact: true }).fill('10');
    await editor
      .getByRole('button', { name: keep ? 'Salvar e continuar' : 'Salvar', exact: true })
      .click();
    const prompt = page.getByRole('dialog', {
      name: 'Criar estoque do novo produto?',
      exact: true,
    });
    await expect(prompt).toBeVisible();
    return prompt;
  }
  const prompt = await create(name);
  await prompt
    .getByRole('combobox', { name: 'Local do estoque inicial', exact: true })
    .fill(place.name);
  await page.getByRole('option', { name: place.name, exact: true }).click();
  await prompt.getByLabel('Quantidade inicial', { exact: true }).fill('-1');
  await prompt.getByRole('button', { name: 'Criar estoque', exact: true }).click();
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Quantidade inicial', { exact: true }).fill('12,500');
  await prompt.getByRole('button', { name: 'Agora não', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Descartar alterações?', exact: true })
    .getByRole('button', { name: 'Continuar editando', exact: true })
    .click();
  await expect(prompt.getByLabel('Quantidade inicial', { exact: true })).toHaveValue('12,500');
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count())
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/produto-estoque-inicial-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: 'docs/screenshots/produto-estoque-inicial.png' });
  await prompt.getByRole('button', { name: 'Criar estoque', exact: true }).click();
  await expect(prompt).toHaveCount(0);
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await expect(editor.getByRole('tab', { name: 'Estoques e locais', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    editor.getByRole('tabpanel', { name: 'Estoques e locais', exact: true }).locator('tbody'),
  ).toContainText('12,500');
  const product = (await staffApi(request, '/products')).find((p: any) => p.name === name);
  let context = await staffApi(request, '/products/' + product.id + '/management');
  expect(context.balances).toHaveLength(1);
  expect(context.movements).toHaveLength(1);
  expect(context.product.stock_location_id).toBe(place.id);
  await editor.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await expect(prompt).toHaveCount(0);
  context = await staffApi(request, '/products/' + product.id + '/management');
  expect(context.product.stock_location_id).toBe(place.id);
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const zero = await create(name + ' zero', true);
  await zero.getByRole('button', { name: 'Criar estoque', exact: true }).click();
  await expect(zero).toHaveCount(0);
  const zeroProduct = (await staffApi(request, '/products')).find(
    (p: any) => p.name === name + ' zero',
  );
  context = await staffApi(request, '/products/' + zeroProduct.id + '/management');
  expect(context.balances[0].physical_quantity).toBe('0.000');
  expect(context.movements).toHaveLength(0);
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const later = await create(name + ' depois');
  await later.getByRole('button', { name: 'Agora não', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const postponed = (await staffApi(request, '/products')).find(
    (p: any) => p.name === name + ' depois',
  );
  context = await staffApi(request, '/products/' + postponed.id + '/management');
  expect(context.balances).toHaveLength(0);
});
test('reposição em massa seleciona entre páginas, registra nota e custos e permite consultar o histórico no celular', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 6),
    name = 'Reposição UI ' + suffix,
    supplier = 'Distribuidora UI ' + suffix;
  const product = await staffApi(request, '/products', {
    name,
    price: '99.00',
    stock_policy: 'ON_DELIVERY',
  });
  const places = [];
  for (let i = 0; i < 12; i++) {
    const location = await staffApi(request, '/stock-locations', {
      name: suffix + ' Depósito ' + String(i).padStart(2, '0'),
      is_default: false,
    });
    places.push(location);
    await staffApi(request, '/stock-balances', {
      product_id: product.id,
      location_id: location.id,
    });
  }
  const variant = await staffApi(request, '/product-variants', {
    product_id: product.id,
    name: 'Caixa fechada ' + suffix,
    price: '200.00',
    stock_mode: 'OWN',
  });
  await staffApi(request, '/stock-balances', {
    product_id: product.id,
    location_id: places[0].id,
    variant_id: variant.id,
  });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/estoque');
  await page.setViewportSize({ width: 1536, height: 1050 });
  await page.getByRole('button', { name: 'Reposição em massa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Reposição em massa', exact: true });
  await expect(
    modal.getByRole('button', { name: 'Confirmar reposição', exact: true }),
  ).toBeDisabled();
  await modal.getByRole('searchbox', { name: 'Buscar estoques para repor' }).fill(name);
  const table = modal.getByRole('table', { name: 'Estoques para reposição' });
  await expect(table.locator('tbody tr')).toHaveCount(10);
  const first = table.locator('tbody tr').first(),
    firstLabel = await first.getByRole('checkbox').getAttribute('aria-label');
  await first.getByRole('checkbox').check();
  await first.getByRole('textbox', { name: /^Quantidade a repor/ }).fill('2,500');
  await first.getByRole('textbox', { name: /^Custo unitário/ }).fill('10');
  await modal
    .getByRole('button', { name: 'Próxima página em Estoques para repor', exact: true })
    .click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const next = table.locator('tbody tr').first();
  await next.getByRole('checkbox').check();
  await next.getByRole('textbox', { name: /^Quantidade a repor/ }).fill('3');
  await next.getByRole('textbox', { name: /^Custo unitário/ }).fill('5');
  await modal
    .getByRole('button', { name: 'Página anterior em Estoques para repor', exact: true })
    .click();
  await expect(modal.getByRole('checkbox', { name: firstLabel!, exact: true })).toBeChecked();
  await modal.getByLabel('Fornecedor da reposição').fill(supplier);
  await modal.getByLabel('Número da nota', { exact: true }).fill('000123-' + suffix);
  await modal.getByLabel('Frete da reposição').fill('9,90');
  await modal.getByLabel('Desconto da reposição').fill('2,40');
  await modal.getByLabel('Observações da reposição').fill('Entrega conferida no depósito.');
  await modal.getByRole('checkbox', { name: 'Só selecionados', exact: true }).check();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await modal.getByRole('button', { name: 'Selecionar página', exact: true }).click();
  await expect(modal.getByText('2 estoque(s) selecionado(s)', { exact: true })).toBeVisible();
  await expect(modal.locator('.replenishment-summary')).toContainText('R$ 47,50');
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Descartar alterações?', exact: true })
    .getByRole('button', { name: 'Continuar editando', exact: true })
    .click();
  await expect(modal.getByLabel('Número da nota', { exact: true })).toHaveValue('000123-' + suffix);
  await page.screenshot({ path: 'docs/screenshots/reposicao-massa-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/reposicao-massa-mobile.png' });
  await modal.getByRole('button', { name: 'Confirmar reposição', exact: true }).click();
  const detail = page.getByRole('dialog', { name: /^Reposição #/ });
  await expect(detail).toContainText('000123-' + suffix);
  await expect(detail.locator('.replenishment-summary')).toContainText('R$ 47,50');
  const list = await staffApi(
    request,
    '/inventory/replenishments?search=' + encodeURIComponent(supplier),
  );
  expect(list.total).toBe(1);
  const result = await staffApi(request, '/inventory/replenishments/' + list.rows[0].id);
  expect(result.items).toHaveLength(2);
  expect(result.items.map((item: any) => item.quantity).sort()).toEqual(['2.500', '3.000']);
  expect(result.total).toBe('47.50');
  expect(result.invoice_number).toBe('000123-' + suffix);
  const movements = await staffApi(request, '/inventory/movements');
  expect(
    movements.filter((row: any) => row.source_key.startsWith('replenishment:' + result.id + ':')),
  ).toHaveLength(2);
  await detail.getByRole('button', { name: 'Fechar reposição', exact: true }).click();
  await page.getByRole('button', { name: 'Histórico de reposições', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Histórico de reposições', exact: true });
  await history.getByRole('searchbox', { name: 'Buscar reposições' }).fill(supplier);
  await expect(
    history.getByRole('table', { name: 'Reposições registradas' }).locator('tbody tr'),
  ).toHaveCount(1);
  await history.getByRole('button', { name: 'Ver reposição', exact: true }).click();
  await expect(detail).toContainText('Entrega conferida no depósito.');
  await page.screenshot({ path: 'docs/screenshots/reposicao-historico-mobile.png' });
  await detail.getByRole('button', { name: 'Fechar reposição', exact: true }).click();
  await history.getByRole('button', { name: 'Fechar histórico', exact: true }).click();
});

test('cores de categorias e locais aparecem nas tags, seletores e reposição, inclusive no celular', async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 6),
    categoryName = 'Categoria colorida ' + suffix,
    locationName = 'Depósito colorido ' + suffix,
    productName = 'Produto cores ' + suffix;
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/cardapio');
  await page
    .getByLabel('Categorias de produtos', { exact: true })
    .getByRole('button', { name: 'Nova', exact: true })
    .click();
  const categoryForm = page.getByRole('dialog', { name: 'Nova categoria', exact: true });
  await categoryForm.getByLabel('Nome', { exact: true }).fill(categoryName);
  await categoryForm.getByRole('button', { name: 'Cor roxo', exact: true }).click();
  await expect(categoryForm.getByLabel('Cor hexadecimal', { exact: true })).toHaveValue('#7c3aed');
  await categoryForm.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(categoryForm).toHaveCount(0);
  const category = (await staffApi(request, '/categories')).find(
    (c: any) => c.name === categoryName,
  );
  expect(category.color).toBe('#7c3aed');
  const product = await staffApi(request, '/products', {
    name: productName,
    price: '10.00',
    stock_policy: 'ON_DELIVERY',
    category_id: category.id,
  });
  await page.getByRole('button', { name: 'Recarregar Produtos', exact: true }).click();
  const productRow = page
    .getByRole('table', { name: 'Produtos do cardápio' })
    .locator('tbody tr')
    .filter({ hasText: productName });
  await expect(productRow.locator('.record-tag')).toContainText(categoryName);
  await expect(productRow.locator('.record-tag .record-color-dot')).toHaveCSS(
    'background-color',
    'rgb(124, 58, 237)',
  );
  await page.getByRole('tab', { name: 'Categorias', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Buscar em Categorias', exact: true })
    .fill(categoryName);
  await page.getByRole('button', { name: 'Editar ' + categoryName, exact: true }).click();
  const editCategory = page.getByRole('dialog', { name: 'Editar · Categorias', exact: true });
  await editCategory.getByLabel('Cor hexadecimal', { exact: true }).fill('#FF6600');
  await editCategory.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editCategory).toHaveCount(0);
  await page.getByRole('tab', { name: 'Produtos', exact: true }).click();
  await expect(productRow.locator('.record-tag .record-color-dot')).toHaveCSS(
    'background-color',
    'rgb(255, 102, 0)',
  );
  await page.getByRole('button', { name: 'Editar ' + productName, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await expect(editor.getByRole('combobox', { name: 'Categoria', exact: true })).toHaveValue(
    categoryName,
  );
  await expect(
    editor.locator('.search-select.has-record-color .record-color-dot').first(),
  ).toHaveCSS('background-color', 'rgb(255, 102, 0)');
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.goto('http://127.0.0.1:35173/estoque');
  await page.getByRole('button', { name: 'Locais de estoque', exact: true }).click();
  const locations = page.getByRole('dialog', { name: 'Locais de estoque', exact: true });
  await locations.getByRole('button', { name: 'Novo local', exact: true }).click();
  const newLocation = page.getByRole('dialog', { name: 'Novo local de estoque', exact: true });
  await newLocation.getByLabel('Nome do local', { exact: true }).fill(locationName);
  await newLocation.getByRole('button', { name: 'Cor verde', exact: true }).click();
  await newLocation.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(newLocation).toHaveCount(0);
  await expect(
    locations.locator('article').filter({ hasText: locationName }).locator('.record-color-dot'),
  ).toHaveCSS('background-color', 'rgb(5, 150, 105)');
  const location = (await staffApi(request, '/stock-locations')).find(
    (l: any) => l.name === locationName,
  );
  await staffApi(request, '/stock-balances', { product_id: product.id, location_id: location.id });
  await locations.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar no estoque', exact: true }).fill(productName);
  const stockRow = page
    .locator('.inventory-overview-table tbody tr')
    .filter({ hasText: productName });
  await expect(stockRow.locator('.record-tag')).toContainText(locationName);
  await expect(stockRow.locator('.record-color-dot')).toHaveCSS(
    'background-color',
    'rgb(5, 150, 105)',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  let darkTagBackground = '';
  for (const theme of ['dark', 'light']) {
    const toggle = page.getByRole('button', {
      name: theme === 'dark' ? 'Ativar tema escuro' : 'Ativar tema claro',
      exact: true,
    });
    if (await toggle.count()) await toggle.click();
    const tagBackground = await stockRow
      .locator('.record-tag')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    if (theme === 'dark') darkTagBackground = tagBackground;
    else expect(tagBackground).not.toBe(darkTagBackground);
    await page.getByRole('button', { name: 'Reposição em massa', exact: true }).click();
    const replenish = page.getByRole('dialog', { name: 'Reposição em massa', exact: true });
    await replenish
      .getByRole('searchbox', { name: 'Buscar estoques para repor' })
      .fill(productName);
    const tag = replenish.locator('tbody tr .record-tag');
    await expect(tag.locator('.record-color-dot')).toHaveCSS(
      'background-color',
      'rgb(5, 150, 105)',
    );
    await expect(tag).toHaveCSS('background-color', tagBackground);
    const alignment = await replenish.locator('.replenishment-stock-meta').evaluate((element) => {
      const [variant, location] = [...element.children].map((child) =>
        child.getBoundingClientRect(),
      );
      return Math.abs(variant.top + variant.height / 2 - (location.top + location.height / 2));
    });
    expect(alignment).toBeLessThan(1);
    await page.screenshot({ path: 'docs/screenshots/reposicao-tags-' + theme + '.png' });
    if (theme === 'light') {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await replenish.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.screenshot({ path: 'docs/screenshots/reposicao-tags-mobile.png' });
    }
    await replenish.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Locais de estoque', exact: true }).click();
  await locations
    .getByRole('button', { name: 'Editar local ' + locationName, exact: true })
    .click();
  const editLocation = page.getByRole('dialog', { name: 'Editar local', exact: true });
  await editLocation.getByRole('button', { name: 'Remover cor', exact: true }).click();
  await editLocation.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editLocation).toHaveCount(0);
  await expect(
    locations.locator('article').filter({ hasText: locationName }).locator('.record-color-dot'),
  ).toHaveCount(0);
  await locations.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(stockRow.locator('.record-color-dot')).toHaveCount(0);
  expect(
    (await staffApi(request, '/stock-locations')).find((l: any) => l.id === location.id).color,
  ).toBeNull();
});

test('fila cancela impressão individual ou toda a unidade além dos filtros e páginas e conserva histórico', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const tag = 'Fila-' + randomUUID().slice(0, 6);
  const printer = await staffApi(request, '/printers', { name: tag, sector: tag });
  const product = await staffApi(request, '/products', {
    name: tag + ' produto',
    price: '10.00',
    stock_policy: 'NO_CONTROL',
    sector: tag,
  });
  const table = await staffApi(request, '/tables', { number: tag, capacity: 4 });
  const draft = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 12, modifiers: [] }],
  });
  const order = await staffApi(request, `/orders/${draft.id}/confirm`, {});
  await staffApi(request, `/orders/${order.id}/receipt/print`, {
    printer_id: printer.id,
    paper_width: 80,
  });
  const agent = await staffApi(request, '/print/agents', { name: tag + ' agente' });
  const agentCall = async (path: string, body: any) => {
    const response = await request.post('http://127.0.0.1:33000/api/v1' + path, {
      headers: { authorization: `Bearer ${agent.token}`, 'Idempotency-Key': randomUUID() },
      data: body,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const complete = await agentCall('/print/jobs/claim', { printer_ids: [printer.id] });
  await agentCall(`/print/jobs/${complete.id}/finish`, { success: true });
  const failed = await agentCall('/print/jobs/claim', { printer_ids: [printer.id] });
  await agentCall(`/print/jobs/${failed.id}/finish`, { success: false, error: 'Sem papel' });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/impressao?aba=fila-de-impressao');
  const queue = page.locator('.print-queue-panel');
  await queue.getByRole('searchbox', { name: 'Buscar na fila de impressão' }).fill(tag);
  await expect(queue.locator('.print-queue-table tbody tr')).toHaveCount(10);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.round(
          document.querySelector('.admin-main')!.getBoundingClientRect().left -
            document.querySelector('.sidebar')!.getBoundingClientRect().right,
        ),
      ),
    )
    .toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await queue
    .getByRole('combobox', { name: 'Fila de impressão por página', exact: true })
    .selectOption('25');
  await expect(queue.locator('.print-queue-table tbody tr')).toHaveCount(13);
  expect(await queue.evaluate((element) => element.getBoundingClientRect().left)).toBeGreaterThan(
    284,
  );
  const queueRows = queue.locator('.print-queue-table tbody tr');
  expect(
    await queueRows.first().evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThan(65);
  const statusPositions = await queueRows
    .locator('td[data-label="Situação"]')
    .evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().left)));
  expect(new Set(statusPositions).size).toBe(1);
  await page.screenshot({
    path: 'docs/screenshots/fila-impressao-compacta-desktop.png',
    fullPage: false,
  });
  await queue
    .getByRole('combobox', { name: 'Fila de impressão por página', exact: true })
    .selectOption('10');
  await queue.getByRole('combobox', { name: 'Situação da impressão' }).click();
  await page.getByRole('option', { name: 'Falhou', exact: true }).click();
  await expect(queue.locator('.print-queue-table tbody tr')).toHaveCount(1);
  await queue.getByRole('button', { name: /^Cancelar impressão #/ }).click();
  const single = page.getByRole('dialog', { name: 'Cancelar impressão', exact: true });
  await single.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(single).toHaveCount(0);
  await expect(queue.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeVisible();
  await queue.getByRole('button', { name: /^Cancelar impressão #/ }).click();
  await single.getByLabel('Motivo do cancelamento (opcional)').fill('Envio incorreto');
  await single.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(single).toHaveCount(0);
  const processing = await agentCall('/print/jobs/claim', { printer_ids: [printer.id] });
  await queue.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
  await queue.getByRole('combobox', { name: 'Situação da impressão' }).click();
  await page.getByRole('option', { name: 'Pendente', exact: true }).click();
  await expect(queue.locator('.print-queue-table tbody tr')).toHaveCount(10);
  await queue.getByRole('button', { name: 'Cancelar fila', exact: true }).click();
  const all = page.getByRole('dialog', { name: 'Cancelar fila de impressão', exact: true });
  await expect(all).toContainText('fora desta página e dos filtros');
  await all.getByLabel('Motivo do cancelamento (opcional)').fill('Limpeza da fila');
  await all.getByRole('button', { name: 'Cancelar toda a fila', exact: true }).click();
  await expect(all).toHaveCount(0);
  await expect(queue.getByRole('button', { name: 'Cancelar fila', exact: true })).toBeDisabled();
  await expect(queue).toContainText('Nenhuma impressão encontrada.');
  const jobs = (await staffApi(request, '/print/jobs')).filter(
    (job: any) => job.printer_id === printer.id,
  );
  expect(jobs).toHaveLength(13);
  expect(jobs.filter((job: any) => job.status === 'COMPLETED')).toHaveLength(1);
  expect(jobs.filter((job: any) => job.status === 'CANCELLED')).toHaveLength(12);
  expect(jobs.find((job: any) => job.id === processing.id).status).toBe('CANCELLED');
  expect((await agentCall('/print/jobs/claim', { printer_ids: [printer.id] })).idle).toBe(true);
  await queue.getByRole('combobox', { name: 'Situação da impressão' }).click();
  await page.getByRole('option', { name: 'Cancelado', exact: true }).click();
  await expect(queue.locator('.print-queue-table tbody tr')).toHaveCount(10);
  await expect(queue.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
  await queue
    .getByRole('button', { name: 'Próxima página em Fila de impressão', exact: true })
    .click();
  await expect(queue.locator('.print-queue-table tbody tr')).toHaveCount(2);
  await page.screenshot({
    path: 'docs/screenshots/fila-impressao-cancelamento-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).not.toBeInViewport();
  expect(
    await queue
      .locator('.print-queue-table td[data-label="Situação"]')
      .first()
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(240);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'docs/screenshots/fila-impressao-cancelamento-mobile.png',
    fullPage: true,
  });
});

test('pedido avulso vende no balcão sem mesa, recebe no ato e separa entrega imediata de preparo', async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 6),
    name = 'Avulso UI ' + suffix,
    customer = 'Cliente balcão ' + suffix;
  const product = await staffApi(request, '/products', {
    name,
    price: '14.50',
    stock_policy: 'NO_CONTROL',
  });
  const prepared = await staffApi(request, '/products', {
    name: name + ' cozinha',
    price: '20.00',
    stock_policy: 'NO_CONTROL',
    requires_production: true,
    sector: 'cozinha',
  });
  const tablesBefore = await staffApi(request, '/tables');
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/pedidos');
  await page.getByRole('button', { name: 'Pedido avulso', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Novo pedido avulso', exact: true });
  await expect(
    modal.getByRole('button', { name: 'Confirmar recebimento e pedido', exact: true }),
  ).toBeDisabled();
  await modal.getByRole('searchbox', { name: 'Buscar produto avulso' }).fill(name);
  await modal.getByRole('button', { name: 'Adicionar ' + name, exact: true }).click();
  await modal.getByRole('button', { name: 'Adicionar ' + name, exact: true }).click();
  await expect(modal.locator('.counter-cart article')).toHaveCount(1);
  await expect(modal.locator('.counter-cart .quantity-stepper')).toContainText('2');
  await modal.getByRole('button', { name: 'Adicionar ' + prepared.name, exact: true }).click();
  await modal.getByLabel('Cliente do pedido avulso').fill(customer);
  await expect(modal.locator('.order-total')).toContainText('R$ 49,00');
  await expect(
    modal.getByRole('checkbox', { name: 'Marcar itens sem preparo como entregues', exact: true }),
  ).toBeChecked();
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Descartar alterações?', exact: true })
    .getByRole('button', { name: 'Continuar editando', exact: true })
    .click();
  await expect(modal.getByLabel('Cliente do pedido avulso')).toHaveValue(customer);
  await page.screenshot({ path: 'docs/screenshots/pedido-avulso-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pedido-avulso-mobile.png', fullPage: true });
  const saleResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/orders/counter') && response.request().method() === 'POST',
  );
  await modal.getByRole('button', { name: 'Confirmar recebimento e pedido', exact: true }).click();
  const response = await saleResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const sale = await response.json();
  await expect(modal).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp('/pedidos/' + sale.order.id + '$'));
  const detail = page
    .getByRole('dialog')
    .filter({ has: page.getByText('Pago no ato · balcão', { exact: true }) });
  await expect(detail).toContainText('Balcão · Pedido avulso');
  await expect(detail).toContainText(customer);
  expect(sale).toMatchObject({ delivered: 2, pending: 1 });
  const record = await staffApi(request, '/orders/' + sale.order.id);
  expect(record).toMatchObject({ service_mode: 'COUNTER', table_id: null, total: '49.00' });
  expect(record.tickets.filter((t: any) => t.status === 'REDEEMED')).toHaveLength(2);
  expect(record.tickets.filter((t: any) => t.status === 'PENDING')).toHaveLength(1);
  await detail.getByRole('button', { name: 'Cupom do pedido', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'Cupom do pedido', exact: true });
  await expect(receipt).toContainText('Balcão');
  await expect(receipt).toContainText('49,00');
  await receipt.getByRole('button', { name: 'Fechar cupom', exact: true }).click();
  await detail.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filtrar por mesa', exact: true }).click();
  await page.getByRole('option', { name: 'Balcão · Pedidos avulsos', exact: true }).click();
  await expect(page.locator('.orders-table tbody tr')).toHaveCount(1);
  expect(
    (await staffApi(request, '/tables')).map((t: any) => ({ id: t.id, status: t.status })),
  ).toEqual(tablesBefore.map((t: any) => ({ id: t.id, status: t.status })));
  expect(product.id).toBeTruthy();
});

test('máscaras numéricas bloqueiam texto, convertem ponto decimal e respeitam contratos de estoque e inteiros', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 6),
    name = 'Máscara estoque ' + suffix;
  const location = await staffApi(request, '/stock-locations', {
    name: 'Local máscara ' + suffix,
    is_default: false,
  });
  const product = await staffApi(request, '/products', {
    name,
    price: '10.00',
    stock_policy: 'ON_DELIVERY',
    stock_location_id: location.id,
  });
  await staffApi(request, '/stock-balances', { product_id: product.id, location_id: location.id });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/estoque');
  await page.getByRole('button', { name: 'Reposição em massa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Reposição em massa', exact: true });
  await modal.getByRole('searchbox', { name: 'Buscar estoques para repor' }).fill(name);
  const row = modal.getByRole('table', { name: 'Estoques para reposição' }).locator('tbody tr');
  await row.getByRole('checkbox').check();
  const quantity = row.getByRole('textbox', { name: /^Quantidade a repor/ });
  let submissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/inventory/replenishments'))
      submissions++;
  });
  await quantity.fill('fgsdfd');
  await expect(quantity).toHaveValue('');
  await expect(quantity).toHaveAttribute('aria-invalid', 'true');
  await modal.getByRole('button', { name: 'Confirmar reposição', exact: true }).click();
  expect(submissions).toBe(0);
  await quantity.fill('1.250');
  await expect(quantity).toHaveValue('1,250');
  await quantity.fill('1,2500');
  await expect(quantity).toHaveValue('1,250');
  await modal.getByRole('button', { name: 'Confirmar reposição', exact: true }).click();
  expect(submissions).toBe(0);
  await quantity.fill('2.750');
  const cost = row.getByRole('textbox', { name: /^Custo unitário/ });
  await cost.fill('14.501');
  await expect(cost).toHaveValue('');
  await expect(cost).toHaveAttribute('aria-invalid', 'true');
  await cost.fill('14.50');
  await modal.getByLabel('Frete da reposição').fill('2.50');
  await modal.getByLabel('Desconto da reposição').fill('0.10');
  await modal.getByLabel('Observações da reposição').click();
  await expect(modal.locator('.replenishment-summary')).toContainText('R$ 42,28');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/inventory/replenishments'),
  );
  await modal.getByRole('button', { name: 'Confirmar reposição', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({
    items: [{ quantity: '2.750', unit_cost: '14.50' }],
    freight: '2.50',
    discount: '0.10',
  });
  await page
    .getByRole('dialog', { name: /^Reposição #/ })
    .getByRole('button', { name: 'Fechar reposição', exact: true })
    .click();
  await page.getByRole('searchbox', { name: 'Buscar no estoque', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Gerenciar produto', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await editor.getByRole('button', { name: 'Movimentar', exact: true }).click();
  const adjustment = page.getByRole('dialog', { name: 'Movimentar estoque', exact: true });
  await adjustment.getByRole('combobox', { name: 'Tipo de movimentação', exact: true }).click();
  await page.getByRole('option', { name: 'Perda / saída', exact: true }).click();
  await adjustment.getByLabel('Quantidade', { exact: true }).fill('-1.250');
  await expect(adjustment.getByLabel('Quantidade', { exact: true })).toHaveValue('-1,250');
  await adjustment.getByLabel('Motivo', { exact: true }).fill('Perda conferida no teste');
  const moved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/inventory/adjustments'),
  );
  await adjustment.getByRole('button', { name: 'Salvar', exact: true }).click();
  expect((await moved).request().postDataJSON().quantity).toBe('-1.250');
  await expect(adjustment).toHaveCount(0);
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.goto('http://127.0.0.1:35173/salao?aba=mesas');
  await page.getByRole('tab', { name: 'Mesas', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const table = page.getByRole('dialog', {
    name: 'Adicionar · Mesas do salão',
    exact: true,
  });
  await table.getByLabel('Número', { exact: true }).fill('N-' + suffix);
  const capacity = table.getByLabel('Lugares', { exact: true });
  await capacity.fill('1.5');
  await expect(capacity).toHaveAttribute('aria-invalid', 'true');
  await capacity.fill('101');
  await table.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(table).toBeVisible();
  await capacity.fill('4');
  await table.getByLabel('Posição X', { exact: true }).fill('2000');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/tables'),
  );
  await table.getByRole('button', { name: 'Salvar', exact: true }).click();
  const tableResponse = await created;
  expect(tableResponse.ok(), await tableResponse.text()).toBe(true);
  expect(tableResponse.request().postDataJSON()).toMatchObject({
    capacity: 4,
    position_x: 2000,
    position_y: 0,
  });
  await staffApi(request, '/product-variants', {
    product_id: product.id,
    name: 'Variação máscara',
    price: '12.00',
  });
  await page.goto('http://127.0.0.1:35173/pedidos');
  await page.getByRole('button', { name: 'Pedido avulso', exact: true }).click();
  const counter = page.getByRole('dialog', { name: 'Novo pedido avulso', exact: true });
  await counter.getByRole('searchbox', { name: 'Buscar produto avulso' }).fill(name);
  await counter.getByRole('button', { name: 'Adicionar ' + name, exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Adicionar · ' + name, exact: true });
  const units = picker.getByLabel('Quantidade do produto', { exact: true });
  await units.fill('1,5');
  await picker.getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
  await expect(picker).toBeVisible();
  await units.fill('2');
  await picker.getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(counter.locator('.counter-cart .quantity-stepper')).toContainText('2');
});

test('presets personalizam primária e fundo do menu, e sidebar recolhe, navega e reabre no desktop e celular', async ({
  page,
  request,
}) => {
  const original = await staffApi(request, '/appearance');
  try {
    await page.setViewportSize({ width: 1536, height: 1000 });
    await login(page, 35173);
    await page.goto('http://127.0.0.1:35173/configuracoes?aba=aparencia');
    await page.getByRole('button', { name: 'Aplicar preset Violeta', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Aplicar preset Violeta', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await staffApi(request, '/appearance')).toMatchObject({
      primary_color: '#8b5cf6',
      sidebar_color: '#21163b',
    });
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(33, 22, 59)');
    const close = page.getByRole('button', { name: 'Recolher menu lateral', exact: true });
    await close.click();
    await expect(
      page.getByRole('button', { name: 'Expandir menu lateral', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    await expect
      .poll(() =>
        page
          .locator('.sidebar')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(76);
    await page.locator('.sidebar').getByRole('button', { name: 'Pedidos', exact: true }).click();
    await expect(page).toHaveURL(/\/pedidos$/);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Expandir menu lateral', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.admin-main')
          .evaluate((element) => Math.round(element.getBoundingClientRect().left)),
      )
      .toBe(76);
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Configurações', exact: true })
      .click();
    await page.getByRole('tab', { name: 'Aparência', exact: true }).click();
    await page.screenshot({
      path: 'docs/screenshots/aparencia-sidebar-recolhido.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Expandir menu lateral', exact: true }).click();
    await page.getByRole('button', { name: 'Personalizar fundo', exact: true }).click();
    const modal = page.getByRole('dialog', {
      name: 'Personalizar fundo do menu lateral',
      exact: true,
    });
    await modal.getByLabel('Código hexadecimal', { exact: true }).fill('#FFFFFF');
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Descartar alterações?', exact: true })
      .getByRole('button', { name: 'Continuar editando', exact: true })
      .click();
    await modal.getByRole('button', { name: 'Salvar aparência', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await staffApi(request, '/appearance')).toMatchObject({
      primary_color: '#8b5cf6',
      sidebar_color: '#ffffff',
    });
    await page.getByRole('button', { name: 'Aplicar preset Oceano', exact: true }).click();
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(13, 27, 42)');
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.round(
            document.querySelector('.admin-main')!.getBoundingClientRect().left -
              document.querySelector('.sidebar')!.getBoundingClientRect().right,
          ),
        ),
      )
      .toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'docs/screenshots/aparencia-presets-desktop.png' });
    await page.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.sidebar')).not.toBeInViewport();
    await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
    await expect(page.locator('.sidebar')).toBeInViewport();
    await expect(
      page.locator('.sidebar').getByRole('button', { name: 'Configurações', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/aparencia-sidebar-mobile.png' });
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Fechar menu', exact: true })
      .click();
    await expect(page.locator('.sidebar')).not.toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'docs/screenshots/aparencia-presets-mobile.png',
      fullPage: true,
    });
  } finally {
    const response = await request.patch('http://127.0.0.1:33000/api/v1/settings', {
      headers: { authorization: `Bearer ${staffToken}`, 'Idempotency-Key': randomUUID() },
      data: original,
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
});

test('menu de impressão do pedido abre PDF antes de baixar, recupera falha e envia cupom à térmica', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const tag = 'Cupom menu ' + randomUUID().slice(0, 6);
  const printer = await staffApi(request, '/printers', { name: tag, sector: 'recibo-menu' });
  const table = await staffApi(request, '/tables', {
    number: 'CM-' + randomUUID().slice(0, 6),
    capacity: 2,
  });
  const draft = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 2, modifiers: [] }],
  });
  const order = await staffApi(request, `/orders/${draft.id}/confirm`, {});
  let attempts = 0,
    downloads = 0;
  let servedPdf: Buffer = Buffer.alloc(0);
  page.on('download', () => downloads++);
  await page.route(`**/api/v1/orders/${order.id}/receipt.pdf?*`, async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Prévia indisponível para teste.' } }),
      });
    else {
      const response = await route.fetch();
      servedPdf = await response.body();
      await route.fulfill({ response });
    }
  });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/pedidos');
  await page
    .getByRole('searchbox', { name: 'Buscar pedidos e fichas', exact: true })
    .fill(order.id.slice(0, 6));
  const row = page
    .getByRole('table', { name: 'Lista de pedidos' })
    .locator('tbody tr')
    .filter({ hasText: '#' + order.id.slice(0, 6).toUpperCase() });
  const print = row.getByRole('button', { name: /^Imprimir pedido/ });
  await print.click();
  const menu = page.getByRole('menu', { name: /^Imprimir pedido/ });
  await expect(
    menu.getByRole('menuitem', { name: 'PDF · Visualizar cupom', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(print).toBeFocused();
  await print.click();
  await page.screenshot({ path: 'docs/screenshots/pedido-menu-impressao.png' });
  await menu.getByRole('menuitem', { name: 'PDF · Visualizar cupom', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Prévia PDF do pedido', exact: true });
  // Native scrollbars used to change the measured width as the bitmap appeared/disappeared.
  await page.addStyleTag({
    content:
      '.pdf-preview-scroll::-webkit-scrollbar { display: block !important; width: 17px !important; height: 17px !important; }',
  });
  await page.setViewportSize({ width: 1440, height: 800 });
  async function expectStablePdf() {
    await expect(preview.getByRole('img', { name: 'Página 1 do PDF', exact: true })).toBeVisible();
    const frames = await preview.evaluate(
      (element) =>
        new Promise<{ width: number; left: number; visible: boolean; busy: boolean }[]>(
          (resolve) => {
            const canvas = element.querySelector('canvas')!;
            const area = element.querySelector('.pdf-preview-viewport')!;
            const samples: { width: number; left: number; visible: boolean; busy: boolean }[] = [];
            const until = performance.now() + 750;
            function sample() {
              const rect = canvas.getBoundingClientRect();
              samples.push({
                width: Math.round(rect.width),
                left: Math.round(rect.left),
                visible: rect.height > 0 && getComputedStyle(canvas).visibility === 'visible',
                busy: area.getAttribute('aria-busy') === 'true',
              });
              if (performance.now() < until) requestAnimationFrame(sample);
              else resolve(samples);
            }
            requestAnimationFrame(sample);
          },
        ),
    );
    expect(frames.every((frame) => frame.visible && !frame.busy)).toBe(true);
    expect(new Set(frames.map((frame) => `${frame.width}:${frame.left}`)).size).toBe(1);
  }
  await expect(preview.getByRole('alert')).toContainText('Não foi possível preparar a prévia.');
  await expect(preview.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeDisabled();
  expect(downloads).toBe(0);
  const response = page.waitForResponse(
    (value) => value.url().includes(`/orders/${order.id}/receipt.pdf`) && value.ok(),
  );
  await preview.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await response;
  await expect(preview.getByRole('img', { name: 'Página 1 do PDF', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeEnabled();
  await expectStablePdf();
  expect(downloads).toBe(0);
  await page.screenshot({ path: 'docs/screenshots/pedido-pdf-previa-desktop.png' });
  const download = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
  const file = await download;
  const fs = await import('node:fs/promises');
  expect((await fs.readFile((await file.path())!)).equals(servedPdf)).toBe(true);
  expect(attempts).toBe(2);
  await preview.getByLabel('Zoom do PDF', { exact: true }).selectOption('1.25');
  await expectStablePdf();
  await preview.getByLabel('Zoom do PDF', { exact: true }).selectOption('1');
  await preview.getByLabel('Largura do PDF', { exact: true }).selectOption('58');
  await expectStablePdf();
  await page.setViewportSize({ width: 390, height: 844 });
  // Wait for the requested responsive resize before sampling steady frames.
  await expect
    .poll(() =>
      preview.evaluate((element) => {
        const canvas = element.querySelector('canvas')!,
          area = element.querySelector('.pdf-preview-scroll')!;
        return canvas.getBoundingClientRect().width <= area.clientWidth - 32;
      }),
    )
    .toBe(true);
  await expect(preview.getByRole('img', { name: 'Página 1 do PDF', exact: true })).toBeVisible();
  await expectMobileModalLayout(preview);
  await expectStablePdf();
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await expect(preview.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: 'docs/screenshots/pedido-pdf-previa-mobile.png' });
  await preview.getByRole('button', { name: 'Fechar prévia', exact: true }).click();
  await print.click();
  expect(
    await menu.evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
  ).toBe(true);
  await menu.getByRole('menuitem', { name: 'Cupom · Impressora térmica', exact: true }).click();
  const thermal = page.getByRole('dialog', { name: 'Cupom do pedido', exact: true });
  await expectMobileModalLayout(thermal);
  await thermal.getByRole('combobox', { name: 'Impressora do cupom', exact: true }).fill(tag);
  await page.getByRole('option', { name: tag + ' · recibo-menu', exact: true }).click();
  await thermal.getByRole('button', { name: 'Enviar para térmica', exact: true }).click();
  await expect(thermal.locator('.receipt-job')).toContainText('Cupom na fila.');
  const jobs = (await staffApi(request, '/print/jobs')).filter(
    (job: any) => job.printer_id === printer.id,
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0].source_order_id).toBe(order.id);
  await expect(
    thermal.getByRole('button', { name: 'Aguardando impressão…', exact: true }),
  ).toBeDisabled();
});

test('estoque limita balcão, mesa e cliente e recusa saldo disputado antes de salvar', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 1050 });
  const tag = 'Saldo UI ' + randomUUID().slice(0, 6);
  const product = await staffApi(request, '/products', {
    name: tag,
    price: '3.00',
    stock_policy: 'ON_DELIVERY',
  });
  const locations = await staffApi(request, '/stock-locations');
  const balance = await staffApi(request, '/stock-balances', {
    product_id: product.id,
    location_id: locations.find((item: any) => item.is_default).id,
  });
  await staffApi(request, '/inventory/adjustments', {
    balance_id: balance.id,
    type: 'PURCHASE',
    quantity: '2.000',
    reason: 'Saldo do teste UI',
  });
  const table = await staffApi(request, '/tables', {
    number: 'ST-' + randomUUID().slice(0, 6),
    capacity: 2,
  });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/pedidos');
  await page.getByRole('button', { name: 'Pedido avulso', exact: true }).click();
  const counter = page.getByRole('dialog', { name: 'Novo pedido avulso', exact: true });
  await counter.getByRole('searchbox', { name: 'Buscar produto avulso' }).fill(tag);
  const add = counter.getByRole('button', { name: 'Adicionar ' + tag, exact: true });
  await expect(add).toContainText('2 disponível(is)');
  await add.click();
  await add.click();
  await expect(
    counter.getByRole('button', { name: 'Aumentar ' + tag, exact: true }),
  ).toBeDisabled();
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  // Aria-disabled blocks addition; a pointer click still explains why.
  await add.click({ force: true });
  await expect(page.getByRole('alert').filter({ hasText: 'Sem estoque disponível' })).toBeVisible();
  let competingOrder: any;
  await page.route(
    '**/api/v1/catalog/operational',
    async (route) => {
      const response = await route.fetch();
      competingOrder = await staffApi(request, '/orders/counter', {
        items: [{ product_id: product.id, quantity: 2, modifiers: [] }],
        expected_total: '6.00',
        method: 'PIX_MANUAL',
        deliver_available: true,
      });
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await counter
    .getByRole('button', { name: 'Confirmar recebimento e pedido', exact: true })
    .click();
  await expect(counter.getByRole('alert')).toContainText('estoque disponível insuficiente');
  await expect(add).toContainText('Sem estoque');
  await expect(
    counter.getByRole('button', { name: 'Confirmar recebimento e pedido', exact: true }),
  ).toBeDisabled();
  expect(competingOrder.order.status).toBe('CONFIRMED');
  const sales = (await staffApi(request, '/orders')).filter((order: any) =>
    order.items_summary?.includes(tag),
  );
  expect(sales).toHaveLength(1);
  await page.screenshot({ path: 'docs/screenshots/estoque-venda-concorrente.png' });
  await counter.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await page.goto(`http://127.0.0.1:35173/salao/atendimento/${table.id}`);
  const attendance = page.getByRole('dialog', { name: 'Mesa ' + table.number, exact: true });
  const tableProduct = attendance.locator('.pos-product').filter({ hasText: tag });
  await expect(tableProduct).toContainText('Sem estoque');
  await expect(tableProduct).toHaveAttribute('aria-disabled', 'true');
  await tableProduct.click({ force: true });
  await expect(attendance.locator('.draft-line')).toHaveCount(0);
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const customer = await customerContext.newPage();
    customer.setDefaultTimeout(10000);
    await customer.goto(`http://127.0.0.1:35174/?bar=${slug}&table=${table.public_code}`);
    await customer.getByLabel('Seu nome', { exact: true }).fill('Cliente saldo');
    await customer.getByLabel('Telefone', { exact: true }).fill('11977776666');
    await customer.getByRole('button', { name: /^Entrar na mesa/ }).click();
    const card = customer.locator('.menu-card').filter({ hasText: tag });
    await expect(card).toContainText('Sem estoque');
    await card.click({ force: true });
    await expect(customer.getByRole('dialog', { name: tag, exact: true })).toHaveCount(0);
    await expect(customer.getByRole('button', { name: 'Ver meu pedido', exact: true })).toHaveCount(
      0,
    );
    await customer.screenshot({ path: 'docs/screenshots/cliente-sem-estoque.png', fullPage: true });
    await staffApi(request, '/inventory/adjustments', {
      balance_id: balance.id,
      type: 'PURCHASE',
      quantity: '1.000',
      reason: 'Reposição do teste UI',
    });
    await customer.reload();
    await expect(card).toContainText('1 disponível(is)');
    await card.click({ force: true });
    await customer.getByRole('button', { name: 'Adicionar ao pedido', exact: false }).click();
    await customer.getByRole('button', { name: 'Ver meu pedido', exact: true }).click();
    const cart = customer.getByRole('dialog', { name: 'Seu carrinho', exact: true });
    await expect(cart).toContainText(tag);
    await cart.getByRole('button', { name: 'Continuar escolhendo', exact: true }).click();
    await card.click({ force: true });
    await expect(customer.getByRole('dialog', { name: tag, exact: true })).toHaveCount(0);
  } finally {
    await customerContext.close();
  }
});

test('cardápio online público permite retirada sem mesa e mantém fichas do cliente', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:35174/?bar=${slug}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ler QR da mesa', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Pedir para retirada', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Buscar produto', { exact: true }).fill('Cerveja Pilsen');
  await page.getByRole('button', { name: 'Cerveja Pilsen 600 ml' }).click();
  await page.getByRole('button', { name: 'Adicionar ao pedido' }).click();
  await page.getByRole('button', { name: 'Ver meu pedido', exact: true }).click();
  await page.getByRole('button', { name: 'Identificar e continuar' }).click();
  const identity = page.getByRole('dialog', {
    name: 'Identificar pedido para retirada',
    exact: true,
  });
  await identity.getByLabel('Seu nome', { exact: true }).fill('Retirada online E2E');
  const phone = identity.getByLabel('Telefone', { exact: true });
  await phone.fill('abc');
  await expect(phone).toHaveValue('');
  await phone.fill('1195555');
  expect(await phone.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await phone.fill('+55 (11) 95555-4444');
  await expect(phone).toHaveValue('(11) 95555-4444');
  expect(await phone.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  await expect(identity.getByText('Código de participação', { exact: false })).toHaveCount(0);
  const identifyRequest = page.waitForRequest(
    (request) => request.url().endsWith('/counter-sessions') && request.method() === 'POST',
  );
  await identity.getByRole('button', { name: 'Continuar para retirada' }).click();
  expect((await identifyRequest).postDataJSON().phone).toBe('11955554444');
  await expect(page.getByText('AMBIENTE SANDBOX', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Simular aprovação do pagamento' }).click();
  await expect(page.locator('.mini-ticket')).toHaveCount(1);
  await expect(page.locator('.mini-ticket')).toContainText('Balcão');
  await expect(page.getByRole('button', { name: 'Pedir para trazer' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Exibir QR e código de barras' }).click();
  await expect(page.locator('.ticket-document img')).toHaveCount(1);
  await expect(page.locator('.ticket-document canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.reload();
  await expect(page.locator('.mini-ticket')).toHaveCount(1);
  const orders = await staffApi(request, '/orders');
  const order = orders.find((row: any) => row.customer_name === 'Retirada online E2E');
  expect(order).toMatchObject({
    service_mode: 'COUNTER',
    source: 'CUSTOMER',
    payment_policy_snapshot: 'PREPAID',
    table_id: null,
    status: 'CONFIRMED',
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test('cardápio online lê mesa por link ou câmera e libera a câmera ao identificar', async ({
  page,
  request,
}) => {
  const table = await staffApi(request, '/tables', {
    number: 'QR-' + randomUUID().slice(0, 5),
    capacity: 4,
  });
  const link = `http://127.0.0.1:35174/?bar=${slug}&table=${table.public_code}`;
  const { default: QRCode } = await import('qrcode');
  const qr = await QRCode.toDataURL(link, { width: 420, margin: 4 });
  await page.addInitScript(
    ({ qr }) => {
      const state = window as any;
      state.__tableStreams = [];
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 640;
        const context = canvas.getContext('2d')!;
        const image = new Image();
        image.src = qr;
        await image.decode();
        context.fillStyle = 'white';
        context.fillRect(0, 0, 640, 640);
        context.drawImage(image, 110, 110);
        const stream = canvas.captureStream(8);
        state.__tableStreams.push(stream);
        return stream;
      };
    },
    { qr },
  );
  await page.goto(`http://127.0.0.1:35174/?bar=${slug}`);
  await page.getByRole('button', { name: 'Ler QR da mesa', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: 'Ler QR Code da mesa', exact: true });
  await scanner.getByLabel('Link ou código da mesa', { exact: true }).fill('https://outro.local/');
  await scanner.getByRole('button', { name: 'Usar esta mesa', exact: true }).click();
  await expect(scanner.getByRole('alert')).toBeVisible();
  await scanner.getByRole('button', { name: 'Ativar câmera', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Entrar na mesa', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp('table=' + table.public_code));
  expect(await page.evaluate(() => (window as any).__tableStreams.length)).toBe(1);
  expect(
    await page.evaluate(() =>
      (window as any).__tableStreams.every((stream: MediaStream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
    ),
  ).toBeTruthy();
  await page.getByLabel('Seu nome', { exact: true }).fill('Cliente QR online');
  await page.getByLabel('Telefone', { exact: true }).fill('11955553333');
  await page.getByRole('button', { name: 'Entrar na mesa' }).click();
  await expect(page.locator('.venue-pill')).toContainText('Mesa ' + table.number);
  await page.getByRole('button', { name: 'Ler outra mesa', exact: true }).click();
  await scanner.getByLabel('Link ou código da mesa', { exact: true }).fill(link);
  await scanner.getByRole('button', { name: 'Usar esta mesa', exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect(page.locator('.venue-pill')).toContainText('Mesa ' + table.number);
  await page.getByRole('button', { name: 'Pedir para retirada', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Trocar atendimento?', exact: true })
    .getByRole('button', { name: 'Mudar para retirada', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Identificar pedido para retirada', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Ler QR da mesa', exact: true }).click();
  await scanner.getByLabel('Link ou código da mesa', { exact: true }).fill(link);
  await scanner.getByRole('button', { name: 'Usar esta mesa', exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.venue-pill')).toContainText('Mesa ' + table.number);
});

test('copia credenciais com aplicativo do perfil e compartilha o link público do cliente', async ({
  page,
  request,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).__copies = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copies.push(text);
        },
      },
    });
  });
  await login(page, 35173);
  const card = page.getByRole('region', { name: 'Compartilhar cardápio online', exact: true });
  const customerUrl = `http://127.0.0.1:35174/${fixture.slug}/`;
  await expect(card.getByLabel('Link do cliente', { exact: true })).toHaveValue(customerUrl);
  await card.getByRole('button', { name: 'Copiar link do cliente', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copies.at(-1))).toBe(customerUrl);
  const publicPage = await context.newPage();
  await publicPage.goto(customerUrl);
  await expect(publicPage.locator('.menu-card').first()).toBeVisible();
  await expect(publicPage.getByRole('dialog')).toHaveCount(0);
  await publicPage.close();
  await page.goto('http://127.0.0.1:35173/equipe');
  await page.getByRole('button', { name: 'Adicionar funcionário', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Adicionar funcionário', exact: true });
  const name = 'Acessos ' + randomUUID().slice(0, 5),
    account = 'access-' + randomUUID().slice(0, 8) + '@test.local';
  await form.getByLabel('Nome', { exact: true }).fill(name);
  await form.getByLabel('E-mail', { exact: true }).fill(account);
  await form.getByLabel('Senha inicial', { exact: true }).fill(password);
  await form.getByRole('combobox', { name: 'Perfil', exact: true }).click();
  await page.getByRole('option', { name: 'Garçom', exact: true }).click();
  await form.getByRole('button', { name: 'Cadastrar funcionário', exact: true }).click();
  const credentials = page.getByRole('dialog', {
    name: 'Copiar credenciais · ' + name,
    exact: true,
  });
  await expect(credentials.getByLabel('Senha de acesso', { exact: true })).toHaveValue(password);
  await expect(credentials.getByLabel('Link de acesso', { exact: true })).toHaveValue(
    `http://127.0.0.1:35175/${fixture.slug}/`,
  );
  await credentials.getByRole('button', { name: 'Copiar credenciais', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copies.at(-1)))
    .toContain('Senha: ' + password);
  await credentials.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar funcionários' }).fill(name);
  const row = page.locator('.team-table tbody tr').filter({ hasText: account });
  await row.getByRole('button', { name: 'Copiar credenciais de ' + name, exact: true }).click();
  await expect(credentials.getByLabel('Senha de acesso', { exact: true })).toHaveValue('');
  await credentials
    .getByLabel('Definir uma nova senha para este funcionário', { exact: true })
    .check();
  const replacement = 'ReplacementTestOnly1!';
  await credentials.getByLabel('Nova senha', { exact: true }).fill(replacement);
  await credentials
    .getByRole('button', { name: 'Salvar nova senha e copiar', exact: true })
    .click();
  await expect(
    credentials.getByText('Nova senha salva. Você pode copiar novamente sem alterar a senha.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copies.at(-1)))
    .toContain('Senha: ' + replacement);
  await credentials.getByRole('button', { name: 'Fechar', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(replacement);
  const members = await staffApi(request, '/staff');
  const testMember = members.find((member: any) => member.email === account);
  for (const [roleName, port] of [
    ['Garçom', 35175],
    ['Cozinha', 35176],
    ['Caixa', 35173],
  ] as const) {
    if (roleName !== 'Garçom') {
      const patched = await request.patch(`http://127.0.0.1:33000/api/v1/staff/${testMember.id}`, {
        headers: { authorization: 'Bearer ' + staffToken, 'Idempotency-Key': randomUUID() },
        data: {
          enabled: true,
          role_id: fixture.roles.find((role: any) => role.name === roleName).id,
        },
      });
      expect(patched.ok(), await patched.text()).toBeTruthy();
      await expect(row).toContainText(roleName);
    }
    await row.getByRole('button', { name: 'Copiar credenciais de ' + name, exact: true }).click();
    const expectedUrl = `http://127.0.0.1:${port}/${fixture.slug}/`;
    await expect(credentials.getByLabel('Link de acesso', { exact: true })).toHaveValue(
      expectedUrl,
    );
    await credentials.getByLabel('Senha de acesso', { exact: true }).fill(replacement);
    await credentials.getByRole('button', { name: 'Copiar credenciais', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__copies.at(-1)))
      .toContain(`Link: ${expectedUrl}\nE-mail: ${account}\nSenha: ${replacement}`);
    await credentials.getByRole('button', { name: 'Fechar', exact: true }).click();
    const staffPage = await context.newPage();
    await staffPage.goto(expectedUrl);
    await expect(staffPage.getByRole('combobox', { name: 'Empresa', exact: true })).toHaveCount(0);
    await staffPage.getByLabel('E-mail', { exact: true }).fill(account);
    await staffPage.getByLabel('Senha', { exact: true }).fill(replacement);
    await staffPage.getByRole('button', { name: 'Entrar na operação' }).click();
    await expect(staffPage.getByRole('button', { name: 'Entrar na operação' })).toHaveCount(0);
    await staffPage.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await row.getByRole('button', { name: 'Copiar credenciais de ' + name, exact: true }).click();
  await expect(credentials.getByLabel('Link de acesso', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test('pedido entrega todas as fichas com cozinha em um passo no balcão e na mesa', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const food = await staffApi(request, '/products', {
    name: 'Lote cozinha ' + randomUUID().slice(0, 4),
    price: '5.00',
    stock_policy: 'ON_PRODUCTION',
    requires_production: true,
    sector: 'cozinha',
  });
  const drink = await staffApi(request, '/products', {
    name: 'Lote bebida ' + randomUUID().slice(0, 4),
    price: '3.00',
    stock_policy: 'ON_DELIVERY',
    sector: 'bar',
  });
  for (const product of [food, drink])
    await staffApi(request, '/stock-balances', {
      product_id: product.id,
      location_id: fixture.location.id,
    });
  const balances = await staffApi(request, '/inventory/balances');
  for (const product of [food, drink])
    await staffApi(request, '/inventory/adjustments', {
      balance_id: balances.find((row: any) => row.product_id === product.id).id,
      quantity: '5.000',
      type: 'PURCHASE',
      reason: 'Estoque para entrega em lote E2E',
    });
  const sale = await staffApi(request, '/orders/counter', {
    items: [food, drink].map((product) => ({ product_id: product.id, quantity: 2, modifiers: [] })),
    expected_total: '16.00',
    method: 'PIX_MANUAL',
    customer_name: 'Entrega lote E2E',
    deliver_available: false,
  });
  const order = await staffApi(request, '/orders/' + sale.order.id);
  const available = order.tickets.find((ticket: any) => ticket.status === 'AVAILABLE');
  const document = await staffApi(request, '/tickets/' + available.id);
  await staffApi(request, '/tickets/' + available.id + '/redeem', { token: document.token });
  const job = (await staffApi(request, '/production/jobs')).find(
    (job: any) => job.order_id === order.id,
  );
  await staffApi(request, '/production/jobs/' + job.id + '/status', { status: 'PREPARING' });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/pedidos/' + order.id);
  const detail = page.getByRole('dialog', {
    name: 'Pedido ' + order.id.slice(0, 8),
    exact: true,
  });
  await detail.getByRole('button', { name: 'Marcar todas como entregues', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Entregar todas as fichas?', exact: true });
  await expect(confirm).toContainText('3 ficha(s) a entregar');
  await expect(confirm).toContainText('2 ficha(s) ainda na cozinha.');
  await confirm.getByRole('button', { name: 'Voltar', exact: true }).click();
  expect(
    (await staffApi(request, '/orders/' + order.id)).tickets.filter(
      (ticket: any) => ticket.status === 'REDEEMED',
    ),
  ).toHaveLength(1);
  await detail.getByRole('button', { name: 'Marcar todas como entregues', exact: true }).click();
  let submissions = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/deliver-tickets')) submissions++;
  });
  await confirm.getByRole('button', { name: 'Confirmar entrega de todas', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(detail.locator('.ticket-context-card')).toHaveCount(4);
  await expect(detail.locator('.ticket-context-card').filter({ hasText: 'Entregue' })).toHaveCount(
    4,
  );
  await expect(
    detail.getByRole('button', { name: 'Marcar todas como entregues', exact: true }),
  ).toHaveCount(0);
  expect(submissions).toBe(1);
  expect((await staffApi(request, '/tabs/' + sale.order.tab_id)).status).toBe('CLOSED');
  expect(
    (await staffApi(request, '/production/jobs')).some((row: any) => row.order_id === order.id),
  ).toBe(false);
  let currentBalances = await staffApi(request, '/inventory/balances');
  for (const product of [food, drink])
    expect(currentBalances.find((row: any) => row.product_id === product.id)).toMatchObject({
      physical_quantity: '3.000',
      reserved_quantity: '0.000',
    });
  const table = await staffApi(request, '/tables', {
    number: 'BL-' + randomUUID().slice(0, 4),
    capacity: 4,
  });
  const tableOrder = await staffApi(request, '/orders', {
    table_id: table.id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [food, drink].map((product) => ({ product_id: product.id, quantity: 1, modifiers: [] })),
  });
  await staffApi(request, '/orders/' + tableOrder.id + '/confirm', {});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:35173/salao/atendimento/' + table.id);
  const attendance = page.getByRole('dialog', { name: 'Mesa ' + table.number, exact: true });
  await attendance
    .getByRole('button', {
      name: 'Ver pedido #' + tableOrder.id.slice(0, 6).toUpperCase(),
      exact: true,
    })
    .click();
  const tableDetail = page.getByRole('dialog', {
    name: 'Pedido #' + tableOrder.id.slice(0, 6).toUpperCase(),
    exact: true,
  });
  await tableDetail
    .getByRole('button', { name: 'Marcar todas como entregues', exact: true })
    .click();
  await expect(confirm).toContainText('2 ficha(s) a entregar');
  expect(await confirm.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/order-bulk-delivery-mobile.png' });
  await confirm.getByRole('button', { name: 'Confirmar entrega de todas', exact: true }).click();
  await expect(
    tableDetail.locator('.ticket-context-card').filter({ hasText: 'Entregue' }),
  ).toHaveCount(2);
  expect((await staffApi(request, '/tables/' + table.id + '/session')).session.status).toBe('OPEN');
  currentBalances = await staffApi(request, '/inventory/balances');
  for (const product of [food, drink])
    expect(currentBalances.find((row: any) => row.product_id === product.id)).toMatchObject({
      physical_quantity: '2.000',
      reserved_quantity: '0.000',
    });
  expect(errors).toEqual([]);
});

test('QR da mesa no cabeçalho oferece prévia PDF, etiqueta, navegador e fila térmica', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const table = await staffApi(request, '/tables', {
    number: 'QRP-' + randomUUID().slice(0, 4),
    capacity: 4,
  });
  const printer = await staffApi(request, '/printers', {
    name: 'Etiqueta da mesa ' + randomUUID().slice(0, 4),
    sector: 'etiquetas',
  });
  await login(page, 35173);
  await page.goto('http://127.0.0.1:35173/salao/atendimento/' + table.id);
  const attendance = page.getByRole('dialog', { name: 'Mesa ' + table.number, exact: true });
  await expect(
    attendance
      .locator('.modal-header-actions')
      .getByRole('button', { name: 'QR Code da mesa', exact: true }),
  ).toBeVisible();
  await attendance.getByRole('button', { name: 'QR Code da mesa', exact: true }).click();
  const qr = page.getByRole('dialog', { name: 'QR Code da mesa ' + table.number, exact: true });
  await expect(
    qr.getByRole('img', { name: 'QR Code da mesa ' + table.number, exact: true }),
  ).toBeVisible();
  const link = await qr.getByLabel('Link da mesa', { exact: true }).inputValue();
  expect(new URL(link).origin).toBe('http://127.0.0.1:35174');
  expect(new URL(link).pathname).toBe('/' + fixture.slug + '/');
  expect(new URL(link).searchParams.get('table')).toBe(table.public_code);
  let downloads = 0;
  page.on('download', () => downloads++);
  await qr.getByRole('button', { name: 'Visualizar PDF', exact: true }).click();
  const pdf = page.getByRole('dialog', { name: 'PDF do QR · Mesa ' + table.number, exact: true });
  await expect(pdf.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeEnabled();
  expect(downloads).toBe(0);
  const downloaded = page.waitForEvent('download');
  await pdf.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toContain('qr-mesa-' + table.number + '-A4.pdf');
  await pdf.getByRole('button', { name: 'Fechar', exact: true }).click();
  await qr.getByLabel('Formato do QR para impressão', { exact: true }).selectOption('LABEL');
  await expect(
    qr.getByRole('button', { name: 'Imprimir no navegador', exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const original = window.open.bind(window);
    window.open = ((...args: any[]) => {
      const child = original(...(args as [string, string, string]));
      if (child)
        child.print = () => {
          (child as any).__printed = true;
        };
      return child;
    }) as typeof window.open;
  });
  const popupEvent = page.waitForEvent('popup');
  await qr.getByRole('button', { name: 'Imprimir no navegador', exact: true }).click();
  const popup = await popupEvent;
  await expect(
    popup.getByRole('heading', { name: 'Mesa ' + table.number, exact: true }),
  ).toBeVisible();
  await expect.poll(() => popup.evaluate(() => (window as any).__printed)).toBe(true);
  await popup.close();
  await qr.getByRole('combobox', { name: 'Impressora do QR da mesa', exact: true }).click();
  await page.getByRole('option', { name: printer.name + ' · etiquetas', exact: true }).click();
  await qr.getByLabel('Papel térmico do QR', { exact: true }).selectOption('58');
  await qr.getByRole('button', { name: 'Imprimir na térmica', exact: true }).click();
  await expect(qr.getByRole('status').filter({ hasText: 'QR na fila.' })).toBeVisible();
  const jobs = (await staffApi(request, '/print/jobs')).filter(
    (job: any) => job.source_table_id === table.id,
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ document_kind: 'TABLE_QR', paper_width: 58, status: 'PENDING' });
  await staffApi(request, '/print/jobs/' + jobs[0].id + '/cancel', {
    reason: 'Teste de etiqueta concluído',
  });
  await expect(qr.getByRole('status').filter({ hasText: 'Impressão cancelada.' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await qr.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/table-qr-print-mobile.png' });
  await qr.getByRole('button', { name: 'Fechar QR', exact: true }).click();
  await expect(attendance).toBeVisible();
  await expectMobileTableHeader(attendance);
  await attendance.getByRole('button', { name: 'QR Code da mesa', exact: true }).click();
  await expect(
    qr.getByRole('img', { name: 'QR Code da mesa ' + table.number, exact: true }),
  ).toBeVisible();
  await qr.getByRole('button', { name: 'Fechar QR', exact: true }).click();
  await attendance.getByRole('button', { name: 'Ler ficha', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: 'Leitura rápida de fichas', exact: true });
  await expect(scanner.getByLabel('Código da ficha', { exact: true })).toBeFocused();
  await scanner.getByRole('button', { name: 'Concluir leitura', exact: true }).click();
  await attendance.getByRole('button', { name: 'Fechar', exact: true }).click();
  const dark = page.getByRole('button', { name: 'Ativar tema escuro', exact: true });
  if (await dark.isVisible()) await dark.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`http://127.0.0.1:35173/${fixture.slug}/salao/atendimento/${table.id}`);
  await expectMobileTableHeader(attendance);
  await page.screenshot({ path: '.local/screenshots/mesa-header-mobile-dark.png' });
  expect((await staffApi(request, '/tables/' + table.id + '/session')).session).toBeNull();
  expect(errors).toEqual([]);
});

test('cliente mobile organiza cardápio, carrinho, fichas e consumo com navegação ao alcance do polegar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:35174/${fixture.slug}/`);
  await expect(
    page.getByRole('button', { name: 'Pedir para retirada', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.menu-card').first()).toBeVisible();
  const productCount = await page.locator('.menu-card').count();
  await page.getByLabel('Buscar produto', { exact: true }).fill('Nenhum produto com este nome');
  await expect(page.getByText('Nenhum produto encontrado.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.locator('.menu-card')).toHaveCount(productCount);
  await page.screenshot({ path: 'docs/screenshots/cliente-cardapio-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Água mineral', exact: true }).click();
  const product = page.getByRole('dialog', { name: 'Água mineral', exact: true });
  await expect(
    product.getByRole('button', { name: 'Adicionar ao pedido', exact: false }),
  ).toBeInViewport();
  await product.getByRole('button', { name: 'Adicionar ao pedido', exact: false }).click();
  const dock = page.getByRole('button', { name: 'Ver meu pedido', exact: true });
  await expect(dock).toBeInViewport({ ratio: 1 });
  await expect(dock).toContainText('R$ 5,00');
  await dock.click();
  await page.getByRole('button', { name: 'Identificar e continuar', exact: false }).click();
  const identity = page.getByRole('dialog', {
    name: 'Identificar pedido para retirada',
    exact: true,
  });
  await identity.getByLabel('Seu nome', { exact: true }).fill('Cliente mobile');
  await identity.getByLabel('Telefone', { exact: true }).fill('11977776666');
  await identity.getByRole('button', { name: 'Continuar para retirada', exact: false }).click();
  await page.getByRole('button', { name: 'Simular aprovação do pagamento', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Navegação do cliente', exact: true });
  await expect(nav).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('heading', { name: 'Minhas fichas', exact: true })).toBeVisible();
  await expect(page.locator('.mini-ticket')).toContainText('Pronto para retirar.');
  await page.screenshot({ path: 'docs/screenshots/cliente-fichas-mobile.png', fullPage: true });
  await nav.getByRole('button', { name: 'Consumo', exact: true }).click();
  await expect(page).toHaveURL(/\/consumo$/);
  const summary = page.getByRole('region', { name: 'Resumo do meu consumo', exact: true });
  await expect(summary).toContainText('Total consumido');
  await expect(summary).toContainText('R$ 5,00');
  await expect(summary).toContainText('Falta pagarR$ 0,00');
  await expect(page.locator('.customer-order-card')).toContainText('1 × Água mineral');
  await expect(page.locator('.customer-tab')).toContainText('R$ 5,00');
  await page.screenshot({
    path: 'docs/screenshots/cliente-consumo-mobile-dark.png',
    fullPage: true,
  });
  if (await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).count())
    await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(nav).toBeInViewport({ ratio: 1 });
  expect(
    await nav
      .getByRole('button', { name: 'Consumo', exact: true })
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: 'docs/screenshots/cliente-consumo-mobile-light.png',
    fullPage: true,
  });
  await nav.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await expect(page.locator('.menu-card')).toHaveCount(productCount);
  await expect(
    page.getByRole('button', { name: 'Instalar aplicativo', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('carrinho flutuante mostra quantidade e total, abre painel mobile e preserva itens entre etapas', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:35174/${fixture.slug}/`);
  const dock = page.getByRole('button', { name: 'Ver meu pedido', exact: true });
  const cart = page.getByRole('dialog', { name: 'Seu carrinho', exact: true });
  await expect(dock).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Água mineral', exact: true }).click();
    await page.getByRole('button', { name: 'Adicionar ao pedido', exact: false }).click();
  }
  await expect(dock).toContainText('2 itens');
  await expect(dock).toContainText('R$ 10,00');
  await expect(dock.locator('.customer-cart-count')).toHaveText('2');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(dock).toBeInViewport({ ratio: 1 });
  await dock.click();
  await expect(cart).toBeVisible();
  await expect(cart.locator('.customer-cart-line')).toHaveCount(2);
  await expect(cart.locator('.customer-cart-total')).toContainText('R$ 10,00');
  await page.screenshot({ path: 'docs/screenshots/cliente-carrinho-mobile.png' });
  await cart.getByRole('button', { name: 'Remover Água mineral', exact: true }).first().click();
  await expect(cart.locator('.customer-cart-total')).toContainText('R$ 5,00');
  await cart.getByRole('button', { name: 'Continuar escolhendo', exact: true }).click();
  await expect(cart).toHaveCount(0);
  await expect(dock.locator('.customer-cart-count')).toHaveText('1');
  await dock.click();
  await cart.getByRole('button', { name: 'Identificar e continuar', exact: true }).click();
  const identity = page.getByRole('dialog', {
    name: 'Identificar pedido para retirada',
    exact: true,
  });
  await expect(identity).toBeVisible();
  await expect(cart).toHaveCount(0);
  await identity.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(cart).toBeVisible();
  await expect(cart.locator('.customer-cart-line')).toHaveCount(1);
  await cart.getByRole('button', { name: 'Remover Água mineral', exact: true }).click();
  await expect(
    cart.getByRole('heading', { name: 'Seu carrinho está vazio', exact: true }),
  ).toBeVisible();
  await expect(
    cart.getByRole('button', { name: 'Identificar e continuar', exact: true }),
  ).toHaveCount(0);
  await cart.getByRole('button', { name: 'Continuar escolhendo', exact: true }).click();
  await expect(dock).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Água mineral', exact: true }).click();
    await page.getByRole('button', { name: 'Adicionar ao pedido', exact: false }).click();
  }
  await expect(dock).toBeInViewport({ ratio: 1 });
  await expect(dock).toContainText('6 itens');
  await dock.click();
  const next = cart.getByRole('button', { name: 'Identificar e continuar', exact: true });
  await expect(next).toBeInViewport({ ratio: 1 });
  await cart.locator('.customer-cart-body').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(next).toBeInViewport({ ratio: 1 });
  expect(await cart.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/cliente-carrinho-mobile-320.png' });
  await cart.getByRole('button', { name: 'Continuar escolhendo', exact: true }).click();
  expect(errors).toEqual([]);
});

test('configura horários e produtos esgotados nos cardápios com agenda automática e edição mobile', async ({
  page,
  browser,
  request,
}) => {
  const initial = await staffApi(request, '/settings');
  const patchSettings = async (body: unknown) => {
    const response = await request.patch('http://127.0.0.1:33000/api/v1/settings', {
      headers: { authorization: `Bearer ${staffToken}`, 'Idempotency-Key': randomUUID() },
      data: body,
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const product = await staffApi(request, '/products', {
    name: 'Esgotado cardápio ' + randomUUID().slice(0, 5),
    price: '8.00',
    stock_policy: 'ON_DELIVERY',
    stock_location_id: fixture.location.id,
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customer = await context.newPage();
  try {
    await login(page, 35173);
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('tab', { name: 'Funcionamento e cardápio', exact: true }).click();
    await page.getByRole('button', { name: 'Editar funcionamento', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Funcionamento e cardápio', exact: true });
    await modal
      .getByRole('checkbox', { name: 'Controlar abertura pelos horários da semana', exact: true })
      .check();
    await modal.getByLabel('Abertura de Segunda-feira, período 1', { exact: true }).fill('11:00');
    await modal.getByLabel('Fechamento de Segunda-feira, período 1', { exact: true }).fill('14:00');
    await modal
      .getByRole('button', { name: 'Adicionar período em Segunda-feira', exact: true })
      .click();
    await modal.getByLabel('Abertura de Segunda-feira, período 2', { exact: true }).fill('18:00');
    await modal.getByLabel('Fechamento de Segunda-feira, período 2', { exact: true }).fill('23:00');
    for (const name of [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ])
      await modal.getByRole('checkbox', { name, exact: true }).uncheck();
    await modal
      .getByRole('checkbox', { name: 'Mostrar produtos sem estoque nos cardápios', exact: true })
      .uncheck();
    await modal.getByRole('button', { name: 'Salvar funcionamento', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByText('Produtos sem estoque ocultos', { exact: true })).toBeVisible();
    await expect(page.locator('.operation-settings-status')).toContainText('Pedidos fechados');
    await customer.goto(`http://127.0.0.1:35174/${fixture.slug}/`);
    await expect(customer.getByRole('button', { name: product.name, exact: true })).toHaveCount(0);
    await expect(customer.getByText('Fechado no momento', { exact: true })).toBeVisible();
    await customer.getByText('Ver horários de funcionamento', { exact: true }).click();
    await expect(customer.locator('.customer-opening-hours dl > div')).toHaveCount(7);
    await customer.getByRole('button', { name: 'Água mineral', exact: true }).click();
    await customer.getByRole('button', { name: 'Adicionar ao pedido', exact: false }).click();
    await customer.getByRole('button', { name: 'Ver meu pedido', exact: true }).click();
    const cart = customer.getByRole('dialog', { name: 'Seu carrinho', exact: true });
    await expect(
      cart.getByRole('button', { name: 'Identificar e continuar', exact: true }),
    ).toBeDisabled();
    await expect(cart.getByRole('alert')).toContainText('fora do horário');
    await page.screenshot({
      path: 'docs/screenshots/configuracoes-funcionamento.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Editar funcionamento', exact: true }).click();
    for (const name of [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]) {
      await modal.getByRole('checkbox', { name, exact: true }).check();
      const day = modal
        .locator('.business-hours-day')
        .filter({ has: page.getByRole('checkbox', { name, exact: true }) });
      await day.getByRole('checkbox', { name: '24 horas', exact: true }).check();
    }
    await modal
      .getByRole('checkbox', { name: 'Mostrar produtos sem estoque nos cardápios', exact: true })
      .check();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      modal.getByRole('button', { name: 'Salvar funcionamento', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/configuracoes-horarios-mobile.png' });
    await modal.getByRole('button', { name: 'Salvar funcionamento', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await customer.reload();
    await expect(customer.getByText('Aberto para pedidos', { exact: true })).toBeVisible();
    const out = customer.getByRole('button', { name: product.name, exact: true });
    await expect(out).toBeVisible();
    await expect(out).toHaveAttribute('aria-disabled', 'true');
    await expect(out).toContainText('Sem estoque');
  } finally {
    await context.close();
    await patchSettings({
      is_open: Boolean(initial.is_open),
      opening_hours: initial.opening_hours,
      show_out_of_stock: Boolean(initial.show_out_of_stock),
    });
  }
});

test('cliente busca sem acentos com campo alinhado e adiciona várias unidades em um único lançamento', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:35174/${fixture.slug}/`);
  const search = page.getByLabel('Buscar produto', { exact: true });
  for (const width of [980, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await search.fill('  AGUA MINERAL  ');
    await expect(page.locator('.menu-card')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Água mineral', exact: true })).toBeVisible();
    const bounds = await page.locator('.customer-menu-search').evaluate((element) => {
      const box = element.getBoundingClientRect(),
        icon = element.querySelector('svg')!.getBoundingClientRect(),
        input = element.querySelector('input')!.getBoundingClientRect();
      return {
        height: box.height,
        inline:
          icon.right <= input.left &&
          Math.abs(icon.top + icon.height / 2 - (input.top + input.height / 2)) < 2,
      };
    });
    expect(bounds.height).toBeLessThanOrEqual(56);
    expect(bounds.inline).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await expect(search).toHaveValue('');
  await search.fill('500 ml');
  await expect(page.getByRole('button', { name: 'Água mineral', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Água mineral', exact: true }).click();
  const product = page.getByRole('dialog', { name: 'Água mineral', exact: true });
  const quantity = product.getByRole('textbox', { name: 'Quantidade do produto', exact: true });
  const add = product.getByRole('button', { name: 'Adicionar ao pedido', exact: false });
  await expect(quantity).toHaveValue('1');
  await expect(
    product.getByRole('button', { name: 'Diminuir quantidade', exact: true }),
  ).toBeDisabled();
  await product.getByRole('button', { name: 'Aumentar quantidade', exact: true }).click();
  await product.getByRole('button', { name: 'Aumentar quantidade', exact: true }).click();
  await expect(quantity).toHaveValue('3');
  await expect(product.locator('.customer-product-subtotal')).toContainText('R$ 15,00');
  await quantity.fill('abc');
  await expect(quantity).toHaveValue('3');
  await quantity.fill('4.5');
  await expect(quantity).toHaveValue('3');
  await quantity.fill('0');
  await expect(add).toBeDisabled();
  await quantity.fill('101');
  await expect(add).toBeDisabled();
  await quantity.fill('100');
  await expect(
    product.getByRole('button', { name: 'Aumentar quantidade', exact: true }),
  ).toBeDisabled();
  await quantity.fill('3');
  await expect(add).toBeEnabled();
  await expect(add).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'docs/screenshots/cliente-produto-quantidade-mobile.png' });
  await add.click();
  const dock = page.getByRole('button', { name: 'Ver meu pedido', exact: true });
  await expect(dock).toContainText('3 itens');
  await expect(dock).toContainText('R$ 15,00');
  await dock.click();
  const cart = page.getByRole('dialog', { name: 'Seu carrinho', exact: true });
  await expect(cart.locator('.customer-cart-line')).toHaveCount(1);
  await expect(cart.locator('.customer-cart-line')).toContainText('3×');
  await cart.getByRole('button', { name: 'Identificar e continuar', exact: true }).click();
  const identity = page.getByRole('dialog', {
    name: 'Identificar pedido para retirada',
    exact: true,
  });
  await identity.getByLabel('Seu nome', { exact: true }).fill('Cliente quantidade');
  await identity.getByLabel('Telefone', { exact: true }).fill('11999997777');
  const request = page.waitForRequest(
    (req) => req.url().endsWith('/public/counter/orders') && req.method() === 'POST',
  );
  await identity.getByRole('button', { name: 'Continuar para retirada', exact: false }).click();
  expect((await request).postDataJSON().items).toHaveLength(1);
  expect((await request).postDataJSON().items[0].quantity).toBe(3);
  await page.getByRole('button', { name: 'Simular aprovação do pagamento', exact: true }).click();
  await expect(page.locator('.mini-ticket')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('quantidade do cliente respeita saldo próprio da variação e estoque atualizado com o produto aberto', async ({
  page,
  request,
}) => {
  const product = await staffApi(request, '/products', {
    name: 'Quantidade por saldo ' + randomUUID().slice(0, 5),
    price: '11.00',
    stock_policy: 'ON_DELIVERY',
    stock_location_id: fixture.location.id,
  });
  const base = await staffApi(request, '/stock-balances', {
    product_id: product.id,
    location_id: fixture.location.id,
  });
  await staffApi(request, '/inventory/adjustments', {
    balance_id: base.id,
    type: 'PURCHASE',
    quantity: '2.000',
    reason: 'Teste da quantidade no cliente',
  });
  const variant = await staffApi(request, '/product-variants', {
    product_id: product.id,
    name: 'Especial',
    price: '17.00',
    stock_mode: 'OWN',
  });
  const own = await staffApi(request, '/stock-balances', {
    product_id: product.id,
    variant_id: variant.id,
    location_id: fixture.location.id,
  });
  await staffApi(request, '/inventory/adjustments', {
    balance_id: own.id,
    type: 'PURCHASE',
    quantity: '1.000',
    reason: 'Teste do saldo próprio',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:35174/${fixture.slug}/`);
  await page.getByLabel('Buscar produto', { exact: true }).fill(product.name);
  await page.getByRole('button', { name: product.name, exact: true }).click();
  const modal = page.getByRole('dialog', { name: product.name, exact: true });
  const quantity = modal.getByLabel('Quantidade do produto', { exact: true });
  const add = modal.getByRole('button', { name: 'Adicionar ao pedido', exact: false });
  await quantity.fill('2');
  await expect(add).toBeEnabled();
  await expect(
    modal.getByRole('button', { name: 'Aumentar quantidade', exact: true }),
  ).toBeDisabled();
  await modal.getByRole('combobox', { name: 'Variação', exact: true }).click();
  await page.getByRole('option', { name: 'Especial · R$ 17,00', exact: true }).click();
  await expect(add).toBeDisabled();
  await modal.getByRole('button', { name: 'Diminuir quantidade', exact: true }).click();
  await expect(quantity).toHaveValue('1');
  await expect(add).toBeEnabled();
  await expect(modal.locator('.customer-product-subtotal')).toContainText('R$ 17,00');
  await modal.getByRole('combobox', { name: 'Variação', exact: true }).click();
  await page.getByRole('option', { name: 'Padrão · R$ 11,00', exact: true }).click();
  await quantity.fill('2');
  await staffApi(request, '/inventory/adjustments', {
    balance_id: base.id,
    type: 'ADJUSTMENT',
    quantity: '-1.000',
    reason: 'Atualização concorrente do saldo',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(add).toBeDisabled({ timeout: 20000 });
  await expect(modal.getByRole('alert').filter({ hasText: 'saldo disponível' })).toBeVisible();
  await quantity.fill('1');
  await expect(add).toBeEnabled();
  await add.click();
  await page.getByRole('button', { name: 'Ver meu pedido', exact: true }).click();
  await expect(page.locator('.customer-cart-line')).toContainText('1×');
});

test('central de solicitações abre destino e item com atalhos e entrega protegida no admin e garçom', async ({
  page,
  browser,
  request,
}) => {
  const tag = randomUUID().slice(0, 5);
  const area = await staffApi(request, '/areas', { name: 'Varanda ' + tag });
  const table = await staffApi(request, '/tables', {
    number: 'R' + tag,
    capacity: 4,
    area_id: area.id,
  });
  const product = await staffApi(request, '/products', {
    name: 'Suco de limão ' + tag,
    price: '8.00',
    stock_policy: 'NO_CONTROL',
  });
  const identified = await request.post(
    `http://127.0.0.1:33000/api/v1/public/${fixture.slug}/visitor-sessions`,
    { data: { table_code: table.public_code, name: 'Cliente solicitações', phone: '11977776666' } },
  );
  expect(identified.ok(), await identified.text()).toBe(true);
  const client = await identified.json();
  const clientApi = async (path: string, data: unknown) => {
    const response = await request.post('http://127.0.0.1:33000/api/v1' + path, {
      headers: { authorization: 'Bearer ' + client.token, 'Idempotency-Key': randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const created = await clientApi('/public/orders', {
    table_id: table.id,
    source: 'CUSTOMER',
    payment_policy: 'PREPAID',
    items: [
      { product_id: product.id, quantity: 3, modifiers: [], notes: 'Sem açúcar; levar à varanda.' },
    ],
  });
  const intent = await clientApi('/payments/intents', { order_id: created.id });
  await clientApi('/sandbox/pay', { intent_id: intent.id });
  const order = await staffApi(request, '/orders/' + created.id);
  const [first, second] = order.tickets;
  await clientApi(`/tickets/${first.id}/request`, {});
  await clientApi(`/tickets/${second.id}/request`, {});
  await login(page, 35173);
  await page.getByRole('button', { name: 'Salão e mesas', exact: true }).click();
  const banner = page.getByRole('region', { name: 'Solicitações de clientes', exact: true });
  await banner.getByRole('button', { name: 'Ver solicitações', exact: true }).click();
  const center = page.getByRole('dialog', { name: 'Solicitações de clientes', exact: true });
  await expect(center.locator('.client-request-card')).toHaveCount(2);
  const firstCard = center.locator('.client-request-card').filter({ hasText: first.public_number });
  await expect(firstCard).toContainText('Mesa ' + table.number);
  await expect(firstCard).toContainText(area.name);
  await expect(firstCard).toContainText('Entrega na mesa');
  await expect(firstCard).toContainText(product.name);
  await expect(firstCard).toContainText('Cliente solicitações');
  await expect(firstCard).toContainText('Sem açúcar; levar à varanda.');
  await center.getByLabel('Buscar solicitações', { exact: true }).fill('limao');
  await expect(center.locator('.client-request-card')).toHaveCount(2);
  await center.getByLabel('Buscar solicitações', { exact: true }).fill('nenhuma solicitação');
  await expect(center.locator('.client-request-card')).toHaveCount(0);
  await center.getByLabel('Buscar solicitações', { exact: true }).fill('');
  await page.screenshot({ path: 'docs/screenshots/central-solicitacoes-desktop.png' });
  await firstCard.getByRole('button', { name: 'Ver pedido', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Pedido ' + order.id.slice(0, 8), exact: true });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(product.name);
  await detail.getByRole('button', { name: 'Fechar', exact: true }).click();
  await banner.getByRole('button', { name: 'Ver solicitações', exact: true }).click();
  await firstCard.getByRole('button', { name: 'Ver item / ficha', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${order.id}/fichas/${first.id}`));
  const item = page.getByRole('dialog', { name: 'Ficha ' + first.public_number, exact: true });
  await expect(item.getByRole('heading', { name: product.name, exact: true })).toBeVisible();
  await item.getByRole('button', { name: 'Fechar', exact: true }).click();
  await detail.getByRole('button', { name: 'Fechar', exact: true }).click();
  await banner.getByRole('button', { name: 'Ver solicitações', exact: true }).click();
  await firstCard.getByRole('button', { name: 'Abrir mesa', exact: true }).click();
  const attendance = page.getByRole('dialog', { name: 'Mesa ' + table.number, exact: true });
  await expect(attendance).toBeVisible();
  await attendance.getByRole('button', { name: 'Fechar', exact: true }).click();
  await banner.getByRole('button', { name: 'Ver solicitações', exact: true }).click();
  await firstCard.getByRole('button', { name: 'Assumir', exact: true }).click();
  await expect(firstCard).toContainText('Você assumiu esta solicitação.');
  await center.getByRole('button', { name: /^Minhas/ }).click();
  await expect(center.locator('.client-request-card')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/central-solicitacoes-mobile.png' });
  const waiterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const waiter = await waiterContext.newPage();
    await login(waiter, 35175, waiterEmail);
    await waiter
      .getByRole('region', { name: 'Solicitações de clientes', exact: true })
      .getByRole('button', { name: 'Ver solicitações', exact: true })
      .click();
    const assigned = waiter
      .locator('.client-request-card')
      .filter({ hasText: first.public_number });
    const available = waiter
      .locator('.client-request-card')
      .filter({ hasText: second.public_number });
    await expect(assigned).toContainText('Em atendimento por Antonio');
    await expect(assigned.getByRole('button', { name: 'Entregar', exact: true })).toBeDisabled();
    await available.getByRole('button', { name: 'Ver item / ficha', exact: true }).click();
    const document = waiter.getByRole('dialog', { name: 'Item e ficha solicitados', exact: true });
    await expect(document).toContainText(product.name);
    await expect(document).toContainText('Mesa ' + table.number);
    await document.getByRole('button', { name: 'Ver pedido', exact: true }).click();
    await expect(
      waiter.getByRole('dialog', { name: 'Pedido solicitado', exact: true }),
    ).toContainText(product.name);
    await waiter
      .getByRole('dialog', { name: 'Pedido solicitado', exact: true })
      .getByRole('button', { name: 'Fechar', exact: true })
      .click();
    await available.getByRole('button', { name: 'Entregar', exact: true }).click();
    const confirmation = waiter.getByRole('dialog', {
      name: 'Confirmar entrega da ficha',
      exact: true,
    });
    await expect(confirmation).toContainText(area.name);
    await expect(confirmation).toContainText('Entrega na mesa');
    await expect(confirmation).toContainText('Sem açúcar; levar à varanda.');
    await confirmation
      .getByRole('button', { name: 'Confirmar entrega ao cliente', exact: true })
      .click();
    await expect(available).toHaveCount(0);
    await firstCard.getByRole('button', { name: 'Entregar', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Confirmar entrega da ficha', exact: true })
      .getByRole('button', { name: 'Confirmar entrega ao cliente', exact: true })
      .click();
    await expect(
      center.getByText('Nenhuma solicitação aguardando entrega.', { exact: true }),
    ).toBeVisible();
    await expect(banner).toHaveCount(0);
  } finally {
    await waiterContext.close();
  }
});

test('switch do cabeçalho pausa pedidos, abre caixa no mesmo modal e alerta para renovar turno com mais de 24h', async ({
  page,
  request,
}) => {
  await login(page, 35173);
  const toggle = page.getByRole('switch', { name: 'Receber novos pedidos', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  const activation = page.getByRole('dialog', { name: 'Ativar novos pedidos', exact: true });
  await expect(activation).toContainText('Nenhum caixa aberto');
  await activation.getByRole('combobox', { name: 'Caixa do novo turno', exact: true }).click();
  await page.getByRole('option', { name: 'Cadastrar novo caixa', exact: true }).click();
  const name = 'Caixa do cabeçalho ' + randomUUID().slice(0, 5);
  await activation.getByLabel('Nome do caixa', { exact: true }).fill(name);
  await activation.getByLabel('Fundo de abertura do novo turno', { exact: true }).fill('25');
  await activation
    .getByRole('button', { name: 'Abrir caixa e ativar pedidos', exact: true })
    .click();
  await expect(activation).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  let state = await staffApi(request, '/operation/control');
  const firstId = state.order_cash_session_id;
  expect(state.sessions.find((cash: any) => cash.id === firstId).register_name).toBe(name);
  const order = await staffApi(request, '/orders', {
    table_id: fixture.tables[0].id,
    source: 'WAITER',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[0].id, quantity: 1, modifiers: [] }],
  });
  expect(order.cash_session_id).toBe(firstId);
  await database.db.execute(
    database.sql`UPDATE cash_sessions SET created_at=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 25 HOUR) WHERE tenant_id=${fixture.tenant_id} AND establishment_id=${fixture.establishment_id} AND id=${firstId}`,
  );
  const overdue = page.getByRole('button', {
    name: 'Revisar caixa aberto há mais de 24 horas',
    exact: true,
  });
  await expect(overdue).toBeVisible({ timeout: 22000 });
  await overdue.click();
  const manage = page.getByRole('dialog', { name: 'Pedidos e caixa', exact: true });
  await expect(manage).toContainText('Este caixa está aberto há mais de 24 horas.');
  await manage.getByRole('button', { name: 'Encerrar e abrir novo turno', exact: true }).click();
  const rotate = page.getByRole('dialog', { name: 'Encerrar e abrir novo turno', exact: true });
  await rotate.getByLabel('Dinheiro contado no fechamento', { exact: true }).fill('25');
  await rotate.getByLabel('Fundo de abertura do novo turno', { exact: true }).fill('10');
  await page.screenshot({ path: 'docs/screenshots/pedidos-caixa-renovar-turno.png' });
  await rotate.getByRole('button', { name: 'Encerrar e abrir novo turno', exact: true }).click();
  await expect(rotate).toHaveCount(0);
  state = await staffApi(request, '/operation/control');
  expect(state.order_cash_session_id).not.toBe(firstId);
  expect(
    state.sessions.find((cash: any) => cash.id === state.order_cash_session_id).expected_amount,
  ).toBe('10.00');
  expect((await staffApi(request, '/orders/' + order.id)).cash_session_id).toBe(firstId);
  await expect(overdue).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/switch-pedidos-header-mobile.png' });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Gerenciar caixa dos pedidos', exact: true }).click();
  await manage.getByRole('button', { name: 'Encerrar e abrir novo turno', exact: true }).click();
  await rotate.getByLabel('Dinheiro contado no fechamento', { exact: true }).fill('10');
  await rotate.getByLabel('Fundo de abertura do novo turno', { exact: true }).fill('5');
  await rotate.getByRole('button', { name: 'Encerrar e abrir novo turno', exact: true }).click();
  await expect(rotate).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('dialog', { name: 'Ativar novos pedidos', exact: true })).toHaveCount(
    0,
  );
});

test('unidades de medida mantêm padrão, saldos, histórico e orientação da ficha técnica', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 6),
    name = 'Ingrediente em medida ' + suffix;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 35173);
  await page.getByRole('button', { name: 'Cardápio', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Adicionar · Produtos', exact: true });
  const measure = () => editor.getByRole('combobox', { name: 'Unidade de medida', exact: true });
  await expect(measure()).toHaveValue('Unidade (un)');
  await editor.getByLabel('Nome', { exact: true }).fill(name);
  await measure().fill('quilograma');
  await page.getByRole('option', { name: 'Quilograma (kg)', exact: true }).click();
  await editor.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await editor.getByLabel('Preço', { exact: true }).fill('4,50');
  await editor.getByRole('tab', { name: 'Estoque e produção', exact: true }).click();
  await editor.getByRole('combobox', { name: 'Baixa de estoque', exact: true }).fill('Na entrega');
  await page.getByRole('option', { name: 'Na entrega', exact: true }).click();
  await editor.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  const initial = page.getByRole('dialog', { name: 'Criar estoque do novo produto?', exact: true });
  await expect(initial).toContainText('Informe em kg');
  await initial.getByLabel('Quantidade inicial', { exact: true }).fill('2,500');
  await initial.getByRole('button', { name: 'Criar estoque', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await expect(editor.getByRole('cell', { name: '2,500 kg', exact: true }).first()).toBeVisible();
  await editor.getByRole('tab', { name: 'Geral', exact: true }).click();
  await expect(measure()).toHaveValue('Quilograma (kg)');
  await measure().fill('grama');
  await page.getByRole('option', { name: 'Grama (g)', exact: true }).click();
  await expect(editor).toContainText('Alterar a unidade não converte saldos');
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Descartar alterações?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await editor.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await editor.getByRole('tab', { name: 'Estoques e locais', exact: true }).click();
  await expect(editor.getByRole('cell', { name: '2,500 g', exact: true }).first()).toBeVisible();
  await editor.getByRole('tab', { name: 'Movimentações', exact: true }).click();
  await expect(editor.getByRole('cell', { name: '+2,500 kg', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/screenshots/unidade-produto-historico.png' });
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const ingredient = (await staffApi(request, '/products')).find(
    (product: any) => product.name === name,
  );
  expect(ingredient.unit_code).toBe('G');
  const dish = await staffApi(request, '/products', {
    name: 'Receita de medida ' + suffix,
    price: '10.00',
    stock_policy: 'RECIPE',
  });
  expect(dish.unit_code).toBe('UN');
  await staffApi(request, '/recipes', { product_id: dish.id });
  await page.getByRole('button', { name: 'Recarregar Produtos', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar em Produtos' }).fill(dish.name);
  await page.getByRole('button', { name: 'Editar ' + dish.name, exact: true }).click();
  await editor.getByRole('tab', { name: 'Ficha técnica', exact: true }).click();
  await editor.getByRole('button', { name: 'Adicionar ingrediente', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Adicionar ingrediente', exact: true });
  await recipe.getByRole('combobox', { name: 'Ingrediente', exact: true }).fill(name);
  await page.getByRole('option', { name, exact: true }).click();
  await expect(recipe).toContainText('Informe em g.');
  await recipe.getByLabel('Quantidade por unidade', { exact: true }).fill('0,500');
  await recipe.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor.getByText('0,500 g por unidade vendida', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('tab', { name: 'Geral', exact: true }).click();
  await measure().fill('litro');
  await page.getByRole('option', { name: 'Litro (L)', exact: true }).click();
  expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await measure().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/screenshots/unidade-produto-mobile.png' });
  expect(
    (await staffApi(request, '/products')).find((product: any) => product.id === dish.id).unit_code,
  ).toBe('UN');
});
