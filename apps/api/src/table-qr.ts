import { z } from 'zod';
import { sql, type Scope } from '../../../packages/database/src/index.js';
import { ensure, permit } from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import {
  tableQrFormats,
  tableQrUrl,
  type TableQrDocument,
  type TableQrFormat,
} from '../../../packages/shared/src/table-qr-print.js';
import { unit } from './orders.js';
export const tableQrQuery = z.object({ format: z.enum(tableQrFormats).default('A4') }).strict();
export async function tableQrDocument(
  s: Scope,
  id: string,
  format: TableQrFormat,
): Promise<TableQrDocument> {
  permit(s.actor, 'table.view');
  const table = await s.get('dining_tables', id),
    venue = await unit(s);
  ensure(!table.deleted_at, 'NOT_FOUND', 'Mesa excluída.', 404);
  ensure(
    table.enabled,
    'INVALID_STATE',
    'Mesa desativada. Ative a mesa antes de emitir seu QR Code.',
  );
  const origin =
    process.env.CUSTOMER_PUBLIC_URL ??
    process.env.VITE_CUSTOMER_URL ??
    (env.NODE_ENV === 'production' ? null : 'http://localhost:5174');
  ensure(
    origin,
    'INVALID_STATE',
    'Configure CUSTOMER_PUBLIC_URL com o endereço público do aplicativo do cliente.',
  );
  return {
    kind: 'TABLE_QR',
    version: 1,
    establishment_name: venue.name,
    table_id: table.id,
    table_number: table.number,
    url: tableQrUrl(origin, venue.slug, table.public_code),
    format,
    issued_at: new Date().toISOString(),
  };
}
export async function queueTableQr(
  s: Scope,
  id: string,
  input: { printer_id: string; paper_width: 58 | 80 },
) {
  permit(s.actor, 'table.view');
  const printer = await s.get('printers', input.printer_id);
  ensure(printer.enabled, 'INVALID_STATE', 'Impressora desativada.');
  const snapshot = await tableQrDocument(s, id, input.paper_width === 58 ? '58' : '80');
  const previous = await s.list('print_jobs', sql`source_table_id=${id}`);
  const job = await s.insert('print_jobs', {
    document_kind: 'TABLE_QR',
    table_qr_snapshot: snapshot,
    source_table_id: id,
    ticket_id: null,
    printer_id: printer.id,
    paper_width: input.paper_width,
    status: 'PENDING',
    is_copy: previous.length > 0,
  });
  await s.audit('table.qr_print_queued', job.id, {
    table_id: id,
    printer_id: printer.id,
    paper_width: input.paper_width,
  });
  await s.event('print.queued', job.id);
  return { id: job.id, status: 'PENDING', printer_name: printer.name };
}
