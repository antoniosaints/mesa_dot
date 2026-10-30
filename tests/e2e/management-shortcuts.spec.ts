import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1',
  password = 'ShortcutsBrowserTestsOnly1!',
  suffix = randomUUID().slice(0, 8),
  email = 'shortcut-owner-' + suffix + '@test.local';
let fixture: any, token: string, cashierEmail: string;
async function login(page: Page, account = email) {
  await page.goto(base + '/' + fixture.slug + '/');
  await page.getByLabel('E-mail', { exact: true }).fill(account);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Atalhos Browser ' + suffix,
    owner_email: email,
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  const auth = await request.post(api + '/auth/login', {
    data: { email, password, establishment_slug: fixture.slug },
  });
  token = (await auth.json()).token;
  cashierEmail = 'shortcut-cashier-' + suffix + '@test.local';
  const created = await request.post(api + '/staff', {
    headers: { authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
    data: {
      name: 'Operador dos atalhos',
      email: cashierEmail,
      password,
      role_id: fixture.roles.find((r: any) => r.name === 'Garçom').id,
    },
  });
  expect(created.ok()).toBe(true);
});
test('F1 abre leitor global, F2 e F3 navegam com slug e F4 busca funções com teclado', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const footer = page.getByRole('contentinfo', { name: 'Atalhos globais da gestão' });
  await expect(footer).toBeVisible();
  const colors = await footer
    .locator('button')
    .evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).color));
  expect(new Set(colors).size).toBe(4);
  await page.keyboard.press('F1');
  const reader = page.getByRole('dialog', { name: 'Leitura rápida de fichas', exact: true });
  await expect(reader).toBeVisible();
  await expect(reader.getByLabel('Código da ficha', { exact: true })).toBeFocused();
  await page.keyboard.press('F1');
  await expect(reader).toHaveCount(1);
  await expect(reader).toContainText('Toda a unidade');
  await page.keyboard.press('Escape');
  await expect(reader).toHaveCount(0);
  await page.screenshot({ path: '.local/screenshots/management-shortcut-bar-desktop.png' });
  await page.keyboard.press('F2');
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/salao');
  await expect(page.getByRole('button', { name: 'Salão e mesas', exact: true })).toHaveAttribute(
    'aria-keyshortcuts',
    'F2',
  );
  await page.keyboard.press('F3');
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/cardapio');
  await expect(page.getByRole('button', { name: 'Cardápio', exact: true })).toHaveAttribute(
    'aria-keyshortcuts',
    'F3',
  );
  await page.keyboard.press('F4');
  const palette = page.getByRole('dialog', { name: 'Busca rápida de funções', exact: true }),
    search = palette.getByRole('combobox', { name: 'Buscar função', exact: true });
  await expect(search).toBeFocused();
  await page.keyboard.press('F4');
  await expect(palette).toHaveCount(1);
  await page.screenshot({
    path: '.local/screenshots/management-shortcuts-desktop.png',
    fullPage: true,
  });
  await search.fill('horario');
  await expect(palette.getByRole('option', { name: /Horário de funcionamento/ })).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    base + '/' + fixture.slug + '/configuracoes?aba=funcionamento-e-cardapio',
  );
  await expect(palette).toHaveCount(0);
  await expect(
    page.getByRole('tab', { name: 'Funcionamento e cardápio', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('F4');
  await search.fill('aparencia');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/configuracoes?aba=aparencia');
  await page.keyboard.press('F4');
  await search.fill('nenhuma funcao xyz');
  await expect(palette.getByText('Nenhuma função encontrada', { exact: true })).toBeVisible();
  await search.fill('pedido');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(palette.getByRole('option', { selected: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await page.keyboard.press('F4');
  await search.fill('avulso');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Novo pedido avulso', exact: true })).toBeVisible();
  await page.keyboard.press('F2');
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/salao');
  await expect(page.getByRole('dialog', { name: 'Novo pedido avulso', exact: true })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
test('atalhos funcionam em formulários sem perder alterações e fecham leitor e câmera ao navegar', async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.keyboard.press('F3');
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const product = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Nome', { exact: true }) });
  await product.getByLabel('Nome', { exact: true }).fill('Rascunho protegido');
  await page.keyboard.press('F1');
  const reader = page.getByRole('dialog', { name: 'Leitura rápida de fichas', exact: true });
  await expect(reader).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(product.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho protegido');
  await expect(product.getByLabel('Nome', { exact: true })).toBeFocused();
  await page.keyboard.press('F2');
  const confirm = page.getByRole('alertdialog', { name: 'Descartar alterações?', exact: true });
  await expect(confirm).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await expect(product.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho protegido');
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/cardapio');
  await page.keyboard.press('F4');
  await page.getByRole('combobox', { name: 'Buscar função', exact: true }).fill('salão');
  await page.keyboard.press('Enter');
  await expect(confirm).toBeVisible();
  await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/salao');
  await expect(product).toHaveCount(0);
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    canvas.getContext('2d')!.fillRect(0, 0, 320, 240);
    const stream = canvas.captureStream(2);
    (window as any).__shortcutStream = stream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream, enumerateDevices: async () => [] },
    });
  });
  await page.keyboard.press('F1');
  await reader.getByRole('button', { name: 'Câmera', exact: true }).click();
  await expect(reader.getByRole('status').filter({ hasText: 'Enquadre' })).toBeVisible();
  await page.keyboard.press('F3');
  await expect(reader).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__shortcutStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/cardapio');
});
test('perfil limitado só encontra funções autorizadas; barra é clicável e responsiva', async ({
  page,
}) => {
  await login(page, cashierEmail);
  const footer = page.getByRole('contentinfo', { name: 'Atalhos globais da gestão' });
  await expect(footer.getByRole('button', { name: 'Cardápio (F3)', exact: true })).toBeDisabled();
  const current = page.url();
  await page.keyboard.press('F3');
  await expect(page).toHaveURL(current);
  await expect(page.getByRole('dialog', { name: 'Busca rápida de funções' })).toHaveCount(0);
  await footer.getByRole('button', { name: 'Buscar funções (F4)', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Busca rápida de funções' }),
    search = palette.getByRole('combobox', { name: 'Buscar função', exact: true });
  await search.fill('financeiro');
  await expect(palette.getByText('Nenhuma função encontrada', { exact: true })).toBeVisible();
  await search.fill('cardapio');
  await expect(palette.getByRole('option', { name: /Cardápio/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = await footer.boundingBox();
    expect(box!.y + box!.height).toBeCloseTo(844, 0);
  }
  await footer.getByRole('button', { name: 'Ler ficha (F1)', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Leitura rápida de fichas', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await footer.getByRole('button', { name: 'Mesas (F2)', exact: true }).click();
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/salao');
  await page.setViewportSize({ width: 390, height: 844 });
  await footer.getByRole('button', { name: 'Buscar funções (F4)', exact: true }).click();
  await page.screenshot({
    path: '.local/screenshots/management-shortcuts-mobile.png',
    fullPage: true,
  });
});
test('atalhos não atuam no login, não capturam combinações modificadas e não acumulam ouvintes', async ({
  page,
}) => {
  await page.goto(base + '/' + fixture.slug + '/');
  await page.keyboard.press('F4');
  await expect(page.getByRole('dialog', { name: 'Busca rápida de funções' })).toHaveCount(0);
  await expect(page.getByRole('contentinfo', { name: 'Atalhos globais da gestão' })).toHaveCount(0);
  await login(page);
  const keys = await page.evaluate(() => {
    const results = [];
    for (const extra of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { repeat: true },
    ]) {
      const event = new KeyboardEvent('keydown', {
        key: 'F4',
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      document.dispatchEvent(event);
      results.push(event.defaultPrevented);
    }
    return results;
  });
  expect(keys).toEqual([false, false, false, false, true]);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('F2');
    await page.keyboard.press('F3');
  }
  await page.keyboard.press('F4');
  await expect(page.getByRole('dialog', { name: 'Busca rápida de funções' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.keyboard.press('F4');
  await expect(page.getByRole('dialog', { name: 'Busca rápida de funções' })).toHaveCount(0);
});
