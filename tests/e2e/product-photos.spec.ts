import { expectMobileModalLayout } from './modal-layout.js';
import { test } from './test.js';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const suffix = randomUUID().slice(0, 8),
  email = 'photo-ui-' + suffix + '@test.local',
  password = 'PhotoBrowserPassword1!';
let fixture: any;
test.beforeAll(async () => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Fotos Browser ' + suffix,
    owner_name: 'Gestora',
    owner_email: email,
    password,
    demo: true,
  });
});
test('cadastra, amplia, troca e remove fotos preservando a edição e o layout mobile', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:35173/' + fixture.slug + '/cardapio');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Adicionar · Produtos', exact: true });
  const name =
    'Produto fotografado com nome extenso para o cardápio ' + suffix + '-' + 'X'.repeat(48);
  await create.getByLabel('Nome', { exact: true }).fill(name);
  await create.getByLabel('Selecionar foto do produto').setInputFiles({
    name: 'invalido.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(create.getByRole('alert')).toContainText('PNG, JPEG ou WebP');
  const photo = new PNG({ width: 1200, height: 600 });
  for (let y = 0; y < photo.height; y++)
    for (let x = 0; x < photo.width; x++) {
      const offset = (y * photo.width + x) * 4;
      photo.data[offset] = x % 255;
      photo.data[offset + 1] = y % 255;
      photo.data[offset + 2] = 140;
      photo.data[offset + 3] = 255;
    }
  const file = { name: 'produto.png', mimeType: 'image/png', buffer: PNG.sync.write(photo) };
  await create.getByLabel('Selecionar foto do produto').setInputFiles(file);
  await expect(create.getByRole('button', { name: 'Trocar foto', exact: true })).toBeVisible();
  await create.getByRole('button', { name: 'Ampliar foto do produto' }).click();
  const preview = page.getByRole('dialog', { name: 'Foto · ' + name, exact: true });
  await expect(preview.getByRole('img')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await expectMobileModalLayout(preview);
  await preview.screenshot({ path: '.local/screenshots/modal-photo-long-title-mobile.png' });
  expect(
    await request
      .get('http://127.0.0.1:33000/api/v1/public/' + fixture.slug + '/menu')
      .then((r) => r.json())
      .then((menu) => menu.products.some((p: any) => p.name === name)),
  ).toBe(false);
  await preview.getByRole('button', { name: 'Fechar foto', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await create.getByRole('tab', { name: 'Preços e variações', exact: true }).click();
  await create.getByLabel('Preço', { exact: true }).fill('12');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/v1/products'),
  );
  await create.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  const product = await (await saved).json();
  expect(product.photo_revision).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole('button', { name: 'Agora não', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar · Produtos', exact: true });
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const thumbnail = page.getByRole('button', { name: 'Ver foto de ' + name, exact: true });
  await expect(thumbnail.locator('img')).toBeVisible();
  await thumbnail.click();
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview
        .getByRole('img')
        .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]),
    )
    .toEqual([1024, 512]);
  await page.screenshot({ path: '.local/screenshots/product-photo-preview-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  const customer = await page.context().newPage();
  await customer.setViewportSize({ width: 390, height: 844 });
  await customer.goto('http://127.0.0.1:35174/' + fixture.slug + '/');
  const customerCard = customer.getByRole('button', { name, exact: true });
  await expect(customerCard.locator('img')).toBeVisible();
  await expect
    .poll(() =>
      customerCard
        .locator('img')
        .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]),
    )
    .toEqual([160, 80]);
  await customerCard.click();
  const customerDetail = customer.getByRole('dialog', { name, exact: true });
  await expect(customerDetail.locator('.customer-product-photo img')).toBeVisible();
  await expectMobileModalLayout(customerDetail);
  await customer.screenshot({ path: '.local/screenshots/product-photo-customer-mobile.png' });
  await customer.close();
  await page.getByRole('button', { name: 'Editar ' + name, exact: true }).click();
  await editor.getByRole('button', { name: 'Remover foto do produto' }).click();
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: 'Descartar alterações?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await editor.getByRole('button', { name: 'Desfazer', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await expect(editor.getByRole('button', { name: 'Trocar foto', exact: true })).toBeVisible();
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await expectMobileModalLayout(editor);
    await page.screenshot({
      path: '.local/screenshots/product-photo-editor-mobile-' + theme + '.png',
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await editor.getByLabel('Selecionar foto do produto').setInputFiles({
    ...file,
    name: 'nova-foto.png',
    buffer: PNG.sync.write(new PNG({ width: 320, height: 240 })),
  });
  const replaced = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith('/api/v1/products/' + product.id),
  );
  await editor.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  expect((await (await replaced).json()).photo_revision).not.toBe(product.photo_revision);
  await editor.getByRole('button', { name: 'Remover foto do produto' }).click();
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(thumbnail).toHaveCount(0);
});
