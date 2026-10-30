export const tableQrFormats = ['A4', 'LABEL', '80', '58'] as const;
export type TableQrFormat = (typeof tableQrFormats)[number];
export interface TableQrDocument {
  kind: 'TABLE_QR';
  version: 1;
  establishment_name: string;
  table_id: string;
  table_number: string;
  url: string;
  format: TableQrFormat;
  issued_at: string;
  is_copy?: boolean;
}
export function tableQrPage(format: TableQrFormat) {
  return format === 'A4'
    ? { width: 210, height: 297, labelWidth: 80, labelHeight: 100, x: 65, y: 25 }
    : format === '58'
      ? { width: 58, height: 100, labelWidth: 58, labelHeight: 100, x: 0, y: 0 }
      : { width: 80, height: 100, labelWidth: 80, labelHeight: 100, x: 0, y: 0 };
}
export function tableQrUrl(base: string, slug: string, code: string) {
  const url = new URL(base);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !/^[a-z0-9-]{1,80}$/.test(slug) ||
    !/^[\w-]{16,64}$/.test(code)
  )
    throw new Error('Endereço público do cardápio inválido.');
  url.pathname = url.pathname.replace(/\/$/, '') + '/' + slug + '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set('table', code);
  return url.href;
}
export function tableQrHtml(d: TableQrDocument, qrDataUrl: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qrDataUrl))
    throw new Error('Imagem de QR inválida.');
  const escape = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
  const p = tableQrPage(d.format),
    qr = Math.min(p.labelWidth - 16, 52),
    titleSize = Math.min(
      18,
      ((p.labelWidth - 10) * 72) / 25.4 / (('Mesa ' + d.table_number).length * 0.6),
    );
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR Code - Mesa ${escape(d.table_number)}</title><style>@page{size:${p.width}mm ${p.height}mm;margin:0}*{box-sizing:border-box}body{margin:0;background:white;color:black;font-family:monospace}.label{position:absolute;left:${p.x}mm;top:${p.y}mm;width:${p.labelWidth}mm;height:${p.labelHeight}mm;text-align:center;${d.format === 'A4' ? 'border:1px dashed #aaa;' : ''}}.venue{position:absolute;left:5mm;right:5mm;top:6mm;height:10mm;font-size:9pt;overflow:hidden;line-height:1.3}h1{position:absolute;left:5mm;right:5mm;top:19mm;font-size:${titleSize}pt;line-height:1.2;margin:0;white-space:nowrap}img{position:absolute;left:${(p.labelWidth - qr) / 2}mm;top:28mm;width:${qr}mm;height:${qr}mm}p{position:absolute;left:5mm;right:5mm;top:${29 + qr}mm;font-size:8pt;line-height:1.4;margin:0}small{position:absolute;left:5mm;right:5mm;top:${38 + qr}mm;font-size:6.5pt;overflow-wrap:anywhere}@media screen{body{min-height:${p.height}mm}}</style></head><body><section class="label"><div class="venue">${escape(d.establishment_name)}</div><h1>Mesa ${escape(d.table_number)}</h1><img src="${qrDataUrl}" alt="QR Code da mesa"><p>Escaneie o QR Code<br>para acessar o cardápio.</p><small>${escape(new URL(d.url).host)}</small></section></body></html>`;
}
export const printDocumentLabel = (kind?: string) =>
  kind === 'TABLE_QR' ? 'QR da mesa' : kind === 'RECEIPT' ? 'Cupom' : 'Ficha';
