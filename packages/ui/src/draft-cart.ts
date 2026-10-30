export interface DraftLine {
  key: string;
  product_id: string;
  quantity: number;
  variant_id?: string;
  modifiers: string[];
  notes: string;
  name: string;
  price: number;
}
export const MAX_DRAFT_QUANTITY = 100;
export function mergeDraftLine(lines: DraftLine[], incoming: DraftLine) {
  const signature = (line: DraftLine) =>
    JSON.stringify([
      line.product_id,
      line.variant_id || null,
      [...line.modifiers].sort(),
      line.notes,
      line.price,
    ]);
  const existing = lines.find((line) => signature(line) === signature(incoming));
  if (
    incoming.quantity > MAX_DRAFT_QUANTITY ||
    (existing && existing.quantity + incoming.quantity > MAX_DRAFT_QUANTITY)
  )
    return { lines, limitReached: true };
  return {
    lines: existing
      ? lines.map((line) =>
          line.key === existing.key
            ? { ...line, quantity: line.quantity + incoming.quantity }
            : line,
        )
      : [...lines, incoming],
    limitReached: false,
  };
}
