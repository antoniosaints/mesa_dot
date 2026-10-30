import { orderLocationLabel } from '../../shared/src/order-location.js';
import type { Data } from './client.js';
import { cashLocalDay, cashText } from './cash-view.js';
import { moneyCents as money, formatMoneyCents as formatDecimal } from './money.js';
export const paymentMethodLabels: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX_MANUAL: 'Pix manual',
  CARD_MANUAL: 'Cartão manual',
  sandbox: 'Online · sandbox',
  mercadopago: 'Mercado Pago',
};
export const paymentMethodLabel = (value: string) => paymentMethodLabels[value] ?? value;
export const paymentAccepted = (p: Data) =>
  ['APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status);
export function paymentReferences(p: Data) {
  return p.allocations?.length ? p.allocations : p.order ? [p.order] : [];
}
export type PaymentFilters = {
  search: string;
  method: string;
  status: string;
  from: string;
  to: string;
  group: string;
  sort: string;
};
export function filterPayments(records: Data[], f: PaymentFilters) {
  const query = cashText(f.search).trim();
  const filtered = records.filter((p) => {
    const day = cashLocalDay(p.confirmed_at || p.created_at);
    const context = paymentReferences(p)
      .map(
        (a: Data) =>
          `${orderLocationLabel(a)} ${a.tab_label} ${a.tab_id ?? ''} ${a.order_id ?? ''}`,
      )
      .join(' ');
    return (
      (!query ||
        cashText(
          `${p.id} ${p.provider_reference} ${paymentMethodLabel(p.provider)} ${context} ${p.review_reason ?? ''}`,
        ).includes(query)) &&
      (!f.method || p.provider === f.method) &&
      (!f.status || p.status === f.status) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to) &&
      (f.group !== 'received' || ['APPROVED', 'PARTIALLY_REFUNDED'].includes(p.status)) &&
      (f.group !== 'refunded' || ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(p.status)) &&
      (f.group !== 'review' || Boolean(p.review_reason))
    );
  });
  return filtered.sort((a, b) => {
    const date = (p: Data) =>
      new Date(
        /[zZ]|[+-]\d\d:\d\d$/.test(p.confirmed_at || p.created_at)
          ? p.confirmed_at || p.created_at
          : String(p.confirmed_at || p.created_at).replace(' ', 'T') + 'Z',
      ).getTime();
    const delta =
      f.sort === 'amount'
        ? Number(b.amount) - Number(a.amount)
        : f.sort === 'net'
          ? Number(b.net_amount) - Number(a.net_amount)
          : f.sort === 'oldest'
            ? date(a) - date(b)
            : date(b) - date(a);
    return delta || String(a.id).localeCompare(b.id);
  });
}
export function paymentTotals(records: Data[]) {
  const accepted = records.filter(paymentAccepted);
  const sum = (rows: Data[], field: string) =>
    formatDecimal(rows.reduce((n, p) => n + money(p[field] ?? '0.00'), 0n));
  return {
    gross: sum(accepted, 'amount'),
    refunded: sum(records, 'refunded_amount'),
    net: sum(accepted, 'net_amount'),
    review: records.filter((p) => p.review_reason).length,
    count: accepted.length,
  };
}
