import { test } from './test.js';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1',
  suffix = randomUUID().slice(0, 8),
  email = 'ai-chat-' + suffix + '@test.local',
  password = 'AiChatBrowserOnlyPassword1!',
  staffEmail = 'ai-staff-' + suffix + '@test.local';
let fixture: any, token: string, branch: any;
const headers = () => ({ authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
async function login(page: Page, account = email) {
  await page.goto(base + '/' + fixture.slug + '/dashboard');
  await page.getByLabel('E-mail', { exact: true }).fill(account);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}
async function discard(page: Page) {
  await page
    .getByRole('alertdialog', { name: 'Descartar alterações?', exact: true })
    .getByRole('button', { name: 'Descartar alterações', exact: true })
    .click();
}
async function settings(request: APIRequestContext) {
  return (await request.get(api + '/settings', { headers: headers() })).json();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Assistente Browser ' + suffix,
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
  const saved = await request.post(api + '/complements/gemini/configure', {
    headers: headers(),
    data: {
      api_key: 'browser-gemini-key-only-for-tests',
      model: 'gemini-3.8-flash',
      image_model: 'gemini-3.1-flash-image',
    },
  });
  expect(saved.ok()).toBe(true);
  const staff = await request.post(api + '/staff', {
    headers: headers(),
    data: { name: 'Admin local', email: staffEmail, password, role_id: fixture.roles[0].id },
  });
  expect(staff.ok()).toBe(true);
  branch = await (
    await request.post(api + '/establishments', {
      headers: headers(),
      data: { name: 'Filial Assistente ' + suffix },
    })
  ).json();
});
test('chat flutuante mantém conversa ao navegar e recarregar, com histórico no pedido seguinte', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByRole('button', { name: 'Abrir assistente IA', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Assistente Gemini', exact: true });
  await chat.getByLabel('Mensagem para o assistente').fill('Como entregar uma ficha?');
  await chat.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(chat.locator('.ai-message.is-assistant')).toHaveCount(1);
  await chat.getByRole('button', { name: 'Minimizar conversa', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Cardápio', exact: true })
    .click();
  await page.getByRole('button', { name: 'Abrir assistente IA', exact: true }).click();
  await expect(chat.locator('.ai-message.is-user')).toContainText('Como entregar uma ficha?');
  const sent = page.waitForRequest(
    (request) => request.url().endsWith('/complements/gemini/ask') && request.method() === 'POST',
  );
  await chat.getByLabel('Mensagem para o assistente').fill('E como cancelar o pedido?');
  await chat.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  expect((await sent).postDataJSON().history.map((entry: any) => entry.role)).toEqual([
    'user',
    'model',
  ]);
  await expect(chat.locator('.ai-message.is-assistant')).toHaveCount(2);
  await page.reload();
  await page.getByRole('button', { name: 'Abrir assistente IA', exact: true }).click();
  await expect(chat.locator('.ai-message.is-assistant')).toHaveCount(2);
  await page.screenshot({ path: '.local/screenshots/ai-chat-desktop.png' });
});
test('descrições são revisadas antes de preencher o produto e imagens têm prévia e download', async ({
  page,
  request,
}) => {
  let unintendedWrites = 0;
  page.on('request', (request) => {
    if (
      ['POST', 'PATCH'].includes(request.method()) &&
      /\/api\/v1\/(?:products(?:\/[a-f0-9-]+)?|settings)$/.test(new URL(request.url()).pathname)
    )
      unintendedWrites++;
  });
  await login(page);
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Cardápio', exact: true })
    .click();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const product = page.getByRole('dialog', {
    name: 'Adicionar · Produtos',
    exact: true,
    includeHidden: true,
  });
  await product.getByLabel('Nome', { exact: true }).fill('Bebida com gengibre ' + suffix);
  await product.getByLabel('Descrição', { exact: true }).fill('Bebida com gengibre fresco.');
  await product.getByRole('button', { name: 'Gerar descrição com IA', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'Gerar descrição com IA', exact: true });
  await draft.getByRole('button', { name: 'Gerar rascunho', exact: true }).click();
  await expect(draft.getByLabel('Descrição sugerida')).toContainText('Descrição sugerida');
  await expect(product.getByLabel('Descrição', { exact: true })).toHaveValue(
    'Bebida com gengibre fresco.',
  );
  await draft.getByLabel('Descrição sugerida').fill('Descrição revisada pela gestora.');
  await draft.getByRole('button', { name: 'Usar descrição', exact: true }).click();
  await expect(product.getByLabel('Descrição', { exact: true })).toHaveValue(
    'Descrição revisada pela gestora.',
  );
  await product.getByRole('button', { name: 'Criar imagem com IA', exact: true }).click();
  const image = page.getByRole('dialog', { name: 'Criar imagem com IA', exact: true });
  const imageKeys: string[] = [];
  await page.route('**/api/v1/complements/gemini/ask', async (route) => {
    if (route.request().postDataJSON().mode !== 'image') {
      await route.continue();
      return;
    }
    imageKeys.push(route.request().headers()['idempotency-key']);
    if (imageKeys.length === 1) {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await image.getByRole('button', { name: 'Gerar imagem', exact: true }).click();
  await expect(image.getByRole('button', { name: 'Gerar imagem', exact: true })).toBeEnabled();
  await image.getByRole('button', { name: 'Gerar imagem', exact: true }).click();
  await expect(image.getByRole('img')).toBeVisible();
  expect(imageKeys).toHaveLength(2);
  expect(imageKeys[0]).toBe(imageKeys[1]);
  expect(
    await image.getByRole('img').evaluate((element: HTMLImageElement) => element.naturalWidth),
  ).toBe(4);
  const downloaded = page.waitForEvent('download');
  await image.getByRole('link', { name: 'Baixar imagem', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.png$/);
  await page.screenshot({ path: '.local/screenshots/ai-product-image.png' });
  await image.locator('.modal-footer').getByRole('button', { name: 'Fechar', exact: true }).click();
  await discard(page);
  const products = await (await request.get(api + '/products', { headers: headers() })).json();
  expect(products.some((row: any) => row.name === 'Bebida com gengibre ' + suffix)).toBe(false);
  expect(unintendedWrites).toBe(0);
  await product.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await discard(page);
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Configurações', exact: true })
    .click();
  await page.getByRole('button', { name: 'Editar informações', exact: true }).click();
  const business = page.getByRole('dialog', { name: 'Informações do negócio', exact: true });
  const before = await settings(request);
  await business.getByRole('button', { name: 'Gerar descrição com IA', exact: true }).click();
  await draft.getByRole('button', { name: 'Gerar rascunho', exact: true }).click();
  await expect(draft.getByLabel('Descrição sugerida')).toBeVisible();
  await draft.getByRole('button', { name: 'Usar descrição', exact: true }).click();
  await expect(business.getByLabel('Descrição do negócio')).toHaveValue(/Descrição sugerida/);
  expect((await settings(request)).business_profile).toEqual(before.business_profile);
  expect(unintendedWrites).toBe(0);
});
test('atalhos de resumo usam contexto e período e o chat cabe no celular em ambos os temas', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Resumir operação com IA', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Assistente Gemini', exact: true });
  await expect(chat.locator('.ai-message.is-assistant')).toHaveCount(1);
  await chat.getByRole('button', { name: 'Minimizar conversa', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Painel financeiro', exact: true })
    .click();
  await expect(page.getByLabel('Atalho de período')).toBeVisible();
  const sent = page.waitForRequest(
    (request) => request.url().endsWith('/complements/gemini/ask') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Resumir período com IA', exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    mode: 'summary',
    focus: 'finance',
    period: { start: expect.any(String), end: expect.any(String) },
  });
  await expect(chat.locator('.ai-message.is-assistant')).toHaveCount(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark'])
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const bounds = await chat.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await chat.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: '.local/screenshots/ai-chat-' + width + '-' + theme + '.png' });
    }
});
test('não expõe o assistente ao administrador local e não mistura conversas entre filiais', async ({
  page,
}) => {
  await login(page, staffEmail);
  await expect(page.locator('.ai-launcher')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Resumir operação com IA', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await login(page);
  await page.getByRole('button', { name: 'Abrir assistente IA', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Assistente Gemini', exact: true });
  await chat.getByLabel('Mensagem para o assistente').fill('Mensagem privada da matriz');
  await chat.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(chat.locator('.ai-message.is-assistant')).toHaveCount(1);
  await chat.getByRole('button', { name: 'Minimizar conversa', exact: true }).click();
  await page
    .getByRole('button', { name: 'Filiais · Assistente Browser ' + suffix, exact: true })
    .click();
  await page
    .getByRole('menu', { name: 'Selecionar filial', exact: true })
    .getByRole('menuitemradio', { name: new RegExp(branch.name) })
    .click();
  await expect(page).toHaveURL(new RegExp('/' + branch.slug + '/dashboard$'));
  await page.getByRole('button', { name: 'Abrir assistente IA', exact: true }).click();
  await expect(chat).toContainText('Configurar em Complementos');
  await expect(chat).not.toContainText('Mensagem privada da matriz');
});
