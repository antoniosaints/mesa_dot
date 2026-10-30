import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool } from '../../packages/database/src/index.js';
import { emptyBusinessProfile } from '../../packages/shared/src/business-profile.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  a: Awaited<ReturnType<typeof provision>>,
  b: typeof a,
  tokenA: string,
  tokenB: string;
const suffix = randomUUID().slice(0, 8),
  password = 'BusinessProfileTestsOnly1!';
async function request(method: string, path: string, body?: unknown, token = tokenA) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'Idempotency-Key': randomUUID(),
    },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
beforeAll(async () => {
  await migrate();
  a = await provision({
    name: 'Perfil A ' + suffix,
    owner_name: 'Dona A',
    owner_email: 'profile-a-' + suffix + '@test.local',
    password,
  });
  b = await provision({
    name: 'Perfil B ' + suffix,
    owner_name: 'Dona B',
    owner_email: 'profile-b-' + suffix + '@test.local',
    password,
  });
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  for (const [fixture, email, setToken] of [
    [a, 'profile-a-' + suffix + '@test.local', (v: string) => (tokenA = v)],
    [b, 'profile-b-' + suffix + '@test.local', (v: string) => (tokenB = v)],
  ] as const) {
    const auth = await request(
      'POST',
      '/auth/login',
      { email, password, establishment_slug: fixture.slug },
      '',
    );
    expect(auth.statusCode, auth.body).toBe(200);
    setToken(auth.json().token);
  }
}, 60000);
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('cadastros existentes continuam com dados públicos opcionais vazios', async () => {
  const menu = await request('GET', '/public/' + a.slug + '/menu', undefined, '');
  expect(menu.statusCode, menu.body).toBe(200);
  expect(menu.json().establishment.business_profile).toEqual(emptyBusinessProfile());
});
it('salva, normaliza e atualiza parcialmente sem afetar as políticas ou a outra conta', async () => {
  const before = (await request('GET', '/settings')).json();
  const profile = {
    description: '  Comida da casa  ',
    phone: '11999998888',
    email: 'CONTATO@EXAMPLE.COM',
    postal_code: '01001000',
    street: 'Praça da Sé',
    number: 'S/N',
    complement: 'Loja 1',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'sp',
  };
  const saved = await request('PATCH', '/settings', { business_profile: profile });
  expect(saved.statusCode, saved.body).toBe(200);
  const expected = {
    ...profile,
    description: 'Comida da casa',
    email: 'contato@example.com',
    state: 'SP',
  };
  expect(saved.json().business_profile).toEqual(expected);
  expect(saved.json()).toMatchObject({
    payment_mode: before.payment_mode,
    postpaid_limit: before.postpaid_limit,
    is_open: before.is_open,
    name: before.name,
    slug: before.slug,
  });
  const partial = await request('PATCH', '/settings', {
    business_profile: { description: 'Nova descrição' },
  });
  expect(partial.statusCode, partial.body).toBe(200);
  const menu = (await request('GET', '/public/' + a.slug + '/menu', undefined, '')).json();
  expect(menu.establishment.business_profile).toEqual({
    ...expected,
    description: 'Nova descrição',
  });
  for (const key of ['tenant_id', 'order_cash_session_id', 'retention_days'])
    expect(menu.establishment).not.toHaveProperty(key);
  expect((await request('GET', '/settings', undefined, tokenB)).json().business_profile).toBeNull();
  expect(
    (await request('GET', '/public/' + b.slug + '/menu', undefined, '')).json().establishment
      .business_profile,
  ).toEqual(emptyBusinessProfile());
});
it('recusa dados inválidos e tentativas de alterar o escopo sem gravar parcialmente', async () => {
  const before = (await request('GET', '/settings')).json().business_profile;
  for (const patch of [
    { phone: 'abc' },
    { postal_code: '01001-000' },
    { email: 'sem-email' },
    { state: 'XX' },
    { description: 'x'.repeat(1001) },
    { tenant_id: b.tenant_id },
    {},
  ]) {
    const response = await request('PATCH', '/settings', { business_profile: patch });
    expect(response.statusCode, response.body).toBe(400);
  }
  expect((await request('GET', '/settings')).json().business_profile).toEqual(before);
  const unauthenticated = await request(
    'PATCH',
    '/settings',
    { business_profile: { description: 'Não permitido' } },
    '',
  );
  expect(unauthenticated.statusCode).toBe(401);
});
it('permite remover informações opcionais e mantém a configuração isolada por filial', async () => {
  const branch = await request('POST', '/establishments', { name: 'Filial Perfil ' + suffix });
  expect(branch.statusCode, branch.body).toBe(200);
  const unit = branch.json();
  const switched = await request('POST', '/auth/switch-branch', {
    establishment_id: unit.id,
  });
  expect(switched.statusCode, switched.body).toBe(200);
  const token = switched.json().token;
  const branchSaved = await request(
    'PATCH',
    '/settings',
    { business_profile: { city: 'Recife', state: 'PE' } },
    token,
  );
  expect(branchSaved.statusCode, branchSaved.body).toBe(200);
  expect(branchSaved.json().business_profile.city).toBe('Recife');
  expect((await request('GET', '/settings')).json().business_profile.city).toBe('São Paulo');
  const cleared = await request('PATCH', '/settings', { business_profile: emptyBusinessProfile() });
  expect(cleared.statusCode, cleared.body).toBe(200);
  expect(cleared.json().business_profile).toEqual(emptyBusinessProfile());
  expect((await request('GET', '/settings', undefined, token)).json().business_profile.city).toBe(
    'Recife',
  );
});
