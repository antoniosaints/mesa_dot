import { orderLocationLabel } from '../../../packages/shared/src/order-location.js';
import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/node';
import { receiptSafeText, receiptWrap } from '../../../packages/shared/src/receipt.js';
import type { TicketPrintDocument } from '../../print-agent/src/escpos.js';
const font = readFile(
  new URL('../../../packages/shared/assets/LiberationMono-Regular.ttf', import.meta.url),
);
export async function ticketPdf(
  document: TicketPrintDocument & { tab_label?: string; notes?: string; order_id?: string },
  paper: 58 | 80,
  issuedAt: string,
): Promise<Buffer> {
  const width = (paper * 72) / 25.4,
    margin = 10,
    fontSize = paper === 58 ? 7 : 8,
    lineHeight = fontSize + 3,
    columns = paper === 58 ? 32 : 42;
  const qrSize = Math.min(140, width - margin * 2);
  const text = [
    document.is_copy ? 'SEGUNDA VIA' : 'FICHA DE CONSUMO',
    'Ficha ' + document.public_number,
    orderLocationLabel(document),
    ...(document.tab_label ? ['Comanda: ' + document.tab_label] : []),
    '',
    document.product,
    ...(document.notes ? ['Obs.: ' + document.notes] : []),
    '',
  ];
  const lines = text.flatMap((line) => receiptWrap(receiptSafeText(line), columns));
  const height = Math.max(320, margin * 2 + lines.length * lineHeight + qrSize + 80);
  const doc = new PDFDocument({
    autoFirstPage: false,
    info: { Title: 'Ficha ' + document.public_number, CreationDate: new Date(issuedAt) },
    compress: true,
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const [face, qr, barcode] = await Promise.all([
    font,
    QRCode.toBuffer(document.token, { width: 360, margin: 2 }),
    bwipjs.toBuffer({ bcid: 'code128', text: document.token, scale: 2, height: 12 }),
  ]);
  doc.addPage({ size: [width, height], margin: 0 });
  doc.registerFont('Ticket', face);
  doc.font('Ticket').fontSize(fontSize);
  let y = margin;
  for (const line of lines) {
    doc.text(line, margin, y, { lineBreak: false, width: width - margin * 2 });
    y += lineHeight;
  }
  doc.image(qr, (width - qrSize) / 2, y, { width: qrSize, height: qrSize });
  y += qrSize + 10;
  doc.image(barcode, margin, y, { fit: [width - margin * 2, 34], align: 'center' });
  y += 44;
  doc.fontSize(fontSize).text('Uso unico. Validacao no sistema.', margin, y, {
    lineBreak: false,
    width: width - margin * 2,
  });
  doc.end();
  return result;
}
