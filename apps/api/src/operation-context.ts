import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { sanitizeRow } from './admin.js';
// Every lookup uses the authenticated scope. SQL epochs respect the server's
// session time zone even when an existing installation stores local DATETIME values.
function withTime(row: Row) {
  const { created_at_epoch, ...safe } = sanitizeRow(row);
  return { ...safe, created_at_iso: new Date(Number(created_at_epoch) * 1000).toISOString() };
}
export async function operationContext(s: Scope) {
  const [
    orders,
    items,
    tickets,
    tables,
    tabs,
    assignments,
    sessions,
    requests,
    areas,
    customers,
    staff,
    modifiers,
    cashSessions,
    cashRegisters,
  ] = await Promise.all([
    rows(
      s.tx,
      sql`SELECT *, UNIX_TIMESTAMP(created_at) AS created_at_epoch FROM orders WHERE ${s.where()} ORDER BY created_at DESC, id`,
    ),
    s.list('order_items'),
    rows(
      s.tx,
      sql`SELECT *, UNIX_TIMESTAMP(created_at) AS created_at_epoch FROM tickets WHERE ${s.where()} ORDER BY created_at DESC, id`,
    ),
    s.list('dining_tables'),
    s.list('tabs'),
    s.list('order_item_assignments'),
    rows(
      s.tx,
      sql`SELECT id, table_id, status, UNIX_TIMESTAMP(created_at) AS started_epoch FROM table_sessions WHERE ${s.where()}`,
    ),
    rows(
      s.tx,
      sql`SELECT *, UNIX_TIMESTAMP(created_at) AS created_at_epoch FROM service_requests WHERE ${s.where()} AND status IN ('OPEN','CLAIMED') ORDER BY created_at,id`,
    ),
    s.list('areas'),
    s.list('customers'),
    rows(
      s.tx,
      sql`SELECT DISTINCT u.id,u.name FROM users u JOIN staff_memberships m ON m.user_id=u.id WHERE m.tenant_id=${s.actor.tenantId} AND m.establishment_id=${s.actor.establishmentId}`,
    ),
    s.list('order_item_modifiers'),
    s.list('cash_sessions'),
    s.list('cash_registers'),
  ]);
  const tableMap = new Map(tables.map((row) => [row.id, row]));
  const tabMap = new Map(tabs.map((row) => [row.id, row]));
  const itemMap = new Map(items.map((row) => [row.id, row]));
  const orderMap = new Map(orders.map((row) => [row.id, row]));
  const assignmentMap = new Map(assignments.map((row) => [row.order_item_id, row.tab_id]));
  const sessionMap = new Map(sessions.map((row) => [row.id, row]));
  const requestMap = new Map(requests.map((row) => [row.ticket_id, row]));
  const areaMap = new Map(areas.map((row) => [row.id, row]));
  const customerMap = new Map(customers.map((row) => [row.id, row]));
  const staffMap = new Map(staff.map((row) => [row.id, row]));
  const cashMap = new Map(cashSessions.map((row) => [row.id, row]));
  const registerMap = new Map(cashRegisters.map((row) => [row.id, row]));
  const modifiersMap = new Map<string, string[]>();
  for (const modifier of modifiers)
    modifiersMap.set(modifier.order_item_id, [
      ...(modifiersMap.get(modifier.order_item_id) ?? []),
      modifier.name_snapshot,
    ]);
  const tabFor = (item: Row, order: Row) => tabMap.get(assignmentMap.get(item.id) ?? order.tab_id);
  const ticketRows = tickets.map<Row>((ticket) => {
    const item = itemMap.get(ticket.order_item_id)!;
    const order = orderMap.get(item.order_id)!;
    const tab = tabFor(item, order);
    const attendance = sessionMap.get(tab?.session_id);
    const request = requestMap.get(ticket.id);
    const table = tableMap.get(attendance?.table_id ?? order.table_id);
    return {
      ...withTime(ticket),
      tab_id: tab?.id ?? order.tab_id,
      tab_mode: tab?.mode,
      session_id: attendance?.id ?? null,
      session_status: attendance?.status ?? (order.service_mode === 'COUNTER' ? tab?.status : null),
      session_started_at_iso: attendance
        ? new Date(Number(attendance.started_epoch) * 1000).toISOString()
        : null,
      service_request_id: request?.id ?? null,
      service_request_status: request?.status ?? null,
      request_claimed_by: request?.claimed_by ?? null,
      order_id: order.id,
      service_mode: order.service_mode,
      customer_name: order.customer_name ?? customerMap.get(order.customer_id)?.name ?? null,
      table_id: table?.id ?? order.table_id,
      table_number: table?.number,
      area_id: table?.area_id ?? null,
      area_name: areaMap.get(table?.area_id)?.name ?? null,
      tab_label: tab?.label ?? 'Sem comanda',
      product: item.name_snapshot,
      notes: item.notes,
      modifiers: modifiersMap.get(item.id) ?? [],
      sector: item.sector,
      delivery_type: order.service_mode === 'COUNTER' ? 'COUNTER_PICKUP' : 'TABLE_DELIVERY',
      order_status: order.status,
    };
  });
  const orderRows = orders.map<Row>((order) => {
    const lines = items.filter((item) => item.order_id === order.id);
    const labels = [...new Set(lines.map((item) => tabFor(item, order)?.label).filter(Boolean))];
    return {
      ...withTime(order),
      cash_register_name:
        registerMap.get(cashMap.get(order.cash_session_id)?.register_id)?.name ?? null,
      table_number: tableMap.get(order.table_id)?.number,
      tab_labels: labels,
      tab_label: labels.join(', ') || tabMap.get(order.tab_id)?.label || 'Definida na confirmação',
      items_summary: lines.map((item) => `${item.quantity} × ${item.name_snapshot}`).join(' · '),
      item_count: lines.reduce((sum, item) => sum + Number(item.quantity), 0),
      ticket_count: ticketRows.filter((ticket) => ticket.order_id === order.id).length,
    };
  });
  const ticketMap = new Map(ticketRows.map((ticket) => [ticket.id, ticket]));
  const requestRows = requests.flatMap((request) => {
    const ticket = ticketMap.get(request.ticket_id);
    if (
      !ticket ||
      ticket.order_status !== 'CONFIRMED' ||
      ticket.session_status === 'CLOSED' ||
      !['REQUESTED', 'ASSIGNED'].includes(ticket.status)
    )
      return [];
    return [
      {
        ...withTime(request),
        claimed_by_name: staffMap.get(request.claimed_by)?.name ?? null,
        ticket,
      },
    ];
  });
  return { orders: orderRows, tickets: ticketRows, requests: requestRows };
}

