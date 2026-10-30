import { expect, it } from 'vitest';
import { orderLocationLabel } from '../packages/shared/src/order-location.js';
import { filterOrdersView } from '../packages/ui/src/orders-view.js';
import { groupTickets } from '../packages/ui/src/ticket-grouping.js';
import { filterProduction } from '../packages/ui/src/production-view.js';
it('avulsos têm identificação e filtro próprios, sem agrupar clientes diferentes no mesmo atendimento', () => {
  const orders = [
    { id: 'o1', service_mode: 'COUNTER', table_id: null, status: 'CONFIRMED' },
    { id: 'o2', service_mode: 'COUNTER', table_id: null, status: 'CONFIRMED' },
    { id: 'mesa', table_id: 'm1', table_number: '01', status: 'CONFIRMED' },
  ];
  const tickets = orders.slice(0, 2).map((o, i) => ({
    id: 't' + i,
    order_id: o.id,
    table_id: null,
    table_number: null,
    service_mode: 'COUNTER',
    tab_id: 'tab' + i,
    session_id: null,
    session_status: 'OPEN',
    status: 'AVAILABLE',
    order_status: 'CONFIRMED',
    tab_label: 'Avulso ' + i,
  }));
  expect(orderLocationLabel(orders[0])).toBe('Balcão · Pedido avulso');
  expect(orderLocationLabel(orders[2])).toBe('Mesa 01');
  const result = filterOrdersView(orders, tickets, {
    search: 'balcão',
    tableId: 'COUNTER',
    status: 'ALL',
    source: 'ALL',
    delivery: 'ALL',
  });
  expect(result.orders.map((o) => o.id)).toEqual(['o1', 'o2']);
  expect(result.tickets).toHaveLength(2);
  const groups = groupTickets(tickets);
  expect(groups).toHaveLength(1);
  expect(groups[0].attendances).toHaveLength(2);
  expect(
    filterProduction(
      [{ ...tickets[0], created_at_iso: new Date().toISOString(), sector: 'cozinha' }],
      { search: 'balcão', table: 'COUNTER', sector: '', status: '', sort: 'oldest' },
    ),
  ).toHaveLength(1);
});
