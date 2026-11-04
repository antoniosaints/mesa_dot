import { expectMobileListLayout } from './list-layout.js';
import { test } from './test.js';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  password = 'SaasBrowserTestsOnly1!';
const suffix = randomUUID().slice(0, 8),
  rootEmail = 'root-ui-' + suffix + '@test.local';
let tenant: any;
test.beforeAll(async () => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  await provision({
    name: 'Mesa SaaS UI ' + suffix,
    owner_email: rootEmail,
    owner_name: 'Gestor da plataforma',
    password,
    platform: true,
    superadmin: true,
  });
  tenant = await provision({
    name: 'Restaurante Portal ' + suffix,
    owner_email: 'owner-ui-' + suffix + '@test.local',
    owner_name: 'Ana',
    password,
  });
});
test('landing responsiva com Sora, marca, demonstração e navegação funcional', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Seu salão em sintonia.');
  await page.getByRole('tab', { name: 'Cozinha', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Porção de batata');
  await page.getByRole('tab', { name: 'Caixa', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Saldo a receber');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Sora/);
  await page.screenshot({ path: '.local/screenshots/mesa-landing-desktop.png', fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Navegação principal', exact: true })
    .getByRole('link', { name: 'Entrar', exact: true })
    .click();
  await expect(page).toHaveURL(base + '/entrar');
  await expect(page.getByRole('heading', { name: 'Selecione sua empresa' })).toBeVisible();
  await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.local/screenshots/mesa-chooser-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('escolher restaurante abre login com slug, sem pedir empresa novamente', async ({ page }) => {
  await page.goto(base + '/entrar');
  await page.getByRole('combobox', { name: 'Empresa', exact: true }).fill(tenant.slug);
  await page
    .getByRole('option', {
      name: ('Restaurante Portal ' + suffix).toLocaleUpperCase('pt-BR'),
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp('/' + tenant.slug + '/'));
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Senha', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Empresa', exact: true })).toHaveCount(0);
});
test('cadastro público cria ambiente e permite primeiro login', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/criar-conta');
  const email = 'signup-browser-' + suffix + '@test.local';
  await page
    .getByLabel('Nome do restaurante ou bar', { exact: true })
    .fill('Novo Restaurante ' + suffix);
  await page.getByLabel('Seu nome', { exact: true }).fill('Maria');
  await page.getByLabel('Seu e-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Confirme a senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Criar meu estabelecimento' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sua casa já tem um lugar no Mesa.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Acessar meu estabelecimento' }).click();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.goto(base);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Seu salão em sintonia.');
});
test('gestor gerencia planos, assinaturas e suspensão com sessão separada', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/gestor');
  await page.evaluate(() =>
    sessionStorage.setItem('bar-staff', JSON.stringify({ marker: 'preservar-sessao-restaurante' })),
  );
  await page.getByLabel('E-mail do gestor').fill(rootEmail);
  await page.getByLabel('Senha do gestor').fill(password);
  await page.getByRole('button', { name: 'Entrar no gestor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contas da plataforma' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Gestão do SaaS', exact: true })
    .getByRole('link', { name: 'Planos', exact: true })
    .click();
  await page.getByRole('button', { name: 'Novo plano', exact: true }).click();
  const plan = page.getByRole('dialog', { name: 'Novo plano', exact: true });
  await plan.getByLabel('Nome do plano', { exact: true }).fill('Essencial ' + suffix);
  await plan.getByLabel('Mensalidade', { exact: true }).fill('129,90');
  await plan.getByRole('button', { name: 'Criar plano', exact: true }).click();
  await expect(plan).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Gestão do SaaS', exact: true })
    .getByRole('link', { name: 'Contas', exact: true })
    .click();
  await page.getByLabel('Buscar conta', { exact: true }).fill(tenant.slug);
  await expect(
    page.getByRole('row').filter({ hasText: 'Restaurante Portal ' + suffix }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Gerenciar', exact: true }).click();
  const detail = page.getByRole('dialog', {
    name: 'Gerenciar conta · Restaurante Portal ' + suffix,
    exact: true,
  });
  await detail.getByRole('button', { name: 'Vincular plano', exact: true }).click();
  const subscription = page.getByRole('dialog', { name: 'Configurar assinatura', exact: true });
  const planId = await subscription
    .getByRole('option', { name: new RegExp('^Essencial ' + suffix + ' ·') })
    .getAttribute('value');
  await subscription.getByLabel('Plano', { exact: true }).selectOption(planId!);
  await subscription.getByLabel('Válida até').fill('2027-12-31');
  await subscription.getByRole('button', { name: 'Salvar assinatura' }).click();
  await expect(subscription).toHaveCount(0);
  await expect(detail).toContainText('Essencial ' + suffix);
  await detail.getByRole('button', { name: 'Suspender conta', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Suspender acesso desta conta?', exact: true })
    .getByRole('button', { name: 'Confirmar suspensão' })
    .click();
  await expect(detail).toContainText('Conta suspensa');
  await detail.getByRole('button', { name: 'Reativar conta', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reativar esta conta?', exact: true })
    .getByRole('button', { name: 'Confirmar reativação' })
    .click();
  await expect(detail).toContainText('Conta ativa');
  await detail.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Gerenciar', exact: true })).toBeVisible();
  while (await page.getByRole('button', { name: 'Fechar notificação', exact: true }).count())
    await page.getByRole('button', { name: 'Fechar notificação', exact: true }).first().click();
  await page.screenshot({ path: '.local/screenshots/mesa-saas-desktop.png', fullPage: true });
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bar-staff')!).marker)).toBe(
    'preservar-sessao-restaurante',
  );
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectMobileListLayout(page.locator('.mesa-root-table'));
  await page.screenshot({ path: '.local/screenshots/mesa-saas-mobile.png', fullPage: true });
  for (const label of ['Planos', 'Auditoria']) {
    await page
      .getByRole('navigation', { name: 'Gestão do SaaS no celular', exact: true })
      .getByRole('link', { name: label, exact: true })
      .click();
    await expectMobileListLayout(page.locator('.mesa-root-table'));
  }
  await page.getByRole('button', { name: 'Sair do gestor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar no gestor SaaS' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Entrar no gestor SaaS' })).toBeVisible();
  expect(errors).toEqual([]);
});