export async function tableRequestCounts(s: Scope) {
  return rows(
    s.tx,
    sql`
    SELECT ts.table_id, COUNT(*) AS pending_requests,
      SUM(CASE WHEN r.status='OPEN' THEN 1 ELSE 0 END) AS unclaimed_requests
    FROM service_requests r
    JOIN tickets t ON t.id=r.ticket_id AND t.tenant_id=r.tenant_id AND t.establishment_id=r.establishment_id
    JOIN order_items i ON i.id=t.order_item_id AND i.tenant_id=t.tenant_id AND i.establishment_id=t.establishment_id
    JOIN orders o ON o.id=i.order_id AND o.tenant_id=i.tenant_id AND o.establishment_id=i.establishment_id
    LEFT JOIN order_item_assignments a ON a.order_item_id=i.id AND a.tenant_id=i.tenant_id AND a.establishment_id=i.establishment_id
    JOIN tabs tb ON tb.id=COALESCE(a.tab_id,o.tab_id) AND tb.tenant_id=o.tenant_id AND tb.establishment_id=o.establishment_id
    JOIN table_sessions ts ON ts.id=tb.session_id AND ts.tenant_id=tb.tenant_id AND ts.establishment_id=tb.establishment_id
    WHERE r.tenant_id=${s.actor.tenantId} AND r.establishment_id=${s.actor.establishmentId}
      AND r.status IN ('OPEN','CLAIMED') AND t.status IN ('REQUESTED','ASSIGNED')
      AND o.status='CONFIRMED' AND ts.status<>'CLOSED'
    GROUP BY ts.table_id
  `,
  );
}
