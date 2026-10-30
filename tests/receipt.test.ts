import { describe, it, expect } from 'vitest';
import { receiptLines, receiptWrap, receiptHtml } from '../packages/shared/src/receipt.js';
import { receiptPdf } from '../apps/api/src/receipt-pdf.js';
import { escpos } from '../apps/print-agent/src/escpos.js';
import { sampleReceipt } from './fixtures/receipt.js';
describe('cupons PDF e térmica', () => {
  it('quebra nomes, observações e valores nas larguras de 58 e 80 mm', () => {
    for (const width of [58, 80] as const) {
      const receipt = sampleReceipt(width);
      receipt.items[0].name = 'X'.repeat(130) + ' Café com leite';
      const lines = receiptLines(receipt);
      expect(lines.every((l) => Array.from(l).length <= (width === 58 ? 32 : 42))).toBe(true);
      expect(lines.join('\n')).toContain('35,00');
      expect(lines.join('\n')).toContain('SALDO PENDENTE');
      expect(lines.join('\n')).toContain('CUPOM NAO FISCAL');
    }
    expect(receiptWrap('á'.repeat(70), 32)).toHaveLength(3);
  });
  it('escapa conteúdo HTML e impede comandos enviados dentro do nome de um produto', () => {
    const receipt = sampleReceipt();
    receipt.items[0].name = 'Café </pre><script>alert(1)</script>\x1b@\x1dV';
    const html = receiptHtml(receipt);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const native = escpos(receipt);
    expect(native.subarray(9, native.length - 3).includes(0x1b)).toBe(false);
    expect(native.subarray(9, native.length - 3).includes(0x1d)).toBe(false);
    expect(native.toString()).toContain('Cafe');
    expect(native.includes(Buffer.from([0x1d, 0x56, 0]))).toBe(true);
  });
  it('gera PDF real com fonte incorporada, largura térmica e várias páginas para contas longas', async () => {
    for (const width of [58, 80] as const) {
      const d = sampleReceipt(width);
      d.items = Array.from({ length: 100 }, (_, n) => ({
        ...d.items[0],
        id: String(n),
        name: 'Porção especial ' + n,
      }));
      const pdf = await receiptPdf(d);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1')).toContain('/FontFile2');
      const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g);
      expect(pages!.length).toBeGreaterThan(1);
      expect(pdf.length).toBeGreaterThan(5000);
    }
  });
});
