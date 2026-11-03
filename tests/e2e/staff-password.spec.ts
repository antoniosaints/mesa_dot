import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const suffix = randomUUID().slice(0, 8),
  email = 'team-password-owner-' + suffix + '@test.local',
  workerEmail = 'team-password-worker-' + suffix + '@test.local',
  managerEmail = 'team-password-manager-' + suffix + '@test.local',
  password = 'TeamPasswordBrowser1!';
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1';
let fixture: any, workerToken: string;
async function login(page: Page, account = email) {
  await page.goto(base + '/' + fixture.slug + '/equipe');
  await page.getByLabel('E-mail', { exact: true }).fill(account);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.locator('.team-table')).toBeVisible();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Equipe senhas ' + suffix,
    owner_name: 'Admin',
    owner_email: email,
    password,
  });
  const signIn = async (account: string) =>
    (
      await (
        await request.post(api + '/auth/login', {
          data: { email: account, password, establishment_slug: fixture.slug },
        })
      ).json()
    ).token;
  const token = await signIn(email);
  async function post(path: string, data: any) {
    const response = await request.post(api + path, {
      headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
      data,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  await post('/staff', {
    name: 'Funcionário de teste',
    email: workerEmail,
    password,
    role_id: fixture.roles.find((role: any) => role.name === 'Garçom').id,
  });
  workerToken = await signIn(workerEmail);
  const manager = await post('/roles', { name: 'Gestor da equipe', permissions: ['staff.manage'] });
  await post('/staff', {
    name: 'Gestor operacional',
    email: managerEmail,
    password,
    role_id: manager.id,
  });
});
test('organiza as ações e troca a senha com confirmação, encerrando as sessões anteriores', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page
    .locator('.team-table tbody tr')
    .filter({ hasText: workerEmail })
    .getByRole('button', { name: 'Ver funcionário Funcionário de teste', exact: true })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Funcionário · Funcionário de teste',
    exact: true,
  });
  const shortcuts = detail.locator('.team-detail-shortcuts > button');
  const first = await shortcuts.nth(0).boundingBox(),
    second = await shortcuts.nth(1).boundingBox();
  expect(Math.abs(first!.width - second!.width)).toBeLessThanOrEqual(1);
  expect(second!.x - first!.x - first!.width).toBeGreaterThanOrEqual(9);
  const note = await detail.locator('.team-security-note').boundingBox();
  expect(first!.y - note!.y - note!.height).toBeGreaterThanOrEqual(19);
  await detail.screenshot({ path: '.local/screenshots/team-detail-actions-desktop.png' });
  await detail.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  const reset = page.getByRole('dialog', {
    name: 'Alterar senha · Funcionário de teste',
    exact: true,
  });
  const replacement = 'EmployeeReplacementOnly1!';
  await reset.getByLabel('Nova senha', { exact: true }).fill(replacement);
  await reset.getByLabel('Confirmar nova senha', { exact: true }).fill('DifferentConfirmation1!');
  await reset.getByRole('button', { name: 'Salvar nova senha', exact: true }).click();
  await expect(reset.getByRole('alert')).toContainText('As senhas não conferem');
  await reset.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: 'Descartar alterações?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Continuar editando' }).click();
  await reset.getByLabel('Confirmar nova senha', { exact: true }).fill(replacement);
  await reset.getByRole('button', { name: 'Mostrar senhas' }).click();
  await expect(reset.getByLabel('Nova senha', { exact: true })).toHaveAttribute('type', 'text');
  await reset.getByRole('button', { name: 'Ocultar senhas' }).click();
  await reset.screenshot({ path: '.local/screenshots/team-change-password.png' });
  await reset.getByRole('button', { name: 'Salvar nova senha', exact: true }).click();
  await expect(reset).toHaveCount(0);
  const oldLogin = await request.post(api + '/auth/login', {
    data: { email: workerEmail, password, establishment_slug: fixture.slug },
  });
  expect(oldLogin.status()).toBe(401);
  expect(
    (
      await request.get(api + '/tables', { headers: { Authorization: 'Bearer ' + workerToken } })
    ).status(),
  ).toBe(401);
  const newLogin = await request.post(api + '/auth/login', {
    data: { email: workerEmail, password: replacement, establishment_slug: fixture.slug },
  });
  expect(newLogin.ok()).toBe(true);
  expect(
    await page.evaluate(
      (value) => JSON.stringify({ ...sessionStorage, ...localStorage }).includes(value),
      replacement,
    ),
  ).toBe(false);
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    const buttons = await detail
      .locator('.team-detail-controls button')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    expect(Math.max(...buttons) - Math.min(...buttons)).toBeLessThanOrEqual(1);
    await detail.screenshot({
      path: '.local/screenshots/team-detail-actions-mobile-' + theme + '.png',
    });
  }
});
test('não oferece redefinição de senha a gestores sem administração geral', async ({ page }) => {
  await login(page, managerEmail);
  await page
    .locator('.team-table tbody tr')
    .filter({ hasText: workerEmail })
    .getByRole('button', { name: 'Ver funcionário Funcionário de teste', exact: true })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Funcionário · Funcionário de teste',
    exact: true,
  });
  await expect(detail.getByRole('button', { name: 'Alterar senha', exact: true })).toHaveCount(0);
});
