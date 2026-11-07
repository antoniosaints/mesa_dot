import { test } from './test.js';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 15000 });

const api = 'http://127.0.0.1:33000/api/v1';
const suffix = randomUUID().slice(0, 8);
const email = 'order-options-' + suffix + '@test.local';
const waiterEmail = 'waiter-options-' + suffix + '@test.local';
const password = 'OrderOptionsTestOnly1!';
const name = 'Heineken opções ' + suffix;
let fixture: any, token: string, small: any, large: any, extra: any;
const headers = () => ({ authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });

test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  const { provision } = await import('../../packages/database/src/provision.js');
  await migrate();
  fixture = await provision({
    name: 'Pedidos e tamanhos ' + suffix,
    owner_name: 'Gestora',
    owner_email: email,
    password,
    demo: true,
  });
  const auth = await request.post(api + '/auth/login', {
    data: { email, password, establishment_slug: fixture.slug },
  });
  token = (await auth.json()).token;
  const staff = await request.post(api + '/staff', {
    headers: headers(),
    data: {
      name: 'Garçom dos tamanhos',
      email: waiterEmail,
      password,
      role_id: fixture.roles.find((role: any) => role.name === 'Garçom').id,
    },
  });
  expect(staff.ok(), await staff.text()).toBe(true);
  for (const [variant, price] of [
    ['600 ml', '15.00'],
    ['1 litro', '20.00'],
  ]) {
    const response = await request.post(api + '/products', {
      headers: headers(),
      data: {
        name,
        default_variant_name: variant,
        price,
        stock_policy: 'NO_CONTROL',
        requires_production: variant === '600 ml',
        sector: variant === '600 ml' ? 'cozinha' : 'bar',
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const product = await response.json();
    if (!small) small = product;
    else large = product;
  }
  const variant = await request.post(api + '/product-variants', {
    headers: headers(),
    data: {
      product_id: small.id,
      name: '2 litros',
      price: '30.00',
      stock_mode: 'SHARED',
      enabled: true,
    },
  });
  expect(variant.ok(), await variant.text()).toBe(true);
  extra = await variant.json();
});

async function staffLogin(page: Page, port: number, route: string, account: string) {
  await page.goto(`http://127.0.0.1:${port}/${fixture.slug}/${route}`);
  await page.getByLabel('E-mail', { exact: true }).fill(account);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  await page.goto(`http://127.0.0.1:${port}/${fixture.slug}/${route}`);
}

for (const [profile, port, account, route, tableIndex] of [
  ['gestor', 35173, email, 'salao/atendimento/', 0],
  ['garçom', 35175, waiterEmail, 'mesas/', 1],
] as const) {
  test(
    profile + ' vê tamanho na seleção, no seletor e no resumo, e envia os IDs corretos',
    async ({ page, request }) => {
      await page.setViewportSize({ width: profile === 'gestor' ? 1440 : 390, height: 1000 });
      await staffLogin(page, port, route + fixture.tables[tableIndex].id, account);
      const table = page.getByRole('dialog').first();
      const catalog = table.getByLabel('Cardápio da mesa', { exact: true });
      const search = table.getByLabel('Buscar produto para o pedido', { exact: true });
      await search.fill('1 litro');
      await expect(catalog.locator('.pos-product')).toHaveCount(1);
      await catalog.getByRole('button', { name: new RegExp(name + ' · 1 litro') }).click();
      await expect(table.locator('.draft-line strong').first()).toHaveText(name + ' · 1 litro');
      if (profile === 'garçom')
        await table.getByRole('tab', { name: 'Cardápio', exact: true }).click();
      await search.fill('2 litros');
      await expect(catalog.locator('.pos-product')).toHaveCount(1);
      await catalog.getByRole('button', { name: new RegExp(name + ' · 600 ml') }).click();
      const picker = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('combobox', { name: 'Variação do produto', exact: true }) });
      await expect(picker.getByRole('heading')).toContainText(name + ' · 600 ml');
      await picker.getByRole('combobox', { name: 'Variação do produto', exact: true }).click();
      await page
        .getByRole('option', { name: name + ' · 2 litros · R$ 30,00', exact: true })
        .click();
      await expect(picker.getByRole('heading')).toContainText(name + ' · 2 litros');
      await picker.getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
      await expect(table.locator('.draft-summary')).toContainText(name + ' · 2 litros');
      const sent = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/api/v1/orders'),
      );
      await table.getByRole('button', { name: 'Confirmar pedido pós-pago', exact: false }).click();
      const response = await sent;
      expect(response.ok(), await response.text()).toBe(true);
      expect(response.request().postDataJSON().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ product_id: large.id, quantity: 1 }),
          expect.objectContaining({ product_id: small.id, variant_id: extra.id, quantity: 1 }),
        ]),
      );
      const order = await response.json();
      const details = await (
        await request.get(api + '/orders/' + order.id, { headers: headers() })
      ).json();
      expect(details.items.map((item: any) => item.name_snapshot)).toEqual(
        expect.arrayContaining([name + ' - 1 litro', name + ' - 2 litros']),
      );
    },
  );
}

