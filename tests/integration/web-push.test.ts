import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { db, pool, rows, sql, view } from '../../packages/database/src/index.js';
import { env } from '../../packages/shared/src/config.js';
import {
  stagePushEvent,
  deliverPush,
  cleanupPushSubscriptions,
} from '../../apps/worker/src/push-notifications.js';
import { openPush } from '../../packages/shared/src/push-crypto.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  unit: Awaited<ReturnType<typeof provision>>,
  other: typeof unit,
  token: string,
  otherToken: string,
  waiterToken: string,
  branchToken: string,
  branchDevice: any;
const password = 'PushIntegrationOnly1!',
  suffix = randomUUID().slice(0, 8),
  email = 'push-' + suffix + '@test.local';
async function req(method: string, path: string, body?: unknown, credential = token) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { authorization: 'Bearer ' + credential, 'Idempotency-Key': randomUUID() },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function call(method: string, path: string, body?: unknown, credential = token) {
  const response = await req(method, path, body, credential);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
function subscription() {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/mesa-test-' + randomUUID(),
    expirationTime: null,
    keys: {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}
async function device(credential = token, native = subscription(), surface = 'admin') {
  return {
    ...(await call(
      'POST',
      '/push/subscriptions',
      {
        subscription: native,
        origin: 'http://localhost:5173',
        surface,
        device_name: 'Dispositivo ' + randomUUID().slice(0, 5),
        activate: true,
      },
      credential,
    )),
    native,
  };
}
async function configure(credential = token, waiterOnly = false) {
  const config = await call('GET', '/push/settings', undefined, credential);
  const rules = config.rules.map((rule: any) => ({
    ...rule,
    role_ids: waiterOnly ? [unit.roles.find((role) => role.name === 'Garçom')!.id] : rule.role_ids,
  }));
  // Only assign a waiter to the events this profile can access.
  if (waiterOnly)
    for (const rule of rules)
      if (
        ![
          'ticket.requested',
          'table.occupied',
          'order.confirmed',
          'production.ready',
          'order.cancelled',
          'table.closed',
          'payment.approved',
        ].includes(rule.event)
      )
        rule.role_ids = [];
  return call('PATCH', '/push/settings', { enabled: true, rules }, credential);
}
async function notification(deviceId: string, credential = token) {
  await call('POST', '/push/subscriptions/' + deviceId + '/test', {}, credential);
  const [event] = await rows(
    db,
    sql`SELECT * FROM outbox_events WHERE aggregate_id=${deviceId} AND event='push.test' ORDER BY created_at DESC,id DESC LIMIT 1`,
  );
  await stagePushEvent(event);
  const [delivery] = await rows(
    db,
    sql`SELECT * FROM push_deliveries WHERE event_id=${event.id} AND subscription_id=${deviceId}`,
  );
  expect(delivery).toBeTruthy();
  return delivery;
}
const deliveryData = (delivery: any) => ({
  id: delivery.id,
  tenant_id: delivery.tenant_id,
  establishment_id: delivery.establishment_id,
});
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco isolado obrigatório.');
  await migrate();
  app = await buildApp({ logger: false, realtime: false });
  unit = await provision({
    name: 'Push ' + suffix,
    owner_email: email,
    owner_name: 'Gestora',
    password,
    demo: true,
  });
  other = await provision({
    name: 'Outro push ' + suffix,
    owner_email: 'other-' + email,
    owner_name: 'Outra',
    password,
    demo: true,
  });
  token = (
    await call('POST', '/auth/login', { email, password, establishment_slug: unit.slug }, '')
  ).token;
  otherToken = (
    await call(
      'POST',
      '/auth/login',
      { email: 'other-' + email, password, establishment_slug: other.slug },
      '',
    )
  ).token;
  await call('POST', '/staff', {
    name: 'Garçom de push',
    email: 'waiter-' + email,
    password,
    role_id: unit.roles.find((role) => role.name === 'Garçom')!.id,
  });
  waiterToken = (
    await call(
      'POST',
      '/auth/login',
      { email: 'waiter-' + email, password, establishment_slug: unit.slug },
      '',
    )
  ).token;
  const branch = await call('POST', '/establishments', { name: 'Filial push ' + suffix });
  branchToken = (await call('POST', '/auth/switch-branch', { establishment_id: branch.id })).token;
  branchDevice = await device(branchToken);
  await configure(branchToken);
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('exige admin geral, separa filiais e mantém endpoint e chaves fora das respostas e do texto do banco', async () => {
  expect((await req('GET', '/push/settings', undefined, waiterToken)).statusCode).toBe(403);
  expect((await req('GET', '/push/devices', undefined, waiterToken)).statusCode).toBe(403);
  const d = await device(),
    context = await call('GET', '/push/context');
  const list = await call('GET', '/push/devices?page=1&page_size=10');
  expect(context.configured).toBe(true);
  expect(context.public_key).toBe(env.WEB_PUSH_PUBLIC_KEY);
  expect(list.rows.some((row: any) => row.id === d.id)).toBe(true);
  expect(list.rows.some((row: any) => row.id === branchDevice.id)).toBe(false);
  const serialized = JSON.stringify({ list, context });
  expect(serialized).not.toContain(d.native.endpoint);
  expect(serialized).not.toContain(d.native.keys.auth);
  expect(serialized).not.toContain(env.WEB_PUSH_PRIVATE_KEY!);
  const [record] = await view(unit.actor).list('push_subscriptions', sql`id=${d.id}`);
  expect(record.credentials).not.toContain(d.native.endpoint);
  expect(openPush(record.credentials)).toMatchObject({ endpoint: d.native.endpoint });
  expect(
    (await req('DELETE', '/push/subscriptions/' + d.id, undefined, waiterToken)).statusCode,
  ).toBe(403);
  expect(
    (await req('DELETE', '/push/subscriptions/' + d.id, undefined, otherToken)).statusCode,
  ).toBe(404);
  expect(
    (await req('DELETE', '/push/subscriptions/' + d.id, undefined, branchToken)).statusCode,
  ).toBe(404);
  const repeated = await device(token, d.native);
  expect(repeated.id).toBe(d.id);
  await call('POST', '/push/devices/' + d.id + '/disable', {});
  const blocked = await call('POST', '/push/subscriptions', {
    subscription: d.native,
    origin: 'http://localhost:5173',
    surface: 'admin',
    device_name: 'Mesmo computador',
    activate: false,
  });
  expect(blocked.enabled).toBe(false);
});
it('bloqueia endpoint privado, origem inválida e perfis de outra filial', async () => {
  const payload = {
    subscription: subscription(),
    origin: 'http://localhost:5173',
    surface: 'admin',
    device_name: 'Inválido',
    activate: true,
  };
  expect(
    (
      await req('POST', '/push/subscriptions', {
        ...payload,
        subscription: { ...payload.subscription, endpoint: 'https://127.0.0.1/private' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await req('POST', '/push/subscriptions', { ...payload, origin: 'https://evil.test' }))
      .statusCode,
  ).toBe(400);
  const config = await call('GET', '/push/settings');
  config.rules[0].role_ids = [other.roles[0].id];
  expect(
    (await req('PATCH', '/push/settings', { enabled: true, rules: config.rules })).statusCode,
  ).toBe(400);
});
it('fanout usa eventos confirmados, não duplica após retries e não notifica assinaturas da outra filial', async () => {
  await configure(token, true);
  const d = await device(waiterToken, subscription(), 'waiter');
  const draft = await call('POST', '/orders', {
    table_id: unit.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: unit.products[0].id, quantity: 1, modifiers: [] }],
  });
  await call('POST', '/orders/' + draft.id + '/confirm', {});
  const events = await view(unit.actor).list(
    'outbox_events',
    sql`event IN ('table.occupied','order.confirmed')`,
  );
  expect(events.map((event) => event.event)).toEqual(
    expect.arrayContaining(['table.occupied', 'order.confirmed']),
  );
  for (const event of events) {
    await stagePushEvent(event);
    await stagePushEvent(event);
  }
  const deliveries = await view(unit.actor).list('push_deliveries', sql`subscription_id=${d.id}`);
  expect(deliveries).toHaveLength(2);
  expect(
    deliveries.every((delivery) => delivery.payload.url.startsWith('/' + unit.slug + '/mesas/')),
  ).toBe(true);
  expect(deliveries.every((delivery) => delivery.payload.body.includes('Mesa 01'))).toBe(true);
  expect(deliveries.some((delivery) => delivery.subscription_id === branchDevice.id)).toBe(false);
  const send = vi.fn(async () => ({}));
  await deliverPush(deliveryData(deliveries[0]), send);
  await deliverPush(deliveryData(deliveries[0]), send);
  expect(send).toHaveBeenCalledTimes(1);
  await deliverPush(
    {
      ...deliveryData(deliveries[1]),
      establishment_id: other.establishment_id,
      tenant_id: other.tenant_id,
    },
    send,
  );
  expect(send).toHaveBeenCalledTimes(1);
  await call('POST', '/push/devices/' + d.id + '/disable', {});
  await deliverPush(deliveryData(deliveries[1]), send);
  expect(send).toHaveBeenCalledTimes(1);
});
it('solicitação leva ao chamado com produto e mesa e uma entrega já resolvida não gera aviso atrasado', async () => {
  await configure(token, true);
  const d = await device(waiterToken, subscription(), 'waiter'),
    table = unit.tables[1];
  const visitor = await call(
    'POST',
    '/public/' + unit.slug + '/visitor-sessions',
    { table_code: table.public_code, name: 'Cliente', phone: '11999999999' },
    '',
  );
  const draft = await call(
    'POST',
    '/orders',
    {
      table_id: table.id,
      source: 'CUSTOMER',
      payment_policy: 'PREPAID',
      items: [{ product_id: unit.products[0].id, quantity: 1, modifiers: [] }],
    },
    visitor.token,
  );
  const intent = await call('POST', '/payments/intents', { order_id: draft.id }, visitor.token);
  await call('POST', '/sandbox/pay', { intent_id: intent.id }, visitor.token);
  const ticket = (await call('GET', '/tickets')).find((row: any) => row.order_id === draft.id);
  await call('POST', '/tickets/' + ticket.id + '/request', {}, visitor.token);
  const [event] = await view(unit.actor).list(
    'outbox_events',
    sql`aggregate_id=${ticket.id} AND event='ticket.requested'`,
  );
  await stagePushEvent(event);
  const [delivery] = await view(unit.actor).list(
    'push_deliveries',
    sql`event_id=${event.id} AND subscription_id=${d.id}`,
  );
  expect(delivery.payload.url).toBe('/' + unit.slug + '/chamados');
  expect(delivery.payload.body).toContain('Mesa 02');
  expect(delivery.payload.body).toContain(unit.products[0].name);
  const document = await call('GET', '/tickets/' + ticket.id);
  await call('POST', '/tickets/' + ticket.id + '/redeem', { token: document.token });
  const send = vi.fn(async () => ({}));
  await deliverPush(deliveryData(delivery), send);
  expect(send).not.toHaveBeenCalled();
});
it('404 e 410 removem a assinatura, enquanto 401 e 403 preservam o dispositivo e encerram o job', async () => {
  for (const statusCode of [404, 410, 401, 403]) {
    const d = await device(),
      delivery = await notification(d.id);
    const attempted = deliverPush(deliveryData(delivery), async () => {
      throw Object.assign(new Error('provider secret must not escape'), { statusCode });
    });
    if (statusCode === 401 || statusCode === 403)
      await expect(attempted).rejects.toThrow('Falha definitiva');
    else await attempted;
    const remaining = await view(unit.actor).list('push_subscriptions', sql`id=${d.id}`),
      [result] = await view(unit.actor).list('push_deliveries', sql`id=${delivery.id}`);
    expect(remaining.length).toBe(statusCode === 404 || statusCode === 410 ? 0 : 1);
    expect(result.state).toBe(statusCode === 404 || statusCode === 410 ? 'EXPIRED' : 'FAILED');
    expect(result.last_error).not.toContain('provider secret');
  }
});
it('BullMQ repete falhas transitórias no Redis e confirma uma única entrega', async () => {
  const d = await device(),
    delivery = await notification(d.id),
    name = 'push-test-' + randomUUID(),
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(name, { connection }),
    events = new QueueEvents(name, { connection });
  let sends = 0;
  const worker = new Worker(
    name,
    (job) =>
      deliverPush(job.data, async () => {
        sends++;
        if (sends < 3)
          throw Object.assign(new Error('temporary'), { statusCode: sends === 1 ? 429 : 503 });
        return {};
      }),
    { connection },
  );
  try {
    await events.waitUntilReady();
    const job = await queue.add('deliver', deliveryData(delivery), {
      jobId: delivery.id,
      attempts: 6,
      backoff: { type: 'exponential', delay: 100 },
    });
    await job.waitUntilFinished(events, 15000);
    expect(sends).toBe(3);
    const [result] = await view(unit.actor).list('push_deliveries', sql`id=${delivery.id}`);
    expect(result.state).toBe('SENT');
    expect(result.attempts).toBe(3);
  } finally {
    await worker.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  }
});
it('logout impede entregas pendentes e a manutenção remove a assinatura sem afetar outros dispositivos', async () => {
  const fresh = (
    await call('POST', '/auth/login', { email, password, establishment_slug: unit.slug }, '')
  ).token;
  const d = await device(fresh),
    delivery = await notification(d.id, fresh);
  await call('POST', '/auth/logout', {}, fresh);
  const send = vi.fn(async () => ({}));
  await deliverPush(deliveryData(delivery), send);
  expect(send).not.toHaveBeenCalled();
  await cleanupPushSubscriptions();
  expect(await view(unit.actor).list('push_subscriptions', sql`id=${d.id}`)).toHaveLength(0);
  expect(
    (await call('GET', '/push/context', undefined, branchToken)).subscriptions.some(
      (row: any) => row.id === branchDevice.id,
    ),
  ).toBe(true);
});
