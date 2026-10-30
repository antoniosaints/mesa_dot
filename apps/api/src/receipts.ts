import { sql, rows, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure, permit, money, formatDecimal } from '../../../packages/shared/src/index.js';
import type { ReceiptDocument, ReceiptItem } from '../../../packages/shared/src/receipt.js';
import { tabBalance, approvedForOrder } from './payments.js';
const ref = (id: string) => '#' + id.slice(0, 8).toUpperCase();
const paymentNames: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX_MANUAL: 'Pix',
  CARD_MANUAL: 'Cartao',
  sandbox: 'Gateway de teste',
};
async function receiptBase(s: Scope, tableId: string | null) {
  const table = tableId ? await s.get('dining_tables', tableId) : null;
  const unit = (
    await rows(
      s.tx,
      sql`SELECT name FROM establishments WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
    )
  )[0];
  return {
    establishment_name: unit.name,
    table_number: table?.number ?? '',
    service_mode: table ? ('TABLE' as const) : ('COUNTER' as const),
  };
}
async function receiptItems(s: Scope, items: Row[]): Promise<ReceiptItem[]> {
  return Promise.all(
    items.map(async (i) => {
      const order = await s.get('orders', i.order_id),
        mods = await s.list('order_item_modifiers', sql`order_item_id=${i.id}`),
        assignments = await s.list('order_item_assignments', sql`order_item_id=${i.id}`);
      const tabId = assignments[0]?.tab_id ?? order.tab_id;
      const tab = tabId ? await s.get('tabs', tabId) : null;
      return {
        id: i.id,
        name: i.name_snapshot,
        quantity: Number(i.quantity),
        unit_price: i.unit_price,
        total: i.total,
        cancelled: order.status === 'CANCELLED',
        notes: i.notes,
        modifiers: mods.map((m) => m.name_snapshot),
        order_reference: ref(order.id),
        tab_label: tab?.label ?? null,
      };
    }),
  );
}
export async function receiptDocument(
  s: Scope,
  scope: 'ORDER' | 'TAB',
  id: string,
  paper: 58 | 80,
): Promise<ReceiptDocument> {
  permit(s.actor, 'table.view');
  if (scope === 'ORDER') {
    const order = await s.get('orders', id);
    if (order.service_mode === 'COUNTER' && order.tab_id) {
      const document = await receiptDocument(s, 'TAB', order.tab_id, paper);
      return {
        ...document,
        scope: 'ORDER',
        reference: ref(id),
        status: order.status === 'CANCELLED' ? 'PEDIDO CANCELADO' : document.status,
      };
    }
  }
  let items: ReceiptItem[],
    base,
    tabLabel: string | null = null,
    customerName: string | null = null,
    status: string,
    createdAt: string;
  let total = 0n,
    paid: bigint | null = null,
    balance: bigint | null = null,
    discount = 0n;
  const payments: ReceiptDocument['payments'] = [],
    notes: string[] = [];
  if (scope === 'TAB') {
    const tab = await s.get('tabs', id),
      session = tab.session_id ? await s.get('table_sessions', tab.session_id) : null;
    base = await receiptBase(s, session?.table_id ?? null);
    if (tab.mode === 'COUNTER')
      customerName = (await s.list('orders', sql`tab_id=${tab.id}`))[0]?.customer_name ?? null;
    tabLabel = tab.label;
    createdAt = tab.created_at;
    status =
      tab.mode === 'COUNTER'
        ? tab.status === 'CLOSED'
          ? 'Pedido avulso finalizado'
          : 'Pedido avulso - aguardando entrega'
        : tab.status === 'CLOSED'
          ? 'Comanda encerrada'
          : tab.status === 'CLOSING'
            ? 'Comanda em fechamento'
            : 'Conferencia de comanda aberta';
    if (tab.owner_customer_id)
      customerName = (await s.get('customers', tab.owner_customer_id)).name;
    const assignments = await s.list('order_item_assignments', sql`tab_id=${id}`);
    const raw = await Promise.all(assignments.map((a) => s.get('order_items', a.order_item_id)));
    items = await receiptItems(s, raw);
    const financial = await tabBalance(s, id);
    total = money(financial.charges) - money(financial.credits);
    paid = money(financial.net_paid);
    balance = money(financial.balance);
    for (const entry of await s.list('financial_entries', sql`tab_id=${id} AND type='DISCOUNT'`))
      discount += money(entry.amount);
    for (const allocation of await s.list('payment_allocations', sql`tab_id=${id}`)) {
      const payment = await s.get('payments', allocation.payment_id);
      if (!['APPROVED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) continue;
      let refunded = 0n;
      for (const r of await s.list(
        'refunds',
        sql`payment_id=${payment.id} AND tab_id=${id} AND status='APPROVED'`,
      ))
        refunded += money(r.amount);
      payments.push({
        method: paymentNames[payment.provider] ?? payment.provider,
        amount: allocation.amount,
        refunded: formatDecimal(refunded),
      });
    }
    notes.push('Valores desta comanda no momento da emissao.');
  } else {
    const order = await s.get('orders', id);
    base = await receiptBase(s, order.table_id);
    createdAt = order.created_at;
    items = await receiptItems(s, await s.list('order_items', sql`order_id=${id}`));
    tabLabel = [...new Set(items.map((i) => i.tab_label).filter(Boolean))].join(' / ') || null;
    status =
      order.status === 'CANCELLED'
        ? 'PEDIDO CANCELADO'
        : order.status === 'DRAFT'
          ? 'PREVIA - PEDIDO NAO CONFIRMADO'
          : order.status === 'PENDING_PAYMENT'
            ? 'PREVIA - AGUARDANDO PAGAMENTO'
            : 'Pedido confirmado';
    if (order.customer_id) customerName = (await s.get('customers', order.customer_id)).name;
    total = order.status === 'CANCELLED' ? 0n : money(order.total);
    if (order.payment_policy_snapshot === 'PREPAID') {
      paid = await approvedForOrder(s, id);
      balance = total - paid;
      notes.push('Pedido pre-pago. Recebido desconta estornos aprovados.');
    } else
      notes.push('Pagamento e descontos sao registrados na comanda; nao sao rateados por pedido.');
    notes.push('Este cupom mostra os itens originais do pedido.');
  }
  let subtotal = 0n,
    cancelled = 0n;
  for (const item of items) {
    subtotal += money(item.total);
    if (item.cancelled) cancelled += money(item.total);
  }
  // created_at is produced by MySQL's CURRENT_TIMESTAMP in its session timezone.
  // UNIX_TIMESTAMP resolves that timezone before the receipt formats it for Brazil.
  const stamp = (await rows(s.tx, sql`SELECT UNIX_TIMESTAMP(${createdAt}) epoch`))[0];
  ensure(stamp.epoch !== null, 'INTERNAL_ERROR', 'Data de abertura inválida.', 500);
  const createdAtIso = new Date(Number(stamp.epoch) * 1000).toISOString();
  return {
    kind: 'RECEIPT',
    version: 1,
    scope,
    reference: ref(id),
    ...base,
    tab_label: tabLabel,
    customer_name: customerName,
    status,
    created_at: createdAtIso,
    issued_at: new Date().toISOString(),
    paper_width: paper,
    items,
    totals: {
      subtotal: formatDecimal(subtotal),
      cancelled: formatDecimal(cancelled),
      discount: formatDecimal(discount),
      adjustments: formatDecimal(total - subtotal + cancelled + discount),
      total: formatDecimal(total),
      paid: paid === null ? null : formatDecimal(paid),
      balance: balance === null ? null : formatDecimal(balance),
    },
    payments,
    notes,
  };
}
export async function queueReceipt(
  s: Scope,
  scope: 'ORDER' | 'TAB',
  id: string,
  input: { printer_id: string; paper_width: 58 | 80 },
) {
  permit(s.actor, 'table.view');
  const printer = await s.get('printers', input.printer_id);
  ensure(printer.enabled, 'INVALID_STATE', 'Impressora desativada.');
  const document = await receiptDocument(s, scope, id, input.paper_width);
  const previous = await s.list(
    'print_jobs',
    scope === 'ORDER' ? sql`source_order_id=${id}` : sql`source_tab_id=${id}`,
  );
  const job = await s.insert('print_jobs', {
    document_kind: 'RECEIPT',
    receipt_snapshot: document,
    source_order_id: scope === 'ORDER' ? id : null,
    source_tab_id: scope === 'TAB' ? id : null,
    ticket_id: null,
    printer_id: printer.id,
    paper_width: input.paper_width,
    status: 'PENDING',
    is_copy: previous.length > 0,
  });
  await s.audit('receipt.print_queued', job.id, {
    scope,
    source_id: id,
    paper_width: input.paper_width,
    printer_id: printer.id,
  });
  await s.event('print.queued', job.id);
  return { id: job.id, status: 'PENDING', printer_name: printer.name };
}
