import type { TableQrDocument } from '../../../packages/shared/src/table-qr-print.js';
import { orderLocationLabel } from '../../../packages/shared/src/order-location.js';
import { receiptLines, type ReceiptDocument } from '../../../packages/shared/src/receipt.js';
export interface TicketPrintDocument {
  kind?: 'TICKET';
  public_number: string;
  product: string;
  table_number: string;
  service_mode?: string;
  token: string;
  is_copy?: boolean;
}
export type PrintDocument = TicketPrintDocument | ReceiptDocument | TableQrDocument;
export function escpos(document: PrintDocument): Buffer {
  if (document.kind === 'TABLE_QR') {
    const url = new URL(document.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      Array.from(document.url).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      Buffer.byteLength(document.url) > 2048
    )
      throw new Error('URL de mesa inválida.');
    const text = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7e]/g, ' ');
    const data = Buffer.from(document.url, 'utf8'),
      length = data.length + 3;
    return Buffer.concat([
      Buffer.from([0x1b, 0x40, 0x1b, 0x61, 1]),
      Buffer.from(
        text(document.establishment_name) + '\nMESA ' + text(document.table_number) + '\n\n',
        'ascii',
      ),
      Buffer.from([
        0x1d,
        0x28,
        0x6b,
        4,
        0,
        0x31,
        0x41,
        0x32,
        0,
        0x1d,
        0x28,
        0x6b,
        3,
        0,
        0x31,
        0x43,
        document.format === '58' ? 3 : 4,
        0x1d,
        0x28,
        0x6b,
        3,
        0,
        0x31,
        0x45,
        0x31,
        0x1d,
        0x28,
        0x6b,
        length & 255,
        length >> 8,
        0x31,
        0x50,
        0x30,
      ]),
      data,
      Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]),
      Buffer.from(
        '\nEscaneie para acessar o cardapio\ne fazer seu pedido.\n' + text(url.host) + '\n\n\n',
        'ascii',
      ),
      Buffer.from([0x1d, 0x56, 0]),
    ]);
  }
  if (document.kind === 'RECEIPT') {
    const content = receiptLines(document)
      .join('\n')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e\n]/g, '?');
    return Buffer.concat([
      Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0, 0x1b, 0x4d, 0]),
      Buffer.from(content + '\n\n\n', 'ascii'),
      Buffer.from([0x1d, 0x56, 0]),
    ]);
  }
  const text = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '');
  const token = Buffer.from(document.token, 'ascii');
  if (!/^[\w-]{32,100}$/.test(document.token)) throw new Error('Token inválido para impressão.');
  const qrLength = token.length + 3;
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 1]),
    Buffer.from(
      `${document.is_copy ? 'SEGUNDA VIA\n' : ''}FICHA ${text(document.public_number)}\n${text(orderLocationLabel(document))}\n${text(document.product)}\n\n`,
      'ascii',
    ),
    Buffer.from([0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0]),
    Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6]),
    Buffer.from([0x1d, 0x28, 0x6b, qrLength & 255, qrLength >> 8, 0x31, 0x50, 0x30]),
    token,
    Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]),
    Buffer.from('\n'),
    Buffer.from([0x1d, 0x68, 60, 0x1d, 0x77, 2, 0x1d, 0x6b, 73, token.length + 2]),
    Buffer.from('{B'),
    token,
    Buffer.from('\nUso unico. Validacao no sistema.\n\n\n'),
    Buffer.from([0x1d, 0x56, 0]),
  ]);
}
