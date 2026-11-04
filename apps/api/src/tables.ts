import { pendingRefundOperations } from './gateway-operations.js';
import { resolveUnit } from '../../../packages/database/src/slugs.js';
import {
  db,
  sql,
  rows,
  Scope,
  type Row,
  type Scope as ScopeType,
} from '../../../packages/database/src/index.js';
import {
  ensure,
  permit,
  hash,
  opaqueToken,
  deriveToken,
  equalSecret,
  money,
  formatDecimal,
} from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { publicActor } from './auth.js';
import { accessTab, unit } from './orders.js';
import { tabBalance } from './payments.js';
export const joinCode = (session: Row) =>
  deriveToken(env.DOCUMENT_KEY ?? '', 'join', session.id, session.join_nonce).slice(0, 12);
// Summarize only the current attendance, using the same ledger rules as tabBalance.
// Each ledger is grouped separately so joins cannot multiply charges or payments.
export async function tableAttendance(s: ScopeType) {
  const tabs = await rows(
    s.tx,
    sql`
    WITH active_tabs AS (
      SELECT t.id,t.label,t.status,t.session_id FROM tabs t
      JOIN table_sessions ts ON ts.id=t.session_id AND ts.tenant_id=t.tenant_id AND ts.establishment_id=t.establishment_id
      WHERE t.tenant_id=${s.actor.tenantId} AND t.establishment_id=${s.actor.establishmentId} AND ts.status<>'CLOSED'
    ), ledger AS (
      SELECT e.tab_id,
        SUM(IF(e.type='CHARGE',e.amount,0)) charges,
        SUM(IF(e.type<>'CHARGE',e.amount,0)) credits
      FROM financial_entries e JOIN active_tabs t ON t.id=e.tab_id
      WHERE e.tenant_id=${s.actor.tenantId} AND e.establishment_id=${s.actor.establishmentId} GROUP BY e.tab_id
    ), received AS (
      SELECT a.tab_id,SUM(a.amount) paid FROM payment_allocations a
      JOIN active_tabs t ON t.id=a.tab_id
      JOIN payments p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id AND p.establishment_id=a.establishment_id
      WHERE a.tenant_id=${s.actor.tenantId} AND a.establishment_id=${s.actor.establishmentId}
        AND p.status IN ('APPROVED','PARTIALLY_REFUNDED','REFUNDED') GROUP BY a.tab_id
    ), returned AS (
      SELECT r.tab_id,SUM(r.amount) refunded FROM refunds r JOIN active_tabs t ON t.id=r.tab_id
      WHERE r.tenant_id=${s.actor.tenantId} AND r.establishment_id=${s.actor.establishmentId} AND r.status='APPROVED' GROUP BY r.tab_id
    )
    SELECT t.*,COALESCE(l.charges,0) charges,COALESCE(l.credits,0) credits,
      COALESCE(p.paid,0)-COALESCE(r.refunded,0) net_paid
    FROM active_tabs t LEFT JOIN ledger l ON l.tab_id=t.id
      LEFT JOIN received p ON p.tab_id=t.id LEFT JOIN returned r ON r.tab_id=t.id
    ORDER BY t.label,t.id
  `,
  );
  const result = new Map<string, { total: bigint; paid: bigint; balance: bigint; tabs: Row[] }>();
  for (const tab of tabs) {
    const summary = result.get(tab.session_id) ?? { total: 0n, paid: 0n, balance: 0n, tabs: [] };
    const total = money(tab.charges) - money(tab.credits),
      paid = money(tab.net_paid);
    summary.total += total;
    summary.paid += paid;
    summary.balance += total - paid;
    summary.tabs.push({
      id: tab.id,
      label: tab.label,
      status: tab.status,
      total: formatDecimal(total),
      paid: formatDecimal(paid),
      balance: formatDecimal(total - paid),
    });
    result.set(tab.session_id, summary);
  }
  return new Map(
    [...result].map(([id, value]) => [
      id,
      {
        total: formatDecimal(value.total),
        paid: formatDecimal(value.paid),
        balance: formatDecimal(value.balance),
        tabs: value.tabs,
      },
    ]),
  );
}
/** Logical deletion preserves the table identity and every historic foreign key. */
export async function deleteTable(s: ScopeType, tableId: string) {
  permit(s.actor, 'table.manage');
  const table = await s.get('dining_tables', tableId, true);
  if (table.deleted_at) return { id: table.id, deleted: true };
  ensure(
    !(await s.list('table_sessions', sql`table_id=${tableId} AND status<>'CLOSED'`)).length,
    'INVALID_STATE',
    'Encerre o atendimento da mesa antes de excluí-la.',
  );
  ensure(
    !(await s.list('orders', sql`table_id=${tableId} AND status='PENDING_PAYMENT'`)).length,
    'INVALID_STATE',
    'A mesa possui um pedido aguardando pagamento. Resolva o pedido antes de excluí-la.',
  );
  await s.update('dining_tables', tableId, { enabled: false, deleted_at: new Date() });
  await s.audit('table.deleted', tableId, { number: table.number });
  await s.event('tables.updated', tableId, { deleted: true });
  return { id: table.id, deleted: true };
}
export async function publicUnit(slug: string) {
  return resolveUnit(db, slug);
}
export async function createVisitor(
  slug: string,
  input: { table_code: string; name: string; phone: string; join_code?: string },
) {
  const u = await publicUnit(slug);
  const token = opaqueToken();
  const result = await db.transaction(async (tx) => {
    await rows(
      tx,
      sql`SELECT id FROM establishments WHERE tenant_id=${u.tenant_id} AND id=${u.id} FOR UPDATE`,
    );
    const s = new Scope(tx, publicActor(u));
    const tables = await s.list(
      'dining_tables',
      sql`public_code=${input.table_code} AND enabled=TRUE AND deleted_at IS NULL`,
    );
    ensure(tables.length, 'NOT_FOUND', 'QR de mesa inválido.', 404);
    const table = tables[0];
    const sessions = await s.list('table_sessions', sql`table_id=${table.id} AND status<>'CLOSED'`);
    const session = sessions[0];
    if (session)
      ensure(
        session.status === 'OPEN' && equalSecret(joinCode(session), input.join_code ?? ''),
        'FORBIDDEN',
        'Mesa ocupada: peça o código de participação ao garçom.',
        403,
      );
    const customer = await s.insert('customers', { name: input.name, phone: input.phone });
    const visitor = await s.insert('visitor_sessions', {
      customer_id: customer.id,
      table_id: table.id,
      session_id: session?.id ?? null,
      token_hash: hash(token),
      expires_at: new Date(Date.now() + u.visitor_ttl_minutes * 60_000),
    });
    if (session)
      await s.insert('table_participants', { session_id: session.id, customer_id: customer.id });
    return {
      establishment_id: u.id,
      visitor_id: visitor.id,
      service_mode: 'TABLE',
      table_id: table.id,
      table_number: table.number,
      expires_in: u.visitor_ttl_minutes * 60,
    };
  });
  return { ...result, token };
}
export async function createCounterVisitor(
  slug: string,
  input: { name: string; phone: string },
  expectedUnit?: string,
) {
  const u = await publicUnit(slug);
  ensure(
    !expectedUnit || expectedUnit === u.id,
    'FORBIDDEN',
    'Estabelecimento diferente do aplicativo.',
    403,
  );
  const token = opaqueToken();
  const result = await db.transaction(async (tx) => {
    await rows(
      tx,
      sql`SELECT id FROM establishments WHERE tenant_id=${u.tenant_id} AND id=${u.id} FOR UPDATE`,
    );
    const s = new Scope(tx, publicActor(u));
    const customer = await s.insert('customers', { name: input.name, phone: input.phone });
    const visitor = await s.insert('visitor_sessions', {
      customer_id: customer.id,
      table_id: null,
      session_id: null,
      service_mode: 'COUNTER',
      token_hash: hash(token),
      expires_at: new Date(Date.now() + u.visitor_ttl_minutes * 60_000),
    });
    return {
      establishment_id: u.id,
      visitor_id: visitor.id,
      table_id: null,
      table_number: null,
      service_mode: 'COUNTER',
      expires_in: u.visitor_ttl_minutes * 60,
    };
  });
  return { ...result, token };
}
export async function createTab(
  s: ScopeType,
  input: { session_id: string; mode: 'SHARED' | 'INDIVIDUAL'; label: string },
) {
  if (s.actor.kind === 'STAFF') permit(s.actor, 'order.create');
  else
    ensure(
      s.actor.kind === 'VISITOR' && s.actor.sessionId === input.session_id,
      'FORBIDDEN',
      'Sessão inválida.',
      403,
    );
  const session = await s.get('table_sessions', input.session_id);
  ensure(session.status === 'OPEN', 'INVALID_STATE', 'Sessão em fechamento.');
  const tab = await s.insert('tabs', {
    ...input,
    status: 'OPEN',
    owner_customer_id: s.actor.customerId ?? null,
  });
  if (s.actor.customerId)
    await s.insert('tab_customers', { tab_id: tab.id, customer_id: s.actor.customerId });
  await s.audit('tab.created', tab.id);
  return tab;
}
export async function joinTab(s: ScopeType, tabId: string) {
  ensure(s.actor.kind === 'VISITOR', 'FORBIDDEN', 'Participação apenas para clientes.', 403);
  const tab = await s.get('tabs', tabId);
  ensure(
    tab.mode === 'SHARED' && tab.status === 'OPEN' && tab.session_id === s.actor.sessionId,
    'FORBIDDEN',
    'Comanda compartilhada não disponível nesta sessão.',
    403,
  );
  const existing = await s.list(
    'tab_customers',
    sql`tab_id=${tabId} AND customer_id=${s.actor.customerId}`,
  );
  if (!existing.length)
    await s.insert('tab_customers', { tab_id: tabId, customer_id: s.actor.customerId });
  return { tab_id: tabId, joined: true };
}
export async function sessionDetails(s: ScopeType, tableId: string) {
  const table = await s.get('dining_tables', tableId);
  if (s.actor.kind === 'VISITOR')
    ensure(s.actor.tableId === tableId, 'FORBIDDEN', 'Mesa inválida.', 403);
  else permit(s.actor, 'table.view');
  const sessions = await s.list('table_sessions', sql`table_id=${tableId} AND status<>'CLOSED'`);
  if (!sessions.length) return { table, session: null, tabs: [] };
  const session = sessions[0];
  if (s.actor.kind === 'VISITOR')
    ensure(
      session.id === s.actor.sessionId,
      'FORBIDDEN',
      'Você não participa desta ocupação.',
      403,
    );
  const tabs = await s.list('tabs', sql`session_id=${session.id}`);
  const visible =
    s.actor.kind === 'VISITOR'
      ? tabs.filter((t) => t.mode === 'SHARED' || t.owner_customer_id === s.actor.customerId)
      : tabs;
  const { join_nonce: _nonce, ...safe } = session;
  return {
    table,
    session: { ...safe, join_code: joinCode(session) },
    tabs: await Promise.all(
      visible.map(async (t) => ({
        ...t,
        financial:
          s.actor.kind === 'STAFF' || t.owner_customer_id === s.actor.customerId
            ? await tabBalance(s, t.id)
            : undefined,
      })),
    ),
  };
}
async function closingState(s: ScopeType, session: Row) {
  const issues: string[] = [];
  const tabs = await s.list('tabs', sql`session_id=${session.id}`);
  const balances: Row[] = await Promise.all(
    tabs.map(async (tab) => ({ ...tab, financial: await tabBalance(s, tab.id) })),
  );
  for (const tab of balances)
    if (money(tab.financial.balance) !== 0n)
      issues.push(`Comanda ${tab.label} com saldo não resolvido.`);
  const unresolvedTickets: Row[] = [],
    unfinishedOrders: Row[] = [],
    pendingPayments: Row[] = [];
  const orders = await s.list('orders', sql`table_id=${session.table_id}`);
  for (const order of orders) {
    if (['DRAFT', 'PENDING_PAYMENT'].includes(order.status)) {
      issues.push(`Pedido ${order.id} não finalizado.`);
      unfinishedOrders.push({ id: order.id, status: order.status });
    }
    if (!tabs.some((t) => t.id === order.tab_id) && order.status === 'CONFIRMED') continue;
    if ((await pendingRefundOperations(s, order.id)).length) {
      issues.push('Estorno aguardando confirmação do Mercado Pago.');
    }
    for (const intent of await s.list('payment_intents', sql`order_id=${order.id}`)) {
      if (['PENDING', 'PROCESSING'].includes(intent.status) && order.status !== 'CANCELLED') {
        issues.push('Pagamento pendente.');
        pendingPayments.push({
          id: intent.id,
          order_id: order.id,
          status: intent.status,
          needs_review: false,
        });
      }
      for (const payment of await s.list('payments', sql`intent_id=${intent.id}`))
        if (payment.review_reason && payment.status !== 'REFUNDED') {
          issues.push('Pagamento necessita conciliação.');
          pendingPayments.push({
            id: payment.id,
            order_id: order.id,
            status: payment.status,
            needs_review: true,
          });
        }
    }
    for (const item of await s.list('order_items', sql`order_id=${order.id}`))
      for (const ticket of await s.list('tickets', sql`order_item_id=${item.id}`))
        if (!['REDEEMED', 'CANCELLED'].includes(ticket.status)) {
          issues.push(`Ficha ${ticket.public_number} ainda não resolvida.`);
          unresolvedTickets.push({
            id: ticket.id,
            public_number: ticket.public_number,
            status: ticket.status,
            product_name: item.name_snapshot,
            order_id: order.id,
          });
        }
  }
  return {
    issues: [...new Set(issues)],
    tabs: balances,
    tickets: unresolvedTickets,
    unfinished_orders: unfinishedOrders,
    pending_payments: pendingPayments,
  };
}
async function closingIssues(s: ScopeType, session: Row) {
  return (await closingState(s, session)).issues;
}
export async function tableClosingReview(s: ScopeType, tableId: string) {
  permit(s.actor, 'table.view');
  const table = await s.get('dining_tables', tableId);
  const sessions = await s.list('table_sessions', sql`table_id=${tableId} AND status<>'CLOSED'`);
  if (!sessions.length)
    return { table_number: table.number, session_id: null, issues: [], can_finalize: false };
  const session = sessions[0],
    state = await closingState(s, session);
  let total = 0n,
    paid = 0n,
    balance = 0n;
  for (const tab of state.tabs) {
    total += money(tab.financial.charges) - money(tab.financial.credits);
    paid += money(tab.financial.net_paid);
    balance += money(tab.financial.balance);
  }
  return {
    ...state,
    table_number: table.number,
    session_id: session.id,
    status: session.status,
    totals: {
      total: formatDecimal(total),
      paid: formatDecimal(paid),
      balance: formatDecimal(balance),
    },
    can_finalize:
      s.actor.permissions.includes('table.release') &&
      (session.status === 'AWAITING_RELEASE' || s.actor.permissions.includes('payment.receive')),
    can_receive: s.actor.permissions.includes('payment.receive'),
    can_view_tickets: s.actor.permissions.includes('ticket.view'),
    can_reopen: session.status !== 'OPEN' && s.actor.permissions.includes('payment.receive'),
    checked_at: new Date().toISOString(),
  };
}
export async function finalizeTable(s: ScopeType, tableId: string, sessionId: string) {
  permit(s.actor, 'table.release');
  await s.get('dining_tables', tableId, true);
  const sessions = await s.list('table_sessions', sql`table_id=${tableId} AND status<>'CLOSED'`);
  ensure(
    sessions[0]?.id === sessionId,
    'INVALID_STATE',
    'O atendimento mudou ou a mesa já foi liberada. Atualize a revisão antes de continuar.',
  );
  // Checkout and release share the existing unit transaction/lock. A pending issue rolls back all changes.
  if (sessions[0].status !== 'AWAITING_RELEASE') {
    const result = await checkoutTable(s, tableId);
    ensure(!result.issues.length, 'INVALID_STATE', result.issues.join(' '));
  }
  return releaseTable(s, tableId);
}
export async function checkoutTable(s: ScopeType, tableId: string) {
  permit(s.actor, 'payment.receive');
  await s.get('dining_tables', tableId, true);
  const sessions = await s.list('table_sessions', sql`table_id=${tableId} AND status<>'CLOSED'`);
  ensure(sessions.length, 'INVALID_STATE', 'Mesa já está livre.');
  const session = sessions[0];
  const issues = await closingIssues(s, session);
  const status = issues.length ? 'CLOSING' : 'AWAITING_RELEASE';
  await s.update('table_sessions', session.id, { status, version: session.version + 1 });
  for (const tab of await s.list('tabs', sql`session_id=${session.id}`))
    await s.update('tabs', tab.id, { status: 'CLOSING' });
  await s.audit('table.checkout', session.id, { status, issues });
  await s.event('table.updated', session.id);
  return { session_id: session.id, status, issues };
}
export async function releaseTable(s: ScopeType, tableId: string) {
  permit(s.actor, 'table.release');
  await s.get('dining_tables', tableId, true);
  const sessions = await s.list('table_sessions', sql`table_id=${tableId} AND status<>'CLOSED'`);
  ensure(
    sessions.length && sessions[0].status === 'AWAITING_RELEASE',
    'INVALID_STATE',
    'Conclua o fechamento antes de liberar.',
  );
  const session = sessions[0];
  const issues = await closingIssues(s, session);
  ensure(!issues.length, 'INVALID_STATE', issues.join(' '));
  for (const tab of await s.list('tabs', sql`session_id=${session.id}`))
    await s.update('tabs', tab.id, { status: 'CLOSED' });
  await s.update('table_sessions', session.id, {
    status: 'CLOSED',
    closed_at: new Date(),
    closed_by: s.actor.id,
    version: session.version + 1,
  });
  for (const visitor of await s.list('visitor_sessions', sql`session_id=${session.id}`))
    await s.update('visitor_sessions', visitor.id, { expires_at: new Date() });
  await s.audit('table.released', session.id);
  await s.event('table.closed', session.id);
  return { table_id: tableId, session_id: session.id, status: 'CLOSED' };
}
export async function transferOrder(
  s: ScopeType,
  tabId: string,
  input: { order_id?: string; item_ids?: string[]; target_tab_id: string },
) {
  permit(s.actor, 'tab.transfer');
  const from = await accessTab(s, tabId);
  const to = await accessTab(s, input.target_tab_id);
  ensure(
    Boolean(from.session_id) &&
      from.mode !== 'COUNTER' &&
      to.mode !== 'COUNTER' &&
      from.id !== to.id &&
      from.session_id === to.session_id &&
      from.status === 'OPEN' &&
      to.status === 'OPEN',
    'INVALID_STATE',
    'Comandas devem estar abertas na mesma sessão.',
  );
  ensure(
    money((await tabBalance(s, from.id)).net_paid) === 0n,
    'INVALID_STATE',
    'Comanda já recebeu pagamentos: resolva as alocações antes de transferir itens.',
  );
  const discounts = await s.list('financial_entries', sql`tab_id=${from.id} AND type='DISCOUNT'`);
  ensure(
    !discounts.length,
    'INVALID_STATE',
    'Comanda com desconto exige redistribuição financeira explícita.',
  );
  let ids = input.item_ids ?? [];
  if (input.order_id)
    ids = (await s.list('order_items', sql`order_id=${input.order_id}`)).map((i) => i.id);
  ensure(
    ids.length && new Set(ids).size === ids.length,
    'BAD_REQUEST',
    'Selecione itens distintos.',
    400,
  );
  const result = [];
  for (const itemId of ids) {
    const item = await s.get('order_items', itemId);
    const order = await s.get('orders', item.order_id);
    ensure(
      order.status === 'CONFIRMED' && order.payment_policy_snapshot === 'POSTPAID',
      'INVALID_STATE',
      'Apenas itens pós-pagos confirmados podem ser transferidos.',
    );
    const assignments = await s.list('order_item_assignments', sql`order_item_id=${item.id}`);
    ensure(
      assignments.length && assignments[0].tab_id === from.id,
      'INVALID_STATE',
      'Item não pertence à comanda de origem.',
    );
    const transfer = await s.insert('order_item_transfers', {
      order_item_id: item.id,
      from_tab_id: from.id,
      target_tab_id: to.id,
      amount: item.total,
      actor_id: s.actor.id,
    });
    await s.insert('financial_entries', {
      tab_id: from.id,
      order_id: order.id,
      type: 'CREDIT',
      amount: item.total,
      source_key: `transfer-out:${transfer.id}`,
      reason: 'Transferência de item',
      created_by: s.actor.id,
    });
    await s.insert('financial_entries', {
      tab_id: to.id,
      order_id: order.id,
      type: 'CHARGE',
      amount: item.total,
      source_key: `transfer-in:${transfer.id}`,
      reason: 'Transferência de item',
      created_by: s.actor.id,
    });
    await s.update('order_item_assignments', assignments[0].id, { tab_id: to.id });
    await s.audit('tab.item_transferred', item.id, {
      from: from.id,
      to: to.id,
      transfer_id: transfer.id,
    });
    result.push(transfer.id);
  }
  await s.event('tab.updated', to.id);
  return { item_ids: ids, target_tab_id: to.id, transfers: result };
}
export async function settings(s: ScopeType) {
  const u = await unit(s);
  return u;
}
