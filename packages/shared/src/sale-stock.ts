export interface SaleStock {
  controlled: boolean;
  available: number | null;
  reason?: string;
  constraints: { key: string; remaining: string; per_unit: string }[];
}
interface Product {
  id: string;
  product_id?: string;
  name?: string;
  stock_policy?: string;
  enabled?: boolean;
  stock?: SaleStock;
}
export interface SaleCatalog {
  products: Product[];
  variants: Product[];
}
export interface StockLine {
  product_id: string;
  variant_id?: string;
  quantity: number;
}
export function stockFor(catalog: SaleCatalog, productId: string, variantId?: string): SaleStock {
  const product = catalog.products.find((item) => item.id === productId);
  const option = variantId
    ? catalog.variants.find((item) => item.id === variantId && item.product_id === productId)
    : product;
  if (!product || !option || product.enabled === false || option.enabled === false)
    return { controlled: true, available: 0, constraints: [], reason: 'Produto indisponível.' };
  return (
    option.stock ?? {
      controlled: product.stock_policy !== 'NO_CONTROL',
      available: product.stock_policy === 'NO_CONTROL' ? null : 0,
      constraints: [],
    }
  );
}
export function additionalStock(
  catalog: SaleCatalog,
  cart: StockLine[],
  productId: string,
  variantId?: string,
): number {
  const stock = stockFor(catalog, productId, variantId);
  if (!stock.controlled) return Infinity;
  if (!stock.available || !stock.constraints.length) return 0;
  const used = new Map<string, bigint>();
  for (const line of cart)
    for (const constraint of stockFor(catalog, line.product_id, line.variant_id).constraints)
      used.set(
        constraint.key,
        (used.get(constraint.key) ?? 0n) + BigInt(constraint.per_unit) * BigInt(line.quantity),
      );
  return Math.max(
    0,
    Math.min(
      ...stock.constraints.map((constraint) =>
        Number(
          (BigInt(constraint.remaining) - (used.get(constraint.key) ?? 0n)) /
            BigInt(constraint.per_unit),
        ),
      ),
    ),
  );
}
export function cartStockIssue(catalog: SaleCatalog, cart: StockLine[]): string | null {
  for (let index = 0; index < cart.length; index++) {
    const line = cart[index],
      name = catalog.products.find((item) => item.id === line.product_id)?.name ?? 'Produto';
    if (
      additionalStock(
        catalog,
        cart.filter((_, position) => position !== index),
        line.product_id,
        line.variant_id,
      ) < line.quantity
    )
      return `${name}: estoque disponível insuficiente. Atualize o pedido e reduza a quantidade ou remova o item.`;
  }
  return null;
}
export function hasSaleStock(catalog: SaleCatalog, cart: StockLine[], productId: string) {
  return (
    additionalStock(catalog, cart, productId) > 0 ||
    catalog.variants.some(
      (variant) =>
        variant.product_id === productId &&
        additionalStock(catalog, cart, productId, variant.id) > 0,
    )
  );
}
