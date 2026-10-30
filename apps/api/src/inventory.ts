import { sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure, quantity, formatDecimal } from '../../../packages/shared/src/index.js';
export interface Component {
  balance_id: string;
  quantity: string;
}
export async function componentsFor(s: Scope, product: Row, variant?: Row): Promise<Component[]> {
  if (product.stock_policy === 'NO_CONTROL') return [];
  async function sourceLocation(explicit?: string) {
    if (explicit) {
      await s.get('stock_locations', explicit);
      return explicit;
    }
    const locations = await s.list('stock_locations', sql`is_default=TRUE`);
    ensure(locations.length === 1, 'INVALID_STATE', 'Configure um local padrão de estoque.');
    return locations[0].id;
  }
  let ingredients = [{ ingredient_id: product.id, quantity: '1.000' }];
  if (product.stock_policy === 'RECIPE') {
    const recipes = await s.list('recipes', sql`product_id=${product.id}`);
    ensure(recipes.length === 1, 'INVALID_STATE', 'Produto sem ficha técnica.');
    ingredients = (await s.list(
      'recipe_items',
      sql`recipe_id=${recipes[0].id}`,
    )) as typeof ingredients;
    ensure(ingredients.length, 'INVALID_STATE', 'Ficha técnica vazia.');
  }
  const result: Component[] = [];
  for (const item of ingredients) {
    const own = product.stock_policy !== 'RECIPE' && variant?.stock_mode === 'OWN';
    const ingredient =
      product.stock_policy === 'RECIPE' ? await s.get('products', item.ingredient_id) : product;
    const location = await sourceLocation(
      (own ? variant?.stock_location_id : null) ||
        ingredient.stock_location_id ||
        product.stock_location_id,
    );
    const balances = await s.list(
      'stock_balances',
      sql`location_id=${location} AND product_id=${item.ingredient_id} AND ${own ? sql`variant_id=${variant!.id}` : sql`variant_id IS NULL`}`,
    );
    ensure(balances.length === 1, 'OUT_OF_STOCK', 'Produto sem saldo de estoque cadastrado.');
    result.push({ balance_id: balances[0].id, quantity: item.quantity });
  }
  return result.sort((a, b) => a.balance_id.localeCompare(b.balance_id));
}
export async function changeStock(
  s: Scope,
  balanceId: string,
  physicalDelta: bigint,
  reservedDelta: bigint,
  type: string,
  source: string,
  ticketId: string | null,
  reason: string,
) {
  const balance = await s.get('stock_balances', balanceId, true);
  const physical = quantity(balance.physical_quantity) + physicalDelta;
  const reserved = quantity(balance.reserved_quantity) + reservedDelta;
  ensure(
    physical >= 0n && reserved >= 0n && physical >= reserved,
    'OUT_OF_STOCK',
    'Estoque disponível insuficiente.',
  );
  await s.update('stock_balances', balance.id, {
    physical_quantity: formatDecimal(physical, 3),
    reserved_quantity: formatDecimal(reserved, 3),
    version: balance.version + 1,
  });
  await s.insert('stock_movements', {
    balance_id: balance.id,
    ticket_id: ticketId,
    quantity: formatDecimal(physicalDelta || reservedDelta, 3),
    type,
    source_key: source,
    created_by: s.actor.id,
    reason,
  });
  await s.event('stock.updated', balance.id, {}, balance.version + 1);
}
export async function holdOrder(s: Scope, order: Row) {
  await expireHolds(s);
  const old = await s.list('checkout_holds', sql`order_id=${order.id} AND status='HELD'`);
  if (old.length) return;
  const totals = new Map<string, bigint>();
  for (const item of await s.list('order_items', sql`order_id=${order.id}`)) {
    for (const component of item.stock_components as Component[])
      totals.set(
        component.balance_id,
        (totals.get(component.balance_id) ?? 0n) +
          quantity(component.quantity) * BigInt(item.quantity),
      );
  }
  for (const [id, value] of [...totals.entries()].sort()) {
    const existing = await s.list('checkout_holds', sql`order_id=${order.id} AND balance_id=${id}`);
    ensure(!existing.length, 'INVALID_STATE', 'Checkout expirado: crie um novo pedido.');
    const hold = await s.insert('checkout_holds', {
      order_id: order.id,
      balance_id: id,
      quantity: formatDecimal(value, 3),
      expires_at: new Date(Date.now() + 10 * 60_000),
      status: 'HELD',
    });
    await changeStock(
      s,
      id,
      0n,
      value,
      'CHECKOUT_HOLD',
      `hold:${hold.id}`,
      null,
      'Reserva temporária de checkout',
    );
  }
  await s.update('orders', order.id, { checkout_expires_at: new Date(Date.now() + 10 * 60_000) });
}
export async function releaseHolds(
  s: Scope,
  orderId: string,
  status: 'CONSUMED' | 'RELEASED' | 'EXPIRED',
) {
  for (const hold of await s.list('checkout_holds', sql`order_id=${orderId} AND status='HELD'`)) {
    await changeStock(
      s,
      hold.balance_id,
      0n,
      -quantity(hold.quantity),
      'CHECKOUT_RELEASE',
      `hold-release:${hold.id}`,
      null,
      'Fim da reserva temporária',
    );
    await s.update('checkout_holds', hold.id, { status });
  }
}
export async function expireHolds(s: Scope) {
  const holds = await s.list('checkout_holds', sql`status='HELD' AND expires_at<UTC_TIMESTAMP(3)`);
  for (const hold of holds) await releaseHolds(s, hold.order_id, 'EXPIRED');
}
export async function reserveTicket(s: Scope, ticket: Row, item: Row) {
  for (const component of item.stock_components as Component[]) {
    const value = quantity(component.quantity);
    await changeStock(
      s,
      component.balance_id,
      0n,
      value,
      'RESERVE',
      `reserve:${ticket.id}:${component.balance_id}`,
      ticket.id,
      'Confirmação de pedido',
    );
    await s.insert('stock_reservations', {
      ticket_id: ticket.id,
      balance_id: component.balance_id,
      quantity: component.quantity,
      status: 'RESERVED',
    });
  }
  if (item.stock_policy_snapshot === 'ON_CONFIRMATION') await consumeTicketStock(s, ticket.id);
}
export async function consumeTicketStock(s: Scope, ticketId: string) {
  for (const reservation of await s.list(
    'stock_reservations',
    sql`ticket_id=${ticketId} AND status='RESERVED'`,
  )) {
    const value = quantity(reservation.quantity);
    await changeStock(
      s,
      reservation.balance_id,
      -value,
      -value,
      'CONSUMPTION',
      `consume:${reservation.id}`,
      ticketId,
      'Baixa física da ficha',
    );
    await s.update('stock_reservations', reservation.id, { status: 'CONSUMED' });
  }
}
export async function cancelTicketStock(s: Scope, ticketId: string) {
  for (const reservation of await s.list('stock_reservations', sql`ticket_id=${ticketId}`)) {
    if (reservation.status === 'RELEASED') continue;
    const value = quantity(reservation.quantity);
    await changeStock(
      s,
      reservation.balance_id,
      reservation.status === 'CONSUMED' ? value : 0n,
      reservation.status === 'RESERVED' ? -value : 0n,
      'CANCELLATION',
      `cancel:${reservation.id}`,
      ticketId,
      'Compensação de cancelamento',
    );
    await s.update('stock_reservations', reservation.id, { status: 'RELEASED' });
  }
}
