export interface ReplenishmentCostLine {
  quantity: string;
  unit_cost?: string | null;
}
const maxTotal = 9999999999999999n;
function decimal(value: string, scale: number, maxDigits: number) {
  if (!new RegExp(`^\\d{1,${maxDigits}}\\.\\d{${scale}}$`).test(value))
    throw new Error('Valor ou quantidade inválidos.');
  return BigInt(value.replace('.', ''));
}
function amount(value: bigint) {
  if (value > maxTotal) throw new Error('O custo total ultrapassa o limite permitido.');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
export function replenishmentCosts(
  items: ReplenishmentCostLine[],
  freight = '0.00',
  discount = '0.00',
) {
  const shipping = decimal(freight, 2, 12),
    reduction = decimal(discount, 2, 12);
  const line_totals = items.map((item) => {
    const quantity = decimal(item.quantity, 3, 11);
    return item.unit_cost == null
      ? null
      : amount((quantity * decimal(item.unit_cost, 2, 12) + 500n) / 1000n);
  });
  const complete = line_totals.every((value) => value !== null);
  const subtotal = complete
    ? line_totals.reduce<bigint>((sum, value) => sum + BigInt(value!.replace('.', '')), 0n)
    : null;
  if (subtotal !== null && reduction > subtotal + shipping)
    throw new Error('O desconto não pode superar o subtotal mais o frete.');
  return {
    line_totals,
    subtotal: subtotal === null ? null : amount(subtotal),
    total: subtotal === null ? null : amount(subtotal + shipping - reduction),
  };
}
