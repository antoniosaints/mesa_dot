import { sql, type Scope } from '../../../packages/database/src/index.js';
import { ensure, permit, quantity, formatDecimal } from '../../../packages/shared/src/index.js';
import { changeStock } from './inventory.js';
export async function initializeProductStock(
  s: Scope,
  productId: string,
  input: { location_id: string; quantity: string; use_for_consumption: boolean },
) {
  permit(s.actor, 'catalog.manage');
  const product = await s.get('products', productId, true);
  await s.get('stock_locations', input.location_id);
  const existing = await s.list(
    'stock_balances',
    sql`product_id=${productId} AND location_id=${input.location_id} AND variant_id IS NULL`,
  );
  const balance =
    existing[0] ??
    (await s.insert('stock_balances', {
      product_id: productId,
      location_id: input.location_id,
      variant_id: null,
    }));
  ensure(
    !existing.length ||
      (balance.physical_quantity === '0.000' &&
        balance.reserved_quantity === '0.000' &&
        !(await s.list('stock_movements', sql`balance_id=${balance.id}`)).length),
    'CONFLICT',
    'Este estoque já foi movimentado. Use a ação Movimentar para alterar o saldo.',
    409,
  );
  const value = quantity(input.quantity);
  if (value > 0n)
    await changeStock(
      s,
      balance.id,
      value,
      0n,
      'COUNT',
      'initial-stock:' + balance.id,
      null,
      'Saldo inicial no cadastro do produto',
    );
  if (input.use_for_consumption) {
    ensure(
      product.stock_policy !== 'RECIPE',
      'BAD_REQUEST',
      'Produtos com ficha técnica usam o estoque dos ingredientes.',
      400,
    );
    await s.update('products', productId, { stock_location_id: input.location_id });
    await s.audit('products.updated', productId, {
      fields: ['stock_location_id'],
      source: 'initial-stock',
    });
    await s.event('products.updated', productId);
  }
  await s.audit('stock.initialized', balance.id, {
    product_id: productId,
    location_id: input.location_id,
    quantity: formatDecimal(value, 3),
  });
  if (value === 0n) await s.event('stock.updated', balance.id);
  return s.get('stock_balances', balance.id);
}
