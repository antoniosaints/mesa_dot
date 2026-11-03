import { test } from './test.js';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('exibe o logotipo da filial, mantém fallback e permite trocar de unidade', async ({
  page,
  request,
}) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  const { fallbackIcon } = await import('../../apps/api/src/pwa-icons.js');
  const suffix = randomUUID().slice(0, 8),
    email = 'branch-logo-' + suffix + '@test.local',
    password = 'BranchLogoBrowser1!';
  const fixture = await provision({
    name: 'Matriz com logo ' + suffix,
    owner_email: email,
    owner_name: 'Admin',
    password,
  });
  const api = 'http://127.0.0.1:33000/api/v1';
  const token = (
    await (
      await request.post(api + '/auth/login', {
        data: { email, password, establishment_slug: fixture.slug },
      })
    ).json()
  ).token;
  const headers = () => ({ Authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
  const logo = await request.patch(api + '/settings/pwa', {
    headers: headers(),
    data: { icon_base64: fallbackIcon('#ef4364', 512).toString('base64') },
  });
  expect(logo.ok()).toBe(true);
  const icon = await logo.json();
  const created = await request.post(api + '/establishments', {
    headers: headers(),
    data: { name: 'Filial sem logo ' + suffix },
  });
  expect(created.ok()).toBe(true);
  const extra = await created.json();
  const available = await (await request.get(api + '/branches', { headers: headers() })).json();
  expect(available.branches.find((branch: any) => branch.id === extra.id).icon_url).toBeNull();
  expect(
    available.branches.find((branch: any) => branch.id === fixture.establishment_id).icon_url,
  ).toContain(icon.icon_revision);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:35173/' + fixture.slug + '/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  const trigger = page.getByRole('button', {
    name: 'Filiais · Matriz com logo ' + suffix,
    exact: true,
  });
  await trigger.click();
  const own = page.getByRole('menuitemradio', { name: new RegExp('Matriz com logo ' + suffix) });
  const without = page.getByRole('menuitemradio', { name: new RegExp(extra.name) });
  await expect
    .poll(() => own.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(192);
  await expect(own.locator('img')).toHaveAttribute(
    'src',
    new RegExp(fixture.establishment_id + '/' + icon.icon_revision),
  );
  await expect(without.locator('img')).toHaveCount(0);
  await expect(without.locator('.branch-option-icon svg')).toBeVisible();
  await page
    .getByRole('menu', { name: 'Selecionar filial' })
    .screenshot({ path: '.local/screenshots/branch-unit-logo.png' });
  await trigger.click();
  await page.route('**/pwa/assets/**/192.png', (route) => route.abort());
  await trigger.click();
  await expect(own.locator('.branch-option-icon svg')).toBeVisible();
  await without.click();
  await expect(
    page.getByRole('button', { name: 'Filiais · ' + extra.name, exact: true }),
  ).toBeVisible();
});
