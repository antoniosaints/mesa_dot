import { test } from './test.js';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
const password = 'PushBrowserOnlyPassword1!',
  suffix = randomUUID().slice(0, 8),
  email = 'push-browser-' + suffix + '@test.local',
  base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1';
let fixture: any, token: string;
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Push Browser ' + suffix,
    owner_email: email,
    owner_name: 'Gestora',
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
  expect(
    (
      await request.post(api + '/staff', {
        headers: { authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
        data: {
          name: 'Garçom de push',
          email: 'waiter-' + email,
          password,
          role_id: fixture.roles.find((role: any) => role.name === 'Garçom').id,
        },
      })
    ).ok(),
  ).toBe(true);
});
async function mockNative(context: BrowserContext) {
  const key = createECDH('prime256v1');
  key.generateKeys();
  await context.addInitScript(
    ({ endpoint, keys }) => {
      let permission: NotificationPermission = 'default';
      (window as any).__permissionRequests = 0;
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => permission,
      });
      Notification.requestPermission = async () => {
        (window as any).__permissionRequests++;
        permission = 'granted';
        return 'granted';
      };
      function subscription(saved: any) {
        return {
          endpoint: saved.endpoint,
          expirationTime: null,
          options: { applicationServerKey: Uint8Array.from(saved.publicKey).buffer },
          toJSON: () => ({ endpoint: saved.endpoint, expirationTime: null, keys: saved.keys }),
          unsubscribe: async () => {
            localStorage.removeItem('test-native-push');
            return true;
          },
        };
      }
      PushManager.prototype.getSubscription = async function () {
        const stored = localStorage.getItem('test-native-push');
        return stored ? (subscription(JSON.parse(stored)) as unknown as PushSubscription) : null;
      };
      PushManager.prototype.subscribe = async function (options) {
        const raw = options!.applicationServerKey as Uint8Array;
        const saved = {
          endpoint,
          keys,
          publicKey: Array.from(raw instanceof Uint8Array ? raw : new Uint8Array(raw)),
        };
        localStorage.setItem('test-native-push', JSON.stringify(saved));
        return subscription(saved) as unknown as PushSubscription;
      };
    },
    {
      endpoint: 'https://fcm.googleapis.com/fcm/send/mesa-browser-' + randomUUID(),
      keys: {
        p256dh: key.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    },
  );
}
async function login(page: Page, origin = base, account = email) {
  await page.goto(origin + '/' + fixture.slug + '/');
  await page.getByLabel('E-mail', { exact: true }).fill(account);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
}
test('admin define eventos e perfis; cada dispositivo exige ativação explícita e pode ser revogado', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(90000);
  await mockNative(context);
  await login(page);
  expect(await page.evaluate(() => (window as any).__permissionRequests)).toBe(0);
  await page
    .getByRole('button', { name: 'Notificações push deste dispositivo', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Notificações neste dispositivo', exact: true });
  await expect(
    modal.getByRole('button', { name: 'Ativar notificações', exact: true }),
  ).toBeEnabled();
  await modal.getByLabel('Nome do dispositivo', { exact: true }).fill('Computador do caixa');
  await modal.getByRole('button', { name: 'Ativar notificações', exact: true }).click();
  await expect(modal.getByText('Ativado nesta filial', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__permissionRequests)).toBe(1);
  await modal.getByRole('button', { name: 'Enviar teste', exact: true }).click();
  await expect(
    page.getByText('Teste adicionado à fila de notificações.', { exact: true }),
  ).toBeVisible();
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('tab', { name: 'Notificações push', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar notificações', exact: true }).click();
  const rules = page.getByRole('dialog', { name: 'Configurar notificações push', exact: true });
  await rules.getByLabel('Ativar envio de notificações nesta filial', { exact: true }).check();
  await rules.getByRole('checkbox', { name: 'Novos pedidos para Garçom', exact: true }).uncheck();
  await expect(
    rules.getByRole('checkbox', { name: 'Solicitações de entrega para Cozinha', exact: true }),
  ).toBeDisabled();
  await rules.getByRole('button', { name: 'Salvar configurações', exact: true }).click();
  await expect(rules).toHaveCount(0);
  const response = await request.get(api + '/push/settings', {
    headers: { authorization: 'Bearer ' + token },
  });
  const config = await response.json();
  expect(config.enabled).toBeTruthy();
  expect(config.rules.find((rule: any) => rule.event === 'order.confirmed').role_ids).not.toContain(
    fixture.roles.find((role: any) => role.name === 'Garçom').id,
  );
  const row = page.getByRole('row').filter({ hasText: 'Computador do caixa' });
  await expect(row).toBeVisible();
  await page.screenshot({
    path: '.local/screenshots/push-settings-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await row.getByRole('button', { name: 'Desativar', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Desativar dispositivo push?', exact: true })
    .getByRole('button', { name: 'Confirmar desativação', exact: true })
    .click();
  await expect(row).toContainText('Desativado');
  await page
    .getByRole('searchbox', { name: 'Buscar dispositivo push', exact: true })
    .fill('não encontrado');
  await expect(
    page.getByText('Nenhum dispositivo encontrado nesta filial.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar dispositivo push', exact: true }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: '.local/screenshots/push-settings-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
test('garçom ativa o próprio aparelho sem ter acesso às regras administrativas', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await mockNative(context);
    const page = await context.newPage();
    await login(page, 'http://127.0.0.1:35175', 'waiter-' + email);
    expect(await page.evaluate(() => (window as any).__permissionRequests)).toBe(0);
    await page
      .getByRole('button', { name: 'Notificações push deste dispositivo', exact: true })
      .click();
    const modal = page.getByRole('dialog', { name: 'Notificações neste dispositivo', exact: true });
    await modal.getByRole('button', { name: 'Ativar notificações', exact: true }).click();
    await expect(modal.getByText('Ativado nesta filial', { exact: true })).toBeVisible();
    await page.screenshot({
      path: '.local/screenshots/push-device-waiter-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await modal.getByRole('button', { name: 'Desativar nesta filial', exact: true }).click();
    await expect(
      modal.getByText('Ainda não ativado neste dispositivo', { exact: true }),
    ).toBeVisible();
    const auth = await (
      await request.post(api + '/auth/login', {
        data: { email: 'waiter-' + email, password, establishment_slug: fixture.slug },
      })
    ).json();
    expect(
      (
        await request.get(api + '/push/settings', {
          headers: { authorization: 'Bearer ' + auth.token },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await context.close();
  }
});
