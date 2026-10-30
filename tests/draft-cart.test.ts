import { describe, it, expect } from 'vitest';
import { mergeDraftLine, type DraftLine } from '../packages/ui/src/draft-cart.js';
const item = (change: Partial<DraftLine> = {}): DraftLine => ({
  key: 'first',
  product_id: 'water',
  quantity: 1,
  modifiers: [],
  notes: '',
  name: 'Água',
  price: 5,
  ...change,
});
describe('itens do pedido em montagem', () => {
  it('acumula cliques sem duplicar a linha nem modificar o carrinho anterior', () => {
    const previous = [item()];
    const result = mergeDraftLine(previous, item({ key: 'next', quantity: 2 }));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ key: 'first', quantity: 3 });
    expect(previous[0].quantity).toBe(1);
  });
  it('agrupa a mesma personalização independentemente da ordem dos adicionais', () => {
    const previous = [
      item({ variant_id: 'large', modifiers: ['ice', 'lime'], notes: 'Sem açúcar' }),
    ];
    expect(
      mergeDraftLine(
        previous,
        item({
          key: 'other',
          variant_id: 'large',
          modifiers: ['lime', 'ice'],
          notes: 'Sem açúcar',
        }),
      ).lines[0].quantity,
    ).toBe(2);
    expect(previous[0].modifiers).toEqual(['ice', 'lime']);
  });
  it('preserva produtos, variações, adicionais, observações e preços diferentes', () => {
    for (const change of [
      { product_id: 'beer' },
      { variant_id: 'large' },
      { modifiers: ['ice'] },
      { notes: 'Sem gelo' },
      { price: 6 },
    ]) {
      const result = mergeDraftLine([item()], item({ key: 'other', ...change }));
      expect(result.lines).toHaveLength(2);
      expect(result.lines.map((line) => line.quantity)).toEqual([1, 1]);
    }
  });
  it('respeita o limite da API sem descartar parcialmente a quantidade solicitada', () => {
    const previous = [item({ quantity: 99 })];
    expect(mergeDraftLine(previous, item()).lines[0].quantity).toBe(100);
    expect(mergeDraftLine(previous, item({ quantity: 2 }))).toEqual({
      lines: previous,
      limitReached: true,
    });
    expect(mergeDraftLine([], item({ quantity: 101 }))).toEqual({ lines: [], limitReached: true });
  });
});
