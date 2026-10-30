import { test } from './test.js';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('planta mantém posições em zoom, oferece ajuste exato e recupera uma falha sem perder o atendimento', async ({
  page,
  request,
  testDatabase,
}) => {
  test.setTimeout(90000);
  const { provision } = await import('../../packages/database/src/provision.js');
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const suffix = randomUUID().slice(0, 8),
    password = 'FloorBrowserTestsOnly1!',
    email = 'floor-browser-' + suffix + '@test.local';
  const fixture = await provision({
    name: 'Salão Browser ' + suffix,
    owner_email: email,
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  const api = 'http://127.0.0.1:33000/api/v1';
  const auth = await (
    await request.post(api + '/auth/login', {
      data: { email, password, establishment_slug: fixture.slug },
    })
  ).json();
  async function call(path: string, body?: unknown) {
    const response = await request.fetch(api + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + auth.token, 'Idempotency-Key': randomUUID() },
      ...(body === undefined ? {} : { data: body }),
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const table = fixture.tables[0];
  const draft = await call('/orders', {
    source: 'POS',
    table_id: table.id,
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[0].id, quantity: 2, modifiers: [] }],
  });
  await call(`/orders/${draft.id}/confirm`, {});
  const details = await call(`/tables/${table.id}/session`);
  const tab = await call('/tabs', {
    session_id: details.session.id,
    mode: 'INDIVIDUAL',
    label: 'Conta da Ana',
  });
  const extra = await call('/orders', {
    source: 'POS',
    table_id: table.id,
    tab_id: tab.id,
    payment_policy: 'POSTPAID',
    items: [{ product_id: fixture.products[1].id, quantity: 1, modifiers: [] }],
  });
  await call(`/orders/${extra.id}/confirm`, {});
  await testDatabase.db.execute(
    testDatabase.sql`UPDATE table_sessions SET opened_at=DATE_SUB(NOW(), INTERVAL 95 MINUTE) WHERE tenant_id=${fixture.tenant_id} AND establishment_id=${fixture.establishment_id} AND id=${details.session.id}`,
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:35173/' + fixture.slug + '/');
  await page.evaluate(() => localStorage.setItem('mesa-theme', 'light'));
  await page.reload();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await page.getByRole('button', { name: 'Salão e mesas', exact: true }).click();
  const card = page
    .locator('.floor-cards .table-card')
    .filter({ has: page.locator('.table-number', { hasText: /^01$/ }) });
  await expect(card).toContainText('1h 35min');
  await expect(card).toContainText('2 comanda(s)');
  await expect(card).toContainText('R$ 33,00');
  await page.screenshot({
    path: '.local/screenshots/floor-cards-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: 'Posicionar mesas', exact: true }).click();
  await expect(page).toHaveURL(/aba=posicionar-mesas/);
  const node = page.getByRole('button', { name: 'Mover mesa 01', exact: true });
  await expect(node).toBeVisible();
  for (let i = 0; i < 5; i++)
    await page.getByRole('button', { name: 'Diminuir zoom', exact: true }).click();
  const before = (await call('/tables')).find((item: any) => item.id === table.id);
  const rect = (await node.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 100, rect.y + rect.height / 2 + 50, { steps: 8 });
  await page.mouse.up();
  const expectedX = Math.round((before.position_x + 200) / 20) * 20,
    expectedY = Math.round((before.position_y + 100) / 20) * 20;
  await expect
    .poll(async () => {
      const value = (await call('/tables')).find((item: any) => item.id === table.id);
      return [value.position_x, value.position_y];
    })
    .toEqual([expectedX, expectedY]);
  await expect(
    page.getByRole('status').filter({ hasText: 'Posição da mesa 01 salva.' }),
  ).toBeVisible();
  await node.focus();
  await node.press('Shift+ArrowRight');
  await expect
    .poll(async () => (await call('/tables')).find((item: any) => item.id === table.id).position_x)
    .toBe(expectedX + 1);
  await expect(node).toBeEnabled();
  await page.route(
    '**/api/v1/tables/' + table.id,
    async (route) => {
      if (route.request().method() === 'PATCH')
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Falha simulada ao salvar.' }),
        });
      else await route.continue();
    },
    { times: 1 },
  );
  await node.press('ArrowRight');
  await expect(page.getByRole('status').filter({ hasText: 'Posição não salva' })).toBeVisible();
  await expect(node).toHaveCSS('left', `${expectedX + 1 + 24}px`);
  expect((await call('/tables')).find((item: any) => item.id === table.id).position_x).toBe(
    expectedX + 1,
  );
  await page.getByRole('button', { name: 'Ajustar posição exata', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Posição da mesa 01', exact: true });
  await modal.getByLabel('Posição horizontal', { exact: true }).fill('640');
  await modal.getByLabel('Posição vertical', { exact: true }).fill('320');
  await modal.getByRole('button', { name: 'Salvar posição', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  await expect(node).toHaveCSS('left', '664px');
  await expect(node).toHaveCSS('top', '356px');
  await expect(page.locator('.admin-main')).toHaveCSS('margin-left', '284px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.local/screenshots/floor-editor-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await page.screenshot({
    path: '.local/screenshots/floor-editor-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () =>
      page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: '.local/screenshots/floor-editor-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: 'Mapa do salão', exact: true }).click();
  await page.getByRole('button', { name: 'Planta', exact: true }).click();
  await expect(page.getByLabel('Planta do salão', { exact: true })).toBeVisible();
  await expect(page.locator('.floor-plan-table[data-table-id="' + table.id + '"]')).toHaveCSS(
    'left',
    '664px',
  );
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(card).toContainText('R$ 33,00');
  await card.click();
  await expect(
    page.getByRole('dialog').getByText('Conta da Ana', { exact: true }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('exclusão da mesa exige confirmação, some do salão e permite reutilizar o número', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  const suffix = randomUUID().slice(0, 8),
    password = 'DeleteTableBrowserOnly1!',
    email = 'delete-table-browser-' + suffix + '@test.local';
  const fixture = await provision({
    name: 'Mesas Browser ' + suffix,
    owner_email: email,
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  const api = 'http://127.0.0.1:33000/api/v1';
  const auth = await (
    await request.post(api + '/auth/login', {
      data: { email, password, establishment_slug: fixture.slug },
    })
  ).json();
  const headers = { authorization: 'Bearer ' + auth.token, 'Idempotency-Key': randomUUID() };
  const draft = await (
    await request.post(api + '/orders', {
      headers,
      data: {
        table_id: fixture.tables[1].id,
        source: 'POS',
        payment_policy: 'POSTPAID',
        items: [{ product_id: fixture.products[0].id, quantity: 1, modifiers: [] }],
      },
    })
  ).json();
  expect(
    (
      await request.post(api + '/orders/' + draft.id + '/confirm', {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:35173/' + fixture.slug + '/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await page.getByRole('button', { name: 'Salão e mesas', exact: true }).click();
  await page.getByRole('tab', { name: 'Mesas', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir mesa 02', exact: true }).click();
  const occupied = page.getByRole('dialog', { name: 'Excluir mesa 02?', exact: true });
  await expect(occupied).toContainText('Encerre o atendimento atual');
  await expect(occupied.getByRole('button', { name: 'Excluir mesa', exact: true })).toBeDisabled();
  await occupied.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir mesa 01', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Excluir mesa 01?', exact: true });
  await expect(confirmation).toContainText('preservando pedidos, comandas, pagamentos');
  await page.screenshot({
    path: '.local/screenshots/delete-table-confirmation.png',
    animations: 'disabled',
  });
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Excluir mesa 01', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Excluir mesa 01', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Excluir mesa', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar 01', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Mesa excluída. O histórico foi preservado.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Mapa do salão', exact: true }).click();
  await expect(page.locator('.floor-cards .table-number').filter({ hasText: /^01$/ })).toHaveCount(
    0,
  );
  await expect(page.locator('.floor-cards .table-card')).toHaveCount(7);
  await page.getByRole('tab', { name: 'Posicionar mesas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mover mesa 01', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Mesas', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Adicionar · Mesas do salão', exact: true });
  await form.getByLabel('Número', { exact: true }).fill('01');
  await expect(form.getByText('Posição X', { exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar 01', exact: true })).toBeVisible();
  const rows = await (await request.get(api + '/tables', { headers })).json();
  expect(rows.find((row: any) => row.number === '01').id).not.toBe(fixture.tables[0].id);
});
