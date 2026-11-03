import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1',
  suffix = randomUUID().slice(0, 8),
  email = 'overview-browser-' + suffix + '@test.local',
  password = 'OverviewBrowserOnly1!';
let fixture: any, branch: any, roleEmail: string;
async function login(page: Page, account = email) {
  await page.goto(base + '/' + fixture.slug + '/dashboard');
  await page.getByLabel('E-mail', { exact: true }).fill(account);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.locator('.overview-brief')).toBeVisible();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Matriz Resumo ' + suffix,
    owner_name: 'Admin',
    owner_email: email,
    password,
    demo: true,
  });
  const token = (
    await (
      await request.post(api + '/auth/login', {
        data: { email, password, establishment_slug: fixture.slug },
      })
    ).json()
  ).token;
  async function post(path: string, data: any) {
    const response = await request.post(api + path, {
      headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
      data,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  for (const quantity of [2, 1]) {
    const draft = await post('/orders', {
      table_id: fixture.tables[0].id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: fixture.products[1].id, quantity, modifiers: [] }],
    });
    await post('/orders/' + draft.id + '/confirm', {});
  }
  branch = await post('/establishments', { name: 'Filial Vazia Resumo ' + suffix });
  const role = await post('/roles', {
    name: 'Acompanhamento operacional',
    permissions: ['reports.view', 'table.view', 'ticket.view'],
  });
  roleEmail = 'overview-reporter-' + suffix + '@test.local';
  await post('/staff', {
    name: 'Responsável operacional',
    email: roleEmail,
    password,
    role_id: role.id,
  });
});
test('filtra indicadores, abre detalhes, adapta os gráficos ao celular e troca para uma filial vazia', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await login(page);
  await expect(page.locator('.overview-toolbar')).toContainText(fixture.name ?? 'Matriz Resumo');
  const confirmed = page.locator('.overview-kpi').filter({ hasText: 'Pedidos confirmados' });
  await expect(confirmed.locator('strong')).toHaveText('2');
  await expect(page.locator('.financial-kpis')).toBeVisible();
  await expect(page.locator('.overview-orders-chart')).toContainText('horário de Brasília');
  const bars = page.getByRole('group', { name: 'Gráfico de pedidos confirmados' });
  await expect(bars.getByRole('button')).toHaveCount(24);
  await bars.getByRole('button').first().click();
  await expect(page.locator('.overview-chart-detail')).toContainText('00h');
  await page.getByRole('button', { name: '7 dias', exact: true }).click();
  await expect(bars.getByRole('button')).toHaveCount(7);
  await page.getByRole('button', { name: 'Personalizado', exact: true }).click();
  await page
    .locator('.overview-custom-period')
    .getByLabel('De', { exact: true })
    .fill('2026-11-03');
  await page
    .locator('.overview-custom-period')
    .getByLabel('Até', { exact: true })
    .fill('2026-11-02');
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  await expect(page.getByRole('alert')).toContainText('período válido');
  await page.getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(bars.getByRole('button')).toHaveCount(24);
  const geometry = await page.evaluate(() => ({
    scrollX,
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    panels: [
      ...document.querySelectorAll('.overview-workspace > *, .admin-main, .page-content'),
    ].map((node) => ({
      name: node.className,
      left: node.getBoundingClientRect().left,
      width: node.getBoundingClientRect().width,
      scroll: node.scrollWidth,
    })),
  }));
  expect(geometry.width, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('.page-content')!.getBoundingClientRect().left -
          document.querySelector('.sidebar')!.getBoundingClientRect().right,
      ),
    )
    .toBeGreaterThanOrEqual(0);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: '.local/screenshots/overview-desktop-light.png', fullPage: true });
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(confirmed).toBeVisible();
    await page.screenshot({
      path: '.local/screenshots/overview-mobile-' + theme + '.png',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .locator('.overview-attendances')
    .getByRole('button', { name: 'Gerenciar mesa' })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp('/salao/atendimento/' + fixture.tables[0].id));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await expect(confirmed.locator('strong')).toHaveText('2');
  await page
    .getByRole('button', { name: 'Filiais · Matriz Resumo ' + suffix, exact: true })
    .click();
  await page.getByRole('menuitemradio', { name: new RegExp(branch.name) }).click();
  await expect(page.locator('.overview-toolbar')).toContainText(branch.name);
  await expect(confirmed.locator('strong')).toHaveText('0');
  await expect(page.locator('.overview-orders-chart')).toContainText('Nenhum pedido confirmado');
  await expect(page.locator('.overview-top-products')).toHaveCount(0);
  await expect(page.locator('.overview-attendances')).toContainText('Nenhuma mesa em atendimento');
  expect(errors).toEqual([]);
});
test('o papel operacional vê gráficos autorizados e não recebe o resumo financeiro', async ({
  page,
}) => {
  const response = page.waitForResponse(
    (value) => value.url().includes('/dashboard/overview?') && value.ok(),
  );
  await login(page, roleEmail);
  const data = await (await response).json();
  expect(data.financial).toBeNull();
  expect(data.inventory).toBeNull();
  expect(data.printing).toBeNull();
  await expect(page.locator('.financial-kpis')).toHaveCount(0);
  await expect(page.getByText('Faturamento líquido', { exact: true })).toHaveCount(0);
  await expect(page.locator('.overview-orders-chart')).toBeVisible();
  await expect(page.locator('.overview-kpi').filter({ hasText: 'Fila de preparo' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Resumir operação com IA', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: '.local/screenshots/overview-restricted-role.png',
    fullPage: true,
  });
});
