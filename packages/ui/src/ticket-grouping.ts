import type { Data } from './client.js';
export interface OrderTickets {
  id: string;
  tickets: Data[];
}
export interface TabTickets {
  id: string;
  label: string;
  mode: string;
  tickets: Data[];
  orders: OrderTickets[];
}
export interface AttendanceTickets {
  id: string;
  status: string;
  startedAt: string;
  tickets: Data[];
  tabs: TabTickets[];
}
export interface TableTickets {
  id: string;
  number: string;
  tickets: Data[];
  attendances: AttendanceTickets[];
}
export const requestedTickets = (tickets: Data[]) =>
  tickets.filter((ticket) => ['OPEN', 'CLAIMED'].includes(ticket.service_request_status)).length;
export function groupTickets(tickets: Data[]): TableTickets[] {
  const tables = new Map<string, TableTickets>();
  const attendances = new Map<string, AttendanceTickets>();
  const tabs = new Map<string, TabTickets>();
  const orders = new Map<string, OrderTickets>();
  for (const ticket of tickets) {
    const tableId = String(ticket.table_id ?? 'COUNTER');
    let table = tables.get(tableId);
    if (!table) {
      table = {
        id: tableId,
        number:
          ticket.service_mode === 'COUNTER'
            ? 'Balcão · Avulsos'
            : String(ticket.table_number ?? '—'),
        tickets: [],
        attendances: [],
      };
      tables.set(tableId, table);
    }
    table.tickets.push(ticket);
    const attendanceKey =
      tableId +
      ':' +
      String(
        ticket.session_id ??
          (ticket.service_mode === 'COUNTER' ? ticket.order_id : 'sem-atendimento'),
      );
    let attendance = attendances.get(attendanceKey);
    if (!attendance) {
      attendance = {
        id: attendanceKey,
        status: ticket.session_status ?? 'CLOSED',
        startedAt: ticket.session_started_at_iso ?? '',
        tickets: [],
        tabs: [],
      };
      attendances.set(attendanceKey, attendance);
      table.attendances.push(attendance);
    }
    attendance.tickets.push(ticket);
    const tabKey = attendanceKey + ':' + String(ticket.tab_id ?? ticket.tab_label ?? 'sem-comanda');
    let tab = tabs.get(tabKey);
    if (!tab) {
      tab = {
        id: tabKey,
        label: ticket.tab_label ?? 'Sem comanda',
        mode: ticket.tab_mode ?? '',
        tickets: [],
        orders: [],
      };
      tabs.set(tabKey, tab);
      attendance.tabs.push(tab);
    }
    tab.tickets.push(ticket);
    const orderKey = tabKey + ':' + ticket.order_id;
    let order = orders.get(orderKey);
    if (!order) {
      order = { id: ticket.order_id, tickets: [] };
      orders.set(orderKey, order);
      tab.orders.push(order);
    }
    order.tickets.push(ticket);
  }
  const result = [...tables.values()].sort((a, b) =>
    a.number.localeCompare(b.number, 'pt-BR', { numeric: true }),
  );
  for (const table of result) {
    table.attendances.sort(
      (a, b) =>
        Number(a.status === 'CLOSED') - Number(b.status === 'CLOSED') ||
        b.startedAt.localeCompare(a.startedAt),
    );
    for (const attendance of table.attendances)
      attendance.tabs.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }
  return result;
}
