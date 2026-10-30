import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure } from '../../../packages/shared/src/index.js';
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
