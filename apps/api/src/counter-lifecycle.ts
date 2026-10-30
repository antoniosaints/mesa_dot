import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { money } from '../../../packages/shared/src/index.js';
import { tabBalance } from './payments.js';
export async function closeCounterIfComplete(s: Scope, order: Row) {
  if (order.service_mode !== 'COUNTER' || !order.tab_id) return;
  const tab = await s.get('tabs', order.tab_id);
  if (tab.status === 'CLOSED' || money((await tabBalance(s, tab.id)).balance) !== 0n) return;
  const pending = await rows(
    s.tx,
    sql`SELECT t.id FROM tickets t JOIN order_items i ON i.id=t.order_item_id AND i.tenant_id=t.tenant_id AND i.establishment_id=t.establishment_id WHERE t.tenant_id=${s.actor.tenantId} AND t.establishment_id=${s.actor.establishmentId} AND i.order_id=${order.id} AND t.status NOT IN ('REDEEMED','CANCELLED') LIMIT 1`,
  );
  if (pending.length) return;
  await s.update('tabs', tab.id, { status: 'CLOSED' });
  await s.audit('counter.completed', order.id);
  await s.event('counter.completed', order.id);
}
