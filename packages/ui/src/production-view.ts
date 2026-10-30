import { orderLocationLabel } from '../../shared/src/order-location.js';
import type { Data } from './client.js';
import { normalizeOrderSearch } from './orders-view.js';
export type ProductionFilters = {
  search: string;
  sector: string;
  table: string;
  status: string;
  sort: string;
};
export function productionAge(job: Data, now = Date.now()) {
  const time = new Date(job.created_at_iso).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / 60000)) : null;
}
export function productionAgeLabel(minutes: number | null) {
  if (minutes === null) return 'Horário indisponível';
  if (minutes === 0) return 'Agora';
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`;
}
export function filterProduction(jobs: Data[], f: ProductionFilters) {
  const query = normalizeOrderSearch(f.search);
  return jobs
    .filter(
      (j) =>
        (!f.sector || j.sector === f.sector) &&
        (!f.table ||
          (f.table === 'COUNTER' ? j.service_mode === 'COUNTER' : j.table_id === f.table)) &&
        (!f.status || j.status === f.status) &&
        (!query ||
          normalizeOrderSearch(
            [
              j.product,
              j.public_number,
              j.order_id,
              orderLocationLabel(j),
              j.tab_label,
              j.notes,
              ...(j.modifiers ?? []),
            ].join(' '),
          ).includes(query)),
    )
    .sort((a, b) => {
      const time = (j: Data) => new Date(j.created_at_iso).getTime() || 0;
      const delta = f.sort === 'newest' ? time(b) - time(a) : time(a) - time(b);
      return delta || String(a.id).localeCompare(b.id);
    });
}
export function canAdvanceProduction(job: Data) {
  return (
    job.order_status === 'CONFIRMED' &&
    ['PENDING', 'PREPARING'].includes(job.status) &&
    !['CANCELLED', 'REDEEMED'].includes(job.ticket_status)
  );
}
