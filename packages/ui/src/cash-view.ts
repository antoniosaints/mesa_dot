import { paginate } from './pagination-model.js';
import type { Data } from './client.js';
export const cashMovementLabels: Record<string, string> = {
  CASH: 'Venda em dinheiro',
  PIX_MANUAL: 'Pix',
  CARD_MANUAL: 'Cartão',
  REFUND: 'Estorno em dinheiro',
  WITHDRAWAL: 'Sangria',
  SUPPLY: 'Suprimento',
};
export const cashTypeLabel = (type: string) => cashMovementLabels[type] ?? type;
export const cashText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
export function cashLocalDay(value: string) {
  if (!value) return '';
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
}
export function filterCashSessions(
  records: Data[],
  filters: {
    search: string;
    register: string;
    status: string;
    from: string;
    to: string;
    sort: string;
  },
) {
  const search = cashText(filters.search).trim();
  const result = records.filter(
    (r) =>
      (!search ||
        cashText([r.id, r.register_name, r.opened_by_name, r.closed_by_name].join(' ')).includes(
          search,
        )) &&
      (!filters.register || r.register_id === filters.register) &&
      (!filters.status || r.status === filters.status) &&
      (!filters.from || cashLocalDay(r.created_at) >= filters.from) &&
      (!filters.to || cashLocalDay(r.created_at) <= filters.to),
  );
  return result.sort((a, b) => {
    const diff =
      filters.sort === 'oldest'
        ? String(a.created_at).localeCompare(b.created_at)
        : filters.sort === 'difference'
          ? Math.abs(Number(b.difference_amount ?? 0)) - Math.abs(Number(a.difference_amount ?? 0))
          : filters.sort === 'amount'
            ? Number(b.expected_amount) - Number(a.expected_amount)
            : String(b.created_at).localeCompare(a.created_at);
    return diff || String(a.id).localeCompare(b.id);
  });
}
export function cashPage<T>(rows: T[], requested: number, size: number) {
  return paginate(rows, requested, size);
}
