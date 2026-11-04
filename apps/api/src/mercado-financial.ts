import { atomic, view, sql, type Row } from '../../../packages/database/src/index.js';
import {
  ensure,
  hash,
  canonical,
  permit,
  formatDecimal,
  type Actor,
} from '../../../packages/shared/src/index.js';
import {
  createIntent,
  validateRefund,
  recordRefund,
  refundPayment,
  reconcileMercadoPayment,
  type RefundInput,
} from './payments.js';
import {
  createMercadoCheckout,
  refundMercado,
  prepareMercado,
  mercadoRequest,
  mercadoPayment,
} from './mercadopago.js';
import {
  gatewaySystem,
  reserveGatewayOperation,
  runGatewayOperation,
} from './gateway-operations.js';
import { accessOrder } from './orders.js';

function checkoutResponse(intent: Row) {
  const value = intent.expires_at;
  const expiry =
    value instanceof Date
      ? value
      : new Date(
          String(value).replace(' ', 'T') + (/Z|[+-]\d\d:\d\d$/.test(String(value)) ? '' : 'Z'),
        );
  return { ...intent, expires_at: expiry.toISOString(), sandbox: intent.provider === 'sandbox' };
}

export async function finishMercadoOperation(actor: Actor, operationId: string) {
  const system = gatewaySystem(actor),
    s = view(system);
  const operation = await s.get('gateway_operations', operationId);
  if (operation.state === 'COMPLETED') return operation.response_json;
  await prepareMercado(system);
  if (operation.kind === 'CHECKOUT') {
    const intent = await s.get('payment_intents', operation.source_id);
    return runGatewayOperation(
      system,
      operation.id,
      (op) =>
        createMercadoCheckout(s, intent, op, async () => {
          await atomic(
            system,
            crypto.randomUUID(),
            'checkout.dispatch',
            { id: op.id },
            async (locked) => {
              const current = await locked.get('gateway_operations', op.id, true);
              ensure(
                current.lease_token === op.lease_token,
                'CONFLICT',
                'Checkout em recuperação.',
                409,
              );
              await locked.update('gateway_operations', op.id, {
                payload: { ...current.payload, provider_started_at: new Date().toISOString() },
              });
              return {};
            },
          );
        }),
      async (locked, op, result) => {
        await locked.update('payment_intents', op.source_id, result);
        await locked.audit('payment.checkout_ready', op.source_id);
        return checkoutResponse(await locked.get('payment_intents', op.source_id));
      },
    );
  }
  ensure(operation.kind === 'REFUND', 'BAD_REQUEST', 'Operação não financeira.', 400);
  return runGatewayOperation(
    system,
    operation.id,
    async (op) => {
      const payment = await s.get('payments', op.source_id);
      return refundMercado(
        s,
        payment,
        op.payload.input.amount,
        0n,
        op.payload.provider_key ?? op.id,
      );
    },
    async (locked, op, reference) => {
      const refund = await recordRefund(
        locked,
        op.source_id,
        op.payload.input,
        reference,
        op.requested_by,
      );
      const payment = await locked.get('payments', op.source_id);
      const unrelatedExternalRefunds = await locked.list(
        'refunds',
        sql`payment_id=${payment.id} AND provider_reference<>${reference} AND reason='Estorno registrado no Mercado Pago'`,
      );
      if (
        payment.review_reason === 'Estorno aguardando confirmação do Mercado Pago.' ||
        (payment.review_reason === 'Estorno externo recebido. Confira o consumo e o atendimento.' &&
          !unrelatedExternalRefunds.length)
      )
        await locked.update('payments', payment.id, {
          review_reason: op.payload.previous_review_reason ?? null,
        });
      await locked.audit('payment.gateway_refund_confirmed', payment.id, {
        operation_id: op.id,
        refund_id: refund.id,
      });
      return refund;
    },
  );
}
export async function paymentCheckout(actor: Actor, key: string, orderId: string) {
  ensure(['STAFF', 'VISITOR'].includes(actor.kind), 'FORBIDDEN', 'Perfil não autorizado.', 403);
  if (actor.kind === 'STAFF') permit(actor, 'payment.receive');
  await accessOrder(view(actor), orderId);
  await prepareMercado(actor);
  const intent = await atomic(
    actor,
    key,
    'POST:/payments/intents',
    { params: {}, body: { order_id: orderId } },
    async (s) => {
      if (s.actor.kind === 'STAFF') permit(s.actor, 'payment.receive');
      return createIntent(s, orderId);
    },
  );
  if (intent.provider !== 'mercadopago') return checkoutResponse(intent);
  const latest = await view(actor).get('payment_intents', intent.id);
  const op = (
    await view(actor).list('gateway_operations', sql`kind='CHECKOUT' AND source_id=${intent.id}`)
  )[0];
  if (op?.state === 'COMPLETED') return checkoutResponse(op.response_json);
  if (latest.checkout_url)
    return checkoutResponse({ ...intent, checkout_url: latest.checkout_url });
  ensure(op, 'INVALID_STATE', 'Checkout precisa ser conciliado. Atualize em instantes.', 409);
  return checkoutResponse(await finishMercadoOperation(actor, op.id));
}
export async function paymentRefund(
  actor: Actor,
  key: string,
  paymentId: string,
  input: RefundInput,
) {
  permit(actor, 'payment.refund');
  const existingPayment = await view(actor).get('payments', paymentId);
  if (existingPayment.provider === 'mercadopago') await prepareMercado(actor);
  const result = await atomic<Row>(
    actor,
    key,
    'POST:/payments/:id/refund',
    { params: { id: paymentId }, body: input },
    async (s) => {
      permit(s.actor, 'payment.refund');
      const payment = await s.get('payments', paymentId, true);
      if (payment.provider !== 'mercadopago')
        return { refund: await refundPayment(s, paymentId, input) };
      const pending = (
        await s.list(
          'gateway_operations',
          sql`kind='REFUND' AND source_id=${paymentId} AND state<>'COMPLETED'`,
        )
      )[0];
      if (pending) {
        ensure(
          pending.payload.input.amount === input.amount &&
            (pending.payload.input.tab_id ?? null) === (input.tab_id ?? null) &&
            (pending.payload.input.cash_session_id ?? null) === (input.cash_session_id ?? null),
          'CONFLICT',
          'Já existe um estorno aguardando confirmação para este pagamento.',
          409,
        );
        await s.audit('payment.refund_resumed', paymentId, { operation_id: pending.id });
        return { operation_id: pending.id };
      }
      const context = await validateRefund(s, paymentId, input);
      const op = await reserveGatewayOperation(
        s,
        'REFUND',
        paymentId,
        `refund:${paymentId}:${context.alreadyRefunded}:${canonical(input)}`,
        {
          input,
          previous_review_reason: payment.review_reason ?? null,
          provider_key: hash(
            `mp-refund:${paymentId}:${formatDecimal(context.alreadyRefunded)}:${input.amount}`,
          ),
        },
      );
      await s.update('payments', payment.id, {
        review_reason: 'Estorno aguardando confirmação do Mercado Pago.',
      });
      await s.audit('payment.refund_requested', payment.id, {
        operation_id: op.id,
        amount: input.amount,
      });
      return { operation_id: op.id };
    },
  );
  if (result.id && result.provider_reference) return result;
  if (result.refund) return result.refund;
  try {
    return await finishMercadoOperation(actor, result.operation_id);
  } catch {
    ensure(
      false,
      'PAYMENT_REVIEW_REQUIRED',
      'O estorno foi registrado e aguarda confirmação do Mercado Pago. A conciliação tentará novamente; confira em Pagamentos antes de solicitar outro estorno.',
      409,
    );
  }
}

