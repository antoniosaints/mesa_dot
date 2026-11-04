import { assertNoPendingRefund } from './gateway-operations.js';
import { closeCounterIfComplete } from './counter-lifecycle.js';
import { sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure, permit, hash, deriveToken } from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { accessOrder } from './orders.js';
import { approvedForOrder } from './payments.js';
import { money } from '../../../packages/shared/src/index.js';
import { consumeTicketStock } from './inventory.js';
export const ticketToken = (ticket: Row) =>
  deriveToken(env.DOCUMENT_KEY ?? '', 'ticket', ticket.id, ticket.token_nonce);
export async function accessTicket(s: Scope, id: string) {
  const ticket = await s.get('tickets', id);
  const item = await s.get('order_items', ticket.order_item_id);
  const order = await accessOrder(s, item.order_id);
  ensure(order.status === 'CONFIRMED', 'INVALID_STATE', 'Pedido não liberado.');
  return { ticket, item, order };
}
export async function ticketDocument(s: Scope, id: string) {
  const { ticket, item, order } = await accessTicket(s, id);
  if (s.actor.kind === 'STAFF') permit(s.actor, 'ticket.view');
  ensure(
    ['STAFF', 'VISITOR', 'AGENT'].includes(s.actor.kind),
    'FORBIDDEN',
    'Documento não autorizado.',
    403,
  );
  const assignments = await s.list('order_item_assignments', sql`order_item_id=${item.id}`);
  const tab = await s.get('tabs', assignments[0]?.tab_id ?? order.tab_id);
  const session = tab.session_id ? await s.get('table_sessions', tab.session_id) : null;
  const table = session ? await s.get('dining_tables', session.table_id) : null;
  const area = table?.area_id ? await s.get('areas', table.area_id) : null;
  const modifiers = await s.list('order_item_modifiers', sql`order_item_id=${item.id}`);
  const requests = await s.list(
    'service_requests',
    sql`ticket_id=${ticket.id} AND status IN ('OPEN','CLAIMED')`,
  );
  const { token_hash: _hash, token_nonce: _nonce, ...safe } = ticket;
  return {
    ...safe,
    token: ticketToken(ticket),
    order_status: order.status,
    session_id: session?.id ?? null,
    service_mode: order.service_mode,
    delivery_type: order.service_mode === 'COUNTER' ? 'COUNTER_PICKUP' : 'TABLE_DELIVERY',
    area_name: area?.name ?? null,
    sector: item.sector,
    modifiers: modifiers.map((modifier) => modifier.name_snapshot),
    tab_id: tab.id,
    service_request_id: requests[0]?.id ?? null,
    service_request_status: requests[0]?.status ?? null,
    request_claimed_by: requests[0]?.claimed_by ?? null,
    product: item.name_snapshot,
    order_id: order.id,
    table_id: table?.id ?? order.table_id,
    tab_label: tab.label,
    table_number: table?.number ?? null,
    notes: item.notes,
  };
}
export async function redeemTicket(s: Scope, id: string, token: string) {
  permit(s.actor, 'ticket.redeem');
  const { ticket, item, order } = await accessTicket(s, id);
  await assertNoPendingRefund(s, order.id);
  if (['PREPAID', 'IMMEDIATE'].includes(order.payment_policy_snapshot))
    ensure(
      (await approvedForOrder(s, order.id)) >= money(order.total),
      'PAYMENT_REQUIRED',
      'Pedido com pagamento estornado ou incompleto.',
      402,
    );
  ensure(hash(token) === ticket.token_hash, 'NOT_FOUND', 'Código de ficha inválido.', 404);
  ensure(
    ['AVAILABLE', 'REQUESTED', 'ASSIGNED'].includes(ticket.status),
    'INVALID_STATE',
    ticket.status === 'REDEEMED'
      ? `Ficha já utilizada em ${ticket.redeemed_at}.`
      : 'Ficha indisponível para entrega.',
  );
  const active = await s.list(
    'service_requests',
    sql`ticket_id=${id} AND status IN ('OPEN','CLAIMED')`,
  );
  ensure(
    !active.length || active[0].status !== 'CLAIMED' || active[0].claimed_by === s.actor.id,
    'CONFLICT',
    'Chamado atribuído a outro garçom.',
  );
  const changed = await s.update(
    'tickets',
    id,
    {
      status: 'REDEEMED',
      redeemed_at: new Date(),
      redeemed_by: s.actor.id,
      version: ticket.version + 1,
    },
    sql`status IN ('AVAILABLE','REQUESTED','ASSIGNED') AND version=${ticket.version}`,
  );
  ensure(changed === 1, 'CONFLICT', 'Ficha utilizada por outro funcionário.');
  if (['ON_DELIVERY', 'RECIPE'].includes(item.stock_policy_snapshot))
    await consumeTicketStock(s, id);
  for (const request of active) {
    await s.update('service_requests', request.id, {
      status: 'COMPLETED',
      completed_at: new Date(),
      claimed_by: s.actor.id,
    });
    await s.insert('service_request_events', {
      request_id: request.id,
      event: 'COMPLETED',
      actor_id: s.actor.id,
    });
  }
  await s.insert('ticket_events', { ticket_id: id, event: 'REDEEMED', actor_id: s.actor.id });
  await closeCounterIfComplete(s, order);
  await s.audit('ticket.redeemed', id);
  await s.event('ticket.redeemed', id, {}, ticket.version + 1);
  return { id, status: 'REDEEMED', version: ticket.version + 1 };
}
export async function requestTicket(s: Scope, id: string) {
  ensure(s.actor.kind === 'VISITOR', 'FORBIDDEN', 'Chamado deve ser feito pelo cliente.', 403);
  const { ticket, order } = await accessTicket(s, id);
  ensure(
    order.service_mode !== 'COUNTER',
    'INVALID_STATE',
    'Pedidos avulsos devem ser retirados no balcão. Apresente a ficha à equipe.',
  );
  const existing = await s.list(
    'service_requests',
    sql`ticket_id=${id} AND status IN ('OPEN','CLAIMED')`,
  );
  if (existing.length) return existing[0];
  ensure(
    ticket.status === 'AVAILABLE',
    'INVALID_STATE',
    'Ficha indisponível para solicitar entrega.',
  );
  const request = await s.insert('service_requests', { ticket_id: id, status: 'OPEN' });
  await s.update('tickets', id, { status: 'REQUESTED', version: ticket.version + 1 });
  await s.insert('service_request_events', {
    request_id: request.id,
    event: 'OPEN',
    actor_id: s.actor.id,
  });
  await s.insert('ticket_events', { ticket_id: id, event: 'REQUESTED', actor_id: s.actor.id });
  await s.event('ticket.requested', id);
  return request;
}
export async function claimRequest(s: Scope, id: string) {
  permit(s.actor, 'ticket.redeem');
  const request = await s.get('service_requests', id, true);
  ensure(request.status === 'OPEN', 'CONFLICT', 'Chamado já assumido.');
  const changed = await s.update(
    'service_requests',
    id,
    { status: 'CLAIMED', claimed_by: s.actor.id },
    sql`status='OPEN'`,
  );
  ensure(changed === 1, 'CONFLICT', 'Outro garçom assumiu este chamado.');
  const ticket = await s.get('tickets', request.ticket_id);
  await s.update('tickets', ticket.id, { status: 'ASSIGNED', version: ticket.version + 1 });
  await s.insert('service_request_events', {
    request_id: id,
    event: 'CLAIMED',
    actor_id: s.actor.id,
  });
  await s.event('ticket.claimed', ticket.id);
  return s.get('service_requests', id);
}
export async function cancelRequest(s: Scope, id: string) {
  const request = await s.get('service_requests', id);
  await accessTicket(s, request.ticket_id);
  if (s.actor.kind !== 'VISITOR') permit(s.actor, 'ticket.redeem');
  ensure(['OPEN', 'CLAIMED'].includes(request.status), 'INVALID_STATE', 'Chamado encerrado.');
  const ticket = await s.get('tickets', request.ticket_id);
  await s.update('service_requests', id, { status: 'CANCELLED' });
  await s.update('tickets', ticket.id, { status: 'AVAILABLE', version: ticket.version + 1 });
  await s.insert('service_request_events', {
    request_id: id,
    event: 'CANCELLED',
    actor_id: s.actor.id,
  });
  await s.event('ticket.request_cancelled', ticket.id);
  return { id, status: 'CANCELLED' };
}
export async function reprintTicket(s: Scope, id: string, reason: string) {
  permit(s.actor, 'ticket.reprint');
  const { ticket, item } = await accessTicket(s, id);
  ensure(
    !['REDEEMED', 'CANCELLED'].includes(ticket.status),
    'INVALID_STATE',
    'Ficha utilizada ou cancelada.',
  );
  const product = await s.get('products', item.product_id);
  const printers = await s.list('printers', sql`enabled=TRUE AND sector=${product.sector}`);
  ensure(printers.length, 'INVALID_STATE', 'Nenhuma impressora configurada para o setor.');
  const jobs = [];
  for (const printer of printers)
    jobs.push(
      await s.insert('print_jobs', {
        ticket_id: id,
        printer_id: printer.id,
        status: 'PENDING',
        is_copy: true,
      }),
    );
  await s.audit('ticket.reprinted', id, { reason });
  return { ticket_id: id, jobs: jobs.map((j) => j.id), is_copy: true };
}
export async function advanceProduction(s: Scope, id: string, status: 'PREPARING' | 'READY') {
  permit(s.actor, 'production.manage');
  const job = await s.get('production_jobs', id, true);
  ensure(
    (status === 'PREPARING' && job.status === 'PENDING') ||
      (status === 'READY' && job.status === 'PREPARING'),
    'INVALID_STATE',
    'Transição de produção inválida.',
  );
  const { ticket, item, order } = await accessTicket(s, job.ticket_id);
  await assertNoPendingRefund(s, order.id);
  if (status === 'READY' && item.stock_policy_snapshot === 'ON_PRODUCTION')
    await consumeTicketStock(s, ticket.id);
  await s.update('production_jobs', id, { status });
  await s.update('tickets', ticket.id, {
    status: status === 'READY' ? 'AVAILABLE' : 'PREPARING',
    version: ticket.version + 1,
  });
  await s.insert('ticket_events', { ticket_id: ticket.id, event: status, actor_id: s.actor.id });
  await s.event('production.updated', id);
  if (status === 'READY') await s.event('production.ready', id);
  await s.audit('production.updated', id, { status });
  return { id, status };
}

