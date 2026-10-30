import { describe, expect, it } from 'vitest';
import {
  filterOrdersView,
  indexOrderTickets,
  orderDelivery,
  sortOrdersView,
  type OrderFilters,
} from '../packages/ui/src/orders-view.js';
const all: OrderFilters = {
  search: '',
  tableId: '',
  status: 'ALL',
  source: 'ALL',
  delivery: 'ALL',
};
const orders = [
  {
    id: 'abc123-pedido',
    table_id: 'm1',
    table_number: '02',
    tab_label: 'João',
    source: 'WAITER',
    status: 'CONFIRMED',
    total: '14.10',
    created_at_iso: '2026-10-28T12:00:00Z',
    items_summary: '2 × Água mineral',
  },
  {
    id: 'def456-pedido',
    table_id: 'm2',
    table_number: '10',
    tab_label: 'Mesa compartilhada',
    source: 'CUSTOMER',
    status: 'CONFIRMED',
    total: '100.00',
    created_at_iso: '2026-10-28T13:00:00Z',
    items_summary: 'Porção de batata',
  },
  {
    id: 'cancelado',
    table_id: 'm1',
    table_number: '02',
    source: 'POS',
    status: 'CANCELLED',
    total: '20.00',
  },
];
const tickets = [
  {
    id: 't1',
    public_number: 'FICHA-001',
    order_id: orders[0].id,
    order_status: 'CONFIRMED',
    table_id: 'm1',
    table_number: '02',
    tab_label: 'João',
    product: 'Água mineral',
    status: 'REDEEMED',
    session_status: 'OPEN',
  },
  {
    id: 't2',
    public_number: 'FICHA-002',
    order_id: orders[0].id,
    order_status: 'CONFIRMED',
    table_id: 'm1',
    table_number: '02',
    tab_label: 'João',
    product: 'Água mineral',
    status: 'REQUESTED',
    service_request_status: 'OPEN',
    session_status: 'OPEN',
  },
  {
    id: 't3',
    order_id: orders[1].id,
    order_status: 'CONFIRMED',
    table_id: 'm2',
    table_number: '10',
    product: 'Porção de batata',
    status: 'REDEEMED',
    session_status: 'CLOSED',
  },
  {
    id: 't4',
    order_id: orders[2].id,
    order_status: 'CANCELLED',
    table_id: 'm1',
    status: 'CANCELLED',
    session_status: 'OPEN',
  },
];
describe('Consulta operacional de pedidos', () => {
  it('busca nomes sem acento, mesa e código curto com #', () => {
    for (const search of ['joao', 'agua', 'garcom', 'mesa 02', '#ABC123'])
      expect(
        filterOrdersView(orders, tickets, { ...all, search }).orders.map((order) => order.id),
      ).toContain(orders[0].id);
  });
  it('encontra o pedido pela ficha, mantendo apenas a ficha procurada na aba correspondente', () => {
    const result = filterOrdersView(orders, tickets, { ...all, search: 'FICHA-002' });
    expect(result.orders.map((order) => order.id)).toEqual([orders[0].id]);
    expect(result.tickets.map((ticket) => ticket.id)).toEqual(['t2']);
  });
  it('combina mesa, origem, situação e entrega sem incluir cancelamentos ou atendimentos encerrados', () => {
    const result = filterOrdersView(orders, tickets, {
      ...all,
      tableId: 'm1',
      source: 'WAITER',
      status: 'CONFIRMED',
      delivery: 'REQUESTED',
    });
    expect(result.orders.map((order) => order.id)).toEqual([orders[0].id]);
    expect(result.tickets.map((ticket) => ticket.id)).toEqual(['t2']);
    expect(orderDelivery(orders[0], tickets.slice(0, 2))).toMatchObject({
      label: 'Cliente aguardando',
      total: 2,
      delivered: 1,
      pending: 1,
      requested: 1,
    });
    expect(orderDelivery(orders[2], [tickets[3]])).toMatchObject({
      label: 'Cancelado',
      pending: 0,
    });
  });
  it('distingue pedido totalmente entregue de ficha entregue em um pedido parcial', () => {
    const result = filterOrdersView(orders, tickets, { ...all, delivery: 'DELIVERED' });
    expect(result.orders.map((order) => order.id)).toEqual([orders[1].id]);
    expect(result.tickets.map((ticket) => ticket.id)).toEqual(['t1', 't3']);
  });
  it('ordena mesas numericamente, datas por instante e valores exatos sem alterar a lista original', () => {
    const index = indexOrderTickets(tickets);
    expect(
      sortOrdersView(orders, { key: 'table', direction: 'asc' }, index).at(-1)?.table_number,
    ).toBe('10');
    expect(sortOrdersView(orders, { key: 'created', direction: 'desc' }, index)[0].id).toBe(
      orders[1].id,
    );
    const values = [
      { id: 'a', total: '999999999999.98' },
      { id: 'b', total: '999999999999.99' },
      { id: 'c', total: '0.10' },
    ];
    expect(
      sortOrdersView(values, { key: 'total', direction: 'asc' }, index).map((order) => order.id),
    ).toEqual(['c', 'a', 'b']);
    expect(orders[0].id).toBe('abc123-pedido');
  });
});
