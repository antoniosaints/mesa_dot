import { randomUUID } from 'node:crypto';
import { rows, sql, type Executor } from './index.js';
import { ensure } from '../../shared/src/index.js';
import { slugBase, slugCandidate, reservedSlugs } from '../../shared/src/slug.js';
function duplicate(error: unknown) {
  const e = error as any;
  return (e.cause ?? e).code === 'ER_DUP_ENTRY';
}
export async function reserveLegacySlug(tx: Executor, tenant: string, unit: string, slug: string) {
  ensure(/^[a-z0-9-]{1,80}$/.test(slug), 'BAD_REQUEST', 'Endereço legado inválido.', 400);
  try {
    await tx.execute(
      sql`INSERT INTO tenant_slugs(id,tenant_id,establishment_id,slug,is_current) VALUES(${randomUUID()},${tenant},${unit},${slug},FALSE)`,
    );
  } catch (e) {
    if (!duplicate(e)) throw e;
    const found = await rows(tx, sql`SELECT establishment_id FROM tenant_slugs WHERE slug=${slug}`);
    ensure(
      found[0]?.establishment_id === unit,
      'CONFLICT',
      'Este endereço já pertence a outro estabelecimento.',
    );
  }
}
/** Caller must be in a transaction. The immutable unit row serializes its own renames. */
export async function assignSlug(tx: Executor, tenant: string, unit: string, name: string) {
  const target = await rows(
    tx,
    sql`SELECT slug FROM establishments WHERE tenant_id=${tenant} AND id=${unit} FOR UPDATE`,
  );
  ensure(target.length, 'NOT_FOUND', 'Estabelecimento não encontrado.', 404);
  const base = slugBase(name);
  for (let index = 1; index <= 10000; index++) {
    const candidate = slugCandidate(base, index);
    if (reservedSlugs.has(candidate)) continue;
    try {
      await tx.execute(
        sql`INSERT INTO tenant_slugs(id,tenant_id,establishment_id,slug,is_current) VALUES(${randomUUID()},${tenant},${unit},${candidate},FALSE)`,
      );
    } catch (e) {
      if (!duplicate(e)) throw e;
      const previous = await rows(
        tx,
        sql`SELECT establishment_id FROM tenant_slugs WHERE slug=${candidate}`,
      );
      if (previous[0]?.establishment_id !== unit) continue;
    }
    await tx.execute(
      sql`UPDATE tenant_slugs SET is_current=FALSE,retired_at=UTC_TIMESTAMP(3) WHERE tenant_id=${tenant} AND establishment_id=${unit} AND is_current=TRUE AND slug<>${candidate}`,
    );
    await tx.execute(
      sql`UPDATE tenant_slugs SET is_current=TRUE,retired_at=NULL WHERE tenant_id=${tenant} AND establishment_id=${unit} AND slug=${candidate}`,
    );
    await tx.execute(
      sql`UPDATE establishments SET slug=${candidate} WHERE tenant_id=${tenant} AND id=${unit}`,
    );
    return { slug: candidate, previous_slug: target[0].slug };
  }
  throw new Error('Não foi possível reservar um endereço exclusivo.');
}
export async function backfillSlugs(tx: Executor) {
  const units = await rows(
    tx,
    sql`SELECT id,tenant_id,name,slug FROM establishments ORDER BY created_at,id`,
  );
  // Reserve every existing address before allocating any name-derived address.
  for (const unit of units) await reserveLegacySlug(tx, unit.tenant_id, unit.id, unit.slug);
  for (const unit of units) await assignSlug(tx, unit.tenant_id, unit.id, unit.name);
}
export async function resolveUnit(tx: Executor, slug: string) {
  const found = await rows(
    tx,
    sql`SELECT e.*,p.short_name pwa_short_name,p.background_color pwa_background_color,p.icon_revision pwa_icon_revision
    FROM tenant_slugs a JOIN establishments e ON e.id=a.establishment_id AND e.tenant_id=a.tenant_id JOIN tenants t ON t.id=e.tenant_id
    LEFT JOIN establishment_pwa_settings p ON p.tenant_id=e.tenant_id AND p.establishment_id=e.id
    WHERE a.slug=${slug} AND t.enabled=TRUE AND t.is_platform=FALSE`,
  );
  ensure(found.length, 'NOT_FOUND', 'Estabelecimento não encontrado.', 404);
  return found[0];
}
export async function resolveUnitId(tx: Executor, id: string) {
  const found = await rows(
    tx,
    sql`SELECT e.*,p.short_name pwa_short_name,p.background_color pwa_background_color,p.icon_revision pwa_icon_revision
    FROM establishments e JOIN tenants t ON t.id=e.tenant_id LEFT JOIN establishment_pwa_settings p ON p.tenant_id=e.tenant_id AND p.establishment_id=e.id WHERE e.id=${id} AND t.enabled=TRUE AND t.is_platform=FALSE`,
  );
  ensure(found.length, 'NOT_FOUND', 'Estabelecimento não encontrado.', 404);
  return found[0];
}
