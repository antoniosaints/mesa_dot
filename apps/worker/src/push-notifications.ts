import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import type { Redis } from 'ioredis';
import { db, rows, sql, Scope, view, type Row } from '../../../packages/database/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { hash } from '../../../packages/shared/src/index.js';
import { openPush } from '../../../packages/shared/src/push-crypto.js';
import {
  pushEvents,
  pushAttempts,
  pushTtlSeconds,
  pushFailure,
  type PushMessage,
} from '../../../packages/shared/src/push.js';
import {
  loadPushSettings,
  roleReceives,
  webPushReady,
  validatePushEndpoint,
  type RegisteredPush,
} from '../../api/src/push.js';
import { publicActor } from '../../api/src/auth.js';
import { publicPwaIdentity } from '../../api/src/pwa.js';
import { iconPath } from '../../../packages/shared/src/pwa.js';

const scopeFor = (row: Row) =>
  view(publicActor({ id: row.establishment_id, tenant_id: row.tenant_id }));
const scopedUserQuery = (
  s: Scope,
) => sql`SELECT ps.*,m.role_id,UNIX_TIMESTAMP(ps.created_at) created_epoch FROM push_subscriptions ps
  JOIN staff_sessions ss ON ss.id=ps.staff_session_id AND ss.tenant_id=ps.tenant_id AND ss.establishment_id=ps.establishment_id AND ss.user_id=ps.user_id
  JOIN staff_memberships m ON m.tenant_id=ps.tenant_id AND m.establishment_id=ps.establishment_id AND m.user_id=ps.user_id
  JOIN users u ON u.id=ps.user_id JOIN tenants t ON t.id=ps.tenant_id
  JOIN tenant_memberships tm ON tm.tenant_id=ps.tenant_id AND tm.user_id=ps.user_id
  WHERE ps.tenant_id=${s.actor.tenantId} AND ps.establishment_id=${s.actor.establishmentId} AND ps.enabled=TRUE
    AND m.enabled=TRUE AND tm.enabled=TRUE AND t.enabled=TRUE AND u.enabled=TRUE
    AND ss.revoked_at IS NULL AND ss.refresh_expires_at>UTC_TIMESTAMP(3)
    AND (ps.expires_at IS NULL OR ps.expires_at>UTC_TIMESTAMP(3))`;
