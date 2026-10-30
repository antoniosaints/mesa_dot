import { z } from 'zod';
import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import {
  amount,
  ensure,
  quantity,
  formatDecimal,
  permit,
} from '../../../packages/shared/src/index.js';
import { replenishmentCosts } from '../../../packages/shared/src/replenishment.js';
import { changeStock } from './inventory.js';
import { pageFields, sqlPage } from './pagination.js';
export const replenishmentSchema = z
  .object({
    supplier_name: z.string().trim().max(160).optional(),
    invoice_number: z.string().trim().max(80).optional(),
    freight: amount.default('0.00'),
    discount: amount.default('0.00'),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z
          .object({
            balance_id: z.uuid(),
            quantity: z
              .string()
              .regex(/^\d{1,11}\.\d{3}$/)
              .refine((value) => quantity(value) > 0n, 'A quantidade deve ser maior que zero.'),
            unit_cost: amount.nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (input) => new Set(input.items.map((item) => item.balance_id)).size === input.items.length,
    'Selecione cada estoque apenas uma vez.',
  );
export const replenishmentQuery = z
  .object({ ...pageFields, search: z.string().trim().max(160).default('') })
  .strict();
const headerSource = sql`SELECT r.id,r.tenant_id,r.establishment_id,r.supplier_name,r.invoice_number,r.freight,r.discount,r.subtotal,r.total,r.item_count,r.notes,r.created_at,u.name created_by_name FROM stock_replenishments r LEFT JOIN users u ON u.id=r.created_by`;
export async function replenishmentDetail(s: Scope, id: string) {
  const found = await rows(
    s.tx,
    sql`${headerSource} WHERE r.tenant_id=${s.actor.tenantId} AND r.establishment_id=${s.actor.establishmentId} AND r.id=${id}`,
  );
  ensure(found.length, 'NOT_FOUND', 'Reposição não encontrada nesta unidade.', 404);
  const { tenant_id: _tenant, establishment_id: _unit, ...header } = found[0];
  const items = await rows(
    s.tx,
    sql`SELECT i.id,i.balance_id,i.product_name,i.variant_name,i.location_name,i.unit_code,l.color location_color,i.quantity,i.physical_before,i.physical_after,i.unit_cost,i.line_total FROM stock_replenishment_items i JOIN stock_balances b ON b.tenant_id=i.tenant_id AND b.establishment_id=i.establishment_id AND b.id=i.balance_id JOIN stock_locations l ON l.tenant_id=b.tenant_id AND l.establishment_id=b.establishment_id AND l.id=b.location_id WHERE i.tenant_id=${s.actor.tenantId} AND i.establishment_id=${s.actor.establishmentId} AND i.replenishment_id=${id} ORDER BY i.product_name,i.location_name,i.id`,
  );
  return { ...header, items };
}
export async function replenishmentList(s: Scope, input: z.infer<typeof replenishmentQuery>) {
  const where = sql`tenant_id=${s.actor.tenantId} AND establishment_id=${s.actor.establishmentId} ${input.search ? sql`AND (LOCATE(${input.search},COALESCE(supplier_name,''))>0 OR LOCATE(${input.search},COALESCE(invoice_number,''))>0 OR EXISTS(SELECT 1 FROM stock_replenishment_items i WHERE i.tenant_id=${s.actor.tenantId} AND i.establishment_id=${s.actor.establishmentId} AND i.replenishment_id=paged.id AND LOCATE(${input.search},CONCAT_WS(' ',i.product_name,i.variant_name,i.location_name))>0))` : sql``}`;
  const result = await sqlPage(s.tx, headerSource, where, sql`created_at DESC,id DESC`, input);
  return {
    ...result,
    rows: result.rows.map(({ tenant_id: _tenant, establishment_id: _unit, ...row }) => row),
  };
}
export async function createReplenishment(s: Scope, input: z.infer<typeof replenishmentSchema>) {
  permit(s.actor, 'inventory.adjust');
  let costs: ReturnType<typeof replenishmentCosts>;
  try {
    costs = replenishmentCosts(input.items, input.freight, input.discount);
  } catch (error) {
    ensure(false, 'BAD_REQUEST', (error as Error).message, 400);
  }
  const stocks = new Map<string, Row>();
  for (const item of [...input.items].sort((a, b) => a.balance_id.localeCompare(b.balance_id))) {
    const balance = await s.get('stock_balances', item.balance_id, true);
    ensure(
      quantity(balance.physical_quantity) + quantity(item.quantity) <= 99999999999999n,
      'BAD_REQUEST',
      'A quantidade resultante ultrapassa a capacidade deste estoque.',
      400,
    );
    const product = await s.get('products', balance.product_id),
      location = await s.get('stock_locations', balance.location_id);
    const variant = balance.variant_id ? await s.get('product_variants', balance.variant_id) : null;
    ensure(
      !variant?.deleted_at,
      'INVALID_STATE',
      'Esta variação foi removida. Escolha um estoque de uma variação disponível.',
    );
    stocks.set(item.balance_id, {
      ...balance,
      product_name: product.name,
      unit_code: product.unit_code,
      location_name: location.name,
      variant_name: variant?.name ?? null,
    });
  }
  const header = await s.insert('stock_replenishments', {
    supplier_name: input.supplier_name || null,
    invoice_number: input.invoice_number || null,
    freight: input.freight,
    discount: input.discount,
    subtotal: costs.subtotal,
    total: costs.total,
    item_count: input.items.length,
    notes: input.notes || null,
    created_by: s.actor.id,
  });
  for (const [index, item] of input.items.entries()) {
    const balance = stocks.get(item.balance_id)!;
    await changeStock(
      s,
      balance.id,
      quantity(item.quantity),
      0n,
      'PURCHASE',
      `replenishment:${header.id}:${balance.id}`,
      null,
      `Reposição ${header.id.slice(0, 8).toUpperCase()}${input.invoice_number ? ' · Nota ' + input.invoice_number : ''}`,
    );
    await s.insert('stock_replenishment_items', {
      replenishment_id: header.id,
      balance_id: balance.id,
      product_name: balance.product_name,
      unit_code: balance.unit_code,
      variant_name: balance.variant_name,
      location_name: balance.location_name,
      quantity: item.quantity,
      physical_before: balance.physical_quantity,
      physical_after: formatDecimal(
        quantity(balance.physical_quantity) + quantity(item.quantity),
        3,
      ),
      unit_cost: item.unit_cost ?? null,
      line_total: costs.line_totals[index],
    });
  }
  await s.audit('inventory.replenished', header.id, { item_count: input.items.length });
  await s.event('inventory.replenished', header.id, { item_count: input.items.length });
  return replenishmentDetail(s, header.id);
}
