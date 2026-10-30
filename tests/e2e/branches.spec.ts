import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1',
  password = 'BranchBrowserPasswordOnly1!',
  suffix = randomUUID().slice(0, 8),
  email = 'branch-browser-' + suffix + '@test.local',
  staffEmail = 'branch-employee-' + suffix + '@test.local';
let fixture: any, token: string, extra: any;
async function login(page: Page, slug = fixture.slug, account = email) {
  await page.goto(base + '/' + slug + '/');
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
    name: 'Matriz Browser ' + suffix,
    owner_email: email,
    owner_name: 'Proprietária',
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
  const headers = { authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() };
  const created = await request.post(api + '/staff', {
    headers,
    data: {
      name: 'Funcionário da conta',
      email: staffEmail,
      password,
      role_id: fixture.roles.find((r: any) => r.name === 'Garçom').id,
    },
  });
  expect(created.ok()).toBe(true);
  const branch = await request.post(api + '/establishments', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { name: 'Filial Apoio ' + suffix },
  });
  expect(branch.ok()).toBe(true);
  extra = await branch.json();
});
test('dropdown cria filial, troca contexto sem senha e vincula usuário existente com perfil próprio', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page
    .getByRole('button', { name: 'Filiais · Matriz Browser ' + suffix, exact: true })
    .click();
  const menu = page.getByRole('menu', { name: 'Selecionar filial', exact: true });
  await expect(
    menu.getByRole('menuitemradio', { name: new RegExp('Matriz Browser ' + suffix) }),
  ).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitem', { name: 'Criar nova filial' }).click();
  const create = page.getByRole('dialog', { name: 'Criar nova filial', exact: true });
  await create.getByLabel('Nome da filial', { exact: true }).fill('Filial Centro ' + suffix);
  await create.getByRole('button', { name: 'Criar e acessar filial' }).click();
  await expect(page).toHaveURL(new RegExp('/filial-centro-' + suffix + '/dashboard$'));
  await expect(
    page.getByRole('button', { name: 'Filiais · Filial Centro ' + suffix, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Equipe', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Funcionário da conta' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Usuários e filiais', exact: true }).click();
  const directory = page.getByRole('dialog', { name: 'Usuários e filiais da conta', exact: true });
  await directory.getByLabel('Buscar usuário da conta').fill(staffEmail);
  await directory
    .getByRole('button', { name: 'Definir filiais de Funcionário da conta', exact: true })
    .click();
  const assignment = page.getByRole('dialog', {
    name: 'Filiais de Funcionário da conta',
    exact: true,
  });
  await assignment
    .getByRole('checkbox', { name: 'Permitir acesso a Filial Centro ' + suffix, exact: true })
    .check();
  await assignment
    .getByRole('combobox', { name: 'Perfil em Filial Centro ' + suffix, exact: true })
    .fill('Caixa');
  await page.getByRole('option', { name: 'Caixa', exact: true }).click();
  await assignment.getByRole('button', { name: 'Salvar filiais', exact: true }).click();
  await expect(assignment).toHaveCount(0);
  await expect(directory).toContainText('Filial Centro ' + suffix);
  await directory.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await expect(page.getByRole('row').filter({ hasText: 'Funcionário da conta' })).toBeVisible();
  const centreSlug = 'filial-centro-' + suffix;
  const staffContext = await browser.newContext(),
    staffPage = await staffContext.newPage();
  try {
    await login(staffPage, centreSlug, staffEmail);
    await expect(staffPage.getByRole('button', { name: 'Caixa', exact: true })).toBeVisible();
    const secondSession = await staffPage.evaluate(() =>
      Object.entries(sessionStorage)
        .map(([, value]) => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })
        .find((value) => value?.actor?.kind === 'STAFF'),
    );
    await staffPage
      .getByRole('button', { name: 'Filiais · Filial Centro ' + suffix, exact: true })
      .click();
    await expect(staffPage.getByRole('menuitem', { name: 'Criar nova filial' })).toHaveCount(0);
    await staffPage
      .getByRole('menuitemradio', { name: new RegExp('Matriz Browser ' + suffix) })
      .click();
    await expect(staffPage).toHaveURL(new RegExp('/' + fixture.slug + '/salao$'));
    await expect(staffPage.getByRole('button', { name: 'Caixa', exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Filiais · Filial Centro ' + suffix, exact: true })
      .click();
    await page.getByRole('menuitemradio', { name: new RegExp('Matriz Browser ' + suffix) }).click();
    await expect(page).toHaveURL(new RegExp('/' + fixture.slug + '/dashboard$'));
    await page.getByRole('button', { name: 'Equipe', exact: true }).click();
    await page
      .getByRole('button', { name: 'Definir filiais de Funcionário da conta', exact: true })
      .click();
    const remove = page.getByRole('dialog', {
      name: 'Filiais de Funcionário da conta',
      exact: true,
    });
    await remove
      .getByRole('checkbox', { name: 'Permitir acesso a Filial Centro ' + suffix, exact: true })
      .uncheck();
    await remove.getByRole('button', { name: 'Salvar filiais', exact: true }).click();
    await expect(remove).toHaveCount(0);
    const denied = await request.get(api + '/me', {
      headers: { authorization: 'Bearer ' + secondSession.token },
    });
    expect(denied.status()).toBe(401);
    await page
      .getByRole('button', { name: 'Filiais · Matriz Browser ' + suffix, exact: true })
      .click();
    await page.screenshot({
      path: '.local/screenshots/branch-dropdown-desktop.png',
      fullPage: true,
    });
  } finally {
    await staffContext.close();
  }
  expect(errors).toEqual([]);
});
test('seletor e controle de filiais funcionam em mobile, modo escuro e menu recolhido', async ({
  page,
}) => {
  await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click();
  await page
    .getByRole('button', { name: 'Filiais · Matriz Browser ' + suffix, exact: true })
    .click();
  await expect(page.getByRole('menu', { name: 'Selecionar filial' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await page
    .getByRole('button', { name: 'Filiais · Matriz Browser ' + suffix, exact: true })
    .click();
  await page.getByLabel('Buscar filial', { exact: true }).fill('Apoio');
  await page.getByRole('menuitemradio', { name: new RegExp('Filial Apoio ' + suffix) }).click();
  await expect(page).toHaveURL(new RegExp('/' + extra.slug + '/dashboard$'));
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await page.getByRole('button', { name: 'Equipe', exact: true }).click();
  await page.getByRole('button', { name: 'Usuários e filiais', exact: true }).click();
  const directory = page.getByRole('dialog', { name: 'Usuários e filiais da conta', exact: true });
  await directory
    .getByRole('button', { name: 'Definir filiais de Funcionário da conta', exact: true })
    .click();
  const assignment = page.getByRole('dialog', {
    name: 'Filiais de Funcionário da conta',
    exact: true,
  });
  await assignment
    .getByRole('checkbox', { name: 'Permitir acesso a Filial Apoio ' + suffix, exact: true })
    .check();
  await assignment.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Descartar alterações?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
  await expect(
    assignment.getByRole('checkbox', {
      name: 'Permitir acesso a Filial Apoio ' + suffix,
      exact: true,
    }),
  ).toBeChecked();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.screenshot({
    path: '.local/screenshots/branch-access-mobile-dark.png',
    fullPage: true,
  });
});
test('login lista só a matriz com logo e encaminha funcionário exclusivo da filial', async ({
  page,
  request,
}) => {
  const directory = await (await request.get(api + '/auth/establishments')).json();
  expect(directory.some((company: any) => company.slug === fixture.slug)).toBe(true);
  expect(directory.some((company: any) => company.slug === extra.slug)).toBe(false);
  const branchAuth = await (
    await request.post(api + '/auth/switch-branch', {
      headers: { authorization: 'Bearer ' + token },
      data: { establishment_id: extra.id },
    })
  ).json();
  const headers = { authorization: 'Bearer ' + branchAuth.token, 'Idempotency-Key': randomUUID() };
  const roles = await (await request.get(api + '/roles', { headers })).json();
  const isolatedEmail = 'only-branch-browser-' + suffix + '@test.local';
  const created = await request.post(api + '/staff', {
    headers,
    data: {
      name: 'Apenas filial',
      email: isolatedEmail,
      password,
      role_id: roles.find((role: any) => role.name === 'Garçom').id,
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto(base + '/entrar');
  const select = page.getByRole('combobox', { name: 'Empresa', exact: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await select.fill(fixture.slug);
      const option = page.getByRole('option', {
        name: ('Matriz Browser ' + suffix).toLocaleUpperCase('pt-BR'),
        exact: true,
      });
      await expect(option).toBeVisible();
      await expect(option).not.toContainText(fixture.slug);
      expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(56);
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(64);
      await expect
        .poll(() =>
          option
            .locator('img')
            .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 390)
        await page.screenshot({ path: '.local/screenshots/company-directory-' + theme + '.png' });
    }
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(base + '/' + fixture.slug + '/');
  await expect(page.getByRole('link', { name: 'Escolher outra empresa', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('E-mail', { exact: true }).fill(isolatedEmail);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    const footer = await page.locator('.login-security-note').boundingBox();
    const submit = await page.getByRole('button', { name: 'Entrar na operação' }).boundingBox();
    expect(Math.abs(footer!.x + footer!.width / 2 - submit!.x - submit!.width / 2)).toBeLessThan(2);
    expect(footer!.y).toBeGreaterThan(submit!.y + submit!.height);
    await page.screenshot({ path: '.local/screenshots/company-login-' + theme + '.png' });
  }
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page).toHaveURL(new RegExp('/' + extra.slug + '/salao$'));
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  const stored = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((key) => key.endsWith(':bar-staff')),
  );
  expect(stored).toContain('mesa:admin:' + extra.id + ':bar-staff');
  expect(stored).not.toContain('mesa:admin:' + fixture.establishment_id + ':bar-staff');
});

for (const theme of ['light', 'dark']) {
  test(`troca de filial mantém o loading contínuo antes dos scripts e até os dados estarem prontos (${theme})`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await login(page);
    await page.evaluate((value) => localStorage.setItem('mesa-theme', value), theme);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
    let releaseMain!: () => void, releaseLazy!: () => void, releaseData!: () => void;
    const main = new Promise<void>((resolve) => {
      releaseMain = resolve;
    });
    const lazy = new Promise<void>((resolve) => {
      releaseLazy = resolve;
    });
    const data = new Promise<void>((resolve) => {
      releaseData = resolve;
    });
    let mainRequested = false,
      lazyRequested = false,
      dataRequested = false;
    await page.route(
      '**/src/main.tsx',
      async (route) => {
        mainRequested = true;
        await main;
        await route.continue();
      },
      { times: 1 },
    );
    await page.route(
      /\/packages\/ui\/src\/admin-app\.tsx(?:\?|$)/,
      async (route) => {
        lazyRequested = true;
        await lazy;
        await route.continue();
      },
      { times: 1 },
    );
    await page.route('**/api/v1/dashboard', async (route) => {
      if (route.request().headers()['x-mesa-establishment'] !== extra.id) {
        await route.continue();
        return;
      }
      dataRequested = true;
      await data;
      await route.continue();
    });
    await page.addInitScript(
      ({ slug }) => {
        if (!location.pathname.startsWith('/' + slug + '/')) return;
        const stats = { uncovered: 0, observed: 0 };
        (window as any).__branchLoadingFrames = stats;
        const sample = () => {
          const boot = document.getElementById('mesa-boot-loading');
          if (boot) {
            stats.observed++;
            if (
              getComputedStyle(boot).display === 'none' &&
              !document.querySelector('.admin-layout')
            )
              stats.uncovered++;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { slug: extra.slug },
    );
    try {
      await page
        .getByRole('button', { name: 'Filiais · Matriz Browser ' + suffix, exact: true })
        .click();
      await page.getByRole('menuitemradio', { name: new RegExp('Filial Apoio ' + suffix) }).click();
      await page.waitForURL('**/' + extra.slug + '/', { waitUntil: 'commit' });
      await expect.poll(() => mainRequested).toBe(true);
      const boot = page.locator('#mesa-boot-loading');
      await expect(boot).toBeVisible();
      await expect(boot).toContainText(extra.name);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(boot).toHaveCSS(
        'background-color',
        theme === 'light' ? 'rgb(243, 246, 251)' : 'rgb(9, 14, 26)',
      );
      expect(
        await boot.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        }),
      ).toEqual([0, 0, 1280, 720]);
      await page.screenshot({
        path: `.local/screenshots/branch-continuous-before-scripts-${theme}.png`,
        animations: 'disabled',
      });
      releaseMain();
      await expect.poll(() => lazyRequested).toBe(true);
      await expect(boot).toBeVisible();
      await expect(page.locator('.page-loading')).toHaveCount(0);
      releaseLazy();
      await expect.poll(() => dataRequested).toBe(true);
      await expect(boot).toBeVisible();
      await expect(page.locator('.admin-layout')).toHaveCount(1);
      releaseData();
      await expect(boot).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Filiais · ' + extra.name, exact: true }),
      ).toBeVisible();
      await expect(page.locator('.metric').first()).toContainText('0 / 1');
      const stats = await page.evaluate(() => (window as any).__branchLoadingFrames);
      expect(stats.observed).toBeGreaterThan(0);
      expect(stats.uncovered).toBe(0);
      expect(
        await page.evaluate(() => sessionStorage.getItem('mesa:branch-transition')),
      ).toBeNull();
      await expect(page.locator('html')).not.toHaveAttribute('data-mesa-branch-loading');
    } finally {
      releaseMain();
      releaseLazy();
      releaseData();
    }
  });
}
