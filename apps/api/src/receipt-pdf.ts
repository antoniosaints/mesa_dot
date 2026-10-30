import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { receiptLines, type ReceiptDocument } from '../../../packages/shared/src/receipt.js';
const font = readFile(
  new URL('../../../packages/shared/assets/LiberationMono-Regular.ttf', import.meta.url),
);
export async function receiptPdf(receipt: ReceiptDocument): Promise<Buffer> {
  const lines = receiptLines(receipt),
    columns = receipt.paper_width === 58 ? 32 : 42,
    fontSize = receipt.paper_width === 58 ? 7 : 8,
    lineHeight = fontSize + 3,
    width = (receipt.paper_width * 72) / 25.4,
    margin = (4 * 72) / 25.4;
  const perPage = Math.floor((842 - margin * 2 - lineHeight * 4) / lineHeight);
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of lines) {
    block.push(line);
    if (!line) {
      blocks.push(block);
      block = [];
    }
  }
  if (block.length) blocks.push(block);
  const pageLines: string[][] = [];
  let current: string[] = [];
  for (const paragraph of blocks) {
    if (current.length && current.length + paragraph.length > perPage) {
      pageLines.push(current);
      current = [];
    }
    while (paragraph.length > perPage) pageLines.push(paragraph.splice(0, perPage));
    current.push(...paragraph);
  }
  if (current.length || !pageLines.length) pageLines.push(current);
  const pages = pageLines.length;
  const doc = new PDFDocument({
    autoFirstPage: false,
    info: {
      Title: 'Cupom nao fiscal ' + receipt.reference,
      Author: receipt.establishment_name,
      CreationDate: new Date(receipt.issued_at),
    },
    compress: true,
  });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Receipt', await font);
  for (let page = 0; page < pages; page++) {
    const content = pageLines[page];
    const headings = page ? ['CONTINUACAO ' + receipt.reference, '-'.repeat(columns)] : [];
    const all = [...headings, ...content, '', `Pagina ${page + 1} de ${pages}`];
    const height = Math.min(842, Math.max(180, margin * 2 + all.length * lineHeight + 6));
    doc.addPage({ size: [width, height], margin: 0 });
    doc.font('Receipt').fontSize(fontSize);
    all.forEach((line, index) =>
      doc.text(line, margin, margin + index * lineHeight, {
        lineBreak: false,
        width: width - margin * 2,
      }),
    );
  }
  doc.end();
  return output;
}
