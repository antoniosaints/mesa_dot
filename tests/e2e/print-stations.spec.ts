import { test } from './test.js';
import {
  expect,
  type Page,
  type APIRequestContext,
  type BrowserContext,
  type WebSocketRoute,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:35173',
  api = 'http://127.0.0.1:33000/api/v1',
  suffix = randomUUID().slice(0, 8),
  password = 'RemotePrintBrowserOnly1!',
  email = 'remote-print-' + suffix + '@test.local';
let fixture: any, token: string, printer: any, order: any;
const headers = () => ({ authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() });
async function call(request: APIRequestContext, path: string, body?: unknown) {
  const response = await request.fetch(api + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(),
    ...(body === undefined ? {} : { data: body }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function login(page: Page, path = 'impressao?aba=printbridge') {
  await page.goto(base + '/' + fixture.slug + '/' + path);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na operação' }).click();
}
async function nativeBridge(context: BrowserContext) {
  const jobs = new Map<string, { id: string; params: any; state: string }>();
  let pairs = 0,
    connections = 0;
  let socket: WebSocketRoute | null = null,
    defaultState = 'processing';
  await context.routeWebSocket('wss://localhost:17861/v1', (route) => {
    connections++;
    socket = route;
    route.onMessage((message) => {
      const rpc = JSON.parse(String(message));
      let result: any;
      switch (rpc.method) {
        case 'hello':
          result = { protocolVersion: 1 };
          break;
        case 'authenticate':
          result = {};
          break;
        case 'pair.request':
          pairs++;
          result = { pairingId: 'local-pair' };
          break;
        case 'pair.poll':
          result = { token: 'test-only-printbridge-native' };
          break;
        case 'printers.list':
          result = [
            {
              id: 'native-remote',
              name: 'Térmica no computador',
              isDefault: true,
              status: 'unknown',
            },
          ];
          break;
        case 'jobs.submit': {
          const old = jobs.get(rpc.params.idempotencyKey);
          if (old) expect(rpc.params).toEqual(old.params);
          const value = old ?? { id: randomUUID(), params: rpc.params, state: defaultState };
          jobs.set(rpc.params.idempotencyKey, value);
          result = { jobId: value.id };
          break;
        }
        case 'jobs.get': {
          const value = [...jobs.values()].find((job) => job.id === rpc.params.jobId)!;
          result = {
            id: value.id,
            printerId: value.params.printerId,
            state: value.state,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            spoolerId: 1,
            error: null,
          };
          break;
        }
        default:
          throw new Error('RPC inesperado ' + rpc.method);
      }
      route.send(JSON.stringify({ version: 1, id: rpc.id, result }));
    });
  });
  return {
    jobs,
    get pairs() {
      return pairs;
    },
    get connections() {
      return connections;
    },
    disconnect() {
      socket?.close();
    },
    submitAll() {
      defaultState = 'submitted';
      for (const job of jobs.values()) job.state = 'submitted';
    },
  };
}
test.beforeAll(async ({ request }) => {
  const { migrate } = await import('../../packages/database/src/migrate.js');
  await migrate();
  const { provision } = await import('../../packages/database/src/provision.js');
  fixture = await provision({
    name: 'Impressão remota ' + suffix,
    owner_email: email,
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  const auth = await request.post(api + '/auth/login', {
    data: { email, password, establishment_slug: fixture.slug },
  });
  expect(auth.ok()).toBe(true);
  token = (await auth.json()).token;
  printer = await call(request, '/printers', {
    name: 'Térmica remota ' + suffix,
    sector: 'remote',
  });
  const product = await call(request, '/products', {
    name: 'Produto remoto',
    price: '10.00',
    stock_policy: 'NO_CONTROL',
    sector: 'remote',
  });
  await call(request, '/cash/sessions', {
    register_id: fixture.register.id,
    opening_amount: '0.00',
  });
  const draft = await call(request, '/orders', {
    table_id: fixture.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
  });
  order = await call(request, '/orders/' + draft.id + '/confirm', {});
});
test('computador retoma após reload e queda, assume modo estação sem login e imprime cupom enviado pelo celular', async ({
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const computer = await browser.newContext(),
    phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const native = await nativeBridge(computer);
  const pc = await computer.newPage(),
    phone = await phoneContext.newPage();
  let phoneSockets = 0;
  phone.on('websocket', (socket) => {
    if (/^wss:\/\/localhost:1786[123]\//.test(socket.url())) phoneSockets++;
  });
  const errors: string[] = [];
  pc.on('pageerror', (error) => errors.push(error.message));
  phone.on('pageerror', (error) => errors.push(error.message));
  try {
    await login(pc);
    await pc.getByLabel('Nome deste computador', { exact: true }).fill('Balcão principal');
    await pc.getByRole('button', { name: 'Conectar PrintBridge', exact: true }).click();
    await pc
      .getByRole('combobox', { name: 'Impressora local para ' + printer.name, exact: true })
      .click();
    await pc.getByRole('option', { name: 'Térmica no computador · Padrão', exact: true }).click();
    await pc.getByRole('button', { name: 'Ativar fila local', exact: true }).click();
    await expect.poll(() => native.jobs.size).toBe(1);
    const agentBefore = (await call(request, '/print/stations')).find(
      (agent: any) => agent.name === 'Balcão principal',
    );
    expect(agentBefore.online).toBe(true);
    await pc.reload();
    await expect(pc.getByText('Agente ativo', { exact: true })).toBeVisible();
    await expect(
      pc.getByRole('button', { name: 'Pausar novos envios', exact: true }),
    ).toBeVisible();
    expect(native.pairs).toBe(1);
    expect(native.jobs.size).toBe(1);
    expect(
      (await call(request, '/print/stations'))
        .filter((agent: any) => agent.name === 'Balcão principal')
        .map((agent: any) => agent.id),
    ).toEqual([agentBefore.id]);
    native.submitAll();
    await expect
      .poll(async () =>
        (await call(request, '/print/jobs'))
          .filter((job: any) => job.printer_id === printer.id)
          .every((job: any) => job.status === 'COMPLETED'),
      )
      .toBe(true);
    const connections = native.connections;
    native.disconnect();
    await expect.poll(() => native.connections, { timeout: 15000 }).toBeGreaterThan(connections);
    await expect(pc.getByText('Agente ativo', { exact: true })).toBeVisible();
    const popupPromise = pc.waitForEvent('popup');
    await pc.getByRole('link', { name: 'Abrir modo estação', exact: true }).click();
    const station = await popupPromise;
    await expect(
      station.getByRole('heading', { name: 'Estação de impressão', exact: true }),
    ).toBeVisible();
    await expect(station.getByText('Ativa em outra aba', { exact: true })).toBeVisible();
    await pc.close();
    await expect(station.getByText('Agente ativo', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await station.evaluate(() => sessionStorage.clear());
    await station.reload();
    await expect(station.getByText('Agente ativo', { exact: true })).toBeVisible();
    await expect(station.getByLabel('E-mail', { exact: true })).toHaveCount(0);
    await login(phone, 'pedidos/' + order.id);
    await phone.getByRole('button', { name: 'Cupom do pedido', exact: true }).click();
    const receipt = phone.getByRole('dialog', { name: 'Cupom do pedido', exact: true });
    await receipt
      .getByRole('combobox', { name: 'Impressora do cupom', exact: true })
      .fill(printer.name);
    await phone.getByRole('option', { name: printer.name + ' · remote', exact: true }).click();
    await expect(receipt.getByText(/Destino online: Balcão principal/)).toBeVisible();
    await receipt.getByRole('button', { name: 'Enviar para térmica', exact: true }).click();
    await expect.poll(() => native.jobs.size, { timeout: 15000 }).toBe(2);
    await expect
      .poll(async () =>
        (await call(request, '/print/jobs'))
          .filter((job: any) => job.printer_id === printer.id && job.document_kind === 'RECEIPT')
          .some((job: any) => job.status === 'COMPLETED'),
      )
      .toBe(true);
    expect(phoneSockets).toBe(0);
    expect(native.pairs).toBe(1);
    await station.screenshot({
      path: '.local/screenshots/remote-print-station-desktop.png',
      fullPage: true,
    });
    await phone.screenshot({ path: '.local/screenshots/remote-print-phone.png' });
    const revoked = await request.patch(api + '/print/agents/' + agentBefore.id, {
      headers: headers(),
      data: { enabled: false },
    });
    expect(revoked.ok()).toBe(true);
    await expect(station.getByRole('alert')).toContainText('pausada', { timeout: 15000 });
    expect(errors).toEqual([]);
  } finally {
    await phoneContext.close();
    await computer.close();
  }
});
test('um dispositivo sem configuração não tenta conectar o PrintBridge nem ganha acesso à gestão', async ({
  page,
}) => {
  let sockets = 0;
  page.on('websocket', (socket) => {
    if (/^wss:\/\/localhost:1786[123]\//.test(socket.url())) sockets++;
  });
  await page.goto(base + '/' + fixture.slug + '/estacao-impressao');
  await expect(page.getByRole('alert')).toContainText('Este computador ainda não foi configurado');
  expect(sockets).toBe(0);
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
});
test('a gestão prioriza PrintBridge e mantém TCP como opção avançada com credencial única e revogação', async ({
  page,
  request,
}) => {
  await login(page);
  const tabs = page.getByRole('tablist', { name: 'Impressão', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: 'Agentes', exact: true })).toHaveCount(0);
  const advanced = page.locator('.tcp-agent-settings');
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.locator('summary').click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(advanced).toContainText('Usa PrintBridge? Não precisa criar uma credencial aqui.');
  await advanced.getByRole('button', { name: 'Criar agente TCP/IP', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Criar agente TCP/IP', exact: true });
  await create.getByLabel('Nome do agente TCP/IP', { exact: true }).fill('Servidor TCP browser');
  await create.getByRole('button', { name: 'Criar credencial TCP/IP', exact: true }).click();
  const credential = page.getByRole('dialog', { name: 'Credencial do agente TCP/IP', exact: true });
  await expect(credential).toBeVisible();
  const raw = await credential.getByLabel('Credencial do agente', { exact: true }).inputValue();
  expect(raw).toHaveLength(43);
  const config = await credential
    .getByLabel('Configuração do agente', { exact: true })
    .inputValue();
  expect(config).toContain('PRINT_AGENT_TOKEN=' + raw);
  expect(config).toContain('PRINT_API_URL=http://127.0.0.1:35173/api/v1');
  await credential
    .getByRole('combobox', { name: 'Impressora para a configuração', exact: true })
    .click();
  await page.getByRole('option', { name: printer.name + ' · remote', exact: true }).click();
  await expect(credential.getByLabel('Configuração do agente', { exact: true })).toContainText(
    'PRINT_PRINTER_ID=' + printer.id,
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await credential.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
  }
  await credential.getByRole('button', { name: 'Fechar credencial', exact: true }).click();
  const row = advanced.locator('.print-station-row').filter({ hasText: 'Servidor TCP browser' });
  await expect(row).toContainText('Aguardando conexão');
  const computers = page.getByRole('region', { name: 'Computadores de impressão', exact: true });
  await expect(computers).not.toContainText('Servidor TCP browser');
  await row.getByRole('button', { name: 'Desativar agente', exact: true }).click();
  const deactivate = page.getByRole('dialog', {
    name: 'Desativar agente de impressão?',
    exact: true,
  });
  await deactivate.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(row).toContainText('Desativado');
  await row.getByRole('button', { name: 'Reativar agente', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reativar agente de impressão?', exact: true })
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click();
  await expect(row).toContainText('Aguardando conexão');
  const exposed = await call(request, '/print/agents');
  expect(JSON.stringify(exposed)).not.toContain(raw);
  await page.reload();
  await expect(
    page.getByRole('dialog', { name: 'Credencial do agente TCP/IP', exact: true }),
  ).toHaveCount(0);
  await page.goto(base + '/' + fixture.slug + '/impressao?aba=agentes');
  await expect(tabs.getByRole('tab', { name: 'PrintBridge', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(advanced).toHaveAttribute('open', '');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('.admin-main')).toHaveCSS(
        'margin-left',
        width > 900 ? '284px' : '0px',
      );
      await expect(page.locator('.sidebar')).toHaveCSS(
        'transform',
        width > 900 ? 'none' : 'matrix(1, 0, 0, 1, -284, 0)',
      );
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: '.local/screenshots/print-settings-' + width + '-' + theme + '.png',
        fullPage: true,
      });
    }
  }
});
