import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import {
  ensure,
  permit,
  money,
  formatDecimal,
  quantity,
  hash,
  opaqueToken,
} from '../../../packages/shared/src/index.js';
import { changeStock } from './inventory.js';
import { tabBalance } from './payments.js';
import { lockCashUnit, selectOrderCash, setOrderCash } from './cash-sessions.js';
export async function dashboard(s: Scope) {
  permit(s.actor, 'reports.view');
  const tables = await s.list('dining_tables', sql`deleted_at IS NULL`);
  const sessions = await s.list('table_sessions', sql`status<>'CLOSED'`);
  let outstanding = 0n;
  for (const session of sessions)
    for (const tab of await s.list('tabs', sql`session_id=${session.id}`))
      outstanding += money((await tabBalance(s, tab.id)).balance);
  return {
    tables: tables.length,
    occupied: sessions.length,
    outstanding: formatDecimal(outstanding),
    service_requests: (await s.list('service_requests', sql`status IN ('OPEN','CLAIMED')`)).length,
    pending_prints: (await s.list('print_jobs', sql`status IN ('PENDING','FAILED')`)).length,
  };
}
export async function inventoryAdjustment(
  s: Scope,
  input: {
    balance_id: string;
    quantity: string;
    type: 'PURCHASE' | 'LOSS' | 'ADJUSTMENT' | 'COUNT';
    reason: string;
  },
) {
  permit(s.actor, 'inventory.adjust');
  const balance = await s.get('stock_balances', input.balance_id, true);
  let delta = quantity(input.quantity);
  if (input.type === 'COUNT') delta -= quantity(balance.physical_quantity);
  if (balance.variant_id && delta > 0n) {
    const variant = await s.get('product_variants', balance.variant_id);
    ensure(
      !variant.deleted_at,
      'INVALID_STATE',
      'Esta variação foi removida. Utilize uma variação disponível para novas entradas de estoque.',
    );
  }
  if (input.type === 'PURCHASE')
    ensure(delta > 0n, 'BAD_REQUEST', 'Compra deve ser positiva.', 400);
  if (input.type === 'LOSS') ensure(delta < 0n, 'BAD_REQUEST', 'Perda deve ser negativa.', 400);
  await changeStock(
    s,
    balance.id,
    delta,
    0n,
    input.type,
    `adjustment:${crypto.randomUUID()}`,
    null,
    input.reason,
  );
  await s.audit('inventory.adjusted', balance.id, {
    type: input.type,
    quantity: input.quantity,
    reason: input.reason,
  });
  return s.get('stock_balances', balance.id);
}
export async function listCashSessions(s: Scope) {
  permit(s.actor, 'cash.manage');
  return rows(
    s.tx,
    sql`SELECT cs.*, cr.name register_name, opener.name opened_by_name, closer.name closed_by_name,
    COALESCE(m.cash_sales,0) cash_sales, COALESCE(m.card_sales,0) card_sales, COALESCE(m.pix_sales,0) pix_sales,
    COALESCE(m.other_receipts,0) other_receipts, COALESCE(m.refunds,0) refunds,
    COALESCE(m.withdrawals,0) withdrawals, COALESCE(m.supplies,0) supplies,
    COALESCE(m.movement_count,0) movement_count,
    cs.opening_amount+COALESCE(m.net_cash,0) expected_amount,
    IF(cs.status='CLOSED',cs.counted_amount-cs.opening_amount-COALESCE(m.net_cash,0),NULL) difference_amount
    FROM cash_sessions cs
    JOIN cash_registers cr ON cr.id=cs.register_id AND cr.tenant_id=cs.tenant_id AND cr.establishment_id=cs.establishment_id
    LEFT JOIN users opener ON opener.id=cs.opened_by
    LEFT JOIN users closer ON closer.id=cs.closed_by
    LEFT JOIN (SELECT cash_session_id,COUNT(*) movement_count,
      SUM(IF(type='CASH',amount,0)) cash_sales,
      SUM(IF(type='CARD_MANUAL',amount,0)) card_sales,
      SUM(IF(type='PIX_MANUAL',amount,0)) pix_sales,
      SUM(IF(type NOT IN ('CASH','CARD_MANUAL','PIX_MANUAL','REFUND','WITHDRAWAL','SUPPLY'),amount,0)) other_receipts,
      SUM(IF(type='REFUND',amount,0)) refunds,
      SUM(IF(type='WITHDRAWAL',amount,0)) withdrawals,
      SUM(IF(type='SUPPLY',amount,0)) supplies,
      SUM(IF(type IN ('CASH','REFUND','WITHDRAWAL','SUPPLY'),amount,0)) net_cash
      FROM cash_movements WHERE ${s.where()} GROUP BY cash_session_id) m ON m.cash_session_id=cs.id
    WHERE cs.tenant_id=${s.actor.tenantId} AND cs.establishment_id=${s.actor.establishmentId}
    ORDER BY cs.created_at DESC,cs.id`,
  );
}
export async function openCash(s: Scope, input: { register_id: string; opening_amount: string }) {
  permit(s.actor, 'cash.manage');
  const unit = await lockCashUnit(s);
  await s.get('cash_registers', input.register_id);
  ensure(
    !(await s.list('cash_sessions', sql`register_id=${input.register_id} AND status='OPEN'`))
      .length,
    'CONFLICT',
    'Caixa já aberto.',
  );
  const session = await s.insert('cash_sessions', {
    ...input,
    status: 'OPEN',
    opened_by: s.actor.id,
  });
  await s.audit('cash.opened', session.id);
  if (
    !unit.order_cash_session_id ||
    !(await s.list('cash_sessions', sql`id=${unit.order_cash_session_id} AND status='OPEN'`)).length
  )
    await setOrderCash(s, session.id);
  await s.event('cash.opened', session.id);
  return session;
}
export async function closeCash(s: Scope, id: string, counted: string) {
  permit(s.actor, 'cash.manage');
  const unit = await lockCashUnit(s);
  const session = await s.get('cash_sessions', id, true);
  ensure(session.status === 'OPEN', 'INVALID_STATE', 'Caixa já encerrado.');
  let expected = money(session.opening_amount);
  for (const movement of await s.list('cash_movements', sql`cash_session_id=${id}`))
    if (['CASH', 'REFUND', 'WITHDRAWAL', 'SUPPLY'].includes(movement.type))
      expected += money(movement.amount);
  await s.update('cash_sessions', id, {
    status: 'CLOSED',
    counted_amount: counted,
    closed_by: s.actor.id,
    closed_at: new Date(),
  });
  await s.audit('cash.closed', id, {
    expected: formatDecimal(expected),
    counted,
    difference: formatDecimal(money(counted) - expected),
  });
  if (unit.order_cash_session_id === id)
    await setOrderCash(s, (await selectOrderCash(s, unit))?.id ?? null);
  await s.event('cash.closed', id);
  return {
    id,
    expected: formatDecimal(expected),
    counted,
    difference: formatDecimal(money(counted) - expected),
  };
}
export async function cashMovement(
  s: Scope,
  input: { cash_session_id: string; type: 'WITHDRAWAL' | 'SUPPLY'; amount: string; reason: string },
) {
  permit(s.actor, 'cash.manage');
  await lockCashUnit(s);
  ensure(
    (await s.get('cash_sessions', input.cash_session_id)).status === 'OPEN',
    'INVALID_STATE',
    'Caixa encerrado.',
  );
  const value = money(input.amount);
  ensure(value > 0n, 'BAD_REQUEST', 'Valor deve ser positivo.', 400);
  const movement = await s.insert('cash_movements', {
    ...input,
    amount: formatDecimal(input.type === 'WITHDRAWAL' ? -value : value),
    source_key: crypto.randomUUID(),
  });
  await s.audit('cash.movement', movement.id);
  return movement;
}
export async function discount(s: Scope, tabId: string, input: { amount: string; reason: string }) {
  permit(s.actor, 'order.discount');
  const tab = await s.get('tabs', tabId);
  ensure(tab.status !== 'CLOSED', 'INVALID_STATE', 'Comanda encerrada.');
  ensure(
    money(input.amount) > 0n && money(input.amount) <= money((await tabBalance(s, tabId)).balance),
    'BAD_REQUEST',
    'Desconto excede o saldo.',
    400,
  );
  const entry = await s.insert('financial_entries', {
    tab_id: tabId,
    type: 'DISCOUNT',
    amount: input.amount,
    source_key: `discount:${crypto.randomUUID()}`,
    reason: input.reason,
    created_by: s.actor.id,
  });
  await s.audit('tab.discount', tabId, input);
  return entry;
}
export async function createAgent(
  s: Scope,
  name: string,
  transport: 'TCP' | 'PRINTBRIDGE' = 'TCP',
) {
  permit(s.actor, 'print.manage');
  const token = opaqueToken();
  const agent = await s.insert('print_agents', { name, token_hash: hash(token), transport });
  await s.audit('print.agent_created', agent.id);
  return { id: agent.id, name, token };
}
export function sanitizeRow(row: Row) {
  const {
    token_hash: _hash,
    token_nonce: _nonce,
    join_nonce: _join,
    password_hash: _password,
    refresh_hash: _refresh,
    ...safe
  } = row;
  return safe;
}
