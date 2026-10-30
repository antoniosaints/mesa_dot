import { z } from 'zod';
import { sql, rows, type Scope } from '../../../packages/database/src/index.js';
import { amount, ensure, money, orderInput, permit } from '../../../packages/shared/src/index.js';
import { createOrder, confirmOrder } from './orders.js';
import { receiveManual } from './payments.js';
import { redeemTicket, ticketToken } from './tickets.js';
export const counterOrderInput = z
  .object({
    items: orderInput.shape.items,
    expected_total: amount,
    method: z.enum(['CASH', 'CARD_MANUAL', 'PIX_MANUAL']),
    cash_session_id: z.uuid().optional(),
    customer_name: z.string().trim().max(80).optional(),
    deliver_available: z.boolean().default(false),
  })
  .strict();
export async function counterCashSessions(s: Scope) {
  permit(s.actor, 'order.create');
  permit(s.actor, 'payment.receive');
  return rows(
    s.tx,
    sql`SELECT c.id,r.name FROM cash_sessions c JOIN cash_registers r ON r.tenant_id=c.tenant_id AND r.establishment_id=c.establishment_id AND r.id=c.register_id WHERE c.tenant_id=${s.actor.tenantId} AND c.establishment_id=${s.actor.establishmentId} AND c.status='OPEN' ORDER BY r.name,c.id`,
  );
}
export async function createCounterOrder(s: Scope, input: z.infer<typeof counterOrderInput>) {
  permit(s.actor, 'order.create');
  permit(s.actor, 'payment.receive');
  if (input.deliver_available) permit(s.actor, 'ticket.redeem');
  const draft = await createOrder(
    s,
    { source: 'POS', payment_policy: 'POSTPAID', items: input.items },
    { customerName: input.customer_name, cashSessionId: input.cash_session_id },
  );
  ensure(
    money(draft.total) === money(input.expected_total),
    'CONFLICT',
    'Os preços foram atualizados. Atualize o cardápio e revise o total antes de receber.',
  );
  const order = await confirmOrder(s, draft.id, true);
  const payment = await receiveManual(s, {
    method: input.method,
    cash_session_id: input.cash_session_id,
    allocations: [{ tab_id: order.tab_id, amount: order.total }],
  });
  const tickets = await rows(
    s.tx,
    sql`SELECT t.* FROM tickets t JOIN order_items i ON i.id=t.order_item_id AND i.tenant_id=t.tenant_id AND i.establishment_id=t.establishment_id WHERE t.tenant_id=${s.actor.tenantId} AND t.establishment_id=${s.actor.establishmentId} AND i.order_id=${order.id}`,
  );
  let delivered = 0;
  if (input.deliver_available)
    for (const ticket of tickets)
      if (ticket.status === 'AVAILABLE') {
        await redeemTicket(s, ticket.id, ticketToken(ticket));
        for (const job of await s.list(
          'print_jobs',
          sql`ticket_id=${ticket.id} AND status='PENDING'`,
        )) {
          await s.update('print_jobs', job.id, {
            status: 'CANCELLED',
            cancelled_at: new Date(),
            cancelled_by: s.actor.id,
            cancellation_reason: 'Entrega imediata no balcão; ficha sem envio.',
          });
        }
        delivered++;
      }
  await s.audit('counter.sale_created', order.id, {
    payment_id: payment.id,
    delivered,
    method: input.method,
  });
  await s.event('counter.sale_created', order.id);
  return { order, payment_id: payment.id, delivered, pending: tickets.length - delivered };
}
