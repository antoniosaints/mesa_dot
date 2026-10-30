import { it, expect } from 'vitest';
import { replenishmentCosts } from '../packages/shared/src/replenishment.js';
it('calcula custos fracionários com arredondamento por item, frete e desconto exatos', () => {
  expect(
    replenishmentCosts(
      [
        { quantity: '12.500', unit_cost: '2.35' },
        { quantity: '3.000', unit_cost: '10.00' },
      ],
      '10.00',
      '5.00',
    ),
  ).toEqual({ line_totals: ['29.38', '30.00'], subtotal: '59.38', total: '64.38' });
  expect(replenishmentCosts([{ quantity: '0.001', unit_cost: '5.00' }]).total).toBe('0.01');
});
it('diferencia custo não informado de custo zero sem inventar total de compra', () => {
  expect(
    replenishmentCosts(
      [{ quantity: '2.000' }, { quantity: '1.000', unit_cost: '3.00' }],
      '10.00',
      '5.00',
    ),
  ).toEqual({ line_totals: [null, '3.00'], subtotal: null, total: null });
  expect(replenishmentCosts([{ quantity: '2.000', unit_cost: '0.00' }]).total).toBe('0.00');
});
it('rejeita desconto superior à compra, valores inválidos e custo fora da capacidade', () => {
  expect(() =>
    replenishmentCosts([{ quantity: '1.000', unit_cost: '1.00' }], '1.00', '2.01'),
  ).toThrow('desconto');
  expect(() => replenishmentCosts([{ quantity: '1,500', unit_cost: '1.00' }])).toThrow('inválidos');
  expect(() =>
    replenishmentCosts([{ quantity: '99999999999.999', unit_cost: '999999999999.99' }]),
  ).toThrow('limite');
});
