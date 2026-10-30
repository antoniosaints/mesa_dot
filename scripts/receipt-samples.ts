import { writeFile, mkdir } from 'node:fs/promises';
import { receiptPdf } from '../apps/api/src/receipt-pdf.js';
import { sampleReceipt } from '../tests/fixtures/receipt.js';
await mkdir('output/pdf', { recursive: true });
await writeFile(
  'output/pdf/cupom-comanda-demonstracao.pdf',
  await receiptPdf(sampleReceipt(80, 'TAB')),
);
await writeFile(
  'output/pdf/cupom-pedido-demonstracao.pdf',
  await receiptPdf(sampleReceipt(58, 'ORDER')),
);
const long = sampleReceipt(58);
long.items = Array.from({ length: 70 }, (_, n) => ({
  ...long.items[0],
  id: String(n),
  name: 'Café especial e pão de queijo ' + n,
}));
await mkdir('tmp/pdfs', { recursive: true });
await writeFile('tmp/pdfs/cupom-longo-58mm.pdf', await receiptPdf(long));
console.log('Cupons de demonstração gerados.');
