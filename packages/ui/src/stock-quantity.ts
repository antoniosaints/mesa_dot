export function normalizeStockQuantity(
  value: unknown,
  options: { positive?: boolean; signed?: boolean } = {},
) {
  let text = String(value ?? '')
    .trim()
    .replace(/\s/g, '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d{1,11}(\.\d{1,3})?$/.test(text))
    throw new Error('Informe uma quantidade válida com até três casas decimais.');
  const negative = text.startsWith('-');
  if (negative && !options.signed) throw new Error('A quantidade não pode ser negativa.');
  const [integer, fraction = ''] = text.replace(/^-/, '').split('.');
  const normalized =
    (negative ? '-' : '') + String(BigInt(integer)) + '.' + fraction.padEnd(3, '0');
  if (options.positive && BigInt(integer + fraction.padEnd(3, '0')) === 0n)
    throw new Error('Informe uma quantidade maior que zero.');
  return normalized;
}
export const stockQuantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
