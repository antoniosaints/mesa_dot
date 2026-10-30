import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { readFile } from 'node:fs/promises';
import { tableQrPage, type TableQrDocument } from '../../../packages/shared/src/table-qr-print.js';
import { receiptSafeText, receiptWrap } from '../../../packages/shared/src/receipt.js';
const font = readFile(
  new URL('../../../packages/shared/assets/LiberationMono-Regular.ttf', import.meta.url),
);
export async function tableQrPdf(document: TableQrDocument): Promise<Buffer> {
  const mm = (v: number) => (v * 72) / 25.4,
    p = tableQrPage(document.format);
  const doc = new PDFDocument({
    autoFirstPage: false,
    info: {
      Title: 'QR Code - Mesa ' + document.table_number,
      Author: document.establishment_name,
      CreationDate: new Date(document.issued_at),
    },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const [face, qr] = await Promise.all([
    font,
    QRCode.toBuffer(document.url, { width: 900, margin: 4, errorCorrectionLevel: 'M' }),
  ]);
  doc.addPage({ size: [mm(p.width), mm(p.height)], margin: 0 });
  doc.registerFont('Label', face);
  doc.font('Label');
  const x = mm(p.x),
    y = mm(p.y),
    width = mm(p.labelWidth),
    padding = mm(5),
    inner = width - padding * 2;
  if (document.format === 'A4')
    doc
      .save()
      .dash(3, { space: 3 })
      .strokeColor('#999999')
      .rect(x, y, width, mm(p.labelHeight))
      .stroke()
      .restore();
  const venue = receiptWrap(document.establishment_name, document.format === '58' ? 28 : 40)
    .slice(0, 2)
    .join('\n');
  doc
    .fontSize(9)
    .fillColor('#111111')
    .text(venue, x + padding, y + mm(6), {
      width: inner,
      align: 'center',
      height: mm(10),
      ellipsis: true,
    });
  const title = 'Mesa ' + receiptSafeText(document.table_number);
  doc.fontSize(18);
  const size = Math.min(18, (18 * inner) / Math.max(inner, doc.widthOfString(title)));
  doc
    .fontSize(size)
    .text(title, x + padding, y + mm(19), { width: inner, align: 'center', lineBreak: false });
  const qrSize = mm(Math.min(p.labelWidth - 16, 52));
  doc.image(qr, x + (width - qrSize) / 2, y + mm(28), { width: qrSize, height: qrSize });
  const bottom = y + mm(28) + qrSize;
  doc
    .fontSize(8)
    .text('Escaneie o QR Code\npara acessar o cardápio.', x + padding, bottom + mm(1), {
      width: inner,
      align: 'center',
      lineGap: 2,
    });
  doc.fontSize(6.5).text(new URL(document.url).host, x + padding, bottom + mm(10), {
    width: inner,
    align: 'center',
    height: mm(7),
    ellipsis: true,
  });
  doc.end();
  return result;
}
