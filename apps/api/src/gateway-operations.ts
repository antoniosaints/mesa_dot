import { atomic, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure, hash, type Actor } from '../../../packages/shared/src/index.js';
import { publicActor } from './auth.js';
export const gatewaySystem = (actor: Actor) =>
  publicActor({ id: actor.establishmentId, tenant_id: actor.tenantId });
export async function reserveGatewayOperation(
  s: Scope,
  kind: string,
  source: string,
  operationKey: string,
  payload: Row,
) {
  const operation_key = hash(operationKey);
  const previous = (
    await s.list('gateway_operations', sql`kind=${kind} AND operation_key=${operation_key}`)
  )[0];
  if (previous) return previous;
  return s.insert('gateway_operations', {
    kind,
    source_id: source,
    operation_key,
    requested_by: s.actor.id,
    payload,
    state: 'PENDING',
  });
}
/** Only short database phases run here; work must perform all provider I/O before commit. */
export async function runGatewayOperation<T>(
  actor: Actor,
  id: string,
  work: (operation: Row) => Promise<T>,
  commit: (s: Scope, operation: Row, result: T) => Promise<unknown>,
) {
  const system = gatewaySystem(actor),
    lease = crypto.randomUUID();
  const operation = await atomic(
    system,
    crypto.randomUUID(),
    'gateway.claim',
    { id, lease },
    async (s) => {
      const op = await s.get('gateway_operations', id, true);
      if (op.state === 'COMPLETED') return op;
      ensure(
        !op.lease_until || new Date(String(op.lease_until) + 'Z').getTime() <= Date.now(),
        'CONFLICT',
        'Esta operação está sendo processada. Aguarde e atualize.',
        409,
      );
      await s.update('gateway_operations', id, {
        state: 'PROCESSING',
        lease_token: lease,
        lease_until: new Date(Date.now() + 120000),
        attempts: Number(op.attempts ?? 0) + 1,
      });
      return { ...op, lease_token: lease, attempts: Number(op.attempts ?? 0) + 1 };
    },
  );
  if (operation.state === 'COMPLETED') return operation.response_json;
  try {
    const result = await work(operation);
    return await atomic(
      system,
      crypto.randomUUID(),
      'gateway.complete',
      { id, lease },
      async (s) => {
        const op = await s.get('gateway_operations', id, true);
        if (op.state === 'COMPLETED') return op.response_json;
        ensure(
          op.lease_token === lease,
          'CONFLICT',
          'A operação está sendo recuperada. Atualize em instantes.',
          409,
        );
        const response = await commit(s, op, result);
        await s.update('gateway_operations', id, {
          state: 'COMPLETED',
          response_json: response,
          lease_token: null,
          lease_until: null,
          last_error: null,
          completed_at: new Date(),
        });
        return response;
      },
    );
  } catch (error) {
    // Keep authorization/reservation and the business key for safe retries after uncertain results.
    await atomic(system, crypto.randomUUID(), 'gateway.defer', { id, lease }, async (s) => {
      const op = await s.get('gateway_operations', id, true);
      if (op.state === 'COMPLETED' || op.lease_token !== lease) return {};
      const review = Number(op.attempts) >= 8;
      await s.update('gateway_operations', id, {
        state: review ? 'REVIEW' : 'PENDING',
        lease_token: null,
        lease_until: null,
        next_attempt_at: new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(Number(op.attempts), 7)),
        ),
        last_error: 'PROVIDER_CONFIRMATION_PENDING',
      });
      return {};
    }).catch(() => {});
    throw error;
  }
}
export async function pendingRefundOperations(s: Scope, orderId: string) {
  const operations: Row[] = [];
  const intents = await s.list('payment_intents', sql`order_id=${orderId}`);
  for (const intent of intents)
    for (const payment of await s.list('payments', sql`intent_id=${intent.id}`))
      operations.push(
        ...(await s.list(
          'gateway_operations',
          sql`kind='REFUND' AND source_id=${payment.id} AND state<>'COMPLETED'`,
        )),
      );
  return operations;
}
export async function assertNoPendingRefund(s: Scope, orderId: string) {
  ensure(
    !(await pendingRefundOperations(s, orderId)).length,
    'INVALID_STATE',
    'Há um estorno aguardando confirmação do Mercado Pago. Atualize o pagamento antes de continuar.',
    409,
  );
}
