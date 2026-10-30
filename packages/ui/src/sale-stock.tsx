import {
  additionalStock,
  cartStockIssue,
  hasSaleStock,
  stockFor,
} from '../../shared/src/sale-stock.js';
import { api, type Data } from './client.js';
const catalogOf = (catalog: Data | null) => ({
  products: catalog?.products ?? [],
  variants: catalog?.variants ?? [],
});
const linesOf = (cart: Data[]) =>
  cart.map((line) => ({
    product_id: String(line.product_id),
    variant_id: line.variant_id || undefined,
    quantity: Number(line.quantity),
  }));
export const remainingStock = (
  catalog: Data | null,
  cart: Data[],
  productId: string,
  variantId?: string,
) => additionalStock(catalogOf(catalog), linesOf(cart), productId, variantId);
export const productHasStock = (catalog: Data | null, cart: Data[], productId: string) =>
  hasSaleStock(catalogOf(catalog), linesOf(cart), productId);
export const stockIssue = (catalog: Data | null, cart: Data[]) =>
  cartStockIssue(catalogOf(catalog), linesOf(cart));
export const stockFailure = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'OUT_OF_STOCK');
export async function validateSaleStock(
  path: string,
  cart: Data[],
  onFresh: (catalog: Data) => void,
) {
  const fresh = await api(path);
  onFresh(fresh);
  if (fresh.establishment?.is_open === false)
    throw new Error(
      fresh.establishment.message ??
        fresh.establishment.closed_reason ??
        'O estabelecimento está fechado para novos pedidos.',
    );
  const issue = stockIssue(fresh, cart);
  if (issue) throw new Error(issue);
}
export function StockHint({
  catalog,
  cart,
  productId,
  variantId,
  allowVariants = false,
}: {
  catalog: Data | null;
  cart: Data[];
  productId: string;
  variantId?: string;
  allowVariants?: boolean;
}) {
  const stock = stockFor(catalogOf(catalog), productId, variantId);
  if (!stock.controlled) return null;
  const remaining = remainingStock(catalog, cart, productId, variantId);
  const options = allowVariants && !remaining && productHasStock(catalog, cart, productId);
  return (
    <span className={'sale-stock-hint ' + (remaining || options ? 'available' : 'unavailable')}>
      {options
        ? 'Veja as variações disponíveis'
        : !stock.available
          ? 'Sem estoque'
          : !remaining
            ? 'Saldo disponível já no pedido'
            : `${remaining} disponível(is)`}
    </span>
  );
}
