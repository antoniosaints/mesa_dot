import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { permit } from '../../../packages/shared/src/index.js';

/** Production display context, without redemption tokens or financial information. */
export async function productionContext(s: Scope) {
  permit(s.actor, 'production.manage');
  const [jobs, modifiers] = await Promise.all([
    rows(
      s.tx,
      sql`
      SELECT j.*, UNIX_TIMESTAMP(j.created_at) AS queued_epoch,
        t.public_number, t.status AS ticket_status, i.id AS order_item_id,
        i.name_snapshot AS product, i.notes, o.id AS order_id, o.status AS order_status,o.service_mode,o.customer_name,
        d.id AS table_id, d.number AS table_number, tb.id AS tab_id, tb.label AS tab_label,
        ts.id AS session_id
      FROM production_jobs j
      JOIN tickets t ON t.tenant_id=j.tenant_id AND t.establishment_id=j.establishment_id AND t.id=j.ticket_id
      JOIN order_items i ON i.tenant_id=t.tenant_id AND i.establishment_id=t.establishment_id AND i.id=t.order_item_id
      JOIN orders o ON o.tenant_id=i.tenant_id AND o.establishment_id=i.establishment_id AND o.id=i.order_id
      LEFT JOIN order_item_assignments a ON a.tenant_id=i.tenant_id AND a.establishment_id=i.establishment_id AND a.order_item_id=i.id
      JOIN tabs tb ON tb.tenant_id=o.tenant_id AND tb.establishment_id=o.establishment_id AND tb.id=COALESCE(a.tab_id,o.tab_id)
      LEFT JOIN table_sessions ts ON ts.tenant_id=tb.tenant_id AND ts.establishment_id=tb.establishment_id AND ts.id=tb.session_id
      LEFT JOIN dining_tables d ON d.tenant_id=ts.tenant_id AND d.establishment_id=ts.establishment_id AND d.id=ts.table_id
      WHERE j.tenant_id=${s.actor.tenantId} AND j.establishment_id=${s.actor.establishmentId}
        AND j.status IN ('PENDING','PREPARING')
      ORDER BY j.created_at, j.id`,
    ),
    rows(
      s.tx,
      sql`
      SELECT DISTINCT m.id, m.order_item_id, m.name_snapshot, m.created_at
      FROM order_item_modifiers m
      JOIN tickets t ON t.tenant_id=m.tenant_id AND t.establishment_id=m.establishment_id AND t.order_item_id=m.order_item_id
      JOIN production_jobs j ON j.tenant_id=t.tenant_id AND j.establishment_id=t.establishment_id AND j.ticket_id=t.id
      WHERE m.tenant_id=${s.actor.tenantId} AND m.establishment_id=${s.actor.establishmentId}
        AND j.status IN ('PENDING','PREPARING')
      ORDER BY m.created_at, m.id`,
    ),
  ]);
  const byItem = new Map<string, string[]>();
  for (const m of modifiers)
    byItem.set(m.order_item_id, [...(byItem.get(m.order_item_id) ?? []), m.name_snapshot]);
  return jobs.map(({ queued_epoch, ...job }: Row) => ({
    ...job,
    created_at_iso: new Date(Number(queued_epoch) * 1000).toISOString(),
    modifiers: byItem.get(job.order_item_id) ?? [],
  }));
}
