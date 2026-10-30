import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { buildApp } from '../../apps/api/src/app.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { provision } from '../../packages/database/src/provision.js';
import { pool, db, rows, sql } from '../../packages/database/src/index.js';
let app: Awaited<ReturnType<typeof buildApp>>,
  fixture: Awaited<ReturnType<typeof provision>>,
  other: typeof fixture,
  token: string,
  otherToken: string,
  waiter: string;
const suffix = randomUUID().slice(0, 8),
  password = 'PhotoTestPassword1!';
const image = (r = 70) => {
  const photo = new PNG({ width: 320, height: 160 });
  for (let i = 0; i < photo.data.length; i += 4) {
    photo.data[i] = r;
    photo.data[i + 1] = 90;
    photo.data[i + 2] = 150;
    photo.data[i + 3] = 255;
  }
  return PNG.sync.write(photo).toString('base64');
};
async function req(
  method: string,
  path: string,
  payload?: unknown,
  auth = token,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: '/api/v1' + path,
    headers: { ...(auth ? { authorization: 'Bearer ' + auth } : {}), 'Idempotency-Key': key },
    ...(payload === undefined ? {} : { payload: payload as any }),
  });
}
async function call(method: string, path: string, payload?: unknown, auth = token) {
  const response = await req(method, path, payload, auth);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
const pathFor = (product: any, unit = fixture.establishment_id, file = 'photo.png') =>
  '/product-photos/' + [unit, product.id, product.photo_revision, file].join('/');
beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Banco isolado obrigatório.');
  await migrate();
  fixture = await provision({
    name: 'Fotos ' + suffix,
    owner_name: 'Admin',
    owner_email: 'photos-' + suffix + '@test.local',
    password,
    demo: true,
  });
  other = await provision({
    name: 'Outra filial ' + suffix,
    owner_name: 'Admin',
    owner_email: 'photos-other-' + suffix + '@test.local',
    password,
  });
  app = await buildApp({ realtime: false, logger: false });
  await app.ready();
  token = (
    await call(
      'POST',
      '/auth/login',
      { email: 'photos-' + suffix + '@test.local', password, establishment_slug: fixture.slug },
      '',
    )
  ).token;
  otherToken = (
    await call(
      'POST',
      '/auth/login',
      { email: 'photos-other-' + suffix + '@test.local', password, establishment_slug: other.slug },
      '',
    )
  ).token;
  await call('POST', '/staff', {
    name: 'Garçom',
    email: 'photos-waiter-' + suffix + '@test.local',
    password,
    role_id: fixture.roles.find((role) => role.name === 'Garçom')!.id,
  });
  waiter = (
    await call(
      'POST',
      '/auth/login',
      {
        email: 'photos-waiter-' + suffix + '@test.local',
        password,
        establishment_slug: fixture.slug,
      },
      '',
    )
  ).token;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it('salva foto e miniatura na criação, publica os metadados sem binário e mantém idempotência', async () => {
  const key = randomUUID(),
    body = {
      name: 'Produto com foto',
      price: '12.00',
      stock_policy: 'NO_CONTROL',
      photo_base64: image(),
    };
  const response = await req('POST', '/products', body, token, key);
  expect(response.statusCode, response.body).toBe(200);
  const product = response.json();
  expect(product.photo_revision).toMatch(/^[a-f0-9]{64}$/);
  expect(product.photo_base64).toBeUndefined();
  expect((await req('POST', '/products', body, token, key)).json()).toEqual(product);
  const photo = await req('GET', pathFor(product), undefined, '');
  expect(photo.statusCode).toBe(200);
  expect(photo.headers['content-type']).toBe('image/png');
  expect(photo.headers['cache-control']).toContain('immutable');
  expect(PNG.sync.read(photo.rawPayload).width).toBe(320);
  const thumbnail = await req(
    'GET',
    pathFor(product, fixture.establishment_id, 'thumbnail.png'),
    undefined,
    '',
  );
  const decoded = PNG.sync.read(thumbnail.rawPayload);
  expect([decoded.width, decoded.height]).toEqual([160, 80]);
  const menu = await call('GET', '/public/' + fixture.slug + '/menu', undefined, '');
  expect(menu.products.find((p: any) => p.id === product.id).photo_revision).toBe(
    product.photo_revision,
  );
  expect(JSON.stringify(menu)).not.toContain('photo_base64');
  expect(
    (await req('PATCH', '/products/' + product.id, { photo_base64: image(100) }, otherToken))
      .statusCode,
  ).toBe(404);
  expect(
    (await req('PATCH', '/products/' + product.id, { photo_base64: image(100) }, waiter))
      .statusCode,
  ).toBe(403);
  expect(
    (await req('GET', pathFor(product, other.establishment_id), undefined, '')).statusCode,
  ).toBe(404);
});
it('troca e remove a foto sem afetar outros dados e sem guardar imagens antigas', async () => {
  const product = await call('POST', '/products', {
    name: 'Troca de foto',
    price: '9.00',
    stock_policy: 'NO_CONTROL',
    photo_base64: image(),
  });
  const unchanged = await call('PATCH', '/products/' + product.id, { name: 'Novo nome' });
  expect(unchanged.photo_revision).toBe(product.photo_revision);
  const replacement = await call('PATCH', '/products/' + product.id, { photo_base64: image(120) });
  expect(replacement.photo_revision).not.toBe(product.photo_revision);
  expect((await req('GET', pathFor(product), undefined, '')).statusCode).toBe(404);
  expect((await req('GET', pathFor(replacement), undefined, '')).statusCode).toBe(200);
  const removed = await call('PATCH', '/products/' + product.id, { photo_base64: null });
  expect(removed).toMatchObject({ name: 'Novo nome', price: '9.00', photo_revision: null });
  expect((await req('GET', pathFor(replacement), undefined, '')).statusCode).toBe(404);
  expect(
    await rows(db, sql`SELECT product_id FROM product_photos WHERE product_id=${product.id}`),
  ).toHaveLength(0);
});
it('rejeita arquivos inválidos, dimensões e payload excessivos com rollback de todo o cadastro', async () => {
  const product = await call('POST', '/products', {
    name: 'Preservado',
    price: '5.00',
    stock_policy: 'NO_CONTROL',
    photo_base64: image(),
  });
  const invalid = [
    Buffer.from('<svg>' + 'a'.repeat(60) + '</svg>').toString('base64'),
    image().slice(0, -20),
    PNG.sync.write(new PNG({ width: 1025, height: 1 })).toString('base64'),
  ];
  for (const photo_base64 of invalid) {
    const response = await req('PATCH', '/products/' + product.id, {
      name: 'Não deve salvar',
      photo_base64,
    });
    expect(response.statusCode, response.body).toBe(400);
  }
  expect((await call('GET', '/products/' + product.id + '/management')).product).toMatchObject({
    name: 'Preservado',
    photo_revision: product.photo_revision,
  });
  expect(
    (
      await req('POST', '/products', {
        name: 'Inválido',
        price: '1.00',
        stock_policy: 'NO_CONTROL',
        photo_base64: invalid[0],
      })
    ).statusCode,
  ).toBe(400);
  expect((await call('GET', '/products')).some((p: any) => p.name === 'Inválido')).toBe(false);
  expect(
    (await req('PATCH', '/products/' + product.id, { photo_base64: 'a'.repeat(2100001) }))
      .statusCode,
  ).toBe(413);
  expect(
    (await req('PATCH', '/products/' + product.id, { photo_revision: 'a'.repeat(64) })).statusCode,
  ).toBe(400);
});
