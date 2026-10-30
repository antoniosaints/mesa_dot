import { test } from './test.js';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readBusinessHours } from '../../packages/shared/src/business-hours.js';
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1',
  suffix = randomUUID().slice(0, 8),
  password = 'SettingsBrowserOnlyPassword1!',
  email = 'settings-' + suffix + '@test.local';
let fixture: any, token: string;
const headers = () => ({ authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
async function savedSettings(request: APIRequestContext) {
  const response = await request.get(api + '/settings', { headers: headers() });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function login(page: Page) {
  await page.goto(base + '/' + fixture.slug + '/configuracoes');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('tab', { name: 'Negócio e aplicativo', exact: true })).toBeVisible();
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Configurações Browser ' + suffix,
    owner_name: 'Gestora',
    owner_email: email,
    password,
    demo: true,
  });
  const auth = await request.post(api + '/auth/login', {
    data: { email, password, establishment_slug: fixture.slug },
  });
  expect(auth.ok()).toBe(true);
  token = (await auth.json()).token;
});
test('negócio e aplicativo compartilham aba, nome e endereço sem repetir o cadastro', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const tabs = page.getByRole('tablist', { name: 'Configurações', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tabs.getByRole('tab', { name: 'Aplicativo PWA', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Informações do negócio', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Identidade visual e aplicativo', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Editar informações', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Informações do negócio', exact: true });
  const name = 'Configurações Browser ' + suffix + ' Centro';
  await modal.getByLabel('Nome', { exact: true }).fill(name);
  await modal
    .getByLabel('Descrição do negócio', { exact: true })
    .fill('Comida da casa e bons encontros.');
  await modal.getByLabel('Telefone', { exact: true }).fill('11988887777');
  await expect(modal.getByLabel('Telefone', { exact: true })).toHaveValue('(11) 98888-7777');
  await modal.getByLabel('E-mail de contato', { exact: true }).fill('CONTATO@EXAMPLE.COM');
  await modal.getByLabel('CEP', { exact: true }).fill('abc00123456');
  await expect(modal.getByLabel('CEP', { exact: true })).toHaveValue('00123-456');
  await modal.getByLabel('Rua ou avenida', { exact: true }).fill('Rua das Flores');
  await modal.getByLabel('Número', { exact: true }).fill('S/N');
  await modal.getByLabel('Complemento', { exact: true }).fill('Loja 2');
  await modal.getByLabel('Bairro', { exact: true }).fill('Centro');
  await modal.getByLabel('Cidade', { exact: true }).fill('São Paulo');
  await modal.getByRole('combobox', { name: 'Estado (UF)', exact: true }).click();
  await page.getByRole('option', { name: 'São Paulo (SP)', exact: true }).click();
  await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(modal).toHaveCount(0);
  const saved = await savedSettings(request);
  fixture.slug = saved.slug;
  expect(saved.business_profile).toMatchObject({
    description: 'Comida da casa e bons encontros.',
    phone: '11988887777',
    email: 'contato@example.com',
    postal_code: '00123456',
    street: 'Rua das Flores',
    number: 'S/N',
    city: 'São Paulo',
    state: 'SP',
  });
  await expect(page.locator('.business-settings-details')).toContainText(
    'Comida da casa e bons encontros.',
  );
  const customer = await page.context().newPage();
  await customer.goto('http://127.0.0.1:35174/' + saved.slug + '/');
  await customer.getByRole('button', { name: 'Sobre o estabelecimento', exact: true }).click();
  const about = customer.getByRole('dialog', { name: 'Sobre ' + name, exact: true });
  await expect(about).toContainText('Comida da casa e bons encontros.');
  await expect(about).toContainText('Rua das Flores, S/N');
  await expect(about.getByRole('link', { name: '(11) 98888-7777', exact: true })).toHaveAttribute(
    'href',
    'tel:+5511988887777',
  );
  await expect(
    about.getByRole('link', { name: 'contato@example.com', exact: true }),
  ).toHaveAttribute('href', 'mailto:contato@example.com');
  await customer.setViewportSize({ width: 320, height: 844 });
  expect(await about.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await customer.close();
  await expect(page.locator('.pwa-phone-preview')).toContainText(name);
  await expect(page.getByLabel('Endereço gerado automaticamente', { exact: true })).toHaveValue(
    saved.slug,
  );
  await expect(page.getByLabel('URL pública', { exact: true })).toHaveValue(
    'http://127.0.0.1:35174/' + saved.slug + '/',
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('.admin-main')).toHaveCSS(
        'margin-left',
        width > 900 ? '284px' : '0px',
      );
      await expect(page.locator('.sidebar')).toHaveCSS(
        'transform',
        width > 900 ? 'none' : 'matrix(1, 0, 0, 1, -284, 0)',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));
      if (width !== 320)
        await page.screenshot({
          path: '.local/screenshots/settings-business-' + width + '-' + theme + '.png',
          fullPage: true,
        });
    }
  }
});
test('protege alterações só no perfil e valida telefone e CEP antes de salvar', async ({
  page,
  request,
}) => {
  const before = (await savedSettings(request)).business_profile;
  await login(page);
  await page.getByRole('button', { name: 'Editar endereço', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Informações do negócio', exact: true });
  await modal.getByLabel('Cidade', { exact: true }).fill('Cidade ainda não salva');
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const guard = page.getByRole('alertdialog', { name: 'Descartar alterações?', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await expect(modal.getByLabel('Cidade', { exact: true })).toHaveValue('Cidade ainda não salva');
  await modal.getByLabel('Telefone', { exact: true }).fill('123');
  await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(
    modal.getByText('Informe o telefone com DDD (10 ou 11 dígitos).', { exact: true }),
  ).toBeVisible();
  await modal.getByLabel('Telefone', { exact: true }).fill('11988887777');
  await modal.getByLabel('CEP', { exact: true }).fill('123');
  await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(modal.getByText('Informe um CEP com 8 dígitos.', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
  }
  expect((await savedSettings(request)).business_profile).toEqual(before);
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await guard.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await expect(modal).toHaveCount(0);
});
test('aplica períodos a dias escolhidos, preserva os demais e permite 24 horas e dias fechados', async ({
  page,
  request,
}) => {
  const before = readBusinessHours((await savedSettings(request)).opening_hours);
  await login(page);
  await page.getByRole('tab', { name: 'Funcionamento e cardápio', exact: true }).click();
  await page.getByRole('button', { name: 'Editar funcionamento', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Funcionamento e cardápio', exact: true }),
    batch = modal.locator('.business-hours-batch');
  await batch.getByRole('button', { name: 'Limpar seleção', exact: true }).click();
  for (const day of ['Segunda-feira', 'Quarta-feira', 'Sábado'])
    await batch.getByRole('checkbox', { name: 'Aplicar em ' + day, exact: true }).check();
  await batch
    .getByLabel('Abertura de horário compartilhado, período 1', { exact: true })
    .fill('11:00');
  await batch
    .getByLabel('Fechamento de horário compartilhado, período 1', { exact: true })
    .fill('14:00');
  await batch
    .getByRole('button', { name: 'Adicionar período em horário compartilhado', exact: true })
    .click();
  await modal.getByRole('button', { name: 'Salvar funcionamento', exact: true }).click();
  await expect(
    page.getByText('Aplique o horário aos dias selecionados antes de salvar o funcionamento.', {
      exact: true,
    }),
  ).toBeVisible();
  await batch.getByRole('button', { name: 'Aplicar aos dias selecionados', exact: true }).click();
  for (const day of ['Segunda-feira', 'Quarta-feira', 'Sábado']) {
    await expect(
      modal.getByLabel('Abertura de ' + day + ', período 1', { exact: true }),
    ).toHaveValue('11:00');
    await expect(
      modal.getByLabel('Fechamento de ' + day + ', período 2', { exact: true }),
    ).toHaveValue('23:00');
  }
  await expect(modal.getByLabel('Abertura de Terça-feira, período 1', { exact: true })).toHaveValue(
    before.days[2].periods[0].start,
  );
  expect(readBusinessHours((await savedSettings(request)).opening_hours)).toEqual(before);
  await modal.getByLabel('Abertura de Quarta-feira, período 1', { exact: true }).fill('12:00');
  await expect(
    modal.getByLabel('Abertura de Segunda-feira, período 1', { exact: true }),
  ).toHaveValue('11:00');
  await modal.getByRole('button', { name: 'Salvar funcionamento', exact: true }).click();
  await expect(modal).toHaveCount(0);
  let saved = readBusinessHours((await savedSettings(request)).opening_hours);
  expect(saved.days[1].periods[0].start).toBe('11:00');
  expect(saved.days[3].periods[0].start).toBe('12:00');
  for (const weekday of [0, 2, 4, 5]) expect(saved.days[weekday]).toEqual(before.days[weekday]);
  await page.getByRole('button', { name: 'Editar funcionamento', exact: true }).click();
  await batch.getByRole('button', { name: 'Todos os dias', exact: true }).click();
  await batch
    .getByRole('combobox', { name: 'Funcionamento dos dias selecionados', exact: true })
    .click();
  await page.getByRole('option', { name: '24 horas', exact: true }).click();
  await batch.getByRole('button', { name: 'Aplicar aos dias selecionados', exact: true }).click();
  await batch.getByRole('button', { name: 'Limpar seleção', exact: true }).click();
  for (const day of ['Sábado', 'Domingo'])
    await batch.getByRole('checkbox', { name: 'Aplicar em ' + day, exact: true }).check();
  await batch
    .getByRole('combobox', { name: 'Funcionamento dos dias selecionados', exact: true })
    .click();
  await page.getByRole('option', { name: 'Fechado', exact: true }).click();
  await batch.getByRole('button', { name: 'Aplicar aos dias selecionados', exact: true }).click();
  await modal.getByRole('button', { name: 'Salvar funcionamento', exact: true }).click();
  await expect(modal).toHaveCount(0);
  saved = readBusinessHours((await savedSettings(request)).opening_hours);
  expect(saved.days.filter((day) => day.enabled && day.all_day)).toHaveLength(5);
  expect(saved.days.filter((day) => !day.enabled).map((day) => day.weekday)).toEqual([0, 6]);
});
test('valida horários compartilhados e protege preenchimento não salvo em mobile e dark', async ({
  page,
  request,
}) => {
  const initial = readBusinessHours(null);
  const response = await request.patch(api + '/settings', {
    headers: headers(),
    data: { opening_hours: initial },
  });
  expect(response.ok()).toBe(true);
  await login(page);
  await page.getByRole('tab', { name: 'Funcionamento e cardápio', exact: true }).click();
  await page.getByRole('button', { name: 'Editar funcionamento', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Funcionamento e cardápio', exact: true }),
    batch = modal.locator('.business-hours-batch');
  await batch
    .getByLabel('Fechamento de horário compartilhado, período 1', { exact: true })
    .fill('09:00');
  await batch.getByRole('button', { name: 'Aplicar aos dias selecionados', exact: true }).click();
  await expect(
    page.getByText(
      'A abertura e o fechamento devem ser diferentes. Para o dia inteiro, use 24 horas.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    modal.getByLabel('Fechamento de Segunda-feira, período 1', { exact: true }),
  ).toHaveValue('18:00');
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const guard = page.getByRole('alertdialog', { name: 'Descartar alterações?', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await batch
    .getByLabel('Fechamento de horário compartilhado, período 1', { exact: true })
    .fill('22:00');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await batch.scrollIntoViewIfNeeded();
      expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 390)
        await page.screenshot({ path: '.local/screenshots/settings-hours-' + theme + '.png' });
    }
  }
  await batch.getByRole('button', { name: 'Reverter preenchimento', exact: true }).click();
  await expect(
    batch.getByLabel('Fechamento de horário compartilhado, período 1', { exact: true }),
  ).toHaveValue('18:00');
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(readBusinessHours((await savedSettings(request)).opening_hours)).toEqual(initial);
});
