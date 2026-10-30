import { orderLocationLabel } from '../../shared/src/order-location.js';
import type { Data } from './client.js';
export const orderSourceLabel = (value: string, serviceMode?: string) =>
  value === 'CUSTOMER' && serviceMode === 'COUNTER'
    ? 'Cliente · Online'
    : ({ CUSTOMER: 'Cliente · QR da mesa', POS: 'Caixa / PDV', WAITER: 'Garçom' }[value] ?? value);
export type OrderSortKey = 'created' | 'table' | 'status' | 'delivery' | 'total';
export interface OrderSort {
  key: OrderSortKey;
  direction: 'asc' | 'desc';
}
export interface OrderFilters {
  search: string;
  tableId: string;
  status: string;
  source: string;
  delivery: string;
}
export const normalizeOrderSearch = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
const activeRequest = (ticket: Data) => ['OPEN', 'CLAIMED'].includes(ticket.service_request_status);
export const isPendingDelivery = (ticket: Data) =>
  ticket.order_status === 'CONFIRMED' &&
  ticket.session_status !== 'CLOSED' &&
  !['REDEEMED', 'CANCELLED'].includes(ticket.status);
export function indexOrderTickets(tickets: Data[]) {
  const index = new Map<string, Data[]>();
  for (const ticket of tickets) {
    const group = index.get(ticket.order_id) ?? [];
    group.push(ticket);
    index.set(ticket.order_id, group);
  }
  return index;
}
export function orderDelivery(order: Data, tickets: Data[] = []) {
  const units = tickets.filter((ticket) => ticket.status !== 'CANCELLED');
  const delivered = units.filter((ticket) => ticket.status === 'REDEEMED').length;
  const pending = units.filter(isPendingDelivery);
  const preparing = pending.filter((ticket) =>
    ['PENDING', 'PREPARING'].includes(ticket.status),
  ).length;
  const requested = pending.filter(activeRequest).length;
  let label = 'Aguardando fichas',
    tone = 'neutral';
  if (order.status === 'CANCELLED') label = 'Cancelado';
  else if (order.status === 'DRAFT') label = 'Não confirmado';
  else if (order.status === 'PENDING_PAYMENT') label = 'Aguardando pagamento';
  else if (units.length && delivered === units.length) {
    label = 'Entregue';
    tone = 'success';
  } else if (requested) {
    label = 'Cliente aguardando';
    tone = 'warning';
  } else if (preparing) {
    label = 'Em preparo';
    tone = 'info';
  } else if (pending.length) {
    label = 'A entregar';
    tone = 'warning';
  } else if (units.length) label = 'Atendimento encerrado';
  return {
    total: units.length,
    delivered,
    pending: pending.length,
    preparing,
    requested,
    label,
    tone,
  };
}
function orderText(order: Data) {
  return normalizeOrderSearch(
    [
      order.id,
      '#' + String(order.id).slice(0, 6),
      orderLocationLabel(order),
      order.tab_label,
      orderSourceLabel(order.source, order.service_mode),
      order.items_summary,
    ].join(' '),
  );
}
function ticketText(ticket: Data, order?: Data) {
  return normalizeOrderSearch(
    [
      ticket.id,
      ticket.public_number,
      ticket.order_id,
      '#' + String(ticket.order_id).slice(0, 6),
      orderLocationLabel(ticket),
      ticket.tab_label,
      ticket.product,
      ticket.notes,
      orderSourceLabel(order?.source ?? '', order?.service_mode),
    ].join(' '),
  );
}
export function filterOrdersView(orders: Data[], tickets: Data[], filters: OrderFilters) {
  const byOrder = indexOrderTickets(tickets);
  const query = normalizeOrderSearch(filters.search);
  const base = orders.filter(
    (order) =>
      (!filters.tableId ||
        (filters.tableId === 'COUNTER'
          ? order.service_mode === 'COUNTER'
          : order.table_id === filters.tableId)) &&
      (filters.status === 'ALL' || order.status === filters.status) &&
      (filters.source === 'ALL' || order.source === filters.source),
  );
  const ids = new Map(base.map((order) => [order.id, order]));
  return {
    orders: base.filter((order) => {
      const units = byOrder.get(order.id) ?? [];
      const flow = orderDelivery(order, units);
      const matchesDelivery =
        filters.delivery === 'ALL' ||
        (filters.delivery === 'PENDING' && flow.pending > 0) ||
        (filters.delivery === 'PREPARING' && flow.preparing > 0) ||
        (filters.delivery === 'REQUESTED' && flow.requested > 0) ||
        (filters.delivery === 'DELIVERED' &&
          order.status === 'CONFIRMED' &&
          flow.total > 0 &&
          flow.delivered === flow.total);
      return (
        matchesDelivery &&
        (!query ||
          orderText(order).includes(query) ||
          units.some((ticket) => ticketText(ticket, order).includes(query)))
      );
    }),
    tickets: tickets.filter((ticket) => {
      const order = ids.get(ticket.order_id);
      if (
        !order ||
        (filters.tableId &&
          (filters.tableId === 'COUNTER'
            ? ticket.service_mode !== 'COUNTER'
            : ticket.table_id !== filters.tableId))
      )
        return false;
      const matchesDelivery =
        filters.delivery === 'ALL' ||
        (filters.delivery === 'PENDING' && isPendingDelivery(ticket)) ||
        (filters.delivery === 'PREPARING' &&
          isPendingDelivery(ticket) &&
          ['PENDING', 'PREPARING'].includes(ticket.status)) ||
        (filters.delivery === 'REQUESTED' && isPendingDelivery(ticket) && activeRequest(ticket)) ||
        (filters.delivery === 'DELIVERED' &&
          ticket.order_status === 'CONFIRMED' &&
          ticket.status === 'REDEEMED');
      return matchesDelivery && (!query || ticketText(ticket, order).includes(query));
    }),
  };
}
const createdTime = (order: Data) => {
  const value = String(order.created_at_iso ?? order.created_at ?? '');
  const time = Date.parse(
    /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z',
  );
  return Number.isNaN(time) ? 0 : time;
};
const amountCents = (value: unknown) => {
  const [whole, fraction = ''] = String(value ?? '0').split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
export function sortOrdersView(orders: Data[], sort: OrderSort, tickets: Map<string, Data[]>) {
  const rank: Record<string, number> = { DRAFT: 0, PENDING_PAYMENT: 1, CONFIRMED: 2, CANCELLED: 3 };
  return [...orders].sort((a, b) => {
    let comparison = 0;
    if (sort.key === 'table')
      comparison = String(a.table_number ?? '').localeCompare(
        String(b.table_number ?? ''),
        'pt-BR',
        { numeric: true },
      );
    else if (sort.key === 'status') comparison = (rank[a.status] ?? 4) - (rank[b.status] ?? 4);
    else if (sort.key === 'delivery')
      comparison =
        orderDelivery(a, tickets.get(a.id)).pending - orderDelivery(b, tickets.get(b.id)).pending;
    else if (sort.key === 'total') {
      const first = amountCents(a.total),
        second = amountCents(b.total);
      comparison = first > second ? 1 : first < second ? -1 : 0;
    } else comparison = createdTime(a) - createdTime(b);
    return (
      (comparison || String(a.id).localeCompare(String(b.id))) * (sort.direction === 'asc' ? 1 : -1)
    );
  });
}