/** One transaction for the entire order: production and stock use their usual transitions. */
export async function deliverOrderTickets(s: Scope, orderId: string) {
  permit(s.actor, 'ticket.redeem');
  const order = await accessOrder(s, orderId);
  ensure(
    order.status === 'CONFIRMED',
    'INVALID_STATE',
    'Confirme o pedido antes de entregar suas fichas.',
  );
  const all: Row[] = [];
  for (const item of await s.list('order_items', sql`order_id=${order.id}`))
    all.push(...(await s.list('tickets', sql`order_item_id=${item.id}`)));
  const pending = all
    .filter((ticket) => !['REDEEMED', 'CANCELLED'].includes(ticket.status))
    .sort((a, b) => a.id.localeCompare(b.id));
  let completedProduction = 0;
  for (const ticket of pending) {
    const jobs = await s.list('production_jobs', sql`ticket_id=${ticket.id}`);
    for (const job of jobs) {
      ensure(
        ['PENDING', 'PREPARING', 'READY'].includes(job.status),
        'INVALID_STATE',
        'Preparo cancelado ou indisponível. Confira a ficha antes de entregar.',
      );
      if (job.status !== 'READY') {
        permit(s.actor, 'production.manage');
        if (job.status === 'PENDING') await advanceProduction(s, job.id, 'PREPARING');
        await advanceProduction(s, job.id, 'READY');
        completedProduction++;
      }
    }
    await redeemTicket(s, ticket.id, ticketToken(ticket));
  }
  const result = {
    order_id: order.id,
    delivered_count: pending.length,
    completed_production_count: completedProduction,
    already_delivered_count: all.filter((ticket) => ticket.status === 'REDEEMED').length,
    cancelled_count: all.filter((ticket) => ticket.status === 'CANCELLED').length,
  };
  if (pending.length) {
    await s.audit('order.tickets_delivered', order.id, result);
    await s.event('order.tickets_delivered', order.id, result);
  }
  return result;
}
