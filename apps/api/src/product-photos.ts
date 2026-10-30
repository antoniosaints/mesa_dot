import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { db, rows, sql, type Scope } from '../../../packages/database/src/index.js';
import { resolveUnitId } from '../../../packages/database/src/slugs.js';
import { ensure } from '../../../packages/shared/src/index.js';

export const productPhotoSchema = z.string().min(40).max(2000000).nullable().optional();
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function normalizeProductPhoto(encoded: string) {
  const bytes = Buffer.from(encoded, 'base64');
  ensure(
    /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) &&
      bytes.length > 32 &&
      bytes.length <= 1500000 &&
      bytes.subarray(0, 8).equals(signature),
    'BAD_REQUEST',
    'Envie uma foto PNG válida de até 1,5 MB.',
    400,
  );
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  ensure(
    width > 0 &&
      height > 0 &&
      width <= 1024 &&
      height <= 1024 &&
      bytes[24] === 8 &&
      [2, 6].includes(bytes[25]) &&
      bytes[28] === 0,
    'BAD_REQUEST',
    'A foto deve ser PNG RGB de 8 bits, sem entrelaçamento, com até 1024 × 1024 pixels.',
    400,
  );
  try {
    const compressed: Buffer[] = [];
    let position = 8;
    let headerSeen = false;
    while (position + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(position);
      if (position + length + 12 > bytes.length) throw new Error('PNG truncado');
      const type = bytes.toString('ascii', position + 4, position + 8);
      if (type === 'IHDR') {
        if (headerSeen || position !== 8 || length !== 13)
          throw new Error('Cabeçalho PNG inválido');
        headerSeen = true;
      }
      if (!headerSeen) throw new Error('Cabeçalho PNG ausente');
      if (type === 'IDAT') compressed.push(bytes.subarray(position + 8, position + 8 + length));
      position += length + 12;
    }
    if (!headerSeen) throw new Error('Cabeçalho PNG ausente');
    inflateSync(Buffer.concat(compressed), { maxOutputLength: height * (width * 4 + 1) });
    const photo = PNG.sync.read(bytes, { checkCRC: true });
    const scale = Math.min(1, 160 / Math.max(width, height));
    const thumbnail = new PNG({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    });
    for (let y = 0; y < thumbnail.height; y++)
      for (let x = 0; x < thumbnail.width; x++) {
        const sx = Math.min(width - 1, (x + 0.5) / scale - 0.5),
          sy = Math.min(height - 1, (y + 0.5) / scale - 0.5);
        const x0 = Math.floor(sx),
          y0 = Math.floor(sy),
          dx = sx - x0,
          dy = sy - y0;
        for (let c = 0; c < 4; c++) {
          const pixel = (px: number, py: number) =>
            photo.data[(Math.min(height - 1, py) * width + Math.min(width - 1, px)) * 4 + c];
          thumbnail.data[(y * thumbnail.width + x) * 4 + c] = Math.round(
            pixel(x0, y0) * (1 - dx) * (1 - dy) +
              pixel(x0 + 1, y0) * dx * (1 - dy) +
              pixel(x0, y0 + 1) * (1 - dx) * dy +
              pixel(x0 + 1, y0 + 1) * dx * dy,
          );
        }
      }
    const png = PNG.sync.write(photo);
    return {
      png,
      thumbnail: PNG.sync.write(thumbnail),
      revision: createHash('sha256').update(png).digest('hex'),
    };
  } catch {
    ensure(false, 'BAD_REQUEST', 'Não foi possível ler a foto. Escolha outra imagem.', 400);
    throw new Error('Foto inválida');
  }
}
export async function saveProductPhoto(s: Scope, product: string, encoded: string | null) {
  await s.get('products', product);
  if (encoded === null) {
    await s.tx.execute(
      sql`DELETE FROM product_photos WHERE ${s.where(sql`product_id=${product}`)}`,
    );
    await s.update('products', product, { photo_revision: null });
    return;
  }
  const photo = normalizeProductPhoto(encoded);
  await s.tx
    .execute(sql`INSERT INTO product_photos(tenant_id,establishment_id,product_id,revision,png,thumbnail)
    VALUES(${s.actor.tenantId},${s.actor.establishmentId},${product},${photo.revision},${photo.png},${photo.thumbnail})
    ON DUPLICATE KEY UPDATE revision=${photo.revision},png=${photo.png},thumbnail=${photo.thumbnail}`);
  await s.update('products', product, { photo_revision: photo.revision });
}
export function registerProductPhotos(app: FastifyInstance) {
  app.get('/api/v1/product-photos/:unit/:product/:revision/:file', async (request, reply) => {
    const params = z
      .object({
        unit: z.uuid(),
        product: z.uuid(),
        revision: z.string().regex(/^[a-f0-9]{64}$/),
        file: z.enum(['thumbnail.png', 'photo.png']),
      })
      .parse(request.params);
    const unit = await resolveUnitId(db, params.unit);
    const photos = await rows(
      db,
      sql`SELECT ${sql.identifier(params.file === 'thumbnail.png' ? 'thumbnail' : 'png')} AS image FROM product_photos
      WHERE tenant_id=${unit.tenant_id} AND establishment_id=${unit.id} AND product_id=${params.product} AND revision=${params.revision}`,
    );
    ensure(photos.length, 'NOT_FOUND', 'Foto não encontrada.', 404);
    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .type('image/png')
      .send(photos[0].image);
  });
}
