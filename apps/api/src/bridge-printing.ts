import { tableQrPdf } from './table-qr-pdf.js';
import { type Scope, type Row } from '../../../packages/database/src/index.js';
import { createHash } from 'node:crypto';
import { ensure } from '../../../packages/shared/src/index.js';
import { printJobDocument } from './printing.js';
import { accessTicket, ticketToken } from './tickets.js';
import { escpos, type PrintDocument } from '../../print-agent/src/escpos.js';
import { receiptPdf } from './receipt-pdf.js';
import { ticketPdf } from './ticket-pdf.js';
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export type BridgeState = 'queued' | 'processing' | 'submitted' | 'failed' | 'unknown';
export interface BridgeDelivery {
  generation: string;
  idempotencyKey: string;
  origin: string;
  printerId: string;
  format: 'pdf' | 'escpos';
  paperWidth: 58 | 80;
  createdAt: string;
  state: BridgeState;
  jobId: string | null;
  sha256: string;
  ticket?: Record<string, any>;
  isCopy: boolean;
}
export function bridgeDelivery(job: Row): BridgeDelivery | null {
  return typeof job.bridge_delivery === 'string'
    ? JSON.parse(job.bridge_delivery)
    : (job.bridge_delivery ?? null);
}
function publicDelivery(d: BridgeDelivery) {
  const { ticket: _ticket, ...safe } = d;
  return safe;
}
async function owned(s: Scope, id: string, requireLease = true) {
  ensure(s.actor.kind === 'AGENT', 'FORBIDDEN', 'Credencial de agente necessária.', 403);
  const agent = await s.get('print_agents', s.actor.id);
  ensure(agent.transport === 'PRINTBRIDGE', 'FORBIDDEN', 'Agente PrintBridge necessário.', 403);
  const job = await s.get('print_jobs', id, true);
  ensure(job.agent_id === s.actor.id, 'FORBIDDEN', 'Trabalho de outra estação.', 403);
  ensure(
    job.status === 'PROCESSING' ||
      (!requireLease && ['COMPLETED', 'CANCELLED'].includes(job.status)),
    'CONFLICT',
    'Trabalho não está em processamento.',
  );
  if (requireLease)
    ensure(
      new Date(job.lease_until + 'Z').getTime() >= Date.now(),
      'CONFLICT',
      'Lease expirado. Recupere o trabalho.',
    );
  return job;
}
async function payload(s: Scope, job: Row, d: BridgeDelivery) {
  let document: PrintDocument;
  if (job.document_kind === 'TABLE_QR') {
    document = (await printJobDocument(s, job)) as PrintDocument;
  } else if (job.document_kind === 'RECEIPT') {
    const receipt =
      typeof job.receipt_snapshot === 'string'
        ? JSON.parse(job.receipt_snapshot)
        : job.receipt_snapshot;
    document = { ...receipt, is_copy: d.isCopy };
  } else {
    const { ticket } = await accessTicket(s, job.ticket_id);
    ensure(
      !['REDEEMED', 'CANCELLED'].includes(ticket.status),
      'INVALID_STATE',
      'Ficha não utilizável.',
    );
    document = { ...d.ticket, token: ticketToken(ticket), is_copy: d.isCopy } as PrintDocument;
  }
  if (d.format === 'escpos') return escpos(document);
  if (document.kind === 'TABLE_QR') return tableQrPdf(document);
  return document.kind === 'RECEIPT'
    ? receiptPdf(document)
    : ticketPdf(document, d.paperWidth, d.createdAt);
}
export async function prepareBridge(
  s: Scope,
  id: string,
  input: { origin: string; printer_id: string; format: 'pdf' | 'escpos'; paper_width: 58 | 80 },
) {
  const job = await owned(s, id),
    previous = bridgeDelivery(job);
  if (previous) {
    ensure(
      previous.origin === input.origin,
      'CONFLICT',
      'Recupere esta impressão pela mesma origem que a iniciou.',
    );
    return publicDelivery(previous);
  }
  const document = await printJobDocument(s, job);
  const d: BridgeDelivery = {
    generation: crypto.randomUUID(),
    idempotencyKey: '',
    origin: input.origin,
    printerId: input.printer_id,
    format: input.format,
    paperWidth: job.document_kind !== 'TICKET' ? job.paper_width : input.paper_width,
    createdAt: new Date().toISOString(),
    state: 'queued',
    jobId: null,
    sha256: '',
    isCopy: Boolean(document.is_copy),
  };
  d.idempotencyKey = 'mesa:' + job.id + ':' + d.generation;
  if (job.document_kind === 'TICKET') {
    const t = document as Row;
    d.ticket = {
      kind: 'TICKET',
      public_number: t.public_number,
      product: t.product,
      table_number: t.table_number,
      service_mode: t.service_mode,
      tab_label: t.tab_label,
      notes: t.notes,
      order_id: t.order_id,
    };
  }
  d.sha256 = digest(await payload(s, job, d));
  await s.update('print_jobs', id, { bridge_delivery: d });
  await s.audit('print.bridge_prepared', id, {
    generation: d.generation,
    format: d.format,
    origin: d.origin,
  });
  return publicDelivery(d);
}
export async function bridgePayload(s: Scope, id: string, generation: string) {
  const job = await owned(s, id),
    d = bridgeDelivery(job);
  ensure(d && d.generation === generation, 'CONFLICT', 'Emissão local diferente da solicitada.');
  const data = await payload(s, job, d);
  ensure(
    digest(data) === d.sha256,
    'CONFLICT',
    'Documento mudou. Confira a impressão antes de solicitar outra via.',
  );
  return { data, contentType: d.format === 'pdf' ? 'application/pdf' : 'application/octet-stream' };
}
export async function reportBridge(
  s: Scope,
  id: string,
  input: { generation: string; job_id?: string; state: BridgeState; error?: string },
) {
  const job = await owned(s, id, false),
    d = bridgeDelivery(job);
  ensure(d && d.generation === input.generation, 'CONFLICT', 'Emissão local diferente.');
  ensure(!d.jobId || d.jobId === input.job_id, 'CONFLICT', 'Identificador local diferente.');
  if (job.status === 'COMPLETED') return { id, status: job.status, bridge: publicDelivery(d) };
  ensure(
    input.state === 'unknown' || input.job_id,
    'BAD_REQUEST',
    'Identificador do trabalho local necessário.',
    400,
  );
  d.jobId = input.job_id ?? d.jobId;
  d.state = input.state;
  if (job.status === 'CANCELLED') {
    await s.update('print_jobs', id, { bridge_delivery: d });
    await s.audit('print.cancelled_result', id, {
      generation: d.generation,
      state: d.state,
      local_job_id: d.jobId,
      transport: 'PRINTBRIDGE',
    });
    return { id, status: 'CANCELLED', bridge: publicDelivery(d) };
  }
  const submitted = input.state === 'submitted',
    failed = ['failed', 'unknown'].includes(input.state);
  const status = submitted ? 'COMPLETED' : failed ? 'FAILED' : 'PROCESSING';
  await s.update('print_jobs', id, {
    bridge_delivery: d,
    status,
    lease_until: submitted || failed ? null : new Date(Date.now() + 60000),
    ...(failed ? { attempts: 5 } : {}),
    completed_at: submitted ? new Date() : null,
    last_error: failed
      ? `${input.state === 'unknown' ? 'Resultado incerto; confira a saída antes de reimprimir. ' : ''}${input.error ?? 'Falha informada pelo PrintBridge.'}`.slice(
          0,
          255,
        )
      : null,
  });
  if (submitted || failed) {
    await s.audit('print.bridge_finished', id, {
      generation: d.generation,
      state: d.state,
      local_job_id: d.jobId,
    });
    await s.event(submitted ? 'print.completed' : 'print.failed', id);
  }
  return { id, status, bridge: publicDelivery(d) };
}
