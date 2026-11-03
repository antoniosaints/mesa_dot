import { pageFields } from './pagination.js';
import { pageInfo } from '../../../packages/shared/src/pagination.js';
import { z } from 'zod';
import { Scope, rows, sql } from '../../../packages/database/src/index.js';
import { ensure, money, formatDecimal } from '../../../packages/shared/src/index.js';

const day = z.iso.date().refine((v) => v >= '2020-01-01' && v <= '2099-12-31');
const querySchema = z
  .object({
    start: day,
    end: day,
    establishment_id: z.uuid().optional(),
    kind: z.enum(['sales', 'payments', 'receivables', 'movements', 'closures']).default('sales'),
    search: z.string().trim().max(120).default(''),
    status: z.string().max(40).default(''),
    method: z.string().max(30).default(''),
    sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
    ...pageFields,
  })
  .strict();
export function financeRange(start: string, end: string) {
  const from = new Date(`${start}T03:00:00.000Z`);
  const until = new Date(new Date(`${end}T03:00:00.000Z`).getTime() + 86400000);
  const days = (until.getTime() - from.getTime()) / 86400000;
  ensure(
    Number.isFinite(days) && days > 0 && days <= 366,
    'BAD_REQUEST',
    'Escolha um período de até 366 dias, com a data final igual ou posterior à inicial.',
    400,
  );
  return { from, until, previous: new Date(from.getTime() - days * 86400000), days };
}
export async function isAccountAdmin(s: Scope) {
  const members = await rows(
    s.tx,
    sql`SELECT tm.is_account_admin FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id JOIN tenants t ON t.id=tm.tenant_id WHERE tm.tenant_id=${s.actor.tenantId} AND tm.user_id=${s.actor.id} AND tm.enabled=TRUE AND u.enabled=TRUE AND t.enabled=TRUE`,
  );
  return s.actor.kind === 'STAFF' && Boolean(members[0]?.is_account_admin);
}
export async function assertAccountAdmin(s: Scope) {
  ensure(
    await isAccountAdmin(s),
    'FORBIDDEN',
    'Financeiro restrito ao administrador geral da conta.',
    403,
  );
}
export async function financeContext(s: Scope) {
  await assertAccountAdmin(s);
  return {
    timezone: 'America/Sao_Paulo',
    establishments: await rows(
      s.tx,
      sql`SELECT e.id,e.name,e.slug FROM establishments e JOIN staff_memberships m ON m.tenant_id=e.tenant_id AND m.establishment_id=e.id AND m.user_id=${s.actor.id} AND m.enabled=TRUE WHERE e.tenant_id=${s.actor.tenantId} ORDER BY e.name,e.id`,
    ),
  };
}
async function context(s: Scope, raw: unknown) {
  await assertAccountAdmin(s);
  const q = querySchema.parse(raw);
  const id = q.establishment_id ?? s.actor.establishmentId;
  const units = await rows(
    s.tx,
    sql`SELECT e.id,e.name FROM establishments e JOIN staff_memberships m ON m.tenant_id=e.tenant_id AND m.establishment_id=e.id AND m.user_id=${s.actor.id} AND m.enabled=TRUE WHERE e.tenant_id=${s.actor.tenantId} AND e.id=${id}`,
  );
  ensure(units.length, 'NOT_FOUND', 'Unidade não encontrada nesta conta.', 404);
  return {
    q,
    unit: units[0],
    s: new Scope(s.tx, { ...s.actor, establishmentId: id }),
    ...financeRange(q.start, q.end),
  };
}
// Every subquery is constrained to both tenant and establishment, including aggregates.
export function tabRows(s: Scope) {
  return sql`SELECT t.id,t.session_id,t.label name,t.status,t.created_at,IF(t.mode='COUNTER','COUNTER','TABLE') service_mode,d.number table_number,c.name customer_name,
    COALESCE(e.charges,0) charges,COALESCE(e.credits,0) credits,COALESCE(e.discounts,0) discounts,
    COALESCE(p.paid,0)-COALESCE(r.refunded,0) paid,
    COALESCE(e.charges,0)-COALESCE(e.credits,0)-COALESCE(e.discounts,0)-COALESCE(p.paid,0)+COALESCE(r.refunded,0) balance
    FROM tabs t LEFT JOIN table_sessions ts ON ts.id=t.session_id AND ts.tenant_id=t.tenant_id AND ts.establishment_id=t.establishment_id
    LEFT JOIN dining_tables d ON d.id=ts.table_id AND d.tenant_id=t.tenant_id AND d.establishment_id=t.establishment_id
    LEFT JOIN customers c ON c.id=t.owner_customer_id AND c.tenant_id=t.tenant_id AND c.establishment_id=t.establishment_id
    LEFT JOIN (SELECT tab_id,SUM(IF(type='CHARGE',amount,0)) charges,SUM(IF(type='CREDIT',amount,0)) credits,SUM(IF(type='DISCOUNT',amount,0)) discounts FROM financial_entries WHERE ${s.where()} GROUP BY tab_id) e ON e.tab_id=t.id
    LEFT JOIN (SELECT pa.tab_id,SUM(pa.amount) paid FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id AND p.tenant_id=pa.tenant_id AND p.establishment_id=pa.establishment_id WHERE pa.tenant_id=${s.actor.tenantId} AND pa.establishment_id=${s.actor.establishmentId} AND p.status IN ('APPROVED','PARTIALLY_REFUNDED','REFUNDED') GROUP BY pa.tab_id) p ON p.tab_id=t.id
    LEFT JOIN (SELECT tab_id,SUM(amount) refunded FROM refunds WHERE ${s.where(sql`status='APPROVED'`)} GROUP BY tab_id) r ON r.tab_id=t.id
    WHERE t.tenant_id=${s.actor.tenantId} AND t.establishment_id=${s.actor.establishmentId}`;
}
export async function periodTotals(s: Scope, from: Date, until: Date) {
  const [ledger, payments, refunds, attendances] = await Promise.all([
    rows(
      s.tx,
      sql`SELECT COALESCE(SUM(IF(type='CHARGE',amount,0)),0) gross,COALESCE(SUM(IF(type='CREDIT',amount,0)),0) cancellations,COALESCE(SUM(IF(type='DISCOUNT',amount,0)),0) discounts,COUNT(DISTINCT IF(type='CHARGE',order_id,NULL)) orders FROM financial_entries WHERE ${s.where(sql`created_at>=${from} AND created_at<${until}`)}`,
    ),
    rows(
      s.tx,
      sql`SELECT COALESCE(SUM(amount),0) amount FROM payments WHERE ${s.where(sql`confirmed_at>=${from} AND confirmed_at<${until} AND status IN ('APPROVED','PARTIALLY_REFUNDED','REFUNDED')`)}`,
    ),
    rows(
      s.tx,
      sql`SELECT COALESCE(SUM(amount),0) amount FROM refunds WHERE ${s.where(sql`created_at>=${from} AND created_at<${until} AND status='APPROVED'`)}`,
    ),
    rows(
      s.tx,
      sql`SELECT COUNT(*) count FROM table_sessions WHERE ${s.where(sql`created_at>=${from} AND created_at<${until}`)}`,
    ),
  ]);
  const l = ledger[0],
    net = money(l.gross) - money(l.cancellations) - money(l.discounts);
  return {
    ...l,
    revenue: formatDecimal(net),
    received_gross: payments[0].amount,
    refunds: refunds[0].amount,
    received: formatDecimal(money(payments[0].amount) - money(refunds[0].amount)),
    average: formatDecimal(
      Number(l.orders)
        ? (net + (net >= 0n ? 1n : -1n) * (BigInt(l.orders) / 2n)) / BigInt(l.orders)
        : 0n,
    ),
    attendances: Number(attendances[0].count),
  };
}
export async function financeDashboard(scope: Scope, raw: unknown) {
  const { s, q, unit, from, until, previous, days } = await context(scope, raw);
  const [totals, comparison, balances, hourly, methods, cash, registers, flow] = await Promise.all([
    periodTotals(s, from, until),
    periodTotals(s, previous, from),
    rows(
      s.tx,
      sql`SELECT COUNT(*) tabs,SUM(balance>0) outstanding_tabs,SUM(balance<=0) settled_tabs,COALESCE(SUM(GREATEST(balance,0)),0) outstanding FROM (${tabRows(s)}) b WHERE status<>'CLOSED'`,
    ),
    rows(
      s.tx,
      sql`SELECT HOUR(DATE_SUB(created_at,INTERVAL 3 HOUR)) hour,COALESCE(SUM(IF(type='CHARGE',amount,-amount)),0) amount FROM financial_entries WHERE ${s.where(sql`created_at>=${from} AND created_at<${until}`)} GROUP BY hour ORDER BY hour`,
    ),
    rows(
      s.tx,
      sql`SELECT provider,SUM(gross) gross,SUM(refunded) refunded,SUM(gross)-SUM(refunded) net FROM (
      SELECT provider,amount gross,0 refunded FROM payments WHERE ${s.where(sql`confirmed_at>=${from} AND confirmed_at<${until} AND status IN ('APPROVED','PARTIALLY_REFUNDED','REFUNDED')`)}
      UNION ALL SELECT p.provider,0 gross,r.amount refunded FROM refunds r JOIN payments p ON p.id=r.payment_id AND p.tenant_id=r.tenant_id AND p.establishment_id=r.establishment_id WHERE r.tenant_id=${s.actor.tenantId} AND r.establishment_id=${s.actor.establishmentId} AND r.status='APPROVED' AND r.created_at>=${from} AND r.created_at<${until}
      ) m GROUP BY provider ORDER BY net DESC,provider`,
    ),
    rows(
      s.tx,
      sql`SELECT cs.id,cs.register_id,cs.created_at,cs.opening_amount,cr.name register_name,u.name opened_by_name,COALESCE(m.cash_sales,0) cash_sales,COALESCE(m.refunds,0) refunds,COALESCE(m.withdrawals,0) withdrawals,COALESCE(m.supplies,0) supplies,cs.opening_amount+COALESCE(m.net_cash,0) expected FROM cash_sessions cs JOIN cash_registers cr ON cr.id=cs.register_id AND cr.tenant_id=cs.tenant_id AND cr.establishment_id=cs.establishment_id LEFT JOIN users u ON u.id=cs.opened_by LEFT JOIN (SELECT cash_session_id,SUM(IF(type='CASH',amount,0)) cash_sales,SUM(IF(type='REFUND',amount,0)) refunds,SUM(IF(type='WITHDRAWAL',amount,0)) withdrawals,SUM(IF(type='SUPPLY',amount,0)) supplies,SUM(IF(type IN ('CASH','REFUND','WITHDRAWAL','SUPPLY'),amount,0)) net_cash FROM cash_movements WHERE ${s.where()} GROUP BY cash_session_id) m ON m.cash_session_id=cs.id WHERE cs.tenant_id=${s.actor.tenantId} AND cs.establishment_id=${s.actor.establishmentId} AND cs.status='OPEN' ORDER BY cs.created_at DESC,cs.id`,
    ),
    s.list('cash_registers'),
    rows(
      s.tx,
      sql`SELECT day,SUM(received) received,SUM(refunded) refunded,SUM(received)-SUM(refunded) net FROM (
      SELECT DATE_FORMAT(DATE_SUB(confirmed_at,INTERVAL 3 HOUR),'%Y-%m-%d') day,amount received,0 refunded FROM payments WHERE ${s.where(sql`confirmed_at>=${from} AND confirmed_at<${until} AND status IN ('APPROVED','PARTIALLY_REFUNDED','REFUNDED')`)}
      UNION ALL SELECT DATE_FORMAT(DATE_SUB(created_at,INTERVAL 3 HOUR),'%Y-%m-%d') day,0 received,amount refunded FROM refunds WHERE ${s.where(sql`created_at>=${from} AND created_at<${until} AND status='APPROVED'`)}
      ) f GROUP BY day ORDER BY day`,
    ),
  ]);
  return {
    actor_unit_id: scope.actor.establishmentId,
    unit,
    q: { start: q.start, end: q.end },
    timezone: 'America/Sao_Paulo',
    days,
    totals,
    comparison,
    current: balances[0],
    hourly,
    methods,
    cash,
    flow,
    registers: registers.map((r) => ({ id: r.id, name: r.name })),
    generated_at: new Date().toISOString(),
  };
}
export async function financeRecords(scope: Scope, raw: unknown) {
  const { s, q, from, until } = await context(scope, raw);
  let source;
  if (q.kind === 'sales')
    source = sql`SELECT o.id,COALESCE(o.confirmed_at,o.created_at) occurred_at,o.status,'' provider,o.total amount,d.number table_number,t.label tab_name,COALESCE(o.customer_name,c.name,'') customer_name,o.source,o.payment_policy_snapshot,o.service_mode,
    COALESCE(i.items,0) items FROM orders o LEFT JOIN dining_tables d ON d.id=o.table_id AND d.tenant_id=o.tenant_id AND d.establishment_id=o.establishment_id LEFT JOIN tabs t ON t.id=o.tab_id AND t.tenant_id=o.tenant_id AND t.establishment_id=o.establishment_id LEFT JOIN customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id AND c.establishment_id=o.establishment_id LEFT JOIN (SELECT order_id,SUM(quantity) items FROM order_items WHERE ${s.where()} GROUP BY order_id) i ON i.order_id=o.id WHERE o.tenant_id=${s.actor.tenantId} AND o.establishment_id=${s.actor.establishmentId} AND COALESCE(o.confirmed_at,o.created_at)>=${from} AND COALESCE(o.confirmed_at,o.created_at)<${until}`;
  else if (q.kind === 'payments')
    source = sql`SELECT p.id,COALESCE(p.confirmed_at,p.created_at) occurred_at,p.status,p.provider,p.amount,COALESCE(r.amount,0) refunded,IF(p.status IN ('APPROVED','PARTIALLY_REFUNDED','REFUNDED'),p.amount,0)-COALESCE(r.amount,0) net,COALESCE(a.tabs,'') tab_name FROM payments p LEFT JOIN (SELECT payment_id,SUM(amount) amount FROM refunds WHERE ${s.where(sql`status='APPROVED'`)} GROUP BY payment_id) r ON r.payment_id=p.id LEFT JOIN (SELECT pa.payment_id,GROUP_CONCAT(DISTINCT CONCAT(IF(t.mode='COUNTER','Balcão',CONCAT('Mesa ',d.number)),' · ',t.label) ORDER BY d.number SEPARATOR ' / ') tabs FROM payment_allocations pa JOIN tabs t ON t.id=pa.tab_id AND t.tenant_id=pa.tenant_id AND t.establishment_id=pa.establishment_id LEFT JOIN table_sessions ts ON ts.id=t.session_id AND ts.tenant_id=t.tenant_id AND ts.establishment_id=t.establishment_id LEFT JOIN dining_tables d ON d.id=ts.table_id AND d.tenant_id=ts.tenant_id AND d.establishment_id=ts.establishment_id WHERE pa.tenant_id=${s.actor.tenantId} AND pa.establishment_id=${s.actor.establishmentId} GROUP BY pa.payment_id) a ON a.payment_id=p.id WHERE p.tenant_id=${s.actor.tenantId} AND p.establishment_id=${s.actor.establishmentId} AND COALESCE(p.confirmed_at,p.created_at)>=${from} AND COALESCE(p.confirmed_at,p.created_at)<${until}`;
  else if (q.kind === 'receivables')
    source = sql`SELECT b.*,created_at occurred_at,balance amount,'' provider,name tab_name FROM (${tabRows(s)}) b WHERE balance>0`;
  else if (q.kind === 'movements')
    source = sql`SELECT m.id,m.created_at occurred_at,m.type status,m.type provider,m.amount,m.reason,cr.name register_name,m.cash_session_id FROM cash_movements m JOIN cash_sessions cs ON cs.id=m.cash_session_id AND cs.tenant_id=m.tenant_id AND cs.establishment_id=m.establishment_id JOIN cash_registers cr ON cr.id=cs.register_id AND cr.tenant_id=cs.tenant_id AND cr.establishment_id=cs.establishment_id WHERE m.tenant_id=${s.actor.tenantId} AND m.establishment_id=${s.actor.establishmentId} AND m.created_at>=${from} AND m.created_at<${until}`;
  else
    source = sql`SELECT cs.id,cs.closed_at occurred_at,cs.status,'' provider,cs.counted_amount amount,cs.opening_amount,cr.name register_name,u.name closed_by_name,cs.opening_amount+COALESCE(m.net,0) expected,cs.counted_amount-cs.opening_amount-COALESCE(m.net,0) difference FROM cash_sessions cs JOIN cash_registers cr ON cr.id=cs.register_id AND cr.tenant_id=cs.tenant_id AND cr.establishment_id=cs.establishment_id LEFT JOIN users u ON u.id=cs.closed_by LEFT JOIN (SELECT cash_session_id,SUM(IF(type IN ('CASH','REFUND','WITHDRAWAL','SUPPLY'),amount,0)) net FROM cash_movements WHERE ${s.where()} GROUP BY cash_session_id) m ON m.cash_session_id=cs.id WHERE cs.tenant_id=${s.actor.tenantId} AND cs.establishment_id=${s.actor.establishmentId} AND cs.status='CLOSED' AND cs.closed_at>=${from} AND cs.closed_at<${until}`;
  // Search uses a bound literal substring: no wildcard expansion or user SQL identifiers.
  const text = q.search.toLocaleLowerCase('pt-BR');
  const searchable: Record<string, string[]> = {
    sales: ['id', 'table_number', 'tab_name', 'customer_name'],
    payments: ['id', 'tab_name', 'provider'],
    receivables: ['id', 'table_number', 'name', 'customer_name'],
    movements: ['id', 'reason', 'register_name'],
    closures: ['id', 'register_name', 'closed_by_name'],
  };
  const match = sql`(${sql.join(
    searchable[q.kind].map((k) => sql`LOCATE(${text},LOWER(COALESCE(${sql.identifier(k)},'')))>0`),
    sql` OR `,
  )})`;
  const where = sql`${q.search ? match : sql`TRUE`} AND ${q.status ? sql`status=${q.status}` : sql`TRUE`} AND ${q.method ? sql`provider=${q.method}` : sql`TRUE`}`;
  const count = await rows(
    s.tx,
    sql`SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount FROM (${source}) records WHERE ${where}`,
  );
  const total = Number(count[0].count),
    page = pageInfo(total, q.page, q.page_size).page;
  const orderBy =
    q.sort === 'date_asc'
      ? sql`occurred_at ASC,id`
      : q.sort === 'amount_desc'
        ? sql`amount DESC,occurred_at DESC,id`
        : q.sort === 'amount_asc'
          ? sql`amount ASC,occurred_at DESC,id`
          : sql`occurred_at DESC,id`;
  const result = await rows(
    s.tx,
    sql`SELECT * FROM (${source}) records WHERE ${where} ORDER BY ${orderBy} LIMIT ${q.page_size} OFFSET ${(page - 1) * q.page_size}`,
  );
  return {
    rows: result,
    total,
    amount: count[0].amount,
    page,
    page_size: q.page_size,
    kind: q.kind,
  };
}
