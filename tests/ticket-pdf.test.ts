import { it, expect } from 'vitest';
import { ticketPdf } from '../apps/api/src/ticket-pdf.js';
import { receiptPdf } from '../apps/api/src/receipt-pdf.js';
import { sampleReceipt } from './fixtures/receipt.js';
it('ficha e cupom PDF geram bytes estáveis para recuperação idempotente no PrintBridge', async () => {
  const date = '2026-10-28T12:00:00Z';
  const ticket = {
    public_number: 'DEMO123',
    product: 'Porção especial · Café com pão de queijo',
    table_number: '05',
    tab_label: 'Comanda demonstração',
    notes: 'Sem açúcar. Molho separado.',
    token: 'demoTokenPrintBridge0123456789_example_testOnly',
  };
  for (const paper of [58, 80] as const) {
    const a = await ticketPdf(ticket, paper, date),
      b = await ticketPdf(ticket, paper, date);
    expect(a.equals(b)).toBe(true);
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.toString('latin1')).toContain('/FontFile2');
  }
  const receipt = sampleReceipt();
  expect((await receiptPdf(receipt)).equals(await receiptPdf(receipt))).toBe(true);
});
