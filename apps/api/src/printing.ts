import { rows, sql, type Scope } from '../../../packages/database/src/index.js';
import { ensure, permit } from '../../../packages/shared/src/index.js';
import { ticketDocument } from './tickets.js';
import type { Row } from '../../../packages/database/src/index.js';
import type { ReceiptDocument } from '../../../packages/shared/src/receipt.js';
export async function printJobDocument(s: Scope, job: Row) {
  if (job.document_kind === 'TABLE_QR') {
    const snapshot =
      typeof job.table_qr_snapshot === 'string'
        ? JSON.parse(job.table_qr_snapshot)
        : job.table_qr_snapshot;
    ensure(
      snapshot?.kind === 'TABLE_QR' && snapshot.version === 1,
      'INVALID_STATE',
      'QR da mesa indisponível.',
    );
    return { ...snapshot, is_copy: Boolean(job.is_copy || job.attempts > 1) };
  }
  if (job.document_kind === 'RECEIPT') {
    const snapshot: ReceiptDocument =
      typeof job.receipt_snapshot === 'string'
        ? JSON.parse(job.receipt_snapshot)
        : job.receipt_snapshot;
    ensure(
      snapshot?.kind === 'RECEIPT' && snapshot.version === 1,
      'INVALID_STATE',
      'Cupom indisponível.',
    );
    return { ...snapshot, is_copy: Boolean(job.is_copy || job.attempts > 1) };
  }
  return {
    ...(await ticketDocument(s, job.ticket_id)),
    is_copy: Boolean(job.is_copy || job.attempts > 1),
  };
}
export async function claimPrint(s: Scope, printerIds: string[] = []): Promise<Row> {
  ensure(s.actor.kind === 'AGENT', 'FORBIDDEN', 'Credencial de agente necessária.', 403);
  const agent = await s.get('print_agents', s.actor.id);
  const local = agent.transport === 'PRINTBRIDGE';
  await s.update('print_agents', s.actor.id, {
    last_seen_at: new Date(),
    ...(!local
      ? { station_status: { printer_ids: printerIds, running: true, connected: true } }
      : {}),
  });
  for (const printerId of printerIds) await s.get('printers', printerId);
  const jobs = await s.list(
    'print_jobs',
    sql`printer_id IN (SELECT id FROM printers WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${s.actor.establishmentId} AND enabled=TRUE) AND (status IN ('PENDING','FAILED') OR (status='PROCESSING' AND lease_until<UTC_TIMESTAMP(3)) ${local ? sql`OR (status='PROCESSING' AND bridge_delivery IS NOT NULL AND agent_id=${s.actor.id})` : sql``}) AND (attempts<5 ${local ? sql`OR (status='PROCESSING' AND bridge_delivery IS NOT NULL AND agent_id=${s.actor.id})` : sql``}) AND (bridge_delivery IS NULL ${local ? sql`OR agent_id=${s.actor.id}` : sql``}) ${
      printerIds.length
        ? sql`AND printer_id IN (${sql.join(
            printerIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql``
    }`,
  );
  for (const job of jobs.reverse()) {
    const ticket = job.document_kind === 'TICKET' ? await s.get('tickets', job.ticket_id) : null;
    if (ticket && !job.bridge_delivery && ['CANCELLED', 'REDEEMED'].includes(ticket.status)) {
      await s.update('print_jobs', job.id, {
        status: 'FAILED',
        attempts: 5,
        last_error: 'Ficha não utilizável.',
      });
      continue;
    }
    await s.update('print_jobs', job.id, {
      status: 'PROCESSING',
      agent_id: s.actor.id,
      attempts: job.attempts + 1,
      lease_until: new Date(Date.now() + 60_000),
    });
    // Tokens are derived only for the authenticated agent; never persisted in jobs or logs.
    return {
      ...job,
      status: 'PROCESSING',
      is_copy: Boolean(job.is_copy || job.attempts > 0),
      document: job.bridge_delivery
        ? undefined
        : await printJobDocument(s, { ...job, attempts: job.attempts + 1 }),
      printer: await s.get('printers', job.printer_id),
    };
  }
  return { idle: true };
}
export async function finishPrint(
  s: Scope,
  id: string,
  input: { success: boolean; error?: string },
) {
  ensure(s.actor.kind === 'AGENT', 'FORBIDDEN', 'Credencial de agente necessária.', 403);
  const job = await s.get('print_jobs', id, true);
  ensure(job.agent_id === s.actor.id, 'FORBIDDEN', 'Job de outro agente.', 403);
  if (job.status === 'CANCELLED') {
    await s.audit('print.cancelled_result', id, { success: input.success, transport: 'TCP' });
    return { id, status: 'CANCELLED' };
  }
  ensure(!job.bridge_delivery, 'CONFLICT', 'Confirme o resultado pelo fluxo do PrintBridge.');
  ensure(
    job.status === 'PROCESSING' && job.agent_id === s.actor.id,
    'CONFLICT',
    'Job não pertence a este agente.',
  );
  ensure(
    new Date(`${job.lease_until}Z`).getTime() >= Date.now(),
    'CONFLICT',
    'Lease de impressão expirado.',
  );
  await s.update('print_jobs', id, {
    status: input.success ? 'COMPLETED' : 'FAILED',
    completed_at: input.success ? new Date() : null,
    last_error: input.error?.slice(0, 255) ?? null,
    lease_until: null,
  });
  await s.audit('print.finished', id, { success: input.success });
  if (!input.success) await s.event('print.failed', id);
  return { id, status: input.success ? 'COMPLETED' : 'FAILED' };
}
export async function retryPrint(s: Scope, id: string, reason?: string) {
  permit(s.actor, 'print.manage');
  const job = await s.get('print_jobs', id);
  ensure(job.status === 'FAILED', 'INVALID_STATE', 'Job não está com falha.');
  if (job.bridge_delivery)
    ensure(
      reason && reason.trim().length >= 3,
      'BAD_REQUEST',
      'Confira a saída física e informe o motivo da nova via.',
      400,
    );
  await s.update('print_jobs', id, {
    status: 'PENDING',
    attempts: 0,
    is_copy: true,
    bridge_delivery: null,
  });
  await s.audit('print.retry', id, {
    reason: reason ?? null,
    previous_bridge: job.bridge_delivery ?? null,
  });
  return { id, status: 'PENDING' };
}

const activePrint = sql`status IN ('PENDING','PROCESSING','FAILED')`;
export async function cancelPrint(s: Scope, id: string, reason?: string) {
  permit(s.actor, 'print.manage');
  ensure(s.actor.kind === 'STAFF', 'FORBIDDEN', 'Funcionário autorizado necessário.', 403);
  const job = await s.get('print_jobs', id, true);
  if (job.status === 'CANCELLED') return { id, status: 'CANCELLED' };
  ensure(
    job.status !== 'COMPLETED',
    'INVALID_STATE',
    'Esta impressão já foi enviada. O cancelamento não pode desfazer o envio.',
  );
  await s.update('print_jobs', id, {
    status: 'CANCELLED',
    cancelled_at: new Date(),
    cancelled_by: s.actor.id,
    cancellation_reason: reason?.trim() || null,
    lease_until: null,
  });
  await s.audit('print.cancelled', id, {
    reason: reason?.trim() || null,
    previous_status: job.status,
  });
  await s.event('print.cancelled', id);
  return { id, status: 'CANCELLED' };
}
export async function cancelPrintQueue(s: Scope, reason?: string) {
  permit(s.actor, 'print.manage');
  ensure(s.actor.kind === 'STAFF', 'FORBIDDEN', 'Funcionário autorizado necessário.', 403);
  const jobs = await rows(
    s.tx,
    sql`SELECT id,status FROM print_jobs WHERE ${s.where(activePrint)} FOR UPDATE`,
  );
  const processing = jobs.filter((job) => job.status === 'PROCESSING').length;
  if (jobs.length) {
    await s.tx.execute(
      sql`UPDATE print_jobs SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP(3),cancelled_by=${s.actor.id},cancellation_reason=${reason?.trim() || null},lease_until=NULL WHERE ${s.where(activePrint)}`,
    );
    await s.audit('print.queue_cancelled', s.actor.establishmentId, {
      cancelled: jobs.length,
      processing,
      reason: reason?.trim() || null,
    });
    await s.event('print.queue_cancelled', s.actor.establishmentId, { cancelled: jobs.length });
  }
  return { cancelled: jobs.length, processing };
}
export async function printJobState(s: Scope, id: string) {
  ensure(s.actor.kind === 'AGENT', 'FORBIDDEN', 'Agente necessário.', 403);
  const job = await s.get('print_jobs', id);
  ensure(job.agent_id === s.actor.id, 'FORBIDDEN', 'Job de outro agente.', 403);
  const delivery =
    typeof job.bridge_delivery === 'string' ? JSON.parse(job.bridge_delivery) : job.bridge_delivery;
  return { id, status: job.status, generation: delivery?.generation ?? null };
}
