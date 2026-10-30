import { expect, it } from 'vitest';
import { tableQrPdf } from '../apps/api/src/table-qr-pdf.js';
import {
  tableQrUrl,
  tableQrHtml,
  tableQrFormats,
  type TableQrDocument,
} from '../packages/shared/src/table-qr-print.js';
import { escpos } from '../apps/print-agent/src/escpos.js';
const base: TableQrDocument = {
  kind: 'TABLE_QR',
  version: 1,
  establishment_name: 'Buteco do Zé',
  table_id: '00000000-0000-4000-8000-000000000001',
  table_number: '05',
  url: tableQrUrl(
    'https://cardapio.example',
    'buteco-do-ze',
    '00000000-0000-4000-8000-000000000001',
  ),
  format: 'A4',
  issued_at: '2026-10-29T15:00:00.000Z',
};
it('QR da mesa usa somente o endereço público e não carrega participação ou autenticação', () => {
  expect(
    tableQrUrl(
      'https://cardapio.example/?token=abc#x',
      'buteco-do-ze',
      '00000000-0000-4000-8000-000000000001',
    ),
  ).toBe(base.url);
  expect(() => tableQrUrl('javascript:alert(1)', 'bar', 'a'.repeat(32))).toThrow();
  expect(() => tableQrUrl('https://a.example', '../bar', 'a'.repeat(32))).toThrow();
});
it('gera PDFs determinísticos nos formatos A4, etiqueta e térmicas e incorpora fonte', async () => {
  for (const format of tableQrFormats) {
    const doc = { ...base, format };
    const pdf = await tableQrPdf(doc);
    expect(pdf.equals(await tableQrPdf(doc))).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/FontFile2');
  }
});
it('ESC/POS imprime QR de URL sem tratar como ficha de consumo e HTML escapa nomes', () => {
  const raw = escpos({ ...base, format: '58' as const });
  expect(raw.includes(Buffer.from(base.url))).toBe(true);
  expect(raw.toString('latin1')).toContain('MESA 05');
  expect(raw.toString('latin1')).not.toContain('Uso unico');
  expect(() => escpos({ ...base, url: 'javascript:alert(1)' })).toThrow();
  const html = tableQrHtml(
    { ...base, establishment_name: '<script>bad()</script>' },
    'data:image/png;base64,AAAA',
  );
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>bad');
});
