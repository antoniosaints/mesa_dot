export const moneyValidationMessage = 'Informe um valor em reais entre 0,00 e 999.999.999.999,99.';
/** API money is a decimal string; never use floating-point arithmetic to serialize it. */
export function normalizeMoney(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}(?:\.\d{0,2})?$/.test(text)) throw new Error(moneyValidationMessage);
  const [whole, fraction = ''] = text.split('.');
  return `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
}
export function moneyCents(value: unknown): bigint {
  const [whole, fraction] = normalizeMoney(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}
export function formatMoneyCents(value: bigint): string {
  const amount = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}
export function formatMoneyInput(value: unknown): string {
  if (value === '' || value == null) return '';
  const [whole, fraction] = normalizeMoney(value).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}
/** Accept pasted BRL values and the decimal point used by existing integrations. */
export function prepareMoneyInput(value: string): string {
  const text = value.replace(/R\$/gi, '').replace(/\s/g, '');
  return !text.includes(',') && /^-?\d+\.\d{0,2}$/.test(text) ? text.replace('.', ',') : text;
}
