import { describe, it, expect } from 'vitest';
import {
  filterPayments,
  paymentTotals,
  type PaymentFilters,
} from '../packages/ui/src/payments-view.js';
const filters: PaymentFilters = {
  search: '',
  method: '',
  status: '',
  from: '',
  to: '',
  group: 'all',
  sort: 'newest',
};
const records = [
  {
    id: 'pix',
    provider: 'PIX_MANUAL',
    provider_reference: 'ref-pix',
    status: 'PARTIALLY_REFUNDED',
    amount: '0.30',
    refunded_amount: '0.10',
    net_amount: '0.20',
    confirmed_at: '2026-10-28 02:30:00',
    allocations: [{ tab_id: 'ana', table_number: '05', tab_label: 'Conta da Ána' }],
  },
  {
    id: 'cash',
    provider: 'CASH',
    provider_reference: 'ref-cash',
    status: 'APPROVED',
    amount: '0.10',
    refunded_amount: '0.00',
    net_amount: '0.10',
    confirmed_at: '2026-10-28T12:00:00Z',
    allocations: [],
  },
  {
    id: 'refund',
    provider: 'CARD_MANUAL',
    status: 'REFUNDED',
    amount: '8.00',
    refunded_amount: '8.00',
    net_amount: '0.00',
    confirmed_at: '2026-10-26T12:00:00Z',
    order: { order_id: 'pedido123', table_number: '02', tab_label: 'Individual' },
  },
  {
    id: 'failed',
    provider: 'sandbox',
    status: 'FAILED',
    amount: '500.00',
    refunded_amount: '0.00',
    net_amount: '0.00',
    created_at: '2026-10-28T13:00:00Z',
    review_reason: 'Revisar recebimento',
  },
];
describe('consulta operacional de pagamentos', () => {
  it('busca mesa, comanda sem acentos, pedido e referência do provedor', () => {
    expect(
      filterPayments(records, { ...filters, search: 'conta da ana' }).map((p) => p.id),
    ).toEqual(['pix']);
    expect(filterPayments(records, { ...filters, search: 'Mesa 05' }).map((p) => p.id)).toEqual([
      'pix',
    ]);
    expect(filterPayments(records, { ...filters, search: 'pedido123' }).map((p) => p.id)).toEqual([
      'refund',
    ]);
    expect(filterPayments(records, { ...filters, search: 'ref-cash' }).map((p) => p.id)).toEqual([
      'cash',
    ]);
  });
  it('combina período no horário de Brasília, forma e estornos parciais', () => {
    expect(
      filterPayments(records, {
        ...filters,
        from: '2026-10-27',
        to: '2026-10-27',
        method: 'PIX_MANUAL',
        group: 'refunded',
      }).map((p) => p.id),
    ).toEqual(['pix']);
    expect(filterPayments(records, { ...filters, group: 'received' }).map((p) => p.id)).toEqual([
      'cash',
      'pix',
    ]);
    expect(filterPayments(records, { ...filters, group: 'review' }).map((p) => p.id)).toEqual([
      'failed',
    ]);
    expect(filterPayments(records, { ...filters, status: 'REFUNDED' }).map((p) => p.id)).toEqual([
      'refund',
    ]);
  });
  it('calcula bruto e líquido em centavos exatos e exclui pagamentos não aprovados', () => {
    expect(paymentTotals(records)).toEqual({
      gross: '8.40',
      refunded: '8.10',
      net: '0.30',
      review: 1,
      count: 3,
    });
    expect(paymentTotals([])).toEqual({
      gross: '0.00',
      refunded: '0.00',
      net: '0.00',
      review: 0,
      count: 0,
    });
  });
  it('ordena valores e datas mantendo desempate estável', () => {
    expect(filterPayments(records, { ...filters, sort: 'net' }).map((p) => p.id)).toEqual([
      'pix',
      'cash',
      'failed',
      'refund',
    ]);
    expect(filterPayments(records, { ...filters, sort: 'oldest' })[0].id).toBe('refund');
  });
});
