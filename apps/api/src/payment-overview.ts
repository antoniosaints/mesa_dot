import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { permit, money, formatDecimal } from '../../../packages/shared/src/index.js';

/** Add display context without changing payment/refund accounting or exposing gateway credentials. */
export async function paymentOverview(s: Scope, id?: string) {
  permit(s.actor, 'payment.receive');
  if (id) await s.get('payments', id);
  const payments = await rows(
    s.tx,
    sql`
    SELECT *, UNIX_TIMESTAMP(created_at) AS created_epoch FROM payments
    WHERE ${s.where(id ? sql`id=${id}` : undefined)} ORDER BY created_at DESC, id`,
  );
  if (!payments.length) return [];
  const allocations = await rows(
    s.tx,
    sql`
    SELECT a.*, t.label AS tab_label, t.status AS tab_status, IF(t.mode='COUNTER','COUNTER','TABLE') AS service_mode, d.number AS table_number
    FROM payment_allocations a
    JOIN tabs t ON t.tenant_id=a.tenant_id AND t.establishment_id=a.establishment_id AND t.id=a.tab_id
    LEFT JOIN table_sessions ts ON ts.tenant_id=t.tenant_id AND ts.establishment_id=t.establishment_id AND ts.id=t.session_id
    LEFT JOIN dining_tables d ON d.tenant_id=ts.tenant_id AND d.establishment_id=ts.establishment_id AND d.id=ts.table_id
    WHERE a.tenant_id=${s.actor.tenantId} AND a.establishment_id=${s.actor.establishmentId}
    ${id ? sql`AND a.payment_id=${id}` : sql``}`,
  );
  const refunds = await rows(
    s.tx,
    sql`
    SELECT *, UNIX_TIMESTAMP(created_at) AS created_epoch FROM refunds
    WHERE ${s.where(id ? sql`payment_id=${id}` : undefined)} ORDER BY created_at DESC, id`,
  );
  const intents = await rows(
    s.tx,
    sql`
    SELECT i.id, o.id AS order_id,o.service_mode, t.label AS tab_label, d.number AS table_number
    FROM payment_intents i
    JOIN orders o ON o.tenant_id=i.tenant_id AND o.establishment_id=i.establishment_id AND o.id=i.order_id
    LEFT JOIN dining_tables d ON d.tenant_id=o.tenant_id AND d.establishment_id=o.establishment_id AND d.id=o.table_id
    LEFT JOIN tabs t ON t.tenant_id=o.tenant_id AND t.establishment_id=o.establishment_id AND t.id=o.tab_id
    WHERE i.tenant_id=${s.actor.tenantId} AND i.establishment_id=${s.actor.establishmentId}
    ${id ? sql`AND i.id IN (SELECT intent_id FROM payments WHERE ${s.where(sql`id=${id}`)})` : sql``}`,
  );
  const grouped = (records: Row[]) => {
    const map = new Map<string, Row[]>();
    for (const record of records)
      map.set(record.payment_id, [...(map.get(record.payment_id) ?? []), record]);
    return map;
  };
  const byPayment = grouped(allocations),
    refundMap = grouped(refunds),
    intentMap = new Map(intents.map((i) => [i.id, i]));
  const dated = ({ created_epoch, ...record }: Row) => ({
    ...record,
    created_at: new Date(Number(created_epoch) * 1000).toISOString(),
  });
  return payments.map((payment) => {
    const history = refundMap.get(payment.id) ?? [];
    const approved = history.filter((r) => r.status === 'APPROVED');
    const refunded = approved.reduce((sum, r) => sum + money(r.amount), 0n);
    const accepted = ['APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status);
    const refundable = ['APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status);
    const linked = (byPayment.get(payment.id) ?? []).map((a) => {
      const used = approved
        .filter((r) => r.tab_id === a.tab_id)
        .reduce((sum, r) => sum + money(r.amount), 0n);
      return {
        ...a,
        refunded_amount: formatDecimal(used),
        refundable_amount: formatDecimal(
          a.tab_status === 'CLOSED' || !refundable ? 0n : money(a.amount) - used,
        ),
      };
    });
    const available = refundable
      ? linked.length
        ? linked.reduce((sum, a) => sum + money(a.refundable_amount), 0n)
        : money(payment.amount) - refunded
      : 0n;
    return {
      ...dated(payment),
      refunded_amount: formatDecimal(refunded),
      net_amount: formatDecimal(accepted ? money(payment.amount) - refunded : 0n),
      refundable_amount: formatDecimal(available),
      allocations: linked,
      refunds: history.map(dated),
      order: intentMap.get(payment.intent_id) ?? null,
    };
  });
}
