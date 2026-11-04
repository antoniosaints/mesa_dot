import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool, atomic, view, sql } from '../../packages/database/src/index.js';
import { env } from '../../packages/shared/src/config.js';
import { openComplement, sealComplement } from '../../packages/shared/src/complement-crypto.js';
import { fakeComplementProviders } from '../complement-transport.js';
let app: Awaited<ReturnType<typeof buildApp>>, fixture: Awaited<ReturnType<typeof provision>>;
let token: string,
  otherToken: string,
  branchToken: string,
  staffToken: string,
  visitorToken: string;
const suffix = randomUUID().slice(0, 8),
  password = 'ComplementsTestsOnly1!',
  key = 'test-Gemini-secret-only-used-in-tests';
const fake = fakeComplementProviders(),
  previous = { ...env };
async function request(
  method: string,
  path: string,
  body?: unknown,
  authorization = token,
  headers = {},
) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: {
      authorization: 'Bearer ' + authorization,
      'Idempotency-Key': randomUUID(),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function call(method: string, path: string, body?: unknown, authorization = token) {
  const result = await request(method, path, body, authorization);
  expect(result.statusCode, result.body).toBe(200);
  return result.json();
}
async function oauth(account = '123456', authorization = token) {
  const begin = await request('POST', '/complements/mercadopago/connect', {}, authorization);
  expect(begin.statusCode, begin.body).toBe(200);
  const url = new URL(begin.json().authorization_url),
    state = url.searchParams.get('state')!;
  const cookie = String(begin.headers['set-cookie']).split(';')[0];
  return {
    url,
    state,
    cookie,
    finish: () =>
      request(
        'GET',
        '/complements/mercadopago/callback?state=' + state + '&code=' + account,
        undefined,
        '',
        { cookie },
      ),
  };
}
async function prepaid() {
  const order = await call(
    'POST',
    '/orders',
    {
      table_id: fixture.tables[0].id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: fixture.products[0].id, quantity: 1, modifiers: [] }],
    },
    visitorToken,
  );
  const intent = await call('POST', '/payments/intents', { order_id: order.id }, visitorToken);
  const remote = [...fake.payments.values()].find(
    (payment) => payment.external_reference === intent.provider_reference,
  )!;
  return { order, intent, remote };
}
async function webhook(remote: any, override?: string) {
  const ts = String(Date.now()),
    requestId = randomUUID();
  const signature = createHmac('sha256', env.MERCADO_PAGO_WEBHOOK_SECRET!)
    .update(`id:${remote.id};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return request(
    'POST',
    '/webhooks/payments/mercadopago?unit=' + fixture.establishment_id + '&data.id=' + remote.id,
    { type: 'payment', data: { id: remote.id } },
    '',
    { 'x-request-id': requestId, 'x-signature': override ?? `ts=${ts},v1=${signature}` },
  );
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Use banco exclusivo de teste.');
  Object.assign(env, {
    MERCADO_PAGO_CLIENT_ID: '123456789',
    MERCADO_PAGO_CLIENT_SECRET: 'test-client-secret-never-production',
    MERCADO_PAGO_WEBHOOK_SECRET: 'test-mp-webhook-never-production',
    MERCADO_PAGO_REDIRECT_URI: 'http://127.0.0.1:35173/api/v1/complements/mercadopago/callback',
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(fake.transport);
  await migrate();
  fixture = await provision({
    name: 'Complementos ' + suffix,
    owner_name: 'Gestor privado',
    owner_email: 'complements-' + suffix + '@test.local',
    password,
    demo: true,
  });
  const other = await provision({
    name: 'Outra conta ' + suffix,
    owner_name: 'Outro gestor',
    owner_email: 'other-complements-' + suffix + '@test.local',
    password,
  });
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  token = (
    await call(
      'POST',
      '/auth/login',
      {
        email: 'complements-' + suffix + '@test.local',
        password,
        establishment_slug: fixture.slug,
      },
      '',
    )
  ).token;
  otherToken = (
    await call(
      'POST',
      '/auth/login',
      {
        email: 'other-complements-' + suffix + '@test.local',
        password,
        establishment_slug: other.slug,
      },
      '',
    )
  ).token;
  const branch = await call('POST', '/establishments', { name: 'Filial ' + suffix });
  branchToken = (await call('POST', '/auth/switch-branch', { establishment_id: branch.id })).token;
  await call('POST', '/staff', {
    name: 'Admin local',
    email: 'local-complements-' + suffix + '@test.local',
    password,
    role_id: fixture.roles[0].id,
  });
  staffToken = (
    await call(
      'POST',
      '/auth/login',
      {
        email: 'local-complements-' + suffix + '@test.local',
        password,
        establishment_slug: fixture.slug,
      },
      '',
    )
  ).token;
  visitorToken = (
    await call(
      'POST',
      '/public/' + fixture.slug + '/visitor-sessions',
      {
        table_code: fixture.tables[0].public_code,
        name: 'Cliente confidencial',
        phone: '+5511999988888',
      },
      '',
    )
  ).token;
});
afterAll(async () => {
  vi.restoreAllMocks();
  Object.assign(env, previous);
  await app?.close();
  await pool.end();
});
it('restringe a loja ao admin geral e mantém conexões separadas por conta e filial', async () => {
  for (const auth of [staffToken, visitorToken])
    for (const path of ['/complements', '/complements/gemini/models'])
      expect(
        (
          await request(
            path.endsWith('models') ? 'POST' : 'GET',
            path,
            path.endsWith('models') ? {} : undefined,
            auth,
          )
        ).statusCode,
      ).toBe(403);
  await call('POST', '/complements/gemini/install', {});
  for (const auth of [otherToken, branchToken])
    expect(
      (await call('GET', '/complements', undefined, auth)).every((item: any) => !item.installed),
    ).toBe(true);
});
it('valida modelos, criptografa a chave sem devolvê-la e preserva a chave ao alterar o modelo', async () => {
  expect(
    (
      await request('POST', '/complements/gemini/configure', {
        api_key: 'invalid-key-for-testing-only',
        model: 'gemini-3.8-flash',
      })
    ).statusCode,
  ).toBe(409);
  const result = await call('POST', '/complements/gemini/configure', {
    api_key: key,
    model: 'gemini-3.8-flash',
  });
  expect(JSON.stringify(result)).not.toContain(key);
  expect(result.models).toHaveLength(3);
  await call('POST', '/complements/gemini/configure', { model: 'gemini-test-pro' });
  const record = (await view(fixture.actor).list('unit_complements', sql`provider='gemini'`))[0];
  expect(record.credentials).not.toContain(key);
  const scope = fixture.tenant_id + ':' + fixture.establishment_id + ':gemini';
  expect(openComplement<any>(record.credentials, scope).api_key).toBe(key);
  expect(() => openComplement(record.credentials, scope + 'other')).toThrow();
  expect(
    (await call('GET', '/complements')).find((item: any) => item.provider === 'gemini'),
  ).toMatchObject({ model: 'gemini-test-pro', enabled: true, configured: true });
  expect(
    (await request('POST', '/complements/gemini/configure', { model: 'gemini-unavailable' }))
      .statusCode,
  ).toBe(400);
  const [audit] = await pool.query('SELECT metadata FROM audit_logs WHERE tenant_id=?', [
    fixture.tenant_id,
  ]);
  expect(JSON.stringify(audit)).not.toContain(key);
});
it('oferece ajuda e resumos só com agregados da filial, trata cotas e desativação', async () => {
  const help = await call('POST', '/complements/gemini/ask', {
    mode: 'help',
    question: 'Como entregar uma ficha?',
  });
  expect(help.answer).toContain('Resumo de teste');
  expect(help.answer).not.toContain('Pensamento privado');
  expect(help.period).toBeNull();
  const summary = await call('POST', '/complements/gemini/ask', { mode: 'summary', days: 7 });
  expect(summary.period.from).toBeTruthy();
  const sent = fake.calls.at(-1)!;
  expect(sent.url.searchParams.has('key')).toBe(false);
  expect(new Headers(sent.init.headers).get('x-goog-api-key')).toBe(key);
  expect(JSON.stringify(sent.body)).toContain('confirmed_orders_in_period');
  expect(JSON.stringify(sent.body)).not.toMatch(/Cliente confidencial|11999988888|Gestor privado/);
  fake.setFailGeneration(true);
  expect(
    (await request('POST', '/complements/gemini/ask', { mode: 'help', question: 'Teste' }))
      .statusCode,
  ).toBe(409);
  fake.setFailGeneration(false);
  await call('POST', '/complements/gemini/disable', {});
  expect(
    (await request('POST', '/complements/gemini/ask', { mode: 'help', question: 'Teste' }))
      .statusCode,
  ).toBe(409);
  await call('POST', '/complements/gemini/enable', {});
  await call('POST', '/complements/gemini/remove-key', {});
  expect(
    (await call('GET', '/complements')).find((item: any) => item.provider === 'gemini'),
  ).toMatchObject({ enabled: false, configured: false });
});
it('vincula OAuth com PKCE, cookie obrigatório e state de uso único, sem expor tokens', async () => {
  const flow = await oauth();
  expect(flow.url.origin).toBe('https://auth.mercadopago.com');
  expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(
    (
      await request(
        'GET',
        '/complements/mercadopago/callback?state=' + flow.state + '&code=123456',
        undefined,
        '',
      )
    ).statusCode,
  ).toBe(403);
  const done = await flow.finish();
  expect(done.statusCode, done.body).toBe(302);
  expect(done.headers.location).toContain('complementos?oauth=success');
  const exchange = fake.calls.find((call) => call.url.pathname === '/oauth/token')!;
  expect(createHash('sha256').update(exchange.body.code_verifier).digest('base64url')).toBe(
    flow.url.searchParams.get('code_challenge'),
  );
  expect((await flow.finish()).statusCode).toBe(403);
  const response = await request('GET', '/complements');
  expect(response.body).not.toContain('fake-access-token');
  expect(response.json().find((item: any) => item.provider === 'mercadopago')).toMatchObject({
    configured: true,
    enabled: true,
    account_id: '123456',
  });
  const denied = await oauth();
  expect(
    (
      await request(
        'GET',
        '/complements/mercadopago/callback?state=' + denied.state + '&error=access_denied',
        undefined,
        '',
        { cookie: denied.cookie },
      )
    ).headers.location,
  ).toContain('oauth=denied');
});
it('cria checkout real, rejeita aprovação sandbox e verifica valor/assinatura antes de confirmar uma única vez', async () => {
  const { order, intent, remote } = await prepaid();
  expect(intent.provider).toBe('mercadopago');
  expect(intent.checkout_url).toMatch(/^https:\/\/www.mercadopago.com.br\//);
  expect(
    (await request('POST', '/sandbox/pay', { intent_id: intent.id }, visitorToken)).statusCode,
  ).toBe(403);
  expect(
    (await request('GET', '/payments/intents/' + intent.id, undefined, otherToken)).statusCode,
  ).toBe(404);
  expect((await webhook(remote, 'ts=0,v1=bad')).statusCode).toBe(401);
  remote.status = 'approved';
  remote.transaction_amount = 0.01;
  expect((await webhook(remote)).statusCode).toBe(409);
  remote.transaction_amount = Number(intent.amount);
  const result = await webhook(remote);
  expect(result.statusCode, result.body).toBe(200);
  expect((await call('GET', '/orders/' + order.id)).tickets).toHaveLength(1);
  await webhook(remote);
  await call('POST', '/payments/intents/' + intent.id + '/sync', {}, visitorToken);
  expect(await view(fixture.actor).list('payments', sql`intent_id=${intent.id}`)).toHaveLength(1);
  expect((await call('GET', '/orders/' + order.id)).tickets).toHaveLength(1);
  const pref = [...fake.preferences.values()].find(
    (pref) => pref.external_reference === intent.provider_reference,
  );
  expect(new URL(pref.back_urls.success).searchParams.get('table')).toBe(
    fixture.tables[0].public_code,
  );
  expect(pref.expiration_date_to).toBe(new Date(intent.expires_at).toISOString());
});
it('renova tokens antes de transações que falham, bloqueia novos checkouts desativados e concilia antigos', async () => {
  const { intent, remote } = await prepaid();
  await atomic(fixture.actor, randomUUID(), 'test.expire.token', {}, async (s) => {
    const record = (await s.list('unit_complements', sql`provider='mercadopago'`))[0];
    const scope = fixture.tenant_id + ':' + fixture.establishment_id + ':mercadopago';
    const data = openComplement<any>(record.credentials, scope);
    data.expires_at = Date.now() - 1;
    await s.update('unit_complements', record.id, { credentials: sealComplement(data, scope) });
    return {};
  });
  expect((await request('POST', '/payments/intents', { order_id: randomUUID() })).statusCode).toBe(
    404,
  );
  const confirmed = (await call('GET', '/orders')).find(
    (order: any) => order.status === 'CONFIRMED',
  );
  expect((await request('POST', '/payments/intents', { order_id: confirmed.id })).statusCode).toBe(
    409,
  );
  // Ownership is checked first. Refresh survives the subsequent invalid-state rollback.
  await call('POST', '/payments/intents/' + intent.id + '/sync', {}, visitorToken);
  expect(fake.calls.filter((call) => call.body?.grant_type === 'refresh_token')).toHaveLength(1);
  await call('POST', '/complements/mercadopago/disable', {});
  const order = await call(
    'POST',
    '/orders',
    {
      table_id: fixture.tables[0].id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: fixture.products[0].id, quantity: 1, modifiers: [] }],
    },
    visitorToken,
  );
  expect(
    (await request('POST', '/payments/intents', { order_id: order.id }, visitorToken)).statusCode,
  ).toBe(409);
  remote.status = 'approved';
  expect((await webhook(remote)).statusCode).toBe(200);
  await call('POST', '/complements/mercadopago/enable', {});
});
it('registra recebimento tardio para revisão sem liberar fichas e permite estornar no provedor', async () => {
  const { intent, order, remote } = await prepaid();
  await pool.query(
    'UPDATE payment_intents SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id=?',
    [intent.id],
  );
  remote.status = 'approved';
  const paid = await webhook(remote);
  expect(paid.statusCode, paid.body).toBe(200);
  expect(paid.json().requires_review).toContain('expirar');
  expect((await call('GET', '/orders/' + order.id)).tickets).toHaveLength(0);
  const payment = paid.json().payment;
  const refund = await call('POST', '/payments/' + payment.id + '/refund', {
    amount: intent.amount,
    reason: 'Recebimento tardio',
  });
  expect(refund.provider_reference).toMatch(/^\d+$/);
  expect(fake.refunds.size).toBe(1);
  expect((await webhook(remote)).statusCode).toBe(200);
  expect(await view(fixture.actor).list('refunds', sql`payment_id=${payment.id}`)).toHaveLength(1);
});
it('reflete estornos externos e pagamentos excedentes sem duplicar fichas', async () => {
  const { intent, order, remote } = await prepaid();
  remote.status = 'approved';
  await webhook(remote);
  const extra = { ...remote, id: fake.nextId() };
  fake.payments.set(String(extra.id), extra);
  expect((await webhook(extra)).json().requires_review).toContain('adicional');
  expect((await call('GET', '/orders/' + order.id)).tickets).toHaveLength(1);
  remote.refunds = [{ id: fake.nextId(), amount: Number(intent.amount), status: 'approved' }];
  remote.status = 'refunded';
  remote.transaction_amount_refunded = Number(intent.amount);
  remote.date_last_updated = new Date().toISOString();
  const result = await webhook(remote);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().payment.status).toBe('REFUNDED');
  await webhook(remote);
  expect(
    await view(fixture.actor).list('refunds', sql`payment_id=${result.json().payment.id}`),
  ).toHaveLength(1);
});
it('rejeita state expirado e revalida o admin geral ao retornar do OAuth', async () => {
  const expired = await oauth();
  await pool.query(
    'UPDATE complement_oauth_states SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE state_hash=?',
    [createHash('sha256').update(expired.state).digest('hex')],
  );
  expect((await expired.finish()).statusCode).toBe(403);
  const revoked = await oauth();
  await pool.query(
    'UPDATE tenant_memberships SET is_account_admin=FALSE WHERE tenant_id=? AND user_id=?',
    [fixture.tenant_id, fixture.user_id],
  );
  try {
    const response = await revoked.finish();
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('oauth=error');
    expect((await request('GET', '/complements')).statusCode).toBe(403);
  } finally {
    await pool.query(
      'UPDATE tenant_memberships SET is_account_admin=TRUE WHERE tenant_id=? AND user_id=?',
      [fixture.tenant_id, fixture.user_id],
    );
  }
});
it('não confirma pagamento com moeda ou recebedor divergente', async () => {
  const { order, remote } = await prepaid();
  remote.status = 'approved';
  remote.currency_id = 'USD';
  expect((await webhook(remote)).statusCode).toBe(409);
  remote.currency_id = 'BRL';
  remote.collector_id = 999999999;
  const ignored = await webhook(remote);
  expect(ignored.statusCode).toBe(200);
  expect(ignored.json().ignored).toBe(true);
  expect((await call('GET', '/orders/' + order.id)).tickets).toHaveLength(0);
});
it('não bloqueia a operação enquanto o Gemini responde e reaproveita a resposta idempotente', async () => {
  await call('POST', '/complements/gemini/configure', { api_key: key, model: 'gemini-3.8-flash' });
  const count = () =>
    fake.calls.filter((call) => call.url.pathname.endsWith(':generateContent')).length;
  const before = count(),
    release = fake.pauseGeneration(),
    requestId = randomUUID();
  const input = { mode: 'help', question: 'Como conferir as entregas?' };
  const pending = request('POST', '/complements/gemini/ask', input, token, {
    'Idempotency-Key': requestId,
  });
  try {
    await vi.waitFor(() => expect(count()).toBe(before + 1));
    expect(
      (
        await request('POST', '/complements/gemini/ask', input, token, {
          'Idempotency-Key': requestId,
        })
      ).statusCode,
    ).toBe(409);
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        call('POST', '/products', {
          name: 'Operação durante consulta',
          price: '1.00',
          stock_policy: 'NO_CONTROL',
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('A geração bloqueou a operação da filial.')),
            1500,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  } finally {
    release();
  }
  const response = await pending;
  expect(response.statusCode, response.body).toBe(200);
  const repeat = await request('POST', '/complements/gemini/ask', input, token, {
    'Idempotency-Key': requestId,
  });
  expect(repeat.json()).toEqual(response.json());
  expect(count()).toBe(before + 1);
});
describe('Chat e ações de IA', () => {
  beforeEach(async () => {
    await app.close();
    app = await buildApp({ realtime: false, logger: false });
    await app.ready();
    await call('POST', '/complements/gemini/configure', {
      api_key: key,
      model: 'gemini-3.8-flash',
      image_model: null,
    });
    fake.setInvalidImage(false);
  });
  it('envia o histórico limitado e gera rascunhos sem modificar cadastros', async () => {
    const before = (await call('GET', '/products')).find(
      (product: any) => product.id === fixture.products[0].id,
    );
    const result = await call('POST', '/complements/gemini/ask', {
      mode: 'description',
      question: 'Escreva uma descrição curta.',
      context: { kind: 'product', name: before.name, description: before.description },
      history: [
        { role: 'user', text: 'Evite promessas.' },
        { role: 'model', text: 'Usarei apenas os dados informados.' },
      ],
    });
    expect(result.answer).toContain('Descrição sugerida');
    expect(result.image).toBeNull();
    expect(
      (await call('GET', '/products')).find((product: any) => product.id === before.id).description,
    ).toBe(before.description);
    const sent = fake.calls.at(-1)!.body;
    expect(sent.contents.map((entry: any) => entry.role)).toEqual(['user', 'model', 'user']);
    expect(sent.contents[2].parts[0].text).toContain(before.name);
    expect(
      (
        await request('POST', '/complements/gemini/ask', {
          mode: 'help',
          question: 'Teste',
          history: Array.from({ length: 9 }, () => ({ role: 'user', text: 'Excesso' })),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          'POST',
          '/complements/gemini/ask',
          { mode: 'description', question: 'Texto', context: { kind: 'product', name: 'Produto' } },
          staffToken,
        )
      ).statusCode,
    ).toBe(403);
  });
  it('respeita o período do financeiro e retorna estoque apenas da filial', async () => {
    await call('POST', '/complements/gemini/ask', {
      mode: 'summary',
      focus: 'finance',
      period: { start: '2026-10-01', end: '2026-10-02' },
    });
    const sent = JSON.stringify(fake.calls.at(-1)!.body.contents);
    expect(sent).toContain('2026-10-01T03:00:00.000Z');
    expect(sent).toContain('2026-10-03T03:00:00.000Z');
    expect(sent).toContain('confirmed_orders_in_period');
    await call('POST', '/complements/gemini/ask', { mode: 'summary', focus: 'stock' });
    expect(JSON.stringify(fake.calls.at(-1)!.body)).toContain('unavailable_stock_sample');
    expect(
      (
        await request('POST', '/complements/gemini/ask', {
          mode: 'summary',
          period: { start: '2026-10-02', end: '2026-10-01' },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('habilita imagens somente em modelos compatíveis e disponíveis', async () => {
    const before = fake.calls.filter((call) =>
      call.url.pathname.endsWith(':generateContent'),
    ).length;
    expect(
      (await request('POST', '/complements/gemini/ask', { mode: 'image', question: 'Uma bebida.' }))
        .statusCode,
    ).toBe(409);
    expect(
      fake.calls.filter((call) => call.url.pathname.endsWith(':generateContent')),
    ).toHaveLength(before);
    expect(
      (await request('POST', '/complements/gemini/configure', { image_model: 'gemini-test-pro' }))
        .statusCode,
    ).toBe(400);
    await call('POST', '/complements/gemini/configure', { image_model: 'gemini-3.1-flash-image' });
    expect(
      (await call('GET', '/complements')).find((entry: any) => entry.provider === 'gemini'),
    ).toMatchObject({ supports_images: true, image_model: 'gemini-3.1-flash-image' });
    const key = randomUUID(),
      input = { mode: 'image', question: 'Ilustre uma bebida no balcão.', aspect_ratio: '4:3' };
    const response = await request('POST', '/complements/gemini/ask', input, token, {
      'Idempotency-Key': key,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().image.data_url).toMatch(/^data:image\/png;base64,/);
    const sent = fake.calls.at(-1)!.body;
    expect(sent.generationConfig).toMatchObject({
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '4:3' },
    });
    expect(response.body).not.toContain('Pensamento privado');
    const repeat = await request('POST', '/complements/gemini/ask', input, token, {
      'Idempotency-Key': key,
    });
    expect(repeat.json()).toEqual(response.json());
    const [audits] = await pool.query(
      "SELECT metadata FROM audit_logs WHERE tenant_id=? AND action='complement.gemini_used'",
      [fixture.tenant_id],
    );
    expect(JSON.stringify(audits)).not.toContain('data:image');
    fake.setInvalidImage(true);
    expect(
      (await request('POST', '/complements/gemini/ask', { mode: 'image', question: 'Uma bebida.' }))
        .statusCode,
    ).toBe(409);
  });
});

it('não mantém o lock da filial enquanto o checkout aguarda o Mercado Pago', async () => {
  const order = await call(
    'POST',
    '/orders',
    {
      table_id: fixture.tables[0].id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: fixture.products[0].id, quantity: 1, modifiers: [] }],
    },
    visitorToken,
  );
  const count = fake.calls.filter((c) => c.url.pathname === '/checkout/preferences').length;
  const release = fake.pauseMercado('/checkout/preferences');
  const pending = request('POST', '/payments/intents', { order_id: order.id }, visitorToken);
  try {
    await expect
      .poll(() => fake.calls.filter((c) => c.url.pathname === '/checkout/preferences').length)
      .toBe(count + 1);
    const other = await Promise.race([
      request('POST', '/categories', {
        name: 'Operação durante checkout ' + randomUUID().slice(0, 5),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Unit lock held during provider call')), 1500),
      ),
    ]);
    expect(other.statusCode, other.body).toBe(200);
  } finally {
    release();
  }
  expect((await pending).statusCode).toBe(200);
});

it('recupera checkout aceito após timeout sem criar outra preferência e preserva a chave idempotente', async () => {
  const order = await call(
    'POST',
    '/orders',
    {
      table_id: fixture.tables[0].id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: fixture.products[0].id, quantity: 1, modifiers: [] }],
    },
    visitorToken,
  );
  const key = randomUUID();
  fake.failNextPreferenceAfterApply();
  expect(
    (
      await request('POST', '/payments/intents', { order_id: order.id }, visitorToken, {
        'Idempotency-Key': key,
      })
    ).statusCode,
  ).toBe(409);
  const intent = (await view(fixture.actor).list('payment_intents', sql`order_id=${order.id}`))[0];
  const operation = (
    await view(fixture.actor).list(
      'gateway_operations',
      sql`kind='CHECKOUT' AND source_id=${intent.id}`,
    )
  )[0];
  expect(operation.state).toBe('PENDING');
  expect(operation.payload.provider_started_at).toBeTruthy();
  const { finishMercadoOperation } = await import('../../apps/api/src/mercado-financial.js');
  await finishMercadoOperation(fixture.actor, operation.id);
  const repeat = await request('POST', '/payments/intents', { order_id: order.id }, visitorToken, {
    'Idempotency-Key': key,
  });
  expect(repeat.statusCode, repeat.body).toBe(200);
  expect(repeat.json().id).toBe(intent.id);
  expect(repeat.json().checkout_url).toMatch(/^https:\/\//);
  expect(
    fake.calls.filter(
      (c) =>
        c.url.pathname === '/checkout/preferences' &&
        c.body?.external_reference === intent.provider_reference,
    ),
  ).toHaveLength(1);
  expect(await view(fixture.actor).list('payment_intents', sql`order_id=${order.id}`)).toHaveLength(
    1,
  );
  const remote = [...fake.payments.values()].find(
    (payment) => payment.external_reference === intent.provider_reference,
  )!;
  remote.status = 'approved';
  expect((await webhook(remote)).statusCode).toBe(200);
  expect(
    (
      await request('POST', '/payments/intents', { order_id: order.id }, visitorToken, {
        'Idempotency-Key': key,
      })
    ).json(),
  ).toEqual(repeat.json());
});

it('mantém o estorno reservado após timeout, bloqueia entrega e concilia webhook concorrente sem duplicar', async () => {
  const { order, intent, remote } = await prepaid();
  remote.status = 'approved';
  const paid = await webhook(remote);
  expect(paid.statusCode, paid.body).toBe(200);
  const detail = await call('GET', '/orders/' + order.id),
    payment = paid.json().payment;
  const input = { amount: '1.00', tab_id: detail.tab_id, reason: 'Estorno com recuperação' },
    key = randomUUID();
  const before = fake.refunds.size;
  fake.failNextRefundAfterApply();
  expect(
    (
      await request('POST', '/payments/' + payment.id + '/refund', input, token, {
        'Idempotency-Key': key,
      })
    ).statusCode,
  ).toBe(409);
  const document = await call('GET', '/tickets/' + detail.tickets[0].id);
  const blocked = await request('POST', '/tickets/' + document.id + '/redeem', {
    token: document.token,
  });
  expect(blocked.statusCode).toBe(409);
  expect(blocked.body).toContain('estorno aguardando');
  expect(
    (await call('GET', '/tables/' + fixture.tables[0].id + '/closing-review')).issues.join(' '),
  ).toContain('Estorno aguardando');
  expect(
    (await request('POST', '/payments/' + payment.id + '/refund', { ...input, amount: '2.00' }))
      .statusCode,
  ).toBe(409);
  // The webhook can observe the remote result before the HTTP retry receives its ACK.
  expect((await webhook(remote)).statusCode).toBe(200);
  const repeated = await request(
    'POST',
    '/payments/' + payment.id + '/refund',
    { ...input, reason: 'Retomar estorno já autorizado' },
    staffToken,
  );
  expect(repeated.statusCode, repeated.body).toBe(200);
  expect(repeated.json().reason).toBe(input.reason);
  expect(fake.refunds.size).toBe(before + 1);
  const refunds = await view(fixture.actor).list('refunds', sql`payment_id=${payment.id}`);
  expect(refunds).toHaveLength(1);
  expect(refunds[0].created_by).toBe(fixture.actor.id);
  expect(
    (await call('GET', '/payments')).find((row: any) => row.id === payment.id).review_reason,
  ).toBeNull();
  expect(
    (
      await request('POST', '/payments/' + payment.id + '/refund', input, token, {
        'Idempotency-Key': key,
      })
    ).json().id,
  ).toBe(refunds[0].id);
  expect((await view(fixture.actor).list('payment_intents', sql`id=${intent.id}`))[0].status).toBe(
    'APPROVED',
  );
});

it('o worker recupera pagamento sem webhook com retry BullMQ e reaplica sem emitir fichas em dobro', async () => {
  const { intent, order, remote } = await prepaid();
  remote.status = 'approved';
  const { Redis } = await import('ioredis');
  const { startPaymentReconciliation } =
    await import('../../apps/worker/src/payment-reconciliation.js');
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const service = startPaymentReconciliation(redis, 'mercado-payments-test-' + randomUUID());
  try {
    const record = (
      await view(fixture.actor).list('payment_reconciliation', sql`intent_id=${intent.id}`)
    )[0];
    fake.failNextPaymentSearch();
    const job = await service.queue.add(
      'reconciliation',
      { ...record, kind: 'reconciliation' },
      { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    );
    await expect
      .poll(async () => (await call('GET', '/orders/' + order.id)).status, { timeout: 15000 })
      .toBe('CONFIRMED');
    await expect.poll(() => job.getState()).toBe('completed');
    expect((await service.queue.getJob(job.id!))!.attemptsMade).toBeGreaterThan(1);
    expect((await call('GET', '/orders/' + order.id)).tickets).toHaveLength(1);
    expect((await webhook(remote)).statusCode).toBe(200);
    await service.queue.add('reconciliation', { ...record, kind: 'reconciliation' });
    await expect
      .poll(
        async () => (await view(fixture.actor).get('payment_reconciliation', record.id)).attempts,
      )
      .toBe(0);
    expect(await view(fixture.actor).list('payments', sql`intent_id=${intent.id}`)).toHaveLength(1);
    expect((await call('GET', '/orders/' + order.id)).tickets).toHaveLength(1);
    expect(
      (await view(fixture.actor).get('payment_reconciliation', record.id)).last_error,
    ).toBeNull();
  } finally {
    await service.worker.close();
    await service.queue.obliterate({ force: true });
    await service.queue.close();
    await redis.quit();
  }
});
