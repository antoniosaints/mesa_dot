import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const api = 'http://127.0.0.1:33000/api/v1',
  suffix = randomUUID().slice(0, 8),
  email = 'camera-owner-' + suffix + '@test.local',
  waiterEmail = 'camera-waiter-' + suffix + '@test.local',
  password = 'WaiterCameraBrowser1!';
let fixture: any, token: string, docs: any[], qr: string, barcode: string;
const headers = () => ({ Authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
async function login(page: Page) {
  await page.goto('http://127.0.0.1:35175/' + fixture.slug + '/conferir-ficha');
  await page.getByLabel('E-mail', { exact: true }).fill(waiterEmail);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('button', { name: 'Abrir câmera', exact: true })).toBeVisible();
}
async function camera(page: Page, image = '') {
  await page.addInitScript(
    ({ image }) => {
      const state = window as any;
      Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
      state.__cameraStreams = [];
      state.__cameraImage = image;
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'white';
        context.fillRect(0, 0, 1280, 720);
        if (state.__cameraImage) {
          const picture = new Image();
          picture.src = state.__cameraImage;
          await picture.decode();
          context.drawImage(picture, (1280 - picture.width) / 2, (720 - picture.height) / 2);
        }
        const stream = canvas.captureStream(8);
        state.__cameraStreams.push(stream);
        return stream;
      };
    },
    { image },
  );
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Câmera Garçom ' + suffix,
    owner_name: 'Admin',
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
  async function post(path: string, data: any) {
    const response = await request.post(api + path, { headers: headers(), data });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  await post('/staff', {
    name: 'Garçom da câmera',
    email: waiterEmail,
    password,
    role_id: fixture.roles.find((role: any) => role.name === 'Garçom').id,
  });
  const order = await post('/orders', {
    table_id: fixture.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 2, modifiers: [] }],
  });
  await post('/orders/' + order.id + '/confirm', {});
  const detail = await (
    await request.get(api + '/orders/' + order.id, { headers: headers() })
  ).json();
  docs = await Promise.all(
    detail.tickets.map(async (ticket: any) =>
      (await request.get(api + '/tickets/' + ticket.id, { headers: headers() })).json(),
    ),
  );
  const { default: QRCode } = await import('qrcode');
  const { default: bwipjs } = await import('bwip-js/node');
  qr = await QRCode.toDataURL(docs[0].token, { width: 340, margin: 4 });
  barcode =
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
});
test('garçom lê QR e Code 128 sem BarcodeDetector e só entrega após confirmação', async ({
  page,
  request,
}) => {
  await camera(page, qr);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  expect(await page.evaluate(() => typeof (window as any).BarcodeDetector)).toBe('undefined');
  const code = page.getByLabel('Código da ficha', { exact: true });
  await page.getByRole('button', { name: 'Abrir câmera', exact: true }).click();
  await expect(code).toHaveValue(docs[0].token);
  await expect(page.getByRole('button', { name: 'Parar câmera', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).__cameraStreams.every((stream: MediaStream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
    ),
  ).toBe(true);
  expect(
    (await (await request.get(api + '/tickets/' + docs[0].id, { headers: headers() })).json())
      .status,
  ).toBe('AVAILABLE');
  await page.getByRole('button', { name: 'Consultar ficha', exact: true }).click();
  await expect(page.locator('.resolved-ticket')).toContainText(docs[0].public_number);
  await page.evaluate((source) => {
    (window as any).__cameraImage = source;
  }, barcode);
  await page.getByRole('button', { name: 'Abrir câmera', exact: true }).click();
  await expect(code).toHaveValue(docs[1].token);
  await page.getByRole('button', { name: 'Consultar ficha', exact: true }).click();
  await expect(page.locator('.resolved-ticket')).toContainText(docs[1].public_number);
  await page.screenshot({ path: '.local/screenshots/waiter-camera-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirmar entrega ao cliente', exact: true }).click();
  await expect(code).toHaveValue('');
  expect(
    (await (await request.get(api + '/tickets/' + docs[1].id, { headers: headers() })).json())
      .status,
  ).toBe('REDEEMED');
  expect(
    (await (await request.get(api + '/tickets/' + docs[0].id, { headers: headers() })).json())
      .status,
  ).toBe('AVAILABLE');
});
test('informa permissão negada, permite cancelar a abertura e libera a câmera ao mudar de tela', async ({
  page,
}) => {
  await camera(page);
  await login(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('blocked', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: 'Abrir câmera', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('não autorizado');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        (window as any).__resolveCamera = resolve;
      });
  });
  await page.getByRole('button', { name: 'Abrir câmera', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).__resolveCamera === 'function');
  await page.getByRole('button', { name: 'Parar câmera', exact: true }).click();
  await page.evaluate(() => {
    const media = document.createElement('canvas').captureStream(1);
    (window as any).__pendingCamera = media;
    (window as any).__resolveCamera(media);
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
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const media = canvas.captureStream(8);
      (window as any).__activeCamera = media;
      return media;
    };
  });
  await page.getByRole('button', { name: 'Abrir câmera', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enquadre o QR Code' })).toBeVisible();
  await page.getByRole('button', { name: 'Mesas', exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__activeCamera
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Conferir ficha', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  });
  await page.getByRole('button', { name: 'Abrir câmera', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('HTTPS ou localhost');
  await expect(page.getByLabel('Código da ficha', { exact: true })).toBeEnabled();
});
