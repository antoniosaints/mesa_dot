import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { db, rows, sql, pool, atomic } from '../../packages/database/src/index.js';
import { assignSlug, backfillSlugs } from '../../packages/database/src/slugs.js';
import { pwaManifest, stableBase } from '../../packages/shared/src/pwa.js';
import { fallbackIcon } from '../../apps/api/src/pwa-icons.js';
const password = 'PwaTestsOnlyPassword1!';
let app: Awaited<ReturnType<typeof buildApp>>,
  a: Awaited<ReturnType<typeof provision>>,
  b: typeof a,
  tokenA: string,
  tokenB: string;
const suffix = randomUUID().slice(0, 8),
  name = 'Bar do João ' + suffix;
async function request(
  method: string,
  path: string,
  body?: unknown,
  token = tokenA,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: method as any,
    url: path,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'Idempotency-Key': randomUUID(),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function login(unit: typeof a, email: string) {
  const r = await request(
    'POST',
    '/api/v1/auth/login',
    { email, password, establishment_slug: unit.slug },
    '',
  );
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
beforeAll(async () => {
  await migrate();
  a = await provision({
    name,
    owner_name: 'Dono A',
    owner_email: `pwa-a-${suffix}@test.local`,
    password,
    demo: true,
  });
  b = await provision({
    name: 'Outro PWA ' + suffix,
    owner_name: 'Dono B',
    owner_email: `pwa-b-${suffix}@test.local`,
    password,
    demo: true,
  });
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  tokenA = (await login(a, `pwa-a-${suffix}@test.local`)).token;
  tokenB = (await login(b, `pwa-b-${suffix}@test.local`)).token;
}, 60000);
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('cria endereço automático e identidade pública sem dados privados', async () => {
  expect(a.slug).toBe('bar-do-joao-' + suffix);
  const r = await request('GET', '/api/v1/pwa/resolve/' + a.slug);
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({ establishment_id: a.establishment_id, name });
  expect(r.json()).not.toHaveProperty('tenant_id');
  expect(r.json()).not.toHaveProperty('opening_hours');
  const directory = await request('GET', '/api/v1/auth/establishments', undefined, '');
  expect(directory.statusCode).toBe(200);
  const entry = directory.json().find((company: any) => company.slug === a.slug);
  expect(entry).toMatchObject({ name, slug: a.slug });
  expect(entry.icon_url).toMatch(
    new RegExp('^/pwa/assets/' + a.establishment_id + '/[^/]+/192\\.png$'),
  );
  for (const company of directory.json())
    expect(Object.keys(company).sort()).toEqual(['icon_url', 'name', 'slug']);
  expect(new Set(directory.json().map((company: any) => company.slug)).size).toBe(
    directory.json().length,
  );
  expect(r.headers['cache-control']).toContain('no-store');
  const me = await request('GET', '/api/v1/me');
  expect(me.headers['cache-control']).toContain('no-store');
  const cors = await request('OPTIONS', '/api/v1/me', undefined, '', {
    Origin: 'http://localhost:5173',
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization,x-mesa-establishment',
  });
  expect(cors.statusCode).toBe(204);
  expect(String(cors.headers['access-control-allow-headers']).toLowerCase()).toContain(
    'x-mesa-establishment',
  );
  const manifest = await request('GET', '/' + a.slug + '/manifest.webmanifest');
  expect(manifest.statusCode, manifest.body).toBe(200);
  expect(manifest.headers['content-type']).toContain('application/manifest+json');
  expect(manifest.headers['cache-control']).toBe('no-store');
  expect(manifest.json().start_url).toBe(stableBase(a.establishment_id));
});
it('renomeia atomicamente sem alterar pedidos, sessões e chaves de negócio', async () => {
  const original = a.slug;
  const draft = await request('POST', '/api/v1/orders', {
    table_id: a.tables[0].id,
    source: 'POS',
    payment_policy: 'POSTPAID',
    items: [{ product_id: a.products[1].id, quantity: 1, modifiers: [] }],
  });
  expect(draft.statusCode).toBe(200);
  const order = await request('POST', `/api/v1/orders/${draft.json().id}/confirm`, {});
  expect(order.statusCode, order.body).toBe(200);
  const before = (await request('GET', '/' + original + '/manifest.webmanifest')).json();
  const changed = await request('PATCH', '/api/v1/settings', { name: name + ' Premium' });
  expect(changed.statusCode, changed.body).toBe(200);
  a.slug = changed.json().slug;
  expect(a.slug).toBe(original + '-premium');
  const directory = (await request('GET', '/api/v1/auth/establishments', undefined, '')).json();
  expect(directory.some((company: any) => company.slug === original)).toBe(false);
  expect(directory.filter((company: any) => company.slug === a.slug)).toHaveLength(1);
  expect(changed.json().id).toBe(a.establishment_id);
  const historical = await request(
    'GET',
    `/${original}/cardapio?table=${a.tables[0].public_code}&token=secret&next=https://evil.test`,
  );
  expect(historical.statusCode).toBe(302);
  expect(historical.headers.location).toBe(`/${a.slug}/cardapio?table=${a.tables[0].public_code}`);
  const current = await request('GET', '/' + a.slug + '/');
  expect(current.statusCode, current.body).toBe(200);
  expect(current.body).toContain('mesa-pwa-context');
  expect(current.body).toContain('Bar do João');
  const after = (
    await request('GET', stableBase(a.establishment_id) + 'manifest.webmanifest')
  ).json();
  expect(after.id).toBe(before.id);
  expect(after.scope).toBe(before.scope);
  expect(after.start_url).toBe(before.start_url);
  expect((await request('GET', `/api/v1/orders/${draft.json().id}`)).json().id).toBe(
    draft.json().id,
  );
  expect(
    (await login({ ...a, slug: original }, `pwa-a-${suffix}@test.local`)).actor.establishmentId,
  ).toBe(a.establishment_id);
});
it('concorre em nomes iguais e não reutiliza endereço histórico de outra empresa', async () => {
  const title = 'Concorrência ' + suffix;
  const create = (n: number) =>
    provision({
      name: title,
      owner_name: 'Teste',
      owner_email: `pwa-concurrent-${n}-${suffix}@test.local`,
      password,
    });
  const [one, two] = await Promise.all([create(1), create(2)]);
  expect(new Set([one.slug, two.slug]).size).toBe(2);
  expect([one.slug, two.slug]).toContain('concorrencia-' + suffix);
  expect([one.slug, two.slug]).toContain('concorrencia-' + suffix + '-2');
  const old = one.slug;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`UPDATE establishments SET name=${title + ' Novo'} WHERE id=${one.establishment_id}`,
    );
    await assignSlug(tx, one.tenant_id, one.establishment_id, title + ' Novo');
  });
  const third = await create(3);
  expect(third.slug).not.toBe(old);
  expect((await request('GET', '/api/v1/pwa/resolve/' + old)).json().establishment_id).toBe(
    one.establishment_id,
  );
});
it('rollback conserva nome, slug atual e histórico quando a alteração falha', async () => {
  const previous = await rows(
    db,
    sql`SELECT name,slug FROM establishments WHERE id=${a.establishment_id}`,
  );
  const target = 'Rollback ' + suffix;
  await expect(
    atomic(a.actor, randomUUID(), 'test.pwa-rollback', {}, async (s) => {
      await s.tx.execute(
        sql`UPDATE establishments SET name=${target} WHERE id=${a.establishment_id}`,
      );
      await assignSlug(s.tx, a.tenant_id, a.establishment_id, target);
      throw new Error('Falha simulada');
    }),
  ).rejects.toThrow('Falha simulada');
  expect(
    await rows(db, sql`SELECT name,slug FROM establishments WHERE id=${a.establishment_id}`),
  ).toEqual(previous);
  const current = await rows(
    db,
    sql`SELECT slug FROM tenant_slugs WHERE establishment_id=${a.establishment_id} AND is_current=TRUE`,
  );
  expect(current).toHaveLength(1);
  expect(current[0].slug).toBe(a.slug);
  expect(
    await rows(db, sql`SELECT id FROM tenant_slugs WHERE slug=${'rollback-' + suffix}`),
  ).toHaveLength(0);
});
it('nega contexto cruzado, edição manual de slug e elevação de acesso pelo endereço público', async () => {
  const headers = { 'X-Mesa-Establishment': b.establishment_id };
  expect((await request('GET', '/api/v1/orders', undefined, tokenA, headers)).statusCode).toBe(403);
  expect(
    (await request('PATCH', '/api/v1/settings', { name: 'Intruso' }, tokenA, headers)).statusCode,
  ).toBe(403);
  expect((await request('PATCH', '/api/v1/settings', { slug: 'manual' })).statusCode).toBe(400);
  expect(
    (await request('POST', '/api/v1/establishments', { name: 'Nova', slug: 'manual' })).statusCode,
  ).toBe(400);
  const fresh = await login(a, `pwa-a-${suffix}@test.local`);
  expect(
    (
      await request(
        'POST',
        '/api/v1/auth/refresh',
        { refresh_token: fresh.refresh_token },
        '',
        headers,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request('POST', '/api/v1/auth/refresh', { refresh_token: fresh.refresh_token }, '', {
        'X-Mesa-Establishment': a.establishment_id,
      })
    ).statusCode,
  ).toBe(200);
  expect((await request('GET', '/api/v1/pwa/resolve/' + b.slug)).json().name).toBe(
    'Outro PWA ' + suffix,
  );
  expect(
    (
      await request('GET', '/api/v1/staff', undefined, tokenB, {
        'X-Mesa-Establishment': a.establishment_id,
      })
    ).statusCode,
  ).toBe(403);
});
it('personaliza manifest e gera quatro ícones PNG com margem maskable, sem expor o arquivo na auditoria', async () => {
  const image = fallbackIcon('#aa3300', 512).toString('base64');
  const r = await request('PATCH', '/api/v1/settings/pwa', {
    short_name: 'João PWA',
    primary_color: '#112233',
    background_color: '#eeeeee',
    icon_base64: image,
  });
  expect(r.statusCode, r.body).toBe(200);
  const identity = r.json();
  expect(identity.short_name).toBe('João PWA');
  for (const size of [32, 180, 192, 512]) {
    const icon = await request(
      'GET',
      `/pwa/assets/${a.establishment_id}/${identity.icon_revision}/${size}.png`,
    );
    expect(icon.statusCode, icon.body).toBe(200);
    expect(PNG.sync.read(icon.rawPayload).width).toBe(size);
  }
  expect(
    (await request('GET', `/pwa/assets/${b.establishment_id}/${identity.icon_revision}/512.png`))
      .statusCode,
  ).toBe(404);
  const manifest = (
    await request('GET', stableBase(a.establishment_id) + 'manifest.webmanifest')
  ).json();
  expect(manifest.theme_color).toBe('#112233');
  expect(manifest.short_name).toBe('João PWA');
  expect(manifest.id).toBe(pwaManifest(identity, 'customer').id);
  const audit = await rows(
    db,
    sql`SELECT metadata FROM audit_logs WHERE establishment_id=${a.establishment_id}`,
  );
  expect(JSON.stringify(audit)).not.toContain(image);
  expect(
    (
      await request('PATCH', '/api/v1/settings/pwa', {
        icon_base64: Buffer.from('<svg/>').toString('base64'),
      })
    ).statusCode,
  ).toBe(400);
});
it('repete a migração e o backfill sem duplicar endereços nem reativar vínculos', async () => {
  const before = await rows(
    db,
    sql`SELECT slug,is_current FROM tenant_slugs WHERE establishment_id=${a.establishment_id} ORDER BY slug`,
  );
  await migrate();
  await db.transaction((tx) => backfillSlugs(tx));
  expect(
    await rows(
      db,
      sql`SELECT slug,is_current FROM tenant_slugs WHERE establishment_id=${a.establishment_id} ORDER BY slug`,
    ),
  ).toEqual(before);
  await db.execute(sql`UPDATE tenants SET enabled=FALSE WHERE id=${b.tenant_id}`);
  try {
    expect((await request('GET', '/api/v1/pwa/resolve/' + b.slug)).statusCode).toBe(404);
    expect(
      (await request('GET', '/api/v1/auth/establishments', undefined, ''))
        .json()
        .some((company: any) => company.slug === b.slug),
    ).toBe(false);
  } finally {
    await db.execute(sql`UPDATE tenants SET enabled=TRUE WHERE id=${b.tenant_id}`);
  }
});
