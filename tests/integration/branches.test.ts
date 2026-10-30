import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { db, pool, rows, sql } from '../../packages/database/src/index.js';
const password = 'BranchTestsOnlyPassword1!',
  suffix = randomUUID().slice(0, 8);
let app: Awaited<ReturnType<typeof buildApp>>,
  a: Awaited<ReturnType<typeof provision>>,
  foreign: typeof a,
  branch: any,
  ownerToken: string,
  secondToken: string,
  staffToken: string,
  staff: any;
async function req(
  method: string,
  path: string,
  body?: unknown,
  token = ownerToken,
  key = randomUUID(),
  headers = {},
) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'idempotency-key': key,
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function assignments(user: string) {
  const response = await req('GET', '/account/users/' + user + '/branches');
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco isolado obrigatório.');
  await migrate();
  app = await buildApp({ logger: false });
  a = await provision({
    name: 'Filial Matriz ' + suffix,
    owner_email: 'branch-owner-' + suffix + '@test.local',
    owner_name: 'Dona da conta',
    password,
    demo: true,
  });
  foreign = await provision({
    name: 'Outra conta ' + suffix,
    owner_email: 'foreign-' + suffix + '@test.local',
    owner_name: 'Outra pessoa',
    password,
    demo: true,
  });
  ownerToken = (
    await req(
      'POST',
      '/auth/login',
      { email: 'branch-owner-' + suffix + '@test.local', password, establishment_slug: a.slug },
      '',
    )
  ).json().token;
  staff = (
    await req('POST', '/staff', {
      name: 'Funcionário compartilhado',
      email: 'branch-staff-' + suffix + '@test.local',
      password,
      role_id: a.roles.find((r) => r.name === 'Garçom')!.id,
    })
  ).json();
  staffToken = (
    await req(
      'POST',
      '/auth/login',
      { email: staff.email, password, establishment_slug: a.slug },
      '',
    )
  ).json().token;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('apenas o admin geral cria filial vazia e a repetição é idempotente', async () => {
  expect(
    (await req('POST', '/establishments', { name: 'Não permitido' }, staffToken)).statusCode,
  ).toBe(403);
  const key = randomUUID(),
    body = { name: 'Filial Centro ' + suffix };
  const response = await req('POST', '/establishments', body, ownerToken, key);
  expect(response.statusCode, response.body).toBe(200);
  branch = response.json();
  expect((await req('POST', '/establishments', body, ownerToken, key)).json()).toEqual(branch);
  secondToken = (await req('POST', '/auth/switch-branch', { establishment_id: branch.id })).json()
    .token;
  expect(secondToken).toBeTruthy();
  for (const table of [
    'products',
    'categories',
    'product_variants',
    'stock_balances',
    'stock_movements',
    'cash_sessions',
    'orders',
    'tickets',
    'payments',
    'financial_entries',
    'customers',
    'printers',
  ]) {
    const [count] = await rows(
      db,
      sql`SELECT COUNT(*) n FROM ${sql.identifier(table)} WHERE tenant_id=${a.tenant_id} AND establishment_id=${branch.id}`,
    );
    expect(Number(count.n), table).toBe(0);
  }
  const [members] = await rows(
    db,
    sql`SELECT COUNT(*) n FROM staff_memberships WHERE tenant_id=${a.tenant_id} AND establishment_id=${branch.id}`,
  );
  expect(Number(members.n)).toBe(1);
  const roles = await req('GET', '/roles', undefined, secondToken);
  expect(roles.json()).toHaveLength(4);
});
it('o diretório mostra apenas a matriz atual com logo, e o login encaminha quem só trabalha na filial', async () => {
  const directory = await req('GET', '/auth/establishments', undefined, '');
  expect(directory.statusCode).toBe(200);
  const companies = directory.json();
  expect(companies.filter((item: any) => [a.slug, branch.slug].includes(item.slug))).toHaveLength(
    1,
  );
  const main = companies.find((item: any) => item.slug === a.slug);
  expect(main.name).toBe('Filial Matriz ' + suffix);
  expect(main.icon_url).toContain('/pwa/assets/' + a.establishment_id + '/');
  const icon = await app.inject({ method: 'GET', url: main.icon_url });
  expect(icon.statusCode).toBe(200);
  expect(icon.headers['content-type']).toContain('image/png');
  const roles = (await req('GET', '/roles', undefined, secondToken)).json();
  const employeeEmail = 'branch-only-' + suffix + '@test.local';
  const created = await req(
    'POST',
    '/staff',
    {
      name: 'Somente filial',
      email: employeeEmail,
      password,
      role_id: roles.find((r: any) => r.name === 'Garçom').id,
    },
    secondToken,
  );
  expect(created.statusCode, created.body).toBe(200);
  const credentials = { email: employeeEmail, password, establishment_slug: a.slug };
  expect((await req('POST', '/auth/login', credentials, '')).statusCode).toBe(401);
  const authenticated = await req('POST', '/auth/account-login', credentials, '', undefined, {
    'x-mesa-establishment': a.establishment_id,
  });
  expect(authenticated.statusCode, authenticated.body).toBe(200);
  expect(authenticated.json()).toMatchObject({
    slug: branch.slug,
    actor: { establishmentId: branch.id, tenantId: a.tenant_id },
  });
  expect(
    (
      await req('GET', '/products', undefined, authenticated.json().token, undefined, {
        'x-mesa-establishment': a.establishment_id,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await req(
        'POST',
        '/auth/account-login',
        { ...credentials, password: 'IncorrectPassword1!' },
        '',
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await req(
        'POST',
        '/auth/account-login',
        { ...credentials, establishment_slug: foreign.slug },
        '',
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await req('POST', '/auth/account-login', credentials, '', undefined, {
        'x-mesa-establishment': foreign.establishment_id,
      })
    ).statusCode,
  ).toBe(403);
  const principalOwner = await req(
    'POST',
    '/auth/account-login',
    { email: 'branch-owner-' + suffix + '@test.local', password, establishment_slug: a.slug },
    '',
  );
  expect(principalOwner.json().actor.establishmentId).toBe(a.establishment_id);
  expect(
    (
      await req(
        'POST',
        '/auth/account-login',
        { ...credentials, establishment_slug: branch.slug },
        '',
      )
    ).json().actor.establishmentId,
  ).toBe(branch.id);
});
it('lista apenas filiais permitidas e troca sessão sem aceitar outra conta ou vínculo ausente', async () => {
  const allowed = (await req('GET', '/branches')).json();
  expect(allowed.can_manage).toBe(true);
  expect(allowed.branches.map((b: any) => b.id).sort()).toEqual(
    [a.establishment_id, branch.id].sort(),
  );
  const employee = (await req('GET', '/branches', undefined, staffToken)).json();
  expect(employee.can_manage).toBe(false);
  expect(employee.branches).toHaveLength(1);
  expect(
    (await req('POST', '/auth/switch-branch', { establishment_id: branch.id }, staffToken))
      .statusCode,
  ).toBe(403);
  expect(
    (await req('POST', '/auth/switch-branch', { establishment_id: foreign.establishment_id }))
      .statusCode,
  ).toBe(403);
  expect((await req('GET', '/account/users', undefined, staffToken)).statusCode).toBe(403);
  expect((await req('GET', '/account/users/' + foreign.user_id + '/branches')).statusCode).toBe(
    404,
  );
  const switched = await req('POST', '/auth/switch-branch', { establishment_id: branch.id });
  expect(switched.json().actor.establishmentId).toBe(branch.id);
  expect(
    (
      await req('GET', '/products', undefined, switched.json().token, undefined, {
        'x-mesa-establishment': a.establishment_id,
      })
    ).statusCode,
  ).toBe(403);
});
it('reutiliza a identidade e senha com perfil independente por filial, sem criar outro usuário', async () => {
  const initial = await assignments(staff.id),
    target = initial.branches.find((b: any) => b.id === branch.id),
    cashier = target.roles.find((r: any) => r.name === 'Caixa');
  const [before] = await rows(
    db,
    sql`SELECT name,email,password_hash FROM users WHERE id=${staff.id}`,
  );
  const body = {
    branches: [
      {
        establishment_id: a.establishment_id,
        role_id: a.roles.find((r) => r.name === 'Garçom')!.id,
      },
      { establishment_id: branch.id, role_id: cashier.id },
    ],
  };
  const key = randomUUID();
  expect(
    (await req('PATCH', '/account/users/' + staff.id + '/branches', body, ownerToken, key))
      .statusCode,
  ).toBe(200);
  expect(
    (await req('PATCH', '/account/users/' + staff.id + '/branches', body, ownerToken, key))
      .statusCode,
  ).toBe(200);
  const [after] = await rows(
    db,
    sql`SELECT name,email,password_hash FROM users WHERE id=${staff.id}`,
  );
  expect(after).toEqual(before);
  const login = await req(
    'POST',
    '/auth/login',
    { email: staff.email, password, establishment_slug: branch.slug },
    '',
  );
  expect(login.statusCode, login.body).toBe(200);
  expect(login.json().actor.permissions).toContain('cash.manage');
  expect(login.json().actor.isAccountAdmin).toBe(false);
  expect((await req('GET', '/finance/context', undefined, login.json().token)).statusCode).toBe(
    403,
  );
  const original = await req('GET', '/me', undefined, staffToken);
  expect(original.json().permissions).not.toContain('cash.manage');
  const users = (
    await req(
      'GET',
      '/account/users?search=' + encodeURIComponent(staff.email) + '&page_size=1&page=1',
    )
  ).json();
  expect(users.total).toBe(1);
  expect(users.rows[0].branches).toHaveLength(2);
});
it('rejeita perfis de outra filial, tentativas de escalada e remoção do acesso atual', async () => {
  expect(
    (
      await req('PATCH', '/account/users/' + staff.id + '/branches', {
        branches: [{ establishment_id: branch.id, role_id: a.roles[0].id }],
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (await req('PATCH', '/account/users/' + staff.id + '/branches', { branches: [] }, staffToken))
      .statusCode,
  ).toBe(403);
  expect(
    (await req('PATCH', '/account/users/' + a.user_id + '/branches', { branches: [] })).statusCode,
  ).toBe(409);
  const context = await assignments(a.user_id),
    current = context.branches.find((b: any) => b.id === a.establishment_id);
  expect(
    (
      await req('PATCH', '/account/users/' + a.user_id + '/branches', {
        branches: [{ establishment_id: current.id, role_id: current.role_id }],
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await req('PATCH', '/account/users/' + foreign.user_id + '/branches', { branches: [] }))
      .statusCode,
  ).toBe(404);
});
it('separa cardápio, estoque, pedidos, pagamentos, caixa e financeiro entre filiais da mesma conta', async () => {
  expect((await req('GET', '/products')).json().length).toBeGreaterThan(0);
  expect((await req('GET', '/products', undefined, secondToken)).json()).toHaveLength(0);
  expect(
    (await req('GET', '/tables/' + a.tables[0].id + '/session', undefined, secondToken)).statusCode,
  ).toBe(404);
  const category = (await req('GET', '/categories')).json()[0];
  expect(
    (
      await req(
        'POST',
        '/products',
        {
          name: 'Referência cruzada',
          price: '5.00',
          category_id: category.id,
          stock_policy: 'NO_CONTROL',
        },
        secondToken,
      )
    ).statusCode,
  ).toBe(409);
  for (const path of ['/orders', '/payments', '/cash/sessions', '/inventory/balances'])
    expect((await req('GET', path, undefined, secondToken)).json(), path).toHaveLength(0);
  const query = '?start=2026-01-01&end=2026-12-31';
  const finance = await req('GET', '/finance/dashboard' + query, undefined, secondToken);
  expect(finance.statusCode, finance.body).toBe(200);
  expect(finance.json().unit.id).toBe(branch.id);
});
it('remover uma filial revoga apenas suas sessões e impede recuperação por refresh mesmo após reativar', async () => {
  const active = await req(
    'POST',
    '/auth/login',
    { email: staff.email, password, establishment_slug: branch.slug },
    '',
  );
  expect(active.statusCode).toBe(200);
  const body = {
    branches: [
      {
        establishment_id: a.establishment_id,
        role_id: a.roles.find((r) => r.name === 'Garçom')!.id,
      },
    ],
  };
  expect((await req('PATCH', '/account/users/' + staff.id + '/branches', body)).statusCode).toBe(
    200,
  );
  expect((await req('GET', '/me', undefined, active.json().token)).statusCode).toBe(401);
  expect(
    (await req('POST', '/auth/refresh', { refresh_token: active.json().refresh_token }, ''))
      .statusCode,
  ).toBe(401);
  expect((await req('GET', '/me', undefined, staffToken)).statusCode).toBe(200);
  const context = await assignments(staff.id),
    target = context.branches.find((b: any) => b.id === branch.id);
  body.branches.push({
    establishment_id: branch.id,
    role_id: target.roles.find((r: any) => r.name === 'Cozinha').id,
  });
  expect((await req('PATCH', '/account/users/' + staff.id + '/branches', body)).statusCode).toBe(
    200,
  );
  expect((await req('GET', '/me', undefined, active.json().token)).statusCode).toBe(401);
  const next = await req(
    'POST',
    '/auth/switch-branch',
    { establishment_id: branch.id },
    staffToken,
  );
  expect(next.statusCode, next.body).toBe(200);
  expect(next.json().actor.permissions).toContain('production.manage');
  expect(next.json().actor.permissions).not.toContain('cash.manage');
});
it('serializa alterações concorrentes entre filiais e não mistura direitos de usuários', async () => {
  const current = await assignments(staff.id),
    assignmentsBody = {
      branches: current.branches
        .filter((b: any) => b.enabled)
        .map((b: any) => ({ establishment_id: b.id, role_id: b.role_id })),
    };
  const result = await Promise.all([
    req('PATCH', '/account/users/' + staff.id + '/branches', assignmentsBody),
    req('PATCH', '/account/users/' + staff.id + '/branches', assignmentsBody, secondToken),
    req('POST', '/auth/switch-branch', { establishment_id: branch.id }, staffToken),
  ]);
  for (const response of result) expect(response.statusCode, response.body).toBe(200);
  const counts = await rows(
    db,
    sql`SELECT establishment_id,COUNT(*) n FROM staff_memberships WHERE tenant_id=${a.tenant_id} AND user_id=${staff.id} GROUP BY establishment_id`,
  );
  expect(counts.every((row) => Number(row.n) === 1)).toBe(true);
});
it('recusa salvar um formulário desatualizado quando outro administrador altera os vínculos', async () => {
  const context = await assignments(staff.id),
    target = context.branches.find((b: any) => b.id === branch.id);
  const original = context.branches
    .filter((b: any) => b.enabled)
    .map((b: any) => ({ establishment_id: b.id, role_id: b.role_id }));
  const changed = original.map((b: any) =>
    b.establishment_id === branch.id
      ? { ...b, role_id: target.roles.find((r: any) => r.name === 'Caixa').id }
      : b,
  );
  expect(
    (
      await req('PATCH', '/account/users/' + staff.id + '/branches', {
        branches: changed,
        expected_version: context.version,
      })
    ).statusCode,
  ).toBe(200);
  const stale = await req('PATCH', '/account/users/' + staff.id + '/branches', {
    branches: original,
    expected_version: context.version,
  });
  expect(stale.statusCode, stale.body).toBe(409);
  expect(stale.json().error.message).toContain('outro administrador');
});
it('a edição local do perfil também notifica a equipe e revoga somente a sessão da filial alterada', async () => {
  const context = await assignments(staff.id),
    home = context.branches.find((b: any) => b.id === a.establishment_id);
  const other = await req(
    'POST',
    '/auth/login',
    { email: staff.email, password, establishment_slug: branch.slug },
    '',
  );
  expect(other.statusCode).toBe(200);
  const changed = await req('PATCH', '/staff/' + home.membership_id, {
    enabled: true,
    role_id: home.roles.find((r: any) => r.name === 'Caixa').id,
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect((await req('GET', '/me', undefined, staffToken)).statusCode).toBe(401);
  expect((await req('GET', '/me', undefined, other.json().token)).statusCode).toBe(200);
  const events = await rows(
    db,
    sql`SELECT id FROM outbox_events WHERE tenant_id=${a.tenant_id} AND establishment_id=${a.establishment_id} AND aggregate_id=${home.membership_id} AND event='staff.updated'`,
  );
  expect(events).toHaveLength(1);
});
