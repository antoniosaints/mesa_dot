import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { db, rows, sql, view, type Row } from '../../../packages/database/src/index.js';
import { publicActor } from '../../api/src/auth.js';
import { finishMercadoOperation, syncMercadoIntent } from '../../api/src/mercado-financial.js';

export async function reconcilePaymentRecord(record: Row) {
  const actor = publicActor({ id: record.establishment_id, tenant_id: record.tenant_id }),
    lease = crypto.randomUUID();
  const scope = view(actor),
    task = await scope.get('payment_reconciliation', record.id);
  if (new Date(String(task.watch_until) + 'Z').getTime() <= Date.now()) return;
  const acquired = await scope.update(
    'payment_reconciliation',
    task.id,
    {
      lease_token: lease,
      lease_until: new Date(Date.now() + 15 * 60000),
      attempts: Number(task.attempts) + 1,
    },
    sql`watch_until>UTC_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<=UTC_TIMESTAMP(3))`,
  );
  const claim: Row | null = acquired ? { ...task, attempts: Number(task.attempts) + 1 } : null;
  if (!claim) return;
  try {
    const result = await syncMercadoIntent(actor, claim.intent_id, false);
    const intent = await view(actor).get('payment_intents', claim.intent_id);
    const age = Date.now() - new Date(String(intent.created_at) + 'Z').getTime();
    const interval =
      age > 7 * 86400000
        ? 6 * 3600000
        : age > 86400000
          ? 3600000
          : result.status === 'PENDING'
            ? 60000
            : 15 * 60000;
    await view(actor).update(
      'payment_reconciliation',
      claim.id,
      {
        lease_token: null,
        lease_until: null,
        last_error: null,
        last_checked_at: new Date(),
        attempts: 0,
        next_attempt_at: new Date(Date.now() + interval),
      },
      sql`lease_token=${lease}`,
    );
    return result;
  } catch (error) {
    await view(actor).update(
      'payment_reconciliation',
      claim.id,
      {
        lease_token: null,
        lease_until: null,
        last_error: 'PROVIDER_OR_VALIDATION_ERROR',
        next_attempt_at: new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(claim.attempts, 7)),
        ),
      },
      sql`lease_token=${lease}`,
    );
    throw error;
  }
}
export function startPaymentReconciliation(redis: Redis, queueName = 'mercado-payments') {
  const queue = new Queue(queueName, { connection: redis });
  const worker = new Worker(
    queueName,
    async (job) => {
      const table = job.data.kind === 'operation' ? 'gateway_operations' : 'payment_reconciliation';
      const record = (
        await rows(
          db,
          sql`SELECT task.* FROM ${sql.identifier(table)} task JOIN tenants t ON t.id=task.tenant_id AND t.enabled=TRUE WHERE task.id=${job.data.id} AND task.tenant_id=${job.data.tenant_id} AND task.establishment_id=${job.data.establishment_id}`,
        )
      )[0];
      if (!record) return;
      if (job.data.kind === 'operation') {
        if (!['CHECKOUT', 'REFUND'].includes(record.kind) || record.state === 'REVIEW') return;
        return finishMercadoOperation(
          publicActor({ id: record.establishment_id, tenant_id: record.tenant_id }),
          record.id,
        );
      }
      return reconcilePaymentRecord(record);
    },
    { connection: redis, concurrency: 2, limiter: { max: 30, duration: 60000 } },
  );
  worker.on('error', () => console.error(JSON.stringify({ event: 'payments.worker_error' })));
  queue.on('error', () => console.error(JSON.stringify({ event: 'payments.queue_error' })));
  worker.on('failed', (job) =>
    console.error(
      JSON.stringify({ event: 'payments.retry', job_id: job?.id, attempts: job?.attemptsMade }),
    ),
  );
  return {
    queue,
    worker,
    async dispatch() {
      const operations = await rows(
        db,
        sql`SELECT o.id,o.tenant_id,o.establishment_id,'operation' kind FROM gateway_operations o JOIN tenants t ON t.id=o.tenant_id AND t.enabled=TRUE WHERE o.kind IN ('CHECKOUT','REFUND') AND o.state IN ('PENDING','PROCESSING') AND o.next_attempt_at<=UTC_TIMESTAMP(3) AND (o.lease_until IS NULL OR o.lease_until<=UTC_TIMESTAMP(3)) ORDER BY o.next_attempt_at LIMIT 50`,
      );
      const records = await rows(
        db,
        sql`SELECT r.id,r.tenant_id,r.establishment_id,'reconciliation' kind FROM payment_reconciliation r JOIN tenants t ON t.id=r.tenant_id AND t.enabled=TRUE WHERE r.next_attempt_at<=UTC_TIMESTAMP(3) AND r.watch_until>UTC_TIMESTAMP(3) AND (r.lease_until IS NULL OR r.lease_until<=UTC_TIMESTAMP(3)) ORDER BY r.next_attempt_at LIMIT 50`,
      );
      for (const record of [...operations, ...records]) {
        const jobId = record.kind + '-' + record.id,
          existing = await queue.getJob(jobId);
        if (existing) {
          const state = await existing.getState();
          if (!['completed', 'failed'].includes(state)) continue;
          await existing.remove();
        }
        await queue.add(record.kind, record, {
          jobId,
          attempts: 6,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 604800, count: 1000 },
        });
      }
    },
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
