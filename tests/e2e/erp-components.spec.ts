import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectMobileModalLayout } from './modal-layout.js';
import { contrast } from '../../packages/ui/src/preferences.js';

test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1';
const suffix = randomUUID().slice(0, 8),
  email = 'erp-components-' + suffix + '@test.local',
  password = 'ErpComponentsOnly1!';
let fixture: any;
let staffToken: string;
async function login(page: Page) {
  await page.goto(`${base}/${fixture.slug}/dashboard`);
  await page.evaluate(() => localStorage.setItem('mesa-interface', 'erp'));
  await page.reload();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.locator('.overview-brief')).toBeVisible();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  const { provision } = await import('../../packages/database/src/provision.js');
  await migrate();
  fixture = await provision({
    name: 'ERP Componentes ' + suffix,
    owner_name: 'Gestora',
    owner_email: email,
    password,
    demo: true,
  });
  const auth = await request.post(api + '/auth/login', {
    data: { email, password, establishment_slug: fixture.slug },
  });
  const { token } = await auth.json();
  staffToken = token;
  for (const name of [
    ...Array.from({ length: 12 }, (_, index) => 'ZZZ Categoria ' + String(index).padStart(2, '0')),
    'AAA Categoria fora da primeira página',
  ]) {
    const response = await request.post(api + '/categories', {
      headers: { authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
      data: { name },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
});
test('ERP ordena a coleção inteira, pagina, valida e salva formulários sem perder alterações', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.goto(`${base}/${fixture.slug}/cardapio?aba=categorias`);
  const table = page.getByRole('table', { name: 'Categorias', exact: true });
  await table.getByRole('button', { name: 'Nome', exact: true }).click();
  await expect(table.locator('tbody tr').first()).toContainText(
    'AAA Categoria fora da primeira página',
  );
  await expect(table.locator('th').first()).toHaveAttribute('aria-sort', 'ascending');
  await table.getByRole('button', { name: 'Nome', exact: true }).click();
  await expect(table.locator('tbody tr').first()).toContainText('ZZZ Categoria 11');
  await page.getByRole('button', { name: 'Próxima página em Categorias', exact: true }).click();
  await expect(page.locator('.table-pagination-range')).toContainText('11–15');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Adicionar · Categorias', exact: true });
  await expect(modal.locator('..')).toHaveClass(/mesa-erp-surface/);
  await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
  const summary = modal.locator('.form-error-summary');
  await expect(summary).toBeFocused();
  await expect(modal.getByLabel('Nome', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await modal.getByLabel('Nome', { exact: true }).fill('Categoria ERP ' + suffix);
  await expect(summary).toHaveCount(0);
  await expect(modal.getByLabel('Nome', { exact: true })).toHaveValue('Categoria ERP ' + suffix);
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: 'Descartar alterações?', exact: true });
  await expect(discard).toBeVisible();
  await expect(discard).toHaveAttribute('data-size', 'confirm');
  await discard.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await expect(modal.getByLabel('Nome', { exact: true })).toHaveValue('Categoria ERP ' + suffix);
  await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page
    .getByRole('searchbox', { name: 'Buscar em Categorias', exact: true })
    .fill('Categoria ERP ' + suffix);
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.table-pagination-range')).toContainText('1–1');
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(
    page.getByRole('combobox', { name: 'Ordenar Categorias', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('ERP alcança modais e dropdowns nos dois temas e a escolha do visual atual reverte o escopo', async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.goto(`${base}/${fixture.slug}/cardapio`);
  await page
    .getByRole('button', { name: 'Editar ' + fixture.products[0].name, exact: true })
    .click();
  const modal = page.getByRole('dialog').first();
  await expect(modal.locator('..')).toHaveClass(/mesa-erp-surface/);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const width of [1440, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width > 900) {
        await expect(page.locator('.sidebar')).toHaveCSS('width', '248px');
        await expect(page.locator('.admin-main')).toHaveCSS('margin-left', '248px');
      }
      await expectMobileModalLayout(modal);
      const tabBar = modal.getByRole('tablist', { name: 'Dados do produto', exact: true });
      const selectedTab = tabBar.getByRole('tab', { selected: true });
      expect((await selectedTab.boundingBox())!.height).toBe(width <= 700 ? 44 : 40);
      await expect(selectedTab).toHaveCSS('border-radius', '9px');
      const brand = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
      );
      const rgb = brand
        .slice(1)
        .match(/../g)!
        .map((part) => parseInt(part, 16));
      await expect(selectedTab).toHaveCSS('background-color', `rgb(${rgb.join(', ')})`);
      expect(
        await tabBar.evaluate(
          (element) =>
            element.scrollWidth > 0 && element.getBoundingClientRect().right <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      if ([1440, 390].includes(width))
        await page.screenshot({
          path: `.local/screenshots/erp-segmented-tabs-${width}-${theme}.png`,
        });
    }
  }
  const tabBar = modal.getByRole('tablist', { name: 'Dados do produto', exact: true });
  await tabBar.getByRole('tab', { selected: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    tabBar.getByRole('tab', { name: 'Preços e variações', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(tabBar.getByRole('tab', { name: 'Preços e variações', exact: true })).toBeInViewport(
    { ratio: 1 },
  );
  await modal.getByRole('tab', { name: 'Geral', exact: true }).click();
  const category = modal.getByRole('combobox', { name: 'Categoria', exact: true });
  await category.click();
  const options = page.getByRole('listbox', { name: 'Opções de Categoria', exact: true });
  await expect(options).toHaveClass(/mesa-erp-surface/);
  await category.press('Escape');
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.sidebar')).toHaveCSS('width', '248px');
  await expect(page.locator('.admin-main')).toHaveCSS('margin-left', '248px');
  await page.goto(`${base}/${fixture.slug}/configuracoes?aba=aparencia`);
  await page.getByRole('button', { name: 'Usar Visual atual', exact: true }).click();
  await page.goto(`${base}/${fixture.slug}/cardapio?aba=categorias`);
  await expect(page.getByRole('button', { name: 'Nome', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(page.getByRole('dialog').locator('..')).not.toHaveClass(/mesa-erp-surface/);
});

test('ERP compacto aproxima título, indicadores e tabela e anima diálogos sem perder foco ou edição', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const headers = { authorization: 'Bearer ' + staffToken };
  const appearance = await request.patch(api + '/settings', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { primary_color: '#8700b5' },
  });
  expect(appearance.ok(), await appearance.text()).toBe(true);
  async function post(path: string, data: unknown) {
    const response = await request.post(api + path, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const draft = await post('/orders', {
    table_id: fixture.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 2, modifiers: [] }],
  });
  const order = await post(`/orders/${draft.id}/confirm`, {});
  await post('/payments/manual', {
    method: 'PIX_MANUAL',
    allocations: [{ tab_id: order.tab_id, amount: '10.00' }],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto(`${base}/${fixture.slug}/pagamentos`);
  const table = page.getByRole('table', { name: 'Lista de pagamentos' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await page.locator('.topbar .theme-toggle').click();
    const selectedTab = page.getByRole('tab', { name: /^Todos/ });
    const count = selectedTab.locator('.system-tab-count');
    await expect(count).toHaveText('1');
    const colors = await count.evaluate((element) => {
      const styles = getComputedStyle(element);
      return { text: styles.color, background: styles.backgroundColor };
    });
    const hex = (color: string) =>
      '#' +
      color
        .match(/\d+/g)!
        .slice(0, 3)
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('');
    expect(contrast(hex(colors.text), hex(colors.background))).toBeGreaterThanOrEqual(4.5);
    expect((await selectedTab.boundingBox())!.height).toBe(40);
    const heading = (await page.locator('.cash-heading').boundingBox())!;
    const kpis = (await page.locator('.payments-kpis').boundingBox())!;
    expect(kpis.y - heading.y - heading.height).toBeLessThanOrEqual(16);
    expect(kpis.height).toBeLessThan(125);
    await expect(table.locator('tbody tr').first()).toBeInViewport({ ratio: 1 });
    expect((await table.boundingBox())!.y).toBeLessThan(600);
    const action = page.getByRole('button', { name: 'Exportar', exact: true });
    expect(await action.evaluate((button) => getComputedStyle(button).boxShadow)).not.toBe('none');
    await page.screenshot({ path: `.local/screenshots/erp-compact-payments-${theme}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${base}/${fixture.slug}/cardapio?aba=categorias`);
  await page.evaluate(() => {
    (window as any).erpModalOpenings = [];
    document.addEventListener('animationstart', (event) => {
      if ((event.target as HTMLElement).classList.contains('modal'))
        (window as any).erpModalOpenings.push(event.animationName);
    });
  });
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Adicionar · Categorias', exact: true });
  await expect(modal).toHaveCSS('animation-name', 'erp-dialog-in');
  await modal.getByLabel('Nome', { exact: true }).fill('Rascunho preservado');
  await expect(modal.getByLabel('Nome', { exact: true })).toBeFocused();
  await expect(modal).toHaveCSS('transform', 'none');
  await expect
    .poll(() => page.evaluate(() => (window as any).erpModalOpenings))
    .toEqual(['erp-dialog-in']);
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: 'Descartar alterações?' });
  await discard.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await expect(modal.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho preservado');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(discard).toHaveCSS('animation-name', 'none');
  await discard.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(modal).toHaveCSS('animation-name', 'none');
  await expectMobileModalLayout(modal);
  await expect(modal.getByRole('button', { name: 'Salvar', exact: true })).toBeInViewport({
    ratio: 1,
  });
});

test('financeiro ERP mantém cinco indicadores em uma linha e filtros compactos sem cortar controles', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto(`${base}/${fixture.slug}/financeiro`);
  const cards = page.locator('.finance-kpi');
  await expect(cards).toHaveCount(5);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const width of [1680, 1440, 1280, 1200, 1024, 768, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const boxes = await cards.evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width };
        }),
      );
      if (width >= 1280) {
        expect(
          Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y)),
        ).toBeLessThan(1);
        expect((await page.locator('.finance-period').boundingBox())!.height).toBeLessThanOrEqual(
          60,
        );
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      for (const control of await page
        .locator('.finance-period input, .finance-period select, .finance-period button:visible')
        .all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      if ([1440, 390].includes(width))
        await page.screenshot({
          path: `.local/screenshots/erp-finance-compact-${width}-${theme}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '76px');
  await expect
    .poll(async () =>
      cards.evaluateAll(
        (items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().y))).size,
      ),
    )
    .toBe(1);
  await page.getByLabel('Atalho de período').selectOption('yesterday');
  await expect(page.getByLabel('Data inicial')).toHaveValue(
    await page.getByLabel('Data final').inputValue(),
  );
  await page.getByLabel('Data inicial').fill('2026-11-01');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByLabel('Atalho de período')).toHaveValue('custom');
  await page.getByRole('tab', { name: 'Vendas', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Vendas', exact: true })).toBeVisible();
});
