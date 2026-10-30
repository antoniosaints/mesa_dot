import { PNG } from 'pngjs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ensure } from '../../../packages/shared/src/index.js';
import { rows, sql, type Scope, type Executor } from '../../../packages/database/src/index.js';
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function normalizePwaIcon(encoded: string) {
  const bytes = Buffer.from(encoded, 'base64');
  ensure(
    bytes.length <= 1500000 && bytes.length > 32 && bytes.subarray(0, 8).equals(signature),
    'BAD_REQUEST',
    'Envie uma imagem PNG válida de até 1,5 MB.',
    400,
  );
  ensure(
    bytes.readUInt32BE(16) === 512 && bytes.readUInt32BE(20) === 512,
    'BAD_REQUEST',
    'O ícone deve ter 512 × 512 pixels.',
    400,
  );
  ensure(
    bytes[24] === 8 && [2, 6].includes(bytes[25]) && bytes[28] === 0,
    'BAD_REQUEST',
    'Converta a imagem para PNG RGB de 8 bits sem entrelaçamento.',
    400,
  );
  try {
    const compressed: Buffer[] = [];
    let pos = 8;
    while (pos + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(pos);
      if (pos + length + 12 > bytes.length) throw new Error('PNG truncado');
      if (bytes.toString('ascii', pos + 4, pos + 8) === 'IDAT')
        compressed.push(bytes.subarray(pos + 8, pos + 8 + length));
      pos += length + 12;
    }
    inflateSync(Buffer.concat(compressed), { maxOutputLength: 512 * (512 * 4 + 1) });
    const image = PNG.sync.read(bytes, { checkCRC: true });
    return { image, png: PNG.sync.write(image) };
  } catch {
    ensure(false, 'BAD_REQUEST', 'Não foi possível ler o PNG.', 400);
    throw new Error('PNG inválido');
  }
}
function resize(image: PNG, size: number) {
  const target = new PNG({ width: size, height: size });
  // Area sampling keeps small logos and text clear when generating the smaller icons.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * image.width) / size),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / size));
      const y0 = Math.floor((y * image.height) / size),
        y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / size));
      const sums = [0, 0, 0, 0];
      let count = 0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          for (let c = 0; c < 4; c++) sums[c] += image.data[(sy * image.width + sx) * 4 + c];
          count++;
        }
      for (let c = 0; c < 4; c++) target.data[(y * size + x) * 4 + c] = Math.round(sums[c] / count);
    }
  return PNG.sync.write(target);
}
export async function savePwaIcon(s: Scope, encoded: string) {
  const { image } = normalizePwaIcon(encoded);
  const settings = await rows(
    s.tx,
    sql`SELECT background_color FROM establishment_pwa_settings WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${s.actor.establishmentId}`,
  );
  const background = settings[0]?.background_color ?? '#ffffff',
    rgb = [1, 3, 5].map((p) => parseInt(background.slice(p, p + 2), 16));
  const art = PNG.sync.read(resize(image, 280)),
    frame = new PNG({ width: 512, height: 512 });
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const dst = (y * 512 + x) * 4,
        inside = x >= 116 && x < 396 && y >= 116 && y < 396,
        src = ((y - 116) * 280 + x - 116) * 4,
        alpha = inside ? art.data[src + 3] / 255 : 0;
      for (let c = 0; c < 3; c++)
        frame.data[dst + c] = Math.round(
          (inside ? art.data[src + c] : 0) * alpha + rgb[c] * (1 - alpha),
        );
      frame.data[dst + 3] = 255;
    }
  const png = PNG.sync.write(frame),
    revision = createHash('sha256').update(png).digest('hex');
  for (const size of [32, 180, 192, 512])
    await s.tx.execute(
      sql`INSERT IGNORE INTO pwa_icons(tenant_id,establishment_id,revision,size,png) VALUES(${s.actor.tenantId},${s.actor.establishmentId},${revision},${size},${size === 512 ? png : resize(frame, size)})`,
    );
  await s.tx.execute(
    sql`INSERT INTO establishment_pwa_settings(tenant_id,establishment_id,icon_revision) VALUES(${s.actor.tenantId},${s.actor.establishmentId},${revision}) ON DUPLICATE KEY UPDATE icon_revision=VALUES(icon_revision)`,
  );
  await s.audit('pwa.icon_updated', s.actor.establishmentId, { revision });
  return { revision };
}
export function fallbackRevision(primary: string, background: string) {
  return 'default-' + primary.slice(1).toLowerCase() + '-' + background.slice(1).toLowerCase();
}
export function fallbackIcon(primary: string, size: number) {
  const image = new PNG({ width: 512, height: 512 }),
    rgb = [1, 3, 5].map((p) => parseInt(primary.slice(p, p + 2), 16));
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const line =
        (x >= 116 && x <= 396 && ((y >= 116 && y <= 132) || (y >= 380 && y <= 396))) ||
        (y >= 116 && y <= 396 && ((x >= 116 && x <= 132) || (x >= 380 && x <= 396))) ||
        (x >= 124 && x <= 388 && y >= 204 && y <= 220) ||
        (x >= 204 && x <= 220 && y >= 212 && y <= 388);
      const offset = (y * 512 + x) * 4;
      for (let c = 0; c < 3; c++) image.data[offset + c] = line ? 255 : rgb[c];
      image.data[offset + 3] = 255;
    }
  return size === 512 ? PNG.sync.write(image) : resize(image, size);
}
export async function iconBytes(
  tx: Executor,
  tenant: string,
  unit: string,
  revision: string,
  size: number,
) {
  const stored = await rows(
    tx,
    sql`SELECT png FROM pwa_icons WHERE tenant_id=${tenant} AND establishment_id=${unit} AND revision=${revision} AND size=${size}`,
  );
  return stored[0]?.png as Buffer | undefined;
}
