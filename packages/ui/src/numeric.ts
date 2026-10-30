export interface NumericRules {
  precision: 0 | 2 | 3;
  maxIntegerDigits: number;
  signed?: boolean;
  positive?: boolean;
  min?: string | number;
  max?: string | number;
  currency?: boolean;
}
const invalid = (message: string): never => {
  throw new Error(message);
};
/** Decimal point is an alternative decimal separator; grouping is accepted only with a comma. */
export function prepareNumericInput(value: string, rules: NumericRules): string {
  let text = value.trim().replace(/\s/g, '');
  if (rules.currency) text = text.replace(/^R\$/i, '');
  if (!text) return '';
  if (/[^\d.,-]/.test(text)) invalid('Use apenas números neste campo.');
  if (text.includes('-') && (!rules.signed || !/^-?[^-]*$/.test(text)))
    invalid('Este campo não aceita valor negativo.');
  if (!rules.precision && /[.,]/.test(text))
    invalid('Informe um número inteiro, sem casas decimais.');
  if (text.includes(',')) {
    const parts = text.split(',');
    if (parts.length !== 2) invalid('Informe somente um separador decimal.');
    if (parts[0].includes('.') && !/^-?\d{1,3}(?:\.\d{3})+$/.test(parts[0]))
      invalid('Use vírgula para os decimais e pontos apenas para os milhares.');
    text = parts[0].replace(/\./g, '') + ',' + parts[1];
  } else {
    if ((text.match(/\./g) ?? []).length > 1) invalid('Informe somente um separador decimal.');
    text = text.replace('.', ',');
  }
  const negative = text.startsWith('-'),
    unsigned = text.replace(/^-/, '');
  if (!unsigned) return negative ? '-' : '';
  const [whole = '', fraction = ''] = unsigned.split(',');
  if (fraction.length > rules.precision)
    invalid(`Use no máximo ${rules.precision} casas decimais.`);
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  if (integer.length > rules.maxIntegerDigits)
    invalid(`Use no máximo ${rules.maxIntegerDigits} dígitos antes da vírgula.`);
  return (negative ? '-' : '') + integer + (text.includes(',') ? ',' + fraction : '');
}
/** Exact canonical API string, with no grouping, exponent, rounding or floating-point conversion. */
export function normalizeNumericValue(value: unknown, rules: NumericRules): string {
  const text = String(value ?? '').trim();
  const pattern = rules.precision
    ? new RegExp(`^-?\\d{1,${rules.maxIntegerDigits}}(?:\\.\\d{0,${rules.precision}})?$`)
    : new RegExp(`^-?\\d{1,${rules.maxIntegerDigits}}$`);
  if (!text || !pattern.test(text))
    invalid(
      rules.precision
        ? `Informe um número com até ${rules.precision} casas decimais.`
        : 'Informe um número inteiro.',
    );
  const negative = text.startsWith('-');
  if (negative && !rules.signed) invalid('Este campo não aceita valor negativo.');
  const [whole, decimal = ''] = text.replace(/^-/, '').split('.');
  const scale = 10n ** BigInt(rules.precision);
  const magnitude = BigInt(whole) * scale + BigInt(decimal.padEnd(rules.precision, '0') || '0');
  const units = negative ? -magnitude : magnitude;
  if (rules.positive && units <= 0n) invalid('Informe um valor maior que zero.');
  const scaled = (bound: string | number) => {
    const [integer, fraction = ''] = String(bound).replace(/^-/, '').split('.');
    return (
      (String(bound).startsWith('-') ? -1n : 1n) *
      (BigInt(integer) * scale + BigInt(fraction.padEnd(rules.precision, '0')))
    );
  };
  if (rules.min !== undefined && units < scaled(rules.min))
    invalid('O valor mínimo é ' + String(rules.min).replace('.', ',') + '.');
  if (rules.max !== undefined && units > scaled(rules.max))
    invalid('O valor máximo é ' + String(rules.max).replace('.', ',') + '.');
  return (
    (units < 0n ? '-' : '') +
    String(BigInt(whole)) +
    (rules.precision ? '.' + decimal.padEnd(rules.precision, '0') : '')
  );
}
export function formatNumericInput(value: string, rules: NumericRules, grouping = false) {
  if (!value || value === '-') return value;
  const canonical = normalizeNumericValue(value, {
    ...rules,
    positive: false,
    min: undefined,
    max: undefined,
  });
  const [whole, fraction] = canonical.split('.');
  return (
    (grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : whole) +
    (fraction !== undefined ? ',' + fraction : '')
  );
}
export function normalizeInteger(value: unknown, options: Partial<NumericRules> = {}) {
  const normalized = normalizeNumericValue(value, {
    precision: 0,
    maxIntegerDigits: 16,
    signed: true,
    ...options,
  });
  const integer = Number(normalized);
  if (!Number.isSafeInteger(integer)) invalid('O número inteiro excede o limite permitido.');
  return integer;
}
