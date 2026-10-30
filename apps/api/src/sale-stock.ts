import { type Scope, type Row } from '../../../packages/database/src/index.js';
import { DomainError, ensure, hash, quantity } from '../../../packages/shared/src/index.js';
import type { SaleStock } from '../../../packages/shared/src/sale-stock.js';
import { componentsFor, type Component } from './inventory.js';

export async function saleStockCatalog(s: Scope, products: Row[], variants: Row[]) {
  const balances = new Map(
    (await s.list('stock_balances')).map((balance) => [balance.id, balance]),
  );
  async function stock(product: Row, variant?: Row): Promise<SaleStock> {
    if (product.stock_policy === 'NO_CONTROL')
      return { controlled: false, available: null, constraints: [] };
    try {
      const components = await componentsFor(s, product, variant);
      const totals = new Map<string, bigint>();
      for (const component of components)
        totals.set(
          component.balance_id,
          (totals.get(component.balance_id) ?? 0n) + quantity(component.quantity),
        );
      const constraints = [...totals].map(([id, amount]) => {
        ensure(amount > 0n, 'INVALID_STATE', 'Consumo da ficha técnica inválido.');
        const balance = balances.get(id);
        const available = balance
          ? quantity(balance.physical_quantity) - quantity(balance.reserved_quantity)
          : 0n;
        return {
          key: hash(id),
          remaining: (available > 0n ? available : 0n).toString(),
          per_unit: amount.toString(),
        };
      });
      const available = Math.min(
        ...constraints.map((item) => Number(BigInt(item.remaining) / BigInt(item.per_unit))),
      );
      return {
        controlled: true,
        available: Number.isFinite(available) ? available : 0,
        constraints,
      };
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return {
        controlled: true,
        available: 0,
        constraints: [],
        reason: 'Estoque indisponível ou não configurado.',
      };
    }
  }
  const enriched: Row[] = [];
  for (const product of products) enriched.push({ ...product, stock: await stock(product) });
  const options: Row[] = [];
  for (const variant of variants) {
    const product = enriched.find((item) => item.id === variant.product_id);
    if (product)
      options.push({
        ...variant,
        stock:
          variant.stock_mode === 'OWN' && product.stock_policy !== 'RECIPE'
            ? await stock(product, variant)
            : product.stock,
      });
  }
  return { products: enriched, variants: options };
}

export function visibleSaleCatalog(
  catalog: Awaited<ReturnType<typeof saleStockCatalog>>,
  showOutOfStock: unknown,
) {
  if (showOutOfStock !== false && showOutOfStock !== 0) return catalog;
  const available = (item: Row) => !item.stock.controlled || item.stock.available > 0;
  const products = catalog.products.filter(
    (product) =>
      available(product) ||
      catalog.variants.some((variant) => variant.product_id === product.id && available(variant)),
  );
  const ids = new Set(products.map((product) => product.id));
  return { products, variants: catalog.variants.filter((variant) => ids.has(variant.product_id)) };
}

/** Lock and check aggregate demand, including shared balances across variants and recipes. */
export async function assertSaleStock(s: Scope, items: Row[], orderId?: string) {
  const totals = new Map<string, { amount: bigint; name: string }>();
  for (const item of items)
    for (const component of item.stock_components as Component[]) {
      const previous = totals.get(component.balance_id);
      totals.set(component.balance_id, {
        amount: (previous?.amount ?? 0n) + quantity(component.quantity) * BigInt(item.quantity),
        name: item.name_snapshot,
      });
    }
  const held = new Map<string, bigint>();
  if (orderId) {
    const holds = await s.list('checkout_holds');
    for (const hold of holds.filter((item) => item.order_id === orderId && item.status === 'HELD'))
      held.set(hold.balance_id, (held.get(hold.balance_id) ?? 0n) + quantity(hold.quantity));
  }
  for (const [id, demand] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    const balance = await s.get('stock_balances', id, true);
    ensure(
      quantity(balance.physical_quantity) -
        quantity(balance.reserved_quantity) +
        (held.get(id) ?? 0n) >=
        demand.amount,
      'OUT_OF_STOCK',
      `${demand.name}: estoque disponível insuficiente. Outro pedido pode ter utilizado o saldo. Atualize o cardápio e revise as quantidades.`,
    );
  }
}
