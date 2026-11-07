import { sql, type Scope } from '../../../packages/database/src/index.js';
import { ensure, permit } from '../../../packages/shared/src/index.js';

/** Relabel the same stock record, preserving every reservation and order reference. */
export async function changeStockLocation(
  s: Scope,
  id: string,
  input: { location_id: string; version: number },
) {
  permit(s.actor, 'inventory.adjust');
  const balance = await s.get('stock_balances', id, true);
  const destination = await s.get('stock_locations', input.location_id);
  ensure(
    balance.version === input.version,
    'CONFLICT',
    'O estoque mudou. Atualize os dados e tente novamente.',
    409,
  );
  if (balance.location_id === destination.id) return balance;
  const duplicate = await s.list(
    'stock_balances',
    sql`location_id=${destination.id} AND product_id=${balance.product_id} AND ${balance.variant_id ? sql`variant_id=${balance.variant_id}` : sql`variant_id IS NULL`}`,
  );
  ensure(
    !duplicate.length,
    'CONFLICT',
    'O destino já possui estoque deste produto e variação. Escolha outro local para manter os saldos separados.',
    409,
  );
  const product = await s.get('products', balance.product_id, true);
  const defaults = await s.list('stock_locations', sql`is_default=TRUE`);
  const productSource =
    product.stock_location_id || (defaults.length === 1 ? defaults[0].id : null);
  let consumptionUpdated = false;
  // A move must not make future orders look for the same stock in the old place.
  if (
    product.stock_policy !== 'RECIPE' &&
    !balance.variant_id &&
    productSource === balance.location_id
  ) {
    // Own variants inheriting the product's old source retain their own origin.
    for (const variant of await s.list(
      'product_variants',
      sql`product_id=${product.id} AND stock_mode='OWN' AND stock_location_id IS NULL AND deleted_at IS NULL`,
    ))
      await s.update('product_variants', variant.id, { stock_location_id: balance.location_id });
    await s.update('products', product.id, { stock_location_id: destination.id });
    consumptionUpdated = true;
  } else if (product.stock_policy !== 'RECIPE' && balance.variant_id) {
    const variant = await s.get('product_variants', balance.variant_id, true);
    if (
      variant.stock_mode === 'OWN' &&
      (variant.stock_location_id || productSource) === balance.location_id
    ) {
      await s.update('product_variants', variant.id, { stock_location_id: destination.id });
      consumptionUpdated = true;
    }
  }
  // Preserve the origin of old records, including writes from a rolling deployment.
  await s.tx.execute(
    sql`UPDATE stock_movements SET location_id=${balance.location_id} WHERE ${s.where(sql`balance_id=${balance.id} AND location_id IS NULL`)}`,
  );
  await s.tx.execute(
    sql`UPDATE stock_replenishment_items SET location_id=${balance.location_id} WHERE ${s.where(sql`balance_id=${balance.id} AND location_id IS NULL`)}`,
  );
  await s.update('stock_balances', balance.id, {
    location_id: destination.id,
    version: balance.version + 1,
  });
  await s.audit('stock.location_changed', balance.id, {
    from_location_id: balance.location_id,
    to_location_id: destination.id,
    physical_quantity: balance.physical_quantity,
    reserved_quantity: balance.reserved_quantity,
    consumption_updated: consumptionUpdated,
  });
  await s.event('stock.updated', balance.id, { location_id: destination.id }, balance.version + 1);
  return s.get('stock_balances', balance.id);
}
