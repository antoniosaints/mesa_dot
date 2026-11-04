import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure } from '../../../packages/shared/src/index.js';
/** Receiving operators can choose a named shift without cash-management access. */
export async function activeCashSessions(s: Scope) {
  return rows(
    s.tx,
    sql`SELECT cs.*,cr.name register_name FROM cash_sessions cs
    JOIN cash_registers cr ON cr.id=cs.register_id AND cr.tenant_id=cs.tenant_id AND cr.establishment_id=cs.establishment_id
    JOIN establishments e ON e.id=cs.establishment_id AND e.tenant_id=cs.tenant_id
    WHERE cs.tenant_id=${s.actor.tenantId} AND cs.establishment_id=${s.actor.establishmentId} AND cs.status='OPEN'
    ORDER BY (cs.id=e.order_cash_session_id) DESC,cs.created_at,cs.id`,
  );
}
/** All order/cash transitions acquire this lock first, including the no-open-cash case. */
export async function lockCashUnit(s: Scope): Promise<Row> {
  const units = await rows(
    s.tx,
    sql`SELECT * FROM establishments WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId} FOR UPDATE`,
  );
  ensure(units.length, 'NOT_FOUND', 'Unidade inexistente.', 404);
  return units[0];
}
/** Caller holds lockCashUnit; explicit counter selection wins, otherwise use the operational cash. */
export async function selectOrderCash(
  s: Scope,
  unit: Row,
  explicitId?: string,
): Promise<Row | null> {
  if (explicitId) {
    const selected = await s.get('cash_sessions', explicitId, true);
    ensure(selected.status === 'OPEN', 'INVALID_STATE', 'Caixa encerrado.');
    return selected;
  }
  const open = await rows(
    s.tx,
    sql`SELECT * FROM cash_sessions WHERE ${s.where(sql`status='OPEN'`)} ORDER BY created_at,id FOR UPDATE`,
  );
  return open.find((session) => session.id === unit.order_cash_session_id) ?? open[0] ?? null;
}
export async function setOrderCash(s: Scope, id: string | null) {
  await s.tx.execute(
    sql`UPDATE establishments SET order_cash_session_id=${id} WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
  );
}
