import { sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { money, formatDecimal } from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { accessOrder } from './orders.js';
import { approvedForOrder } from './payments.js';
export async function orderCancellationContext(s: Scope, id: string) {
  const order = await accessOrder(s, id);
  const table = order.table_id ? await s.get('dining_tables', order.table_id) : null;
  const blockers = new Set<string>();
  if (order.status === 'CANCELLED') blockers.add('Este pedido já está cancelado.');
  for (const item of await s.list('order_items', sql`order_id=${id}`)) {
    for (const ticket of await s.list('tickets', sql`order_item_id=${item.id}`)) {
      if (ticket.status === 'REDEEMED')
        blockers.add('Há produto já entregue. O cancelamento exige tratamento manual.');
      if (ticket.status === 'PREPARING')
        blockers.add('Há produto em preparo. O cancelamento exige tratamento manual.');
      const jobs = await s.list('production_jobs', sql`ticket_id=${ticket.id}`);
      if (jobs.some((job) => job.status === 'READY'))
        blockers.add(
          'Há produto já produzido. O cancelamento exige tratamento de perda no estoque.',
        );
    }
  }
  const remaining = await approvedForOrder(s, id);
  const canRefund = s.actor.kind === 'STAFF' && s.actor.permissions.includes('payment.refund');
  const targets: Row[] = [];
  if (canRefund) {
    const intents = await s.list('payment_intents', sql`order_id=${id}`);
    const paymentIds = new Set<string>();
    for (const intent of intents)
      for (const p of await s.list('payments', sql`intent_id=${intent.id}`)) paymentIds.add(p.id);
    if (order.service_mode === 'COUNTER' && order.tab_id)
      for (const allocation of await s.list('payment_allocations', sql`tab_id=${order.tab_id}`))
        paymentIds.add(allocation.payment_id);
    for (const paymentId of paymentIds) {
      const payment = await s.get('payments', paymentId);
      if (!['APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status)) continue;
      const refunds = await s.list('refunds', sql`payment_id=${payment.id} AND status='APPROVED'`);
      const refunded = refunds.reduce((sum, row) => sum + money(row.amount), 0n);
      const paymentRemaining = money(payment.amount) - refunded;
      const allocations = await s.list('payment_allocations', sql`payment_id=${payment.id}`);
      for (const allocation of allocations.length ? allocations : [null]) {
        const tab = allocation ? await s.get('tabs', allocation.tab_id) : null;
        const allocatedRemaining = allocation
          ? money(allocation.amount) -
            refunds
              .filter((row) => row.tab_id === allocation.tab_id)
              .reduce((sum, row) => sum + money(row.amount), 0n)
          : paymentRemaining;
        const available =
          paymentRemaining < allocatedRemaining ? paymentRemaining : allocatedRemaining;
        targets.push({
          payment_id: payment.id,
          provider: payment.provider,
          status: payment.status,
          payment_amount: payment.amount,
          refunded_amount: formatDecimal(refunded),
          refundable_amount: formatDecimal(available > 0n ? available : 0n),
          tab_id: tab?.id ?? null,
          tab_label: tab?.label ?? null,
          blocked_reason:
            tab?.status === 'CLOSED'
              ? 'A comanda está encerrada; o estorno exige tratamento administrativo específico.'
              : payment.provider === 'sandbox' && env.NODE_ENV === 'production'
                ? 'Gateway real não configurado.'
                : null,
        });
      }
    }
  }
  let cashSessions: Row[] = [];
  if (
    targets.some((target) => target.provider === 'CASH' && money(target.refundable_amount) > 0n)
  ) {
    const registers = await s.list('cash_registers');
    cashSessions = (await s.list('cash_sessions', sql`status='OPEN'`)).map((row) => ({
      id: row.id,
      name: registers.find((register) => register.id === row.register_id)?.name ?? 'Caixa',
      opened_at: row.opened_at,
    }));
  }
  return {
    order_id: order.id,
    table_number: table?.number ?? null,
    service_mode: order.service_mode,
    total: order.total,
    status: order.status,
    refund_required_amount: formatDecimal(remaining),
    can_refund: canRefund,
    cancellation_blockers: [...blockers],
    can_cancel: remaining === 0n && blockers.size === 0,
    refund_targets: targets,
    cash_sessions: cashSessions,
  };
}
