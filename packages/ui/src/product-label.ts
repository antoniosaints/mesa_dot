import { normalizeOrderSearch } from './orders-view.js';
import type { Data } from './client.js';

/** Use the stock's own variant when supplied; otherwise identify the default option. */
export function productLabel(product: Data, variantName = product.default_variant_name) {
  const variant = String(variantName ?? '').trim();
  return variant && normalizeOrderSearch(variant) !== 'padrao'
    ? `${product.name} · ${variant}`
    : product.name;
}

export function productSearchText(product: Data, variants: Data[] = []) {
  return [
    productLabel(product),
    ...variants
      .filter((variant) => variant.product_id === product.id)
      .map((variant) => variant.name),
  ].join(' ');
}