async function granted(s: Scope, roleId: string, permission: string) {
  return (
    (
      await rows(
        s.tx,
        sql`SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${s.actor.tenantId} AND rp.establishment_id=${s.actor.establishmentId} AND rp.role_id=${roleId} AND p.code=${permission}`,
      )
    ).length > 0
  );
}
async function messageContext(
  s: Scope,
  event: Row,
): Promise<{
  body: string;
  orderId?: string;
  tableId?: string;
  ticketId?: string;
  production?: boolean;
} | null> {
  let order: Row | undefined,
    item: Row | undefined,
    table: Row | undefined,
    ticket: Row | undefined;
  if (['ticket.requested', 'production.ready'].includes(event.event)) {
    const job =
      event.event === 'production.ready'
        ? await s.get('production_jobs', event.aggregate_id)
        : null;
    if (job && job.status !== 'READY') return null;
    ticket = await s.get('tickets', job?.ticket_id ?? event.aggregate_id);
    if (['REDEEMED', 'CANCELLED'].includes(ticket.status)) return null;
    if (event.event === 'ticket.requested' && !['REQUESTED', 'ASSIGNED'].includes(ticket.status))
      return null;
    item = await s.get('order_items', ticket.order_item_id);
    order = await s.get('orders', item.order_id);
    const assignment = (await s.list('order_item_assignments', sql`order_item_id=${item.id}`))[0];
    const tab = await s.get('tabs', assignment?.tab_id ?? order.tab_id);
    const attendance = tab.session_id ? await s.get('table_sessions', tab.session_id) : null;
    if (attendance?.status === 'CLOSED' || order.status !== 'CONFIRMED') return null;
    if (attendance) table = await s.get('dining_tables', attendance.table_id);
  } else if (event.event.startsWith('order.')) {
    order = await s.get('orders', event.aggregate_id);
    if (event.event === 'order.confirmed' && order.status !== 'CONFIRMED') return null;
    if (order.table_id) table = await s.get('dining_tables', order.table_id);
  } else if (event.event.startsWith('table.')) {
    const attendance = await s.get('table_sessions', event.aggregate_id);
    if (event.event === 'table.occupied' && attendance.status === 'CLOSED') return null;
    if (
      event.event === 'table.closed' &&
      (await s.list('table_sessions', sql`table_id=${attendance.table_id} AND status<>'CLOSED'`))
        .length
    )
      return null;
    table = await s.get('dining_tables', attendance.table_id);
  }
  const area = table?.area_id ? (await s.get('areas', table.area_id)).name : '';
  const place = table
    ? `Mesa ${table.number}${area ? ' · ' + area : ''}`
    : order?.service_mode === 'COUNTER'
      ? 'Balcão · Pedido avulso'
      : '';
  const detail = item
    ? item.name_snapshot
    : order
      ? `Pedido #${order.id.slice(0, 6).toUpperCase()}`
      : '';
  let body = [place, detail].filter(Boolean).join(' · ');
  if (!body)
    body =
      (
        {
          'payment.approved': 'Um recebimento foi confirmado. Confira os pagamentos da unidade.',
          'cash.opened': 'Um novo turno de caixa foi iniciado.',
          'cash.closed': 'Um turno de caixa foi encerrado.',
          'print.failed': 'Confira a fila de impressão da unidade.',
        } as Record<string, string>
      )[event.event] ?? 'Há uma atualização na operação.';
  return { body: body.slice(0, 240), orderId: order?.id, tableId: table?.id, ticketId: ticket?.id };
}
function targetPath(
  surface: string,
  key: string,
  unit: Row,
  context: Awaited<ReturnType<typeof messageContext>>,
) {
  const base = '/' + unit.slug + '/';
  if (surface === 'kitchen') return base + 'producao';
  if (surface === 'waiter')
    return (
      base +
      (key === 'ticket.requested'
        ? 'chamados'
        : context?.tableId
          ? 'mesas/' + context.tableId
          : 'entregas')
    );
  if (context?.orderId)
    return (
      base + 'pedidos/' + context.orderId + (context.ticketId ? '/fichas/' + context.ticketId : '')
    );
  if (context?.tableId && key !== 'table.closed')
    return base + 'salao/atendimento/' + context.tableId;
  return (
    base +
    (key.startsWith('table.')
      ? 'salao'
      : key.startsWith('payment.')
        ? 'pagamentos'
        : key.startsWith('cash.')
          ? 'caixa'
          : key.startsWith('print.')
            ? 'impressao'
            : 'dashboard')
  );
}
/** Durable fanout happens before the outbox is marked published. A unique pair survives BullMQ job removal. */
export async function stagePushEvent(event: Row) {
  const definition = pushEvents.find((item) => item.key === event.event),
    isTest = event.event === 'push.test';
  if ((!definition && !isTest) || !webPushReady()) return;
  await db.transaction(async (tx) => {
    const s = new Scope(tx, scopeFor(event).actor);
    const [fresh] = await rows(
      tx,
      sql`SELECT *,UNIX_TIMESTAMP(created_at) created_epoch FROM outbox_events WHERE ${s.where(sql`id=${event.id}`)} AND created_at>=DATE_SUB(NOW(3),INTERVAL ${pushTtlSeconds} SECOND)`,
    );
    if (!fresh) return;
    const settings = await loadPushSettings(s);
    if (
      !isTest &&
      (!settings.enabled ||
        !settings.enabled_since ||
        Number(fresh.created_epoch) * 1000 <
          Date.parse(settings.enabled_since.replace(' ', 'T') + 'Z'))
    )
      return;
    const [unit] = await rows(
      tx,
      sql`SELECT e.* FROM establishments e JOIN tenants t ON t.id=e.tenant_id WHERE e.tenant_id=${event.tenant_id} AND e.id=${event.establishment_id} AND t.enabled=TRUE`,
    );
    if (!unit) return;
    const context = isTest
      ? { body: 'As notificações deste dispositivo estão funcionando.' }
      : await messageContext(s, fresh);
    if (!context) return;
    const devices = await rows(tx, scopedUserQuery(s));
    for (const device of devices) {
      if (
        isTest
          ? device.id !== fresh.payload.subscription_id || device.user_id !== fresh.payload.user_id
          : !roleReceives(settings.rules, event.event, device.role_id) ||
            !(await granted(s, device.role_id, definition!.permission))
      )
        continue;
      if (
        device.vapid_key_hash !== hash(env.WEB_PUSH_PUBLIC_KEY!) ||
        Number(device.created_epoch) > Number(fresh.created_epoch)
      )
        continue;
      const payload: PushMessage = {
        title: `${unit.name} · ${isTest ? 'Notificação de teste' : definition!.title}`.slice(
          0,
          160,
        ),
        body: context.body,
        url: targetPath(device.surface, event.event, unit, context),
        tag: 'mesa-' + event.id,
        unit_id: unit.id,
        icon: iconPath(publicPwaIdentity(unit), 192),
      };
      await tx.execute(
        sql`INSERT IGNORE INTO push_deliveries(id,tenant_id,establishment_id,event_id,subscription_id,event_key,payload,expires_at) VALUES(${randomUUID()},${event.tenant_id},${event.establishment_id},${event.id},${device.id},${event.event},${JSON.stringify(payload)},${new Date(Number(fresh.created_epoch) * 1000 + pushTtlSeconds * 1000)})`,
      );
    }
  });
}
export type PushTransport = (
  subscription: RegisteredPush,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;
/** Delivery rechecks membership and preferences, so a queued push cannot retain revoked access. */
export async function deliverPush(
  data: { id: string; tenant_id: string; establishment_id: string },
  transport: PushTransport = webpush.sendNotification,
) {
  const s = scopeFor(data),
    [delivery] = await s.list('push_deliveries', sql`id=${data.id} AND state='PENDING'`);
  if (!delivery) return;
  const update = (values: Row) => s.update('push_deliveries', delivery.id, values);
  const [fresh] = await rows(
    db,
    sql`SELECT TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(3),expires_at) ttl FROM push_deliveries WHERE ${s.where(sql`id=${delivery.id}`)}`,
  );
  if (!fresh || fresh.ttl <= 0) {
    await update({ state: 'EXPIRED', last_error: 'TTL_EXPIRED' });
    return;
  }
  if (!webPushReady()) {
    await update({ state: 'FAILED', last_error: 'SERVER_NOT_CONFIGURED' });
    throw new UnrecoverableError('Web Push não configurado no servidor.');
  }
  const [device] = (await rows(db, scopedUserQuery(s))).filter(
    (row) => row.id === delivery.subscription_id,
  );
  if (!device || device.vapid_key_hash !== hash(env.WEB_PUSH_PUBLIC_KEY!)) {
    await update({ state: 'SKIPPED', last_error: 'DEVICE_INACTIVE' });
    return;
  }
  if (delivery.event_key !== 'push.test') {
    const settings = await loadPushSettings(s),
      definition = pushEvents.find((item) => item.key === delivery.event_key);
    if (
      !settings.enabled ||
      !definition ||
      !roleReceives(settings.rules, delivery.event_key, device.role_id) ||
      !(await granted(s, device.role_id, definition.permission))
    ) {
      await update({ state: 'SKIPPED', last_error: 'PREFERENCE_OR_ACCESS_CHANGED' });
      return;
    }
    const [event] = await s.list('outbox_events', sql`id=${delivery.event_id}`);
    if (!event || !(await messageContext(s, event))) {
      await update({ state: 'SKIPPED', last_error: 'OPERATION_RESOLVED' });
      return;
    }
  }
  if (delivery.attempts >= pushAttempts) {
    await update({ state: 'FAILED', last_error: 'RETRIES_EXHAUSTED' });
    throw new UnrecoverableError('Tentativas de push esgotadas.');
  }
  await update({ attempts: delivery.attempts + 1 });
  try {
    const credentials = openPush<RegisteredPush>(device.credentials);
    validatePushEndpoint(credentials.endpoint);
    await transport(credentials, JSON.stringify(delivery.payload), {
      TTL: Math.max(1, Math.min(pushTtlSeconds, Number(fresh.ttl))),
      urgency: 'high',
      timeout: 10000,
      vapidDetails: {
        subject: env.WEB_PUSH_SUBJECT,
        publicKey: env.WEB_PUSH_PUBLIC_KEY!,
        privateKey: env.WEB_PUSH_PRIVATE_KEY!,
      },
    });
    await update({ state: 'SENT', sent_at: new Date(), last_error: null });
  } catch (failure) {
    const status = Number((failure as { statusCode?: number }).statusCode) || undefined;
    const category = pushFailure(status);
    if (category === 'expired') {
      await update({ state: 'EXPIRED', last_error: 'SUBSCRIPTION_GONE' });
      await db.execute(
        sql`DELETE FROM push_subscriptions WHERE endpoint_hash=${device.endpoint_hash}`,
      );
      return;
    }
    if (category === 'permanent' || delivery.attempts + 1 >= pushAttempts) {
      await update({
        state: 'FAILED',
        last_error: status ? 'HTTP_' + status : 'RETRIES_EXHAUSTED',
      });
      throw new UnrecoverableError(
        status
          ? `Falha definitiva no serviço de push (HTTP ${status}).`
          : 'Tentativas de push esgotadas.',
      );
    }
    await update({ last_error: status ? 'HTTP_' + status : 'NETWORK_ERROR' });
    // Provider errors often contain endpoint URLs and authentication details. Never log them.
    throw new Error(
      status
        ? `Serviço de push temporariamente indisponível (HTTP ${status}).`
        : 'Falha temporária no serviço de push.',
    );
  }
}
export async function cleanupPushSubscriptions() {
  // Refresh-session validity protects background-only devices; foreground inactivity alone is not an error.
  await db.execute(
    sql`DELETE ps FROM push_subscriptions ps LEFT JOIN staff_sessions ss ON ss.id=ps.staff_session_id AND ss.tenant_id=ps.tenant_id AND ss.establishment_id=ps.establishment_id LEFT JOIN staff_memberships m ON m.tenant_id=ps.tenant_id AND m.establishment_id=ps.establishment_id AND m.user_id=ps.user_id LEFT JOIN tenant_memberships tm ON tm.tenant_id=ps.tenant_id AND tm.user_id=ps.user_id LEFT JOIN users u ON u.id=ps.user_id LEFT JOIN tenants t ON t.id=ps.tenant_id WHERE ss.id IS NULL OR m.id IS NULL OR tm.id IS NULL OR u.id IS NULL OR t.id IS NULL OR ss.revoked_at IS NOT NULL OR ss.refresh_expires_at<=UTC_TIMESTAMP(3) OR m.enabled=FALSE OR tm.enabled=FALSE OR u.enabled=FALSE OR t.enabled=FALSE OR (ps.expires_at IS NOT NULL AND ps.expires_at<=UTC_TIMESTAMP(3))`,
  );
  await db.execute(
    sql`DELETE FROM push_deliveries WHERE state<>'PENDING' AND created_at<DATE_SUB(NOW(3),INTERVAL 30 DAY)`,
  );
}
export function startPushQueue(redis: Redis) {
  const queue = new Queue('web-push', { connection: redis });
  const worker = new Worker('web-push', async (job) => deliverPush(job.data), {
    connection: redis,
    concurrency: 8,
    limiter: { max: 50, duration: 1000 },
  });
  worker.on('error', () => console.error(JSON.stringify({ event: 'push.worker_error' })));
  queue.on('error', () => console.error(JSON.stringify({ event: 'push.queue_error' })));
  worker.on('failed', (job) =>
    console.error(
      JSON.stringify({ event: 'push.retry', job_id: job?.id, attempts: job?.attemptsMade }),
    ),
  );
  return {
    queue,
    worker,
    async dispatch() {
      const pending = await rows(
        db,
        sql`SELECT id,tenant_id,establishment_id FROM push_deliveries WHERE state='PENDING' AND next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY created_at LIMIT 100`,
      );
      for (const delivery of pending) {
        const existing = await queue.getJob(delivery.id);
        if (existing && (await existing.getState()) === 'failed') {
          await scopeFor(delivery).update('push_deliveries', delivery.id, {
            state: 'FAILED',
            last_error: 'RETRIES_EXHAUSTED',
          });
          continue;
        }
        await queue.add('deliver', delivery, {
          jobId: delivery.id,
          attempts: pushAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 604800, count: 1000 },
        });
        await scopeFor(delivery).update('push_deliveries', delivery.id, {
          next_attempt_at: new Date(Date.now() + 60_000),
        });
      }
    },
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