export async function applyMercadoObservation(actor: Actor, remote: Row) {
  const fingerprint = hash(
    canonical({
      id: remote.id,
      external_reference: remote.external_reference,
      collector_id: remote.collector_id,
      currency_id: remote.currency_id,
      transaction_amount: remote.transaction_amount,
      transaction_amount_refunded: remote.transaction_amount_refunded,
      status: remote.status,
      date_last_updated: remote.date_last_updated,
      refunds: (Array.isArray(remote.refunds) ? remote.refunds : [])
        .map((refund: Row) => ({ id: refund.id, amount: refund.amount, status: refund.status }))
        .sort((a: Row, b: Row) => String(a.id).localeCompare(String(b.id))),
    }),
  );
  return atomic(
    gatewaySystem(actor),
    'mp-observation:' + fingerprint,
    'payment.mercadopago.observe',
    { fingerprint },
    (s) => reconcileMercadoPayment(s, remote),
  );
}
/** All network reads are outside atomic; every observation is applied in a separate short transaction. */
export async function syncMercadoIntent(
  actor: Actor,
  intentId: string,
  authorize = true,
  requestKey?: string,
) {
  if (authorize)
    ensure(['STAFF', 'VISITOR'].includes(actor.kind), 'FORBIDDEN', 'Perfil não autorizado.', 403);
  const s = view(actor),
    intent = await s.get('payment_intents', intentId);
  if (authorize) {
    ensure(['STAFF', 'VISITOR'].includes(actor.kind), 'FORBIDDEN', 'Perfil não autorizado.', 403);
    await accessOrder(s, intent.order_id);
    if (requestKey)
      await atomic(
        actor,
        requestKey,
        'POST:/payments/intents/:id/sync',
        { params: { id: intentId }, body: {} },
        async () => ({ accepted: true }),
      );
  }
  ensure(
    intent.provider === 'mercadopago',
    'INVALID_STATE',
    'Esta intenção não pertence ao Mercado Pago.',
    409,
  );
  await prepareMercado(actor);
  const ids = new Set<string>();
  for (const payment of await s.list('payments', sql`intent_id=${intentId}`))
    ids.add(String(payment.provider_reference));
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const found = await mercadoRequest(
      s,
      '/v1/payments/search?' +
        new URLSearchParams({
          external_reference: intent.provider_reference,
          sort: 'date_created',
          criteria: 'desc',
          limit: '50',
          offset: String(offset),
        }).toString(),
      {},
      intent.external_account_id,
    );
    ensure(Array.isArray(found.results), 'UNAVAILABLE', 'Consulta de pagamentos inválida.', 409);
    for (const payment of found.results) ids.add(String(payment.id));
    offset += found.results.length;
    if (!found.results.length || offset >= Number(found.paging?.total ?? found.results.length))
      break;
    ensure(
      page < 99,
      'UNAVAILABLE',
      'A conciliação retornou muitos pagamentos. Revisão necessária.',
      409,
    );
  }
  for (const id of ids) {
    const payment = await mercadoPayment(s, id, intent.external_account_id);
    ensure(
      String(payment.external_reference ?? '') === intent.provider_reference,
      'CONFLICT',
      'Referência externa divergente da intenção.',
      409,
    );
    await applyMercadoObservation(actor, payment);
  }
  const payments = await s.list('payments', sql`intent_id=${intentId}`);
  return {
    status: (await s.get('payment_intents', intentId)).status,
    requires_review: payments.find((payment) => payment.review_reason)?.review_reason ?? null,
  };
}
