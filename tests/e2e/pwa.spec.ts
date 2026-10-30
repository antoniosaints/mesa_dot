import { test } from './test.js';
import { expect, devices, webkit, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
const api = 'http://127.0.0.1:33000/api/v1',
  customer = 'http://127.0.0.1:35174',
  admin = 'http://127.0.0.1:35173';
const password = 'PwaBrowserOnlyPassword1!',
  suffix = randomUUID().slice(0, 8);
let a: any, b: any, loginA: any;
const stable = (unit: any) => '/pwa/apps/' + unit.establishment_id + '/';
async function manifest(request: APIRequestContext, unit: any) {
  const response = await request.get(customer + stable(unit) + 'manifest.webmanifest');
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test.beforeAll(async ({ request }) => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DOCUMENT_KEY = 'a'.repeat(64);
  process.env.NODE_ENV = 'test';
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  a = await provision({
    name: 'Bar do João Browser ' + suffix,
    owner_name: 'Titular A',
    owner_email: 'pwa-browser-a-' + suffix + '@test.local',
    password,
    demo: true,
  });
  b = await provision({
    name: 'Bar da Maria Browser ' + suffix,
    owner_name: 'Titular B',
    owner_email: 'pwa-browser-b-' + suffix + '@test.local',
    password,
    demo: true,
  });
  const response = await request.post(api + '/auth/login', {
    data: {
      email: 'pwa-browser-a-' + suffix + '@test.local',
      password,
      establishment_slug: a.slug,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  loginA = await response.json();
});
test('PWA entrega HTML e manifest personalizados antes do JavaScript e mantém contexto após renomear', async ({
  page,
  context,
  request,
}) => {
  const before = await manifest(request, a),
    other = await manifest(request, b);
  expect(before.id).not.toBe(other.id);
  expect(before.start_url).toBe(stable(a));
  expect(before.scope).toBe(stable(a));
  const html = await request.get(customer + '/' + a.slug + '/');
  expect(await html.text()).toContain('<title>Bar do João Browser ' + suffix + '</title>');
  expect(await html.text()).toContain('href="' + stable(a) + 'manifest.webmanifest"');
  expect(html.headers()['cache-control']).toBe('no-store');
  const invalid = await request.get(customer + stable(b) + 'rota-invalida');
  expect(invalid.status()).toBe(404);
  expect(await invalid.text()).not.toContain('mesa-pwa-context');
  const cdp = await context.newCDPSession(page);
  await page.goto(customer + stable(a) + '?table=' + a.tables[0].public_code);
  await page.getByLabel('Seu nome', { exact: true }).fill('Cliente do João');
  await page.getByLabel('Telefone', { exact: true }).fill('11912345678');
  await page.getByRole('button', { name: 'Entrar na mesa →' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const storageBefore = await page.evaluate(() =>
    Object.fromEntries(Object.entries(sessionStorage)),
  );
  const sessionKey = Object.keys(storageBefore).find((key) => key.includes(a.establishment_id))!;
  expect(sessionKey).toBeTruthy();
  const sessionA = JSON.parse(storageBefore[sessionKey]);
  expect(sessionA.establishment_id).toBe(a.establishment_id);
  const otherPage = await context.newPage();
  await otherPage.goto(customer + stable(b) + '?table=' + b.tables[0].public_code);
  await expect(otherPage.getByRole('heading', { level: 1 })).toHaveText(
    'Bar da Maria Browser ' + suffix,
  );
  await expect(
    otherPage.getByRole('dialog', { name: 'Entrar na mesa', exact: true }),
  ).toBeVisible();
  expect(await otherPage.evaluate(() => Object.values(sessionStorage).join(''))).not.toContain(
    sessionA.token,
  );
  const denied = await request.get(api + '/my-tickets', {
    headers: {
      authorization: 'Bearer ' + sessionA.token,
      'X-Mesa-Establishment': b.establishment_id,
    },
  });
  expect(denied.status()).toBe(403);
  await page.goto(customer + stable(b) + '?table=' + b.tables[0].public_code);
  await expect(page.getByRole('dialog', { name: 'Entrar na mesa', exact: true })).toBeVisible();
  await page.goto(customer + stable(a) + '?table=' + a.tables[0].public_code);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const oldSlug = a.slug;
  const renamed = await request.patch(api + '/settings', {
    headers: { authorization: 'Bearer ' + loginA.token, 'Idempotency-Key': randomUUID() },
    data: { name: 'Bar do João Browser ' + suffix + ' Premium' },
  });
  expect(renamed.ok(), await renamed.text()).toBeTruthy();
  a.slug = (await renamed.json()).slug;
  const old = await request.get(
    customer +
      '/' +
      oldSlug +
      '/cardapio?table=' +
      a.tables[0].public_code +
      '&token=secret&next=https://example.org',
    { maxRedirects: 0 },
  );
  expect(old.status()).toBe(302);
  expect(old.headers().location).toBe('/' + a.slug + '/cardapio?table=' + a.tables[0].public_code);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Bar do João Browser ' + suffix + ' Premium',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey)).toBe(
    storageBefore[sessionKey],
  );
  const after = await manifest(request, a);
  expect(after.id).toBe(before.id);
  expect(after.start_url).toBe(before.start_url);
  expect(after.scope).toBe(before.scope);
  const browserManifest = await cdp.send('Page.getAppManifest');
  expect(browserManifest.errors).toEqual([]);
  expect(JSON.parse(browserManifest.data!).id).toBe(before.id);
  await page.getByRole('button', { name: 'Instalar aplicativo', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Adicionar à Tela de Início');
  await page.getByRole('button', { name: 'Entendi' }).click();
  await page.screenshot({ path: 'docs/screenshots/pwa-cliente.png', fullPage: true });
});
test('configuração PWA protege edição, salva logo e cores e navega sob o contexto da unidade', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin + stable(a) + 'configuracoes');
  await expect(page.getByLabel('Estabelecimento', { exact: true })).toHaveCount(0);
  await expect(page.locator('.login-company')).toContainText('Bar do João');
  await page.getByLabel('E-mail', { exact: true }).fill('pwa-browser-a-' + suffix + '@test.local');
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await page.getByRole('tab', { name: 'Negócio e aplicativo', exact: true }).click();
  await expect(page.getByLabel('Endereço gerado automaticamente')).toHaveValue(a.slug);
  await expect(page.getByLabel('URL pública', { exact: true })).toHaveValue(
    customer + '/' + a.slug + '/',
  );
  await page.getByRole('button', { name: 'Personalizar aplicativo' }).click();
  const editor = page.getByRole('dialog', { name: 'Personalizar aplicativo PWA', exact: true });
  const original = await manifest(request, a);
  const globalColor = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--blue'),
  );
  await page.getByLabel('Nome curto do aplicativo', { exact: true }).fill('João no celular');
  await expect(editor.locator('.pwa-install-preview')).toContainText('João no celular');
  await page.getByRole('button', { name: 'Cor principal: Violeta', exact: true }).click();
  await expect(page.getByLabel('Cor principal em hexadecimal')).toHaveValue('#8b5cf6');
  expect((await manifest(request, a)).theme_color).toBe(original.theme_color);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--blue'))).toBe(
    globalColor,
  );
  await page.getByLabel('Cor principal em hexadecimal').fill('#abc');
  await page.getByLabel('Nome curto do aplicativo', { exact: true }).focus();
  await expect(editor.getByRole('alert')).toContainText('Use o formato #RRGGBB');
  await page.getByRole('button', { name: 'Cor principal: Violeta', exact: true }).click();
  await page.getByLabel('Logotipo do aplicativo', { exact: true }).setInputFiles({
    name: 'invalido.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('arquivo inválido'),
  });
  await expect(editor.getByRole('alert')).toContainText('Escolha PNG, JPEG ou WebP');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Descartar alterações?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando' }).click();
  await page.getByLabel('Cor principal do aplicativo', { exact: true }).fill('#216342');
  await page.getByLabel('Cor de fundo do aplicativo', { exact: true }).fill('#fafafa');
  const icon = new PNG({ width: 64, height: 64 });
  icon.data.fill(255);
  await page
    .getByLabel('Logotipo do aplicativo', { exact: true })
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG.sync.write(icon) });
  await expect(page.getByAltText('Prévia do logotipo selecionado')).toBeVisible();
  await page.screenshot({ path: '.local/screenshots/pwa-personalizar-desktop-dark.png' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(editor).toBeVisible();
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    const heading = await editor.locator(':scope > .section-head h2').boundingBox();
    const close = await editor.locator(':scope > .section-head > .icon-button').boundingBox();
    expect(close!.y).toBeLessThan(heading!.y + heading!.height);
    await editor
      .getByRole('button', { name: 'Salvar aplicativo', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      editor.getByRole('button', { name: 'Salvar aplicativo', exact: true }),
    ).toBeInViewport();
    await editor.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `.local/screenshots/pwa-personalizar-mobile-${width}-dark.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Salvar aplicativo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.pwa-phone-preview')).toContainText('João no celular');
  const updated = await manifest(request, a);
  expect(updated.short_name).toBe('João no celular');
  expect(updated.theme_color).toBe('#216342');
  for (const entry of updated.icons) {
    const response = await request.get(customer + entry.src);
    expect(response.ok()).toBeTruthy();
    expect(PNG.sync.read(await response.body()).width).toBe(Number(entry.sizes.split('x')[0]));
  }
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Personalizar aplicativo', exact: true }).click();
  await page.getByRole('button', { name: 'Usar ícone padrão', exact: true }).click();
  await expect(editor.getByAltText('Prévia do ícone no aplicativo')).toHaveAttribute(
    'src',
    /default-216342-fafafa/,
  );
  expect((await manifest(request, a)).icons[0].src).toBe(updated.icons[0].src);
  await expect(editor.getByAltText('Prévia do ícone no aplicativo')).toHaveJSProperty(
    'naturalWidth',
    192,
  );
  await page.screenshot({ path: '.local/screenshots/pwa-personalizar-desktop-light.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/screenshots/pwa-personalizar-mobile-light.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Restaurar logotipo salvo', exact: true }).click();
  await expect(editor.getByAltText('Prévia do ícone no aplicativo')).toHaveAttribute(
    'src',
    updated.icons[0].src.replace(/\/(192|512)\.png$/, '/192.png'),
  );
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/pwa-configuracoes.png', fullPage: true });
  await page.getByRole('button', { name: 'Equipe', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(stable(a) + 'equipe'));
  const otherPage = await page.context().newPage();
  await otherPage.goto(admin + stable(b) + 'configuracoes');
  await expect(otherPage.getByRole('button', { name: 'Entrar na operação' })).toBeVisible();
  await expect(otherPage.getByLabel('Estabelecimento', { exact: true })).toHaveCount(0);
  await expect(otherPage.locator('.login-company')).toContainText('Bar da Maria');
});
test('service worker não reutiliza HTML de empresa ou dados privados ao navegar offline', async ({
  page,
  context,
}) => {
  await page.goto(customer + stable(a));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bar do João');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  const stored = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      result.push(...(await cache.keys()).map((r) => r.url));
    }
    return result;
  });
  expect(stored.some((url) => url.includes('/api/') || url.includes('/pwa/apps/'))).toBe(false);
  await context.setOffline(true);
  try {
    await page.goto(customer + stable(b));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Você está sem conexão');
    await expect(page.locator('body')).not.toContainText('Bar do João');
  } finally {
    await context.setOffline(false);
  }
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Bar da Maria Browser ' + suffix,
  );
});
test('Chromium Android exibe identidade e instruções de instalação', async ({ browser }) => {
  const android = await browser.newContext({ ...devices['Pixel 7'] });
  const androidPage = await android.newPage();
  await androidPage.goto(customer + stable(a));
  await expect(androidPage.getByRole('heading', { level: 1 })).toContainText('Bar do João');
  expect(
    await androidPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
  await androidPage.getByRole('button', { name: 'Instalar aplicativo', exact: true }).click();
  await expect(androidPage.getByRole('dialog')).toContainText('Chrome ou Edge');
  await android.close();
});
test('WebKit iPhone exibe identidade, ícones e instruções de instalação', async () => {
  test.skip(
    process.env.PWA_RUN_WEBKIT !== '1',
    'Habilite PWA_RUN_WEBKIT=1 em host com WebKit operacional; emulação não substitui teste físico.',
  );
  const safari = await webkit.launch({
    headless: true,
    ...(process.env.PWA_WEBKIT_EXECUTABLE_PATH
      ? { executablePath: process.env.PWA_WEBKIT_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const ios = await safari.newContext({ ...devices['iPhone 13'] });
    const iosPage = await ios.newPage();
    await iosPage.goto(customer + stable(b));
    await expect(iosPage.getByRole('heading', { level: 1 })).toHaveText(
      'Bar da Maria Browser ' + suffix,
    );
    await expect(iosPage.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      new RegExp(b.establishment_id),
    );
    await iosPage.getByRole('button', { name: 'Instalar aplicativo', exact: true }).click();
    await expect(iosPage.getByRole('dialog')).toContainText('Safari');
    expect(
      await iosPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true);
    await iosPage.screenshot({ path: 'docs/screenshots/pwa-iphone-webkit.png', fullPage: true });
  } finally {
    await safari.close();
  }
});
test('sessão legada só migra para sua unidade uma vez e não reaparece após sair', async ({
  page,
  request,
}) => {
  const response = await request.post(api + '/auth/login', {
    data: {
      email: 'pwa-browser-a-' + suffix + '@test.local',
      password,
      establishment_slug: a.slug,
    },
  });
  expect(response.ok()).toBeTruthy();
  const legacy = await response.json();
  await page.goto(admin);
  await page.evaluate(
    (value) => sessionStorage.setItem('bar-staff', JSON.stringify(value)),
    legacy,
  );
  await page.goto(admin + stable(a) + 'dashboard');
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar na operação' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar na operação' })).toBeVisible();
  const denied = await request.get(api + '/me', {
    headers: { authorization: 'Bearer ' + legacy.token },
  });
  expect(denied.status()).toBe(401);
  await page.goto(admin + stable(b) + 'dashboard');
  await expect(page.getByRole('button', { name: 'Entrar na operação' })).toBeVisible();
});
test('login escolhe empresa antes das credenciais, mantém slug e contexto no endereço', async ({
  page,
  request,
}) => {
  const identity = await (await request.get(api + '/pwa/apps/' + a.establishment_id)).json();
  await page.goto(admin + '/pedidos?aba=fichas&token=secret&next=https://example.org');
  await expect(
    page.getByRole('heading', { name: 'Selecione sua empresa', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Estabelecimento', { exact: true })).toHaveCount(0);
  const companies = page.getByRole('combobox', { name: 'Empresa', exact: true });
  await companies.fill('Empresa inexistente ' + suffix);
  await expect(page.getByText('Nenhuma opção encontrada.')).toBeVisible();
  await companies.fill(a.slug);
  await page.screenshot({ path: 'docs/screenshots/login-empresa-selecao.png' });
  await page
    .getByRole('option', { name: identity.name.toLocaleUpperCase('pt-BR'), exact: true })
    .click();
  await expect(page).toHaveURL(admin + '/' + a.slug + '/pedidos?aba=fichas');
  await expect(page.getByRole('combobox', { name: 'Empresa', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Estabelecimento', { exact: true })).toHaveCount(0);
  await expect(page.locator('.login-company')).toContainText(identity.name);
  await page.getByLabel('E-mail', { exact: true }).fill('pwa-browser-a-' + suffix + '@test.local');
  await page.getByLabel('Senha', { exact: true }).fill('SenhaErrada1!');
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByText('Credenciais inválidas.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(admin + '/' + a.slug + '/pedidos?aba=fichas');
  await page.getByLabel('Senha', { exact: true }).fill(password);
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count())
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/login-empresa-mobile.png' });
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
  await expect(page).toHaveURL(admin + '/' + a.slug + '/pedidos?aba=fichas');
});
test('seletor de empresas recupera falhas, trata lista vazia e troca mesmo com sessão legada', async ({
  page,
}) => {
  let mode = 'error';
  await page.route('**/api/v1/auth/establishments', async (route) => {
    if (mode === 'error')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Indisponível' } }),
      });
    else if (mode === 'empty')
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    else await route.continue();
  });
  await page.goto(admin + '/entrar');
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar as empresas.');
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
  mode = 'empty';
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByText('Nenhuma empresa disponível para acesso no momento.')).toBeVisible();
  mode = 'ok';
  await page.getByRole('button', { name: 'Atualizar empresas', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Empresa', exact: true })).toBeVisible();
  await page.evaluate(
    (value) => sessionStorage.setItem('bar-staff', JSON.stringify(value)),
    loginA,
  );
  await page.goto(admin + '/' + b.slug + '/');
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Escolher outra empresa', exact: true })).toHaveCount(
    0,
  );
  await page.goto(admin + '/entrar');
  await expect(
    page.getByRole('heading', { name: 'Selecione sua empresa', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/login-empresa-selecao-mobile.png' });
});
test('garçom e cozinha também selecionam a empresa antes de informar credenciais', async ({
  page,
}) => {
  const identity = await (await page.request.get(api + '/pwa/apps/' + b.establishment_id)).json();
  for (const port of [35175, 35176]) {
    const origin = 'http://127.0.0.1:' + port;
    await page.goto(origin);
    await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Empresa', exact: true }).fill(b.slug);
    await page
      .getByRole('option', { name: identity.name.toLocaleUpperCase('pt-BR'), exact: true })
      .click();
    await expect(page).toHaveURL(origin + '/' + b.slug + '/');
    await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Estabelecimento', { exact: true })).toHaveCount(0);
  }
});
