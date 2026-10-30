import { describe, expect, it } from 'vitest';
import {
  additionalStock,
  cartStockIssue,
  hasSaleStock,
  type SaleCatalog,
  type SaleStock,
} from '../packages/shared/src/sale-stock.js';
const stock = (key: string, remaining: string, per_unit = '1000'): SaleStock => ({
  controlled: true,
  available: Number(BigInt(remaining) / BigInt(per_unit)),
  constraints: [{ key, remaining, per_unit }],
});
const catalog: SaleCatalog = {
  products: [
    { id: 'bottle', name: 'Garrafa', stock: stock('shared', '2000') },
    { id: 'drink', name: 'Drink', stock: stock('shared', '2000', '750') },
    { id: 'free', stock_policy: 'NO_CONTROL' },
    { id: 'missing', stock_policy: 'ON_DELIVERY' },
  ],
  variants: [
    { id: 'shared-size', product_id: 'bottle', stock: stock('shared', '2000') },
    { id: 'own-size', product_id: 'bottle', stock: stock('own', '1000') },
  ],
};
describe('disponibilidade de venda no carrinho', () => {
  it('soma linhas personalizadas e variações que usam o mesmo saldo', () => {
    const cart = [
      { product_id: 'bottle', quantity: 1 },
      { product_id: 'bottle', variant_id: 'shared-size', quantity: 1 },
    ];
    expect(additionalStock(catalog, cart, 'bottle')).toBe(0);
    expect(cartStockIssue(catalog, cart)).toBeNull();
    expect(cartStockIssue(catalog, [...cart, { product_id: 'bottle', quantity: 1 }])).toContain(
      'estoque',
    );
    expect(additionalStock(catalog, cart, 'bottle', 'own-size')).toBe(1);
  });
  it('respeita ingredientes em comum e não arredonda receitas fracionadas para cima', () => {
    expect(additionalStock(catalog, [{ product_id: 'bottle', quantity: 1 }], 'drink')).toBe(1);
    expect(
      cartStockIssue(catalog, [
        { product_id: 'drink', quantity: 2 },
        { product_id: 'bottle', quantity: 1 },
      ]),
    ).toContain('estoque');
  });
  it('bloqueia configuração ausente e mantém produtos sem controle disponíveis', () => {
    expect(additionalStock(catalog, [], 'missing')).toBe(0);
    expect(additionalStock(catalog, [], 'free')).toBe(Infinity);
    expect(cartStockIssue(catalog, [{ product_id: 'free', quantity: 100 }])).toBeNull();
    expect(
      hasSaleStock(
        { products: [{ id: 'bottle', stock: stock('empty', '0') }], variants: catalog.variants },
        [],
        'bottle',
      ),
    ).toBe(true);
  });
});
