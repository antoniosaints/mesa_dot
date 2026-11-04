import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1';
const suffix = randomUUID().slice(0, 8),
  email = `interface-${suffix}@test.local`,
  password = 'InterfaceStylesOnly1!';
let fixture: any, branch: any, readerEmail: string;
async function login(page: Page, account = email) {
  await page.goto(`${base}/${fixture.slug}/dashboard`);
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
    name: `Interface Mesa ${suffix}`,
    owner_name: 'Admin',
    owner_email: email,
    password,
    demo: true,
  });
  const response = await request.post(api + '/auth/login', {
    data: { email, password, establishment_slug: fixture.slug },
  });
  const { token } = await response.json();
  const headers = () => ({ authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
  const colors = await request.patch(api + '/settings', {
    headers: headers(),
    data: { primary_color: '#8b5cf6', sidebar_color: '#21163b' },
  });
  expect(colors.ok()).toBe(true);
  const created = await request.post(api + '/establishments', {
    headers: headers(),
    data: { name: 'Filial Interface ' + suffix },
  });
  expect(created.ok(), await created.text()).toBe(true);
  branch = await created.json();
  const role = await request.post(api + '/roles', {
    headers: headers(),
    data: {
      name: 'Leitura da operação',
      permissions: ['reports.view', 'table.view', 'ticket.view'],
    },
  });
  expect(role.ok()).toBe(true);
  readerEmail = `interface-reader-${suffix}@test.local`;
  const staff = await request.post(api + '/staff', {
    headers: headers(),
    data: {
      name: 'Leitor operacional',
      email: readerEmail,
      password,
      role_id: (await role.json()).id,
    },
  });
  expect(staff.ok()).toBe(true);
  const draft = await request.post(api + '/orders', {
    headers: headers(),
    data: {
      table_id: fixture.tables[0].id,
      source: 'POS',
      payment_policy: 'POSTPAID',
      items: [{ product_id: fixture.products[1].id, quantity: 2, modifiers: [] }],
    },
  });
  expect(draft.ok(), await draft.text()).toBe(true);
  const confirmed = await request.post(api + '/orders/' + (await draft.json()).id + '/confirm', {
    headers: headers(),
    data: {},
  });
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
});

test('usuário alterna os dois visuais, preserva cores e tema, recarrega e troca de filial', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await expect(page.locator('.admin-layout')).toHaveAttribute('data-interface', 'classic');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '284px');
  await page.goto(`${base}/${fixture.slug}/configuracoes?aba=aparencia`);
  await page.getByRole('button', { name: 'Claro', exact: true }).click();
  await page.getByRole('button', { name: 'Usar Mesa ERP', exact: true }).click();
  await expect(page.locator('.admin-layout')).toHaveAttribute('data-interface', 'erp');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '248px');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(33, 22, 59)');
  await expect(page.getByRole('button', { name: 'Usar Mesa ERP' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
      ),
    )
    .toBe('#8b5cf6');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Usar Mesa ERP' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '76px');
  await page.locator('.sidebar').getByRole('button', { name: 'Visão geral', exact: true }).click();
  await expect(page.locator('.overview-brief')).toBeVisible();
  await expect(page.locator('.overview-kpi')).toHaveCount(8);
  const chart = page.getByRole('group', { name: 'Gráfico de pedidos confirmados' });
  await expect(chart.getByRole('button')).toHaveCount(24);
  await chart.getByRole('button').first().click();
  await expect(page.locator('.overview-chart-detail')).toContainText('00h');
  await page.getByRole('button', { name: 'Gerenciar caixa dos pedidos', exact: true }).click();
  const cash = page.getByRole('dialog', { name: 'Pedidos e caixa', exact: true });
  await expect(cash).toBeVisible();
  await cash.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.keyboard.press('F1');
  await expect(
    page.getByRole('dialog', { name: 'Leitura rápida de fichas', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('F2');
  await expect(page).toHaveURL(/\/salao$/);
  await page.keyboard.press('F3');
  await expect(page).toHaveURL(/\/cardapio$/);
  await expect(page.getByRole('tab', { name: 'Produtos', exact: true })).toHaveCSS(
    'background-color',
    'rgb(139, 92, 246)',
  );
  await page.keyboard.press('F4');
  await expect(page.getByRole('dialog', { name: 'Busca rápida de funções' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expandir menu lateral', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Visão geral', exact: true }).click();
  for (const width of [320, 390, 600, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.locator('.topbar .theme-toggle').click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      const controls = page.locator('.topbar button:visible');
      for (const control of await controls.all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      await expect(page.locator('.overview-brief')).toBeVisible();
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `.local/screenshots/mesa-erp-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ferramentas da estação', exact: true }).click();
  await expect(page.locator('.erp-utilities-panel')).toBeVisible();
  await expect(page.locator('.erp-utilities-panel').getByRole('button').first()).toBeVisible();
  await page.locator('.erp-utilities-panel .printbridge-indicator').click();
  await expect(page).toHaveURL(/\/impressao\?aba=printbridge$/);
  await page.goto(`${base}/${fixture.slug}/dashboard`);
  await expect(page.locator('.overview-brief')).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas da estação', exact: true }).click();
  await page.getByRole('button', { name: 'Ferramentas da estação', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.erp-utilities-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).not.toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('.branch-trigger').click();
  await page.getByRole('menuitemradio', { name: new RegExp(branch.name) }).click();
  await expect(page).toHaveURL(new RegExp(`/${branch.slug}/dashboard$`));
  await expect(page.locator('.admin-layout')).toHaveAttribute('data-interface', 'erp');
  await expect(page.locator('.overview-toolbar')).toContainText(branch.name);
  await page.goto(`${base}/${branch.slug}/configuracoes?aba=aparencia`);
  await page.getByRole('button', { name: 'Usar Visual atual', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '284px');
  await page.reload();
  await expect(page.locator('.admin-layout')).toHaveAttribute('data-interface', 'classic');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('Mesa ERP mantém o financeiro restrito e os gráficos operacionais autorizados', async ({
  page,
}) => {
  await page.goto(base);
  await page.evaluate(() => localStorage.setItem('mesa-interface', 'erp'));
  const received = page.waitForResponse(
    (response) => response.url().includes('/dashboard/overview?') && response.ok(),
  );
  await login(page, readerEmail);
  const data = await (await received).json();
  expect(data.financial).toBeNull();
  await expect(page.locator('.admin-layout')).toHaveAttribute('data-interface', 'erp');
  await expect(page.locator('.financial-kpis')).toHaveCount(0);
  await expect(page.getByText('Faturamento líquido', { exact: true })).toHaveCount(0);
  await expect(
    page.locator('.sidebar').getByRole('button', { name: 'Painel financeiro', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.overview-orders-chart')).toBeVisible();
  await page.getByRole('button', { name: '7 dias', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Gráfico de pedidos confirmados' }).getByRole('button'),
  ).toHaveCount(7);
});
