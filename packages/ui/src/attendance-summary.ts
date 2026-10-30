import type { Data } from './client.js';
const cents = (value: unknown) => {
  const [whole, fraction = ''] = String(value ?? '0').split('.');
  const negative = whole.startsWith('-');
  const amount = BigInt(whole.replace('-', '')) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
};
const amount = (value: bigint) => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};
export function attendanceSummary(tabs: Data[], tickets: Data[]) {
  let total = 0n;
  let paid = 0n;
  let balance = 0n;
  for (const tab of tabs) {
    total += cents(tab.financial?.charges) - cents(tab.financial?.credits);
    paid += cents(tab.financial?.net_paid);
    balance += cents(tab.financial?.balance);
  }
  const active = tickets.filter(
    (ticket) => ticket.status !== 'CANCELLED' && ticket.order_status === 'CONFIRMED',
  );
  const delivered = active.filter((ticket) => ticket.status === 'REDEEMED').length;
  return {
    total: amount(total),
    paid: amount(paid),
    balance: amount(balance),
    ordered: active.length,
    delivered,
    pending: active.length - delivered,
    preparing: active.filter((ticket) => ['PENDING', 'PREPARING'].includes(ticket.status)).length,
    requested: active.filter((ticket) =>
      ['OPEN', 'CLAIMED'].includes(ticket.service_request_status),
    ).length,
  };
}
