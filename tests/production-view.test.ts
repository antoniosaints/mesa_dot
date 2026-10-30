import { it, expect } from 'vitest';
import {
  filterProduction,
  productionAge,
  productionAgeLabel,
  canAdvanceProduction,
  type ProductionFilters,
} from '../packages/ui/src/production-view.js';
const filters: ProductionFilters = {
  search: '',
  sector: '',
  table: '',
  status: '',
  sort: 'oldest',
};
const records = [
  {
    id: 'a',
    created_at_iso: '2026-10-28T12:00:00Z',
    status: 'PENDING',
    ticket_status: 'PENDING',
    order_status: 'CONFIRMED',
    product: 'Porção de batata',
    table_id: 'mesa1',
    table_number: '05',
    tab_label: 'Conta da Ána',
    public_number: 'FICHA1',
    order_id: 'pedido1',
    sector: 'cozinha',
    notes: 'Sem sal',
    modifiers: ['Molho extra'],
  },
  {
    id: 'b',
    created_at_iso: '2026-10-28T12:10:00Z',
    status: 'PREPARING',
    ticket_status: 'PREPARING',
    order_status: 'CONFIRMED',
    product: 'Suco natural',
    table_id: 'mesa2',
    table_number: '02',
    tab_label: 'Compartilhada',
    public_number: 'FICHA2',
    order_id: 'pedido2',
    sector: 'bar',
    notes: 'Sem gelo',
  },
];
it('produção busca produto, observações, adicionais e referências e combina filtros', () => {
  for (const search of [
    'porcao',
    'conta da ana',
    'sem sal',
    'molho',
    'FICHA1',
    'pedido1',
    'Mesa 05',
  ])
    expect(filterProduction(records, { ...filters, search }).map((j) => j.id)).toEqual(['a']);
  expect(
    filterProduction(records, {
      ...filters,
      sector: 'bar',
      status: 'PREPARING',
      table: 'mesa2',
    }).map((j) => j.id),
  ).toEqual(['b']);
  expect(filterProduction(records, { ...filters, sector: 'bar', table: 'mesa1' })).toEqual([]);
  expect(filterProduction(records, { ...filters, sort: 'newest' }).map((j) => j.id)).toEqual([
    'b',
    'a',
  ]);
});
it('tempo de produção usa a entrada ISO, limita datas futuras e identifica data inválida', () => {
  expect(productionAge(records[0], Date.parse('2026-10-28T13:05:00Z'))).toBe(65);
  expect(productionAge(records[0], Date.parse('2026-10-28T11:00:00Z'))).toBe(0);
  expect(productionAge({ created_at_iso: 'inválida' })).toBeNull();
  expect([
    productionAgeLabel(0),
    productionAgeLabel(7),
    productionAgeLabel(65),
    productionAgeLabel(null),
  ]).toEqual(['Agora', '7 min', '1h 05min', 'Horário indisponível']);
});
it('ações de preparo não são oferecidas para pedidos cancelados ou fichas entregues', () => {
  expect(canAdvanceProduction(records[0])).toBe(true);
  expect(canAdvanceProduction(records[1])).toBe(true);
  expect(canAdvanceProduction({ ...records[0], order_status: 'CANCELLED' })).toBe(false);
  expect(canAdvanceProduction({ ...records[1], ticket_status: 'REDEEMED' })).toBe(false);
  expect(canAdvanceProduction({ ...records[1], status: 'READY' })).toBe(false);
});
