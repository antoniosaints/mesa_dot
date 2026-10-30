import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { db, rows, sql, pool } from '../../packages/database/src/index.js';
const password = 'SaasPortalTestsOnly1!';
let app: Awaited<ReturnType<typeof buildApp>>,
  root: Awaited<ReturnType<typeof provision>>,
  tenant: typeof root;
let rootToken: string, ownerToken: string;
const suffix = randomUUID().slice(0, 8);
async function req(
  method: string,
  path: string,
  body?: unknown,
  token = '',
  key = randomUUID(),
  extra = {},
) {
  return app.inject({
    method: method as any,
    url: path.startsWith('/api/') ? path : '/api/v1' + path,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'idempotency-key': key,
      ...extra,
    },
    ...(body ? { payload: body as any } : {}),
  });
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco isolado obrigatório.');
  await migrate();
  app = await buildApp({ logger: false });
  root = await provision({
    name: 'Mesa Platform ' + suffix,
    owner_email: 'platform-' + suffix + '@test.local',
    owner_name: 'Gestor',
    password,
    superadmin: true,
    platform: true,
  });
  tenant = await provision({
    name: 'Restaurant ' + suffix,
    owner_email: 'owner-' + suffix + '@test.local',
    owner_name: 'Proprietário',
    password,
  });
  rootToken = (
    await req('POST', '/auth/saas/login', { email: 'platform-' + suffix + '@test.local', password })
  ).json().token;
  ownerToken = (
    await req('POST', '/auth/login', {
      email: 'owner-' + suffix + '@test.local',
      password,
      establishment_slug: tenant.slug,
    })
  ).json().token;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('separa o login do gestor do proprietário e oculta o tenant da plataforma', async () => {
  expect(rootToken).toBeTruthy();
  expect(
    (await req('POST', '/auth/saas/login', { email: 'owner-' + suffix + '@test.local', password }))
      .statusCode,
  ).toBe(401);
  const directory = (await req('GET', '/auth/establishments')).json();
  expect(directory.some((row: any) => row.slug === tenant.slug)).toBe(true);
  expect(directory.some((row: any) => row.slug === root.slug)).toBe(false);
  expect((await req('GET', '/api/v1/pwa/resolve/' + root.slug)).statusCode).toBe(404);
  const [owner] = await rows(db, sql`SELECT is_superadmin FROM users WHERE id=${tenant.user_id}`);
  expect(owner.is_superadmin).toBe(0);
});
it('exige superadmin em todas as novas consultas e mutações', async () => {
  for (const path of [
    '/saas/me',
    '/saas/overview',
    '/saas/accounts',
    '/saas/accounts/' + tenant.tenant_id,
    '/saas/plans',
    '/saas/audit-logs',
  ]) {
    expect((await req('GET', path)).statusCode, path).toBe(401);
    expect((await req('GET', path, undefined, ownerToken)).statusCode, path).toBe(403);
  }
  expect(
    (await req('PATCH', '/saas/tenants/' + tenant.tenant_id, { enabled: false }, ownerToken))
      .statusCode,
  ).toBe(403);
});
it('cadastra conta pública sem privilégios, repete com segurança e rejeita campos de elevação', async () => {
  const input = {
    name: 'Novo restaurante ' + suffix,
    owner_name: 'Dona da casa',
    owner_email: 'signup-' + suffix + '@test.local',
    password,
  };
  const key = randomUUID();
  const [a, b] = await Promise.all([
    req('POST', '/auth/register', input, '', key),
    req('POST', '/auth/register', input, '', key),
  ]);
  expect(a.statusCode, a.body).toBe(201);
  expect(b.json()).toEqual(a.json());
  expect(a.json().token).toBeUndefined();
  const [user] = await rows(
    db,
    sql`SELECT is_superadmin FROM users WHERE email=${input.owner_email}`,
  );
  expect(user.is_superadmin).toBe(0);
  const login = await req('POST', '/auth/login', {
    email: input.owner_email,
    password,
    establishment_slug: a.json().slug,
  });
  expect(login.statusCode).toBe(200);
  expect((await req('GET', '/saas/me', undefined, login.json().token)).statusCode).toBe(403);
  expect(
    (await req('POST', '/auth/register', { ...input, password: 'ChangedPasswordOnly1!' }, '', key))
      .statusCode,
  ).toBe(409);
  expect((await req('POST', '/auth/register', { ...input, superadmin: true })).statusCode).toBe(
    400,
  );
});
it('valida senhas e dados públicos sem criar cadastros parciais', async () => {
  const input = {
    name: 'Bad Signup ' + suffix,
    owner_name: 'Teste',
    owner_email: 'bad-' + suffix + '@test.local',
    password: 'short',
  };
  expect((await req('POST', '/auth/register', input)).statusCode).toBe(400);
  expect(await rows(db, sql`SELECT id FROM users WHERE email=${input.owner_email}`)).toHaveLength(
    0,
  );
});
it('pagina, busca e filtra contas no servidor sem incluir a plataforma', async () => {
  const result = await req(
    'GET',
    '/saas/accounts?search=' + suffix + '&page=1&page_size=1',
    undefined,
    rootToken,
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().items).toHaveLength(1);
  expect(result.json().total).toBeGreaterThanOrEqual(2);
  expect(result.json().items[0].id).not.toBe(root.tenant_id);
  const stats = (await req('GET', '/saas/overview', undefined, rootToken)).json();
  expect(Number(stats.total)).toBe(Number(stats.active) + Number(stats.suspended));
  expect(
    (await req('GET', '/saas/accounts?page_size=10000', undefined, rootToken)).statusCode,
  ).toBe(400);
});
it('suspende e reativa conta bloqueando sessões existentes sem apagar dados', async () => {
  const paused = await req(
    'PATCH',
    '/saas/tenants/' + tenant.tenant_id,
    { enabled: false },
    rootToken,
  );
  expect(paused.statusCode, paused.body).toBe(200);
  expect((await req('GET', '/me', undefined, ownerToken)).statusCode).toBe(401);
  const [user] = await rows(db, sql`SELECT id FROM users WHERE id=${tenant.user_id}`);
  expect(user).toBeTruthy();
  expect(
    (await req('PATCH', '/saas/tenants/' + tenant.tenant_id, { enabled: true }, rootToken))
      .statusCode,
  ).toBe(200);
  expect((await req('GET', '/me', undefined, ownerToken)).statusCode).toBe(200);
  expect(
    (await req('PATCH', '/saas/tenants/' + root.tenant_id, { enabled: false }, rootToken))
      .statusCode,
  ).toBe(409);
});
it('vincula e altera plano com auditoria exclusiva do gestor', async () => {
  const plan = await req(
    'POST',
    '/saas/plans',
    { name: 'Plano Teste ' + suffix, monthly_price: '129.90', limits_json: {} },
    rootToken,
  );
  expect(plan.statusCode, plan.body).toBe(200);
  const created = await req(
    'POST',
    '/saas/subscriptions',
    {
      tenant_id: tenant.tenant_id,
      plan_id: plan.json().id,
      status: 'TRIAL',
      valid_until: '2027-01-31T23:59:59.000Z',
    },
    rootToken,
  );
  expect(created.statusCode, created.body).toBe(200);
  const body = {
    plan_id: plan.json().id,
    status: 'ACTIVE',
    valid_until: '2027-02-28T23:59:59.000Z',
  };
  expect(
    (await req('PATCH', '/saas/subscriptions/' + created.json().id, body, ownerToken)).statusCode,
  ).toBe(403);
  expect(
    (await req('PATCH', '/saas/subscriptions/' + created.json().id, body, rootToken)).statusCode,
  ).toBe(200);
  const detail = await req('GET', '/saas/accounts/' + tenant.tenant_id, undefined, rootToken);
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().subscriptions[0].status).toBe('ACTIVE');
  expect(detail.json().owners[0].email).toContain(suffix);
  const audit = (await req('GET', '/saas/audit-logs', undefined, rootToken)).json();
  expect(
    audit.some(
      (r: any) => r.action === 'subscription.updated' && r.aggregate_id === created.json().id,
    ),
  ).toBe(true);
});
it('serve a landing e rotas do gestor sem contexto de restaurante na produção', async () => {
  for (const path of ['/', '/entrar', '/criar-conta', '/gestor', '/gestor/planos']) {
    const response = await app.inject({
      method: 'GET',
      url: path,
      headers: { 'x-mesa-app': 'admin' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toContain('<div id="root">');
    expect(response.body).not.toContain('id="mesa-pwa-context"');
  }
});