test('balcão mantém a variante padrão após atualizar o cardápio e envia cada opção correta', async ({
  page,
}) => {
  await staffLogin(page, 35173, 'pedidos', email);
  await page.getByRole('button', { name: 'Pedido avulso', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Novo pedido avulso', exact: true });
  await modal.getByRole('searchbox', { name: 'Buscar produto avulso' }).fill('1 litro');
  await modal
    .getByRole('button', { name: 'Adicionar ' + name + ' · 1 litro', exact: true })
    .click();
  await modal.getByRole('button', { name: 'Atualizar cardápio', exact: true }).click();
  await expect(
    modal.getByRole('button', { name: 'Atualizar cardápio', exact: true }),
  ).toBeEnabled();
  await expect(modal.locator('.counter-cart')).toContainText(name + ' · 1 litro');
  expect(
    await modal.locator('form').evaluate((form: HTMLFormElement) =>
      [...form.querySelectorAll<HTMLInputElement>(':invalid')].map((input) => ({
        name: input.getAttribute('aria-label'),
        message: input.validationMessage,
      })),
    ),
  ).toEqual([]);
  expect(
    await modal
      .getByRole('button', { name: 'Confirmar recebimento e pedido', exact: true })
      .evaluate((button: HTMLButtonElement) => ({ type: button.type, form: Boolean(button.form) })),
  ).toEqual({ type: 'submit', form: true });
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/v1/orders/counter'),
  );
  await modal.getByRole('button', { name: 'Confirmar recebimento e pedido', exact: true }).click();
  const response = await sent;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.request().postDataJSON().items).toEqual([
    expect.objectContaining({ product_id: large.id, quantity: 1 }),
  ]);
});

test('cliente mobile preserva tamanhos do carrinho às fichas, cozinha e entregas', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:35174/${fixture.slug}/`);
  const search = page.getByLabel('Buscar produto', { exact: true });
  for (const [query, choice, label] of [
    ['1 litro', '', '1 litro'],
    ['2 litros', '2 litros', '2 litros'],
  ]) {
    await search.fill(query);
    await expect(page.locator('.menu-card')).toHaveCount(1);
    await page.locator('.menu-card').click();
    const modal = page.locator('.customer-product-modal');
    if (choice) {
      await modal.getByRole('combobox', { name: 'Variação', exact: true }).click();
      await page
        .getByRole('option', { name: name + ' · 2 litros · R$ 30,00', exact: true })
        .click();
    }
    await expect(modal.getByRole('heading')).toHaveText(name + ' · ' + label);
    await modal.getByRole('button', { name: 'Adicionar ao pedido', exact: false }).click();
  }
  await page.getByRole('button', { name: 'Ver meu pedido', exact: true }).click();
  const cart = page.locator('.customer-cart-modal');
  await expect(cart.locator('.customer-cart-line strong')).toHaveText([
    name + ' · 1 litro',
    name + ' · 2 litros',
  ]);
  await cart.getByRole('button', { name: 'Identificar e continuar', exact: false }).click();
  const identify = page.getByRole('dialog', {
    name: 'Identificar pedido para retirada',
    exact: true,
  });
  await identify.getByLabel('Seu nome', { exact: true }).fill('Cliente dos tamanhos');
  await identify.getByLabel('Telefone', { exact: true }).fill('11988887777');
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/v1/public/counter/orders'),
  );
  await identify.getByRole('button', { name: 'Continuar para retirada', exact: false }).click();
  const response = await sent;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.request().postDataJSON().items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ product_id: large.id, quantity: 1 }),
      expect.objectContaining({ product_id: small.id, variant_id: extra.id, quantity: 1 }),
    ]),
  );
  const order = await response.json();
  await expect(page.getByText('AMBIENTE SANDBOX', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Simular aprovação do pagamento', exact: true }).click();
  const labels = [name + ' - 1 litro', name + ' - 2 litros'];
  await expect(page.locator('.mini-ticket')).toHaveCount(2);
  for (const label of labels)
    await expect(page.locator('.mini-ticket h2', { hasText: label })).toBeVisible();
  const edited = await request.patch(api + '/products/' + small.id, {
    headers: headers(),
    data: { name: 'Produto alterado depois do pedido', default_variant_name: 'Novo tamanho' },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  const editedVariant = await request.patch(api + '/product-variants/' + extra.id, {
    headers: headers(),
    data: { name: 'Tamanho renomeado' },
  });
  expect(editedVariant.ok(), await editedVariant.text()).toBe(true);
  const kitchen = await page.context().newPage();
  await kitchen.setViewportSize({ width: 390, height: 844 });
  await staffLogin(kitchen, 35176, 'producao', email);
  await kitchen
    .getByRole('searchbox', { name: 'Buscar na produção', exact: true })
    .fill('2 litros');
  const reference = order.id.slice(0, 6).toUpperCase();
  const job = kitchen
    .locator('.production-job')
    .filter({ hasText: labels[1] })
    .filter({ hasText: reference });
  await expect(job.locator('h3')).toHaveText(labels[1]);
  await job.getByRole('button', { name: 'Iniciar preparo', exact: true }).click();
  await job.getByRole('button', { name: 'Pronto para entregar', exact: true }).click();
  await expect(job).toHaveCount(0);
  await kitchen.close();
  const waiter = await page.context().newPage();
  await waiter.setViewportSize({ width: 390, height: 844 });
  await staffLogin(waiter, 35175, 'entregas', waiterEmail);
  await waiter.getByRole('button', { name: 'Expandir atendimentos', exact: true }).click();
  const cards = waiter.locator('.ticket-context-card').filter({ hasText: reference });
  for (const label of labels)
    await expect(cards.locator('.ticket-context-main strong', { hasText: label })).toBeVisible();
  const management = await page.context().newPage();
  await staffLogin(management, 35173, 'pedidos/' + order.id, email);
  for (const label of labels)
    await expect(
      management.locator('.ticket-context-main strong', { hasText: label }),
    ).toBeVisible();
  await management.close();
  await waiter.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  for (const label of labels)
    await expect(page.locator('.mini-ticket h2', { hasText: label })).toBeVisible();
});
