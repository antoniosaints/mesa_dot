import { z } from 'zod';
import { rows, sql, type Scope } from '../../../packages/database/src/index.js';
import { ensure, permit } from '../../../packages/shared/src/index.js';
import { businessAvailability } from '../../../packages/shared/src/business-hours.js';
import { financeRange, isAccountAdmin, periodTotals, tabRows } from './finance.js';

export async function dashboardOverview(s: Scope, raw: unknown) {
  permit(s.actor, 'reports.view');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const q = z
    .object({ start: z.iso.date().default(today), end: z.iso.date().default(today) })
    .strict()
    .parse(raw);
  const range = financeRange(q.start, q.end);
  ensure(range.days <= 90, 'BAD_REQUEST', 'Escolha um período de até 90 dias.', 400);
  const can = (permission: string) => s.actor.permissions.includes(permission);
  const access = {
    tables: can('table.view'),
    orders: can('table.view') || can('order.create'),
    deliveries: can('ticket.view'),
    requests: can('ticket.redeem'),
    production: can('production.manage'),
    inventory: can('inventory.view'),
    printing: can('print.manage'),
    cash: can('cash.manage'),
    financial: await isAccountAdmin(s),
  };
  const [unit] = await rows(
    s.tx,
    sql`SELECT e.id,e.name,e.tenant_id,t.name account_name,e.is_open,e.opening_hours
    FROM establishments e JOIN tenants t ON t.id=e.tenant_id WHERE e.id=${s.actor.establishmentId} AND e.tenant_id=${s.actor.tenantId}`,
  );
  ensure(unit, 'NOT_FOUND', 'Filial não encontrada nesta conta.', 404);
  const { from, until, previous, days } = range;
  const period = sql`COALESCE(confirmed_at,created_at)>=${from} AND COALESCE(confirmed_at,created_at)<${until}`;
  const tableData = async () => {
    const [totals, live, attendances] = await Promise.all([
      rows(
        s.tx,
        sql`SELECT COUNT(*) count FROM dining_tables WHERE ${s.where(sql`enabled=TRUE AND deleted_at IS NULL`)}`,
      ),
      rows(
        s.tx,
        sql`SELECT ts.status,COUNT(*) count FROM table_sessions ts JOIN dining_tables d ON d.id=ts.table_id AND d.tenant_id=ts.tenant_id AND d.establishment_id=ts.establishment_id
        WHERE ts.tenant_id=${s.actor.tenantId} AND ts.establishment_id=${s.actor.establishmentId} AND ts.status<>'CLOSED' AND d.enabled=TRUE AND d.deleted_at IS NULL GROUP BY ts.status`,
      ),
      rows(
        s.tx,
        sql`SELECT ts.id,ts.table_id,d.number,ts.status,ts.opened_at,
        (SELECT COUNT(*) FROM tabs t WHERE t.tenant_id=ts.tenant_id AND t.establishment_id=ts.establishment_id AND t.session_id=ts.id AND t.status<>'CLOSED') tabs
        FROM table_sessions ts JOIN dining_tables d ON d.id=ts.table_id AND d.tenant_id=ts.tenant_id AND d.establishment_id=ts.establishment_id
        WHERE ts.tenant_id=${s.actor.tenantId} AND ts.establishment_id=${s.actor.establishmentId} AND ts.status<>'CLOSED' ORDER BY ts.opened_at,ts.id LIMIT 8`,
      ),
    ]);
    const occupied = live.reduce((sum, row) => sum + Number(row.count), 0),
      total = Number(totals[0].count);
    return {
      total,
      occupied,
      free: Math.max(0, total - occupied),
      closing: live
        .filter((row) => row.status !== 'OPEN')
        .reduce((sum, row) => sum + Number(row.count), 0),
      attendances,
    };
  };
  const orderData = async () => {
    const [statuses, series, sources, top, recent] = await Promise.all([
      rows(
        s.tx,
        sql`SELECT status,COUNT(*) count FROM orders WHERE ${s.where(period)} GROUP BY status`,
      ),
      rows(
        s.tx,
        sql`SELECT DATE_FORMAT(DATE_SUB(COALESCE(confirmed_at,created_at),INTERVAL 3 HOUR),${days === 1 ? '%Y-%m-%d %H:00' : '%Y-%m-%d'}) bucket,COUNT(*) count FROM orders WHERE ${s.where(sql`${period} AND status='CONFIRMED'`)} GROUP BY bucket ORDER BY bucket`,
      ),
      rows(
        s.tx,
        sql`SELECT source,service_mode,COUNT(*) count FROM orders WHERE ${s.where(sql`${period} AND status='CONFIRMED'`)} GROUP BY source,service_mode`,
      ),
      rows(
        s.tx,
        sql`SELECT i.product_id,MAX(p.name) name,SUM(i.quantity) quantity FROM order_items i
        JOIN orders o ON o.id=i.order_id AND o.tenant_id=i.tenant_id AND o.establishment_id=i.establishment_id
        JOIN products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id AND p.establishment_id=i.establishment_id
        WHERE o.tenant_id=${s.actor.tenantId} AND o.establishment_id=${s.actor.establishmentId} AND o.status='CONFIRMED' AND COALESCE(o.confirmed_at,o.created_at)>=${from} AND COALESCE(o.confirmed_at,o.created_at)<${until}
        GROUP BY i.product_id ORDER BY quantity DESC,i.product_id LIMIT 5`,
      ),
      access.tables
        ? rows(
            s.tx,
            sql`SELECT o.id,o.status,o.source,o.service_mode,o.created_at,o.confirmed_at,d.number table_number
        FROM orders o LEFT JOIN dining_tables d ON d.id=o.table_id AND d.tenant_id=o.tenant_id AND d.establishment_id=o.establishment_id
        WHERE o.tenant_id=${s.actor.tenantId} AND o.establishment_id=${s.actor.establishmentId} AND COALESCE(o.confirmed_at,o.created_at)>=${from} AND COALESCE(o.confirmed_at,o.created_at)<${until}
        ORDER BY COALESCE(o.confirmed_at,o.created_at) DESC,o.id LIMIT 6`,
          )
        : [],
    ]);
    return {
      statuses,
      series,
      sources,
      top,
      recent,
      confirmed: Number(statuses.find((row) => row.status === 'CONFIRMED')?.count ?? 0),
      cancelled: Number(statuses.find((row) => row.status === 'CANCELLED')?.count ?? 0),
    };
  };
  const financialData = async () => {
    const [totals, comparison, balance] = await Promise.all([
      periodTotals(s, from, until),
      periodTotals(s, previous, from),
      rows(
        s.tx,
        sql`SELECT COALESCE(SUM(GREATEST(balance,0)),0) outstanding,COUNT(*) tabs FROM (${tabRows(s)}) b WHERE status<>'CLOSED'`,
      ),
    ]);
    return {
      totals,
      comparison,
      outstanding: balance[0].outstanding,
      open_tabs: Number(balance[0].tabs),
    };
  };
  const [
    tables,
    orders,
    deliveryRows,
    requestRows,
    productionRows,
    inventoryRows,
    printRows,
    cashRows,
    financial,
  ] = await Promise.all([
    access.tables ? tableData() : null,
    access.orders ? orderData() : null,
    access.deliveries
      ? rows(
          s.tx,
          sql`SELECT status,COUNT(*) count FROM tickets WHERE ${s.where(sql`status<>'CANCELLED' AND (status<>'REDEEMED' OR (redeemed_at>=${from} AND redeemed_at<${until}))`)} GROUP BY status`,
        )
      : null,
    access.requests
      ? rows(
          s.tx,
          sql`SELECT COUNT(*) count,MIN(created_at) oldest FROM service_requests WHERE ${s.where(sql`status IN ('OPEN','CLAIMED')`)}`,
        )
      : null,
    access.production
      ? rows(
          s.tx,
          sql`SELECT j.status,COUNT(*) count FROM production_jobs j JOIN tickets t ON t.id=j.ticket_id AND t.tenant_id=j.tenant_id AND t.establishment_id=j.establishment_id
      WHERE j.tenant_id=${s.actor.tenantId} AND j.establishment_id=${s.actor.establishmentId} AND j.status<>'CANCELLED' AND t.status NOT IN ('REDEEMED','CANCELLED') GROUP BY j.status`,
        )
      : null,
    access.inventory
      ? rows(
          s.tx,
          sql`SELECT COUNT(*) count FROM stock_balances b JOIN products p ON p.id=b.product_id AND p.tenant_id=b.tenant_id AND p.establishment_id=b.establishment_id
      LEFT JOIN product_variants v ON v.id=b.variant_id AND v.tenant_id=b.tenant_id AND v.establishment_id=b.establishment_id
      WHERE b.tenant_id=${s.actor.tenantId} AND b.establishment_id=${s.actor.establishmentId} AND p.enabled=TRUE AND p.stock_policy IN ('ON_CONFIRMATION','ON_DELIVERY','ON_PRODUCTION') AND (b.variant_id IS NULL OR (v.deleted_at IS NULL AND v.stock_mode='OWN')) AND b.physical_quantity-b.reserved_quantity<=0`,
        )
      : null,
    access.printing
      ? rows(
          s.tx,
          sql`SELECT status,COUNT(*) count FROM print_jobs WHERE ${s.where(sql`status IN ('PENDING','PROCESSING','FAILED')`)} GROUP BY status`,
        )
      : null,
    access.cash
      ? rows(
          s.tx,
          sql`SELECT COUNT(*) count,COALESCE(SUM(created_at<UTC_TIMESTAMP(3)-INTERVAL 24 HOUR),0) overdue FROM cash_sessions WHERE ${s.where(sql`status='OPEN'`)}`,
        )
      : null,
    access.financial ? financialData() : null,
  ]);
  const groups = (items: typeof deliveryRows) =>
    items === null ? null : Object.fromEntries(items.map((row) => [row.status, Number(row.count)]));
  return {
    scope: {
      tenant_id: unit.tenant_id,
      establishment_id: unit.id,
      name: unit.name,
      account_name: unit.account_name,
    },
    period: { ...q, days, timezone: 'America/Sao_Paulo', bucket: days === 1 ? 'hour' : 'day' },
    access,
    availability: businessAvailability({
      is_open: unit.is_open,
      opening_hours: unit.opening_hours,
    }),
    tables,
    orders,
    deliveries: groups(deliveryRows),
    requests: requestRows?.[0] ?? null,
    production: groups(productionRows),
    inventory: inventoryRows ? { unavailable_balances: Number(inventoryRows[0].count) } : null,
    printing: groups(printRows),
    cash: cashRows
      ? { open: Number(cashRows[0].count), overdue: Number(cashRows[0].overdue) }
      : null,
    financial,
    generated_at: new Date().toISOString(),
  };
}
