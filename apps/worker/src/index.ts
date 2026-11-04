import { startPaymentReconciliation } from './payment-reconciliation.js';
import { stagePushEvent, startPushQueue, cleanupPushSubscriptions } from './push-notifications.js';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  db,
  pool,
  rows,
  sql,
  view,
  atomic,
  type Row,
} from '../../../packages/database/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { publicActor } from '../../api/src/auth.js';
import { expireHolds } from '../../api/src/inventory.js';
import { approvedForOrder } from '../../api/src/payments.js';

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('outbox', { connection: redis });
const push = startPushQueue(redis);
const payments = startPaymentReconciliation(redis);
async function sessionFor(event: Row) {
  const s = view(publicActor({ id: event.establishment_id, tenant_id: event.tenant_id }));
  const session = await s.list('table_sessions', sql`id=${event.aggregate_id}`);
  if (session.length) return { session_id: session[0].id, customer_id: null };
  let orderId = event.aggregate_id;
  const tickets = await s.list('tickets', sql`id=${event.aggregate_id}`);
  if (tickets.length) orderId = (await s.get('order_items', tickets[0].order_item_id)).order_id;
  const jobs = await s.list('production_jobs', sql`id=${event.aggregate_id}`);
  if (jobs.length) {
    const t = await s.get('tickets', jobs[0].ticket_id);
    orderId = (await s.get('order_items', t.order_item_id)).order_id;
  }
  const orders = await s.list('orders', sql`id=${orderId}`);
  if (orders[0]?.tab_id)
    return {
      session_id: (await s.get('tabs', orders[0].tab_id)).session_id,
      customer_id: orders[0].customer_id,
    };
  return { session_id: null, customer_id: orders[0]?.customer_id ?? null };
}
const worker = new Worker(
  'outbox',
  async (job) => {
    const found = await rows(
      db,
      sql`SELECT * FROM outbox_events WHERE id=${job.data.id} AND tenant_id=${job.data.tenant_id} AND establishment_id=${job.data.establishment_id}`,
    );
    if (!found.length || found[0].published_at) return;
    const event = found[0];
    await stagePushEvent(event);
    await redis.publish(
      'bar:events',
      JSON.stringify({
        event_id: event.id,
        event: event.event,
        tenant_id: event.tenant_id,
        establishment_id: event.establishment_id,
        aggregate_id: event.aggregate_id,
        version: event.version,
        occurred_at: event.created_at,
        ...(await sessionFor(event)),
        data: event.payload,
      }),
    );
    await view(publicActor({ id: event.establishment_id, tenant_id: event.tenant_id })).update(
      'outbox_events',
      event.id,
      { published_at: new Date(), last_error: null },
    );
  },
  { connection: redis, concurrency: 4 },
);
worker.on('failed', (job, error) =>
  console.error(
    JSON.stringify({ event: 'outbox.failed', job_id: job?.id, message: error.message }),
  ),
);
let stopped = false;
async function dispatch() {
  const pending = await db.transaction(
    async (tx) => {
      const events = await rows(
        tx,
        sql`SELECT * FROM outbox_events WHERE published_at IS NULL AND next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );
      for (const event of events)
        await tx.execute(
          sql`UPDATE outbox_events SET attempts=attempts+1,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND) WHERE id=${event.id}`,
        );
      return events;
    },
    { isolationLevel: 'read committed' },
  );
  // Queue calls happen after COMMIT. Lost enqueue attempts become eligible again after the lease.
  for (const event of pending) {
    const existing = await queue.getJob(event.id);
    if (existing && (await existing.getState()) === 'failed') await existing.retry();
    else
      await queue.add(
        event.event,
        { id: event.id, tenant_id: event.tenant_id, establishment_id: event.establishment_id },
        {
          jobId: event.id,
          attempts: 8,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
  }
}
let lastMaintenance = 0;
async function maintenance() {
  if (Date.now() - lastMaintenance < 60_000) return;
  lastMaintenance = Date.now();
  for (const u of await rows(
    db,
    sql`SELECT e.* FROM establishments e JOIN tenants t ON t.id=e.tenant_id WHERE t.enabled=TRUE`,
  )) {
    await atomic(
      publicActor(u),
      `maintenance:${Math.floor(Date.now() / 60_000)}`,
      'maintenance',
      {},
      async (s) => {
        await expireHolds(s);
        for (const order of await s.list(
          'orders',
          sql`status='PENDING_PAYMENT' AND checkout_expires_at<UTC_TIMESTAMP(3)`,
        )) {
          if ((await approvedForOrder(s, order.id)) > 0n) continue;
          await s.update('orders', order.id, { status: 'CANCELLED', version: order.version + 1 });
          for (const intent of await s.list(
            'payment_intents',
            sql`order_id=${order.id} AND status='PENDING'`,
          ))
            await s.update('payment_intents', intent.id, { status: 'FAILED' });
          await s.insert('order_status_events', {
            order_id: order.id,
            status: 'CANCELLED',
            actor_id: s.actor.id,
          });
          await s.audit('order.checkout_expired', order.id);
          await s.event('order.cancelled', order.id);
        }
        const stale = await rows(
          s.tx,
          sql`SELECT c.id FROM customers c WHERE c.tenant_id=${u.tenant_id} AND c.establishment_id=${u.id} AND c.anonymized_at IS NULL AND c.created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${u.retention_days} DAY) AND NOT EXISTS(SELECT 1 FROM visitor_sessions v WHERE v.tenant_id=c.tenant_id AND v.establishment_id=c.establishment_id AND v.customer_id=c.id AND v.expires_at>UTC_TIMESTAMP(3)) AND NOT EXISTS(SELECT 1 FROM table_participants p JOIN table_sessions ts ON ts.tenant_id=p.tenant_id AND ts.establishment_id=p.establishment_id AND ts.id=p.session_id WHERE p.tenant_id=c.tenant_id AND p.establishment_id=c.establishment_id AND p.customer_id=c.id AND ts.status<>'CLOSED')`,
        );
        for (const customer of stale) {
          await s.update('customers', customer.id, {
            name: 'Anonimizado',
            phone: '',
            anonymized_at: new Date(),
          });
          await s.audit('customer.anonymized', customer.id);
        }
        return { expired_checkouts_processed: true, anonymized: stale.length };
      },
    );
  }
}
const stop = async () => {
  stopped = true;
  await worker.close();
  await push.close();
  await payments.close();
  await queue.close();
  await redis.quit();
  await pool.end();
};
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void stop();
  });
while (!stopped) {
  try {
    await dispatch();
    await push.dispatch();
    await payments.dispatch();
    if (Date.now() - lastMaintenance >= 60_000) await cleanupPushSubscriptions();
    await maintenance();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'worker.error',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
