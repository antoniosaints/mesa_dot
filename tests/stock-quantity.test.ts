import { describe, it, expect } from 'vitest';
import { normalizeStockQuantity } from '../packages/ui/src/stock-quantity.js';
describe('quantidades de estoque', () => {
  it('aceita inteiro, decimal pt-BR e ponto preservando três casas', () => {
    expect(normalizeStockQuantity('10')).toBe('10.000');
    expect(normalizeStockQuantity('0,05')).toBe('0.050');
    expect(normalizeStockQuantity('1.234,567')).toBe('1234.567');
    expect(normalizeStockQuantity('1.250')).toBe('1.250');
    expect(normalizeStockQuantity('-2,5', { signed: true })).toBe('-2.500');
  });
  it('bloqueia arredondamento implícito, valores inválidos e ingrediente zero', () => {
    for (const value of ['', 'abc', '1.2345', '100000000000', '-1'])
      expect(() => normalizeStockQuantity(value)).toThrow();
    expect(() => normalizeStockQuantity('0', { positive: true })).toThrow();
    expect(normalizeStockQuantity('0')).toBe('0.000');
  });
});
