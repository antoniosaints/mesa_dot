import { orderLocationLabel } from './order-location.js';
export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unit_price: string;
  total: string;
  cancelled: boolean;
  notes: string | null;
  modifiers: string[];
  order_reference: string;
  tab_label: string | null;
}
export interface ReceiptDocument {
  kind: 'RECEIPT';
  version: 1;
  scope: 'ORDER' | 'TAB';
  reference: string;
  establishment_name: string;
  table_number: string;
  service_mode?: 'TABLE' | 'COUNTER';
  tab_label: string | null;
  customer_name: string | null;
  status: string;
  created_at: string;
  issued_at: string;
  paper_width: 58 | 80;
  items: ReceiptItem[];
  totals: {
    subtotal: string;
    cancelled: string;
    discount: string;
    adjustments: string;
    total: string;
    paid: string | null;
    balance: string | null;
  };
  payments: { method: string; amount: string; refunded: string }[];
  notes: string[];
  is_copy?: boolean;
}
const amount = (v: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number(v))
    .replace(/\u00a0/g, ' ');
export const receiptDate = (v: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z'));
// Strip control characters, including ESC/POS commands, from all user-provided text.
export const receiptSafeText = (v: unknown) =>
  Array.from(String(v ?? ''))
    .map((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
export function receiptWrap(value: unknown, width: number): string[] {
  const text = receiptSafeText(value);
  if (!text) return [''];
  const words = text.split(' '),
    lines: string[] = [];
  let line = '';
  for (const word of words) {
    const chunks = Array.from(word);
    while (chunks.length > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(chunks.splice(0, width).join(''));
    }
    const rest = chunks.join('');
    if (!rest) continue;
    if (Array.from(line + (line ? ' ' : '') + rest).length > width) {
      lines.push(line);
      line = rest;
    } else line += (line ? ' ' : '') + rest;
  }
  if (line) lines.push(line);
  return lines;
}
export function receiptLines(d: ReceiptDocument): string[] {
  const width = d.paper_width === 58 ? 32 : 42,
    lines: string[] = [];
  const add = (v: unknown) => lines.push(...receiptWrap(v, width));
  const center = (v: string) => {
    for (const l of receiptWrap(v, width))
      lines.push(' '.repeat(Math.max(0, Math.floor((width - Array.from(l).length) / 2))) + l);
  };
  const pair = (label: string, value: string) => {
    const n = Array.from(value).length,
      max = width - n - 1;
    if (max < 1) {
      add(label);
      add(value);
      return;
    }
    const wrapped = receiptWrap(label, max);
    for (const l of wrapped.slice(0, -1)) add(l);
    const last = wrapped.at(-1) ?? '';
    lines.push(last + ' '.repeat(Math.max(1, width - Array.from(last).length - n)) + value);
  };
  center(d.establishment_name);
  center('CUPOM NAO FISCAL');
  if (d.is_copy) center('COPIA / REIMPRESSAO');
  lines.push('='.repeat(width));
  add((d.scope === 'ORDER' ? 'Pedido ' : 'Comanda ') + d.reference);
  add(d.service_mode === 'COUNTER' ? orderLocationLabel(d) : 'Mesa: ' + d.table_number);
  if (d.tab_label) add('Comanda: ' + d.tab_label);
  if (d.customer_name) add('Cliente: ' + d.customer_name);
  add('Situacao: ' + d.status);
  add('Abertura: ' + receiptDate(d.created_at));
  add('Emissao: ' + receiptDate(d.issued_at));
  lines.push('-'.repeat(width));
  for (const item of d.items) {
    add((item.cancelled ? '[CANCELADO] ' : '') + item.quantity + 'x ' + item.name);
    pair(amount(item.unit_price) + ' / un.', amount(item.total));
    for (const m of item.modifiers) add('  + ' + m);
    if (item.notes) add('Obs.: ' + item.notes);
    if (d.scope === 'TAB') add('Pedido ' + item.order_reference);
    else if (item.tab_label) add('Conta: ' + item.tab_label);
    lines.push('');
  }
  if (!d.items.length) add('Nenhum item lancado.');
  lines.push('-'.repeat(width));
  pair('Subtotal dos itens', amount(d.totals.subtotal));
  if (Number(d.totals.cancelled)) pair('Cancelamentos', '- ' + amount(d.totals.cancelled));
  if (Number(d.totals.discount)) pair('Descontos', '- ' + amount(d.totals.discount));
  if (Number(d.totals.adjustments)) pair('Outros ajustes', amount(d.totals.adjustments));
  pair('TOTAL', amount(d.totals.total));
  if (d.totals.paid !== null) pair('Recebido liquido', amount(d.totals.paid));
  if (d.totals.balance !== null)
    pair(
      Number(d.totals.balance) < 0 ? 'CREDITO A REGULARIZAR' : 'SALDO PENDENTE',
      amount(d.totals.balance),
    );
  if (d.payments.length) {
    lines.push('-'.repeat(width));
    add('Pagamentos registrados');
    for (const p of d.payments) {
      pair(p.method, amount(p.amount));
      if (Number(p.refunded)) pair('Estornado', amount(p.refunded));
    }
  }
  lines.push('-'.repeat(width));
  for (const note of d.notes) add(note);
  center('Documento de conferencia.');
  center('Obrigado pela preferencia!');
  return lines;
}
export function receiptHtml(d: ReceiptDocument): string {
  const escape = (v: string) =>
    v
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cupom ${escape(d.reference)}</title><style>@page{size:${d.paper_width}mm 297mm;margin:4mm}body{margin:0;background:white;color:black}pre{width:${d.paper_width - 8}mm;margin:0;font:${d.paper_width === 58 ? '9' : '10'}px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere}@media screen{body{padding:16px;display:flex;justify-content:center}}</style></head><body><pre>${escape(receiptLines(d).join('\n'))}</pre></body></html>`;
}
