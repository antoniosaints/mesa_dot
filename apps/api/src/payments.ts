import { complement } from './complement-store.js';
import { createMercadoCheckout, mercadoConfigured, refundMercado } from './mercadopago.js';
import { sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure, permit, money, formatDecimal } from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { accessOrder, accessTab, confirmOrder } from './orders.js';
import { holdOrder } from './inventory.js';
import { lockCashUnit } from './cash-sessions.js';
export async function tabBalance(s: Scope, tabId: string) {
  await s.get('tabs', tabId);
  let charges = 0n;
  let credits = 0n;
  let paid = 0n;
  let refunded = 0n;
  for (const entry of await s.list('financial_entries', sql`tab_id=${tabId}`)) {
    if (entry.type === 'CHARGE') charges += money(entry.amount);
    else credits += money(entry.amount);
  }
  for (const allocation of await s.list('payment_allocations', sql`tab_id=${tabId}`)) {
    const payment = await s.get('payments', allocation.payment_id);
    if (['APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status))
      paid += money(allocation.amount);
  }
  for (const refund of await s.list('refunds', sql`tab_id=${tabId} AND status='APPROVED'`))
    refunded += money(refund.amount);
  return {
    charges: formatDecimal(charges),
    credits: formatDecimal(credits),
    paid: formatDecimal(paid),
    refunded: formatDecimal(refunded),
    net_paid: formatDecimal(paid - refunded),
    balance: formatDecimal(charges - credits - paid + refunded),
  };
}
export async function approvedForOrder(s: Scope, orderId: string) {
  const order = await s.get('orders', orderId);
  if (order.payment_policy_snapshot === 'IMMEDIATE' && order.tab_id) {
    const balance = await tabBalance(s, order.tab_id);
    return money(balance.net_paid);
  }
  let amount = 0n;
  for (const intent of await s.list('payment_intents', sql`order_id=${orderId}`))
    for (const payment of await s.list(
      'payments',
      sql`intent_id=${intent.id} AND status IN ('APPROVED','PARTIALLY_REFUNDED','REFUNDED')`,
    )) {
      amount += money(payment.amount);
      for (const refund of await s.list(
        'refunds',
        sql`payment_id=${payment.id} AND status='APPROVED'`,
      ))
        amount -= money(refund.amount);
    }
  return amount;
}
export async function createIntent(s: Scope, orderId: string) {
  const connection = await complement(s, 'mercadopago');
  const real = Boolean(connection?.enabled && connection.credentials);
  ensure(
    real || (env.NODE_ENV !== 'production' && !connection?.credentials),
    'INVALID_STATE',
    'Pagamento online indisponível. Peça ao administrador para ativar o Mercado Pago em Complementos.',
    409,
  );
  if (real)
    ensure(
      mercadoConfigured(),
      'INVALID_STATE',
      'Mercado Pago temporariamente indisponível. Contate o administrador.',
      409,
    );
  const order = await accessOrder(s, orderId);
  ensure(
    order.status === 'PENDING_PAYMENT' && order.payment_policy_snapshot === 'PREPAID',
    'INVALID_STATE',
    'Pedido não aguarda pré-pagamento.',
  );
  const previous = await s.list('payment_intents', sql`order_id=${order.id}`);
  if (previous.length) {
    ensure(
      previous[0].status === 'PENDING' &&
        new Date(`${previous[0].expires_at}Z`).getTime() > Date.now(),
      'INVALID_STATE',
      'Intenção já processada ou expirada.',
    );
    return { ...previous[0], sandbox: previous[0].provider === 'sandbox' };
  }
  await holdOrder(s, order);
  const intent = await s.insert('payment_intents', {
    order_id: order.id,
    provider: real ? 'mercadopago' : 'sandbox',
    provider_reference: crypto.randomUUID(),
    amount: order.total,
    status: 'PENDING',
    expires_at: new Date(Date.now() + 10 * 60_000),
  });
  await s.audit('payment.intent_created', intent.id);
  return real ? createMercadoCheckout(s, intent) : { ...intent, sandbox: true };
}
export interface GatewayEvent {
  provider?: 'sandbox' | 'mercadopago';
  payment_reference?: string;
  review_reason?: string;
  event_id: string;
  reference: string;
  amount: string;
  status: 'APPROVED' | 'FAILED';
  settled: boolean;
}
export async function capturePayment(s: Scope, input: GatewayEvent) {
  const provider = input.provider ?? 'sandbox';
  const intents = await s.list(
    'payment_intents',
    sql`provider_reference=${input.reference} AND provider=${provider}`,
  );
  ensure(intents.length, 'NOT_FOUND', 'Intenção de pagamento não encontrada.', 404);
  const intent = intents[0];
  ensure(
    money(input.amount) === money(intent.amount),
    'CONFLICT',
    'Valor do provedor diverge da intenção.',
  );
  const handled = await s.list(
    'payment_webhooks',
    sql`provider=${provider} AND provider_event_id=${input.event_id}`,
  );
  if (handled[0]?.payment_id) {
    const payment = await s.get('payments', handled[0].payment_id);
    ensure(payment.intent_id === intent.id, 'CONFLICT', 'Evento pertence a outro pagamento.', 409);
    return { payment, duplicate: true };
  }
  const prior = await s.list('payments', sql`intent_id=${intent.id}`);
  const previous =
    provider === 'mercadopago'
      ? prior.filter((payment) => payment.provider_reference === input.payment_reference)
      : prior;
  if (previous.length) {
    ensure(
      previous[0].status !== 'FAILED' || input.status === 'FAILED',
      'CONFLICT',
      'Pagamento exige conciliação com referência nova.',
    );
    await s.insert('payment_webhooks', {
      provider,
      provider_event_id: input.event_id,
      payload_hash: (await import('../../../packages/shared/src/index.js')).hash(
        JSON.stringify(input),
      ),
      payment_id: previous[0].id,
      status: 'DUPLICATE',
    });
    return { payment: previous[0], duplicate: true };
  }
  const payment = await s.insert('payments', {
    intent_id: intent.id,
    provider,
    provider_reference: input.payment_reference ?? intent.provider_reference,
    amount: intent.amount,
    status: input.status,
    confirmed_at: input.status === 'APPROVED' ? new Date() : null,
    settled_at: input.settled && input.status === 'APPROVED' ? new Date() : null,
    idempotency_key: input.event_id,
  });
  await s.update('payment_intents', intent.id, { status: input.status });
  await s.insert('payment_webhooks', {
    provider,
    provider_event_id: input.event_id,
    payload_hash: (await import('../../../packages/shared/src/index.js')).hash(
      JSON.stringify(input),
    ),
    payment_id: payment.id,
    status: 'PROCESSED',
  });
  let order: Row | null = null;
  let review: string | null = null;
  if (input.status === 'APPROVED') {
    await s.tx.execute(sql`SAVEPOINT confirm_paid_order`);
    try {
      ensure(
        !input.review_reason &&
          !prior.some((payment) =>
            ['APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status),
          ),
        'CONFLICT',
        input.review_reason ||
          'Pagamento adicional para a mesma intenção. Revise e estorne o valor excedente.',
        409,
      );
      ensure(
        new Date(`${intent.expires_at}Z`).getTime() > Date.now(),
        'CONFLICT',
        'Pagamento recebido após expirar o checkout.',
      );
      order = await confirmOrder(s, intent.order_id, true);
      await s.tx.execute(sql`RELEASE SAVEPOINT confirm_paid_order`);
    } catch (error) {
      await s.tx.execute(sql`ROLLBACK TO SAVEPOINT confirm_paid_order`);
      if (!(error instanceof Error) || !('code' in error)) throw error;
      review = error.message;
      await s.update('payments', payment.id, { review_reason: review });
    }
    await s.event('payment.approved', payment.id, { requires_review: Boolean(review) });
  }
  await s.audit('payment.webhook', payment.id, {
    status: input.status,
    requires_review: Boolean(review),
  });
  return { payment: await s.get('payments', payment.id), order, requires_review: review };
}
export async function receiveManual(
  s: Scope,
  input: {
    method: 'CASH' | 'CARD_MANUAL' | 'PIX_MANUAL';
    allocations: { tab_id: string; amount: string }[];
    cash_session_id?: string;
  },
) {
  permit(s.actor, 'payment.receive');
  if (input.cash_session_id) await lockCashUnit(s);
  ensure(
    new Set(input.allocations.map((a) => a.tab_id)).size === input.allocations.length,
    'BAD_REQUEST',
    'Comandas duplicadas.',
    400,
  );
  let total = 0n;
  for (const allocation of input.allocations) {
    const tab = await accessTab(s, allocation.tab_id);
    ensure(tab.status !== 'CLOSED', 'INVALID_STATE', 'Comanda encerrada.');
    const value = money(allocation.amount);
    ensure(
      value > 0n && value <= money((await tabBalance(s, tab.id)).balance),
      'BAD_REQUEST',
      'Recebimento supera o saldo da comanda.',
      400,
    );
    total += value;
  }
  ensure(total > 0n, 'BAD_REQUEST', 'Pagamento vazio.', 400);
  if (input.method === 'CASH')
    ensure(input.cash_session_id, 'BAD_REQUEST', 'Pagamento em dinheiro exige caixa aberto.', 400);
  if (input.cash_session_id)
    ensure(
      (await s.get('cash_sessions', input.cash_session_id)).status === 'OPEN',
      'INVALID_STATE',
      'Caixa encerrado.',
    );
  const payment = await s.insert('payments', {
    provider: input.method,
    provider_reference: crypto.randomUUID(),
    amount: formatDecimal(total),
    status: 'APPROVED',
    confirmed_at: new Date(),
    settled_at: new Date(),
    idempotency_key: crypto.randomUUID(),
  });
  for (const allocation of input.allocations)
    await s.insert('payment_allocations', {
      payment_id: payment.id,
      tab_id: allocation.tab_id,
      amount: allocation.amount,
    });
  if (input.cash_session_id)
    await s.insert('cash_movements', {
      cash_session_id: input.cash_session_id,
      payment_id: payment.id,
      type: input.method,
      amount: payment.amount,
      reason: 'Recebimento',
      source_key: `payment:${payment.id}`,
    });
  await s.audit('payment.received', payment.id, { method: input.method });
  await s.event('payment.approved', payment.id);
  return payment;
}
export async function refundPayment(
  s: Scope,
  paymentId: string,
  input: { amount: string; tab_id?: string; reason: string; cash_session_id?: string },
) {
  permit(s.actor, 'payment.refund');
  await lockCashUnit(s);
  const payment = await s.get('payments', paymentId, true);
  ensure(
    ['APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status),
    'INVALID_STATE',
    'Pagamento não estornável.',
  );
  ensure(
    payment.provider !== 'sandbox' || env.NODE_ENV !== 'production',
    'INVALID_STATE',
    'Gateway real não configurado.',
  );
  let alreadyRefunded = 0n;
  for (const refund of await s.list('refunds', sql`payment_id=${paymentId} AND status='APPROVED'`))
    alreadyRefunded += money(refund.amount);
  const value = money(input.amount);
  ensure(
    value > 0n && value + alreadyRefunded <= money(payment.amount),
    'BAD_REQUEST',
    'Estorno excede o recebimento líquido.',
    400,
  );
  const allocations = await s.list('payment_allocations', sql`payment_id=${paymentId}`);
  if (allocations.length) {
    ensure(input.tab_id, 'BAD_REQUEST', 'Informe a comanda do estorno.', 400);
    const tab = await s.get('tabs', input.tab_id);
    ensure(
      tab.status !== 'CLOSED',
      'INVALID_STATE',
      'Estorno após encerramento requer fluxo administrativo específico.',
    );
    const allocation = allocations.find((a) => a.tab_id === tab.id);
    ensure(allocation, 'BAD_REQUEST', 'Pagamento não alocado a esta comanda.', 400);
    let tabRefund = 0n;
    for (const r of await s.list(
      'refunds',
      sql`payment_id=${paymentId} AND tab_id=${tab.id} AND status='APPROVED'`,
    ))
      tabRefund += money(r.amount);
    ensure(
      value + tabRefund <= money(allocation.amount),
      'BAD_REQUEST',
      'Estorno excede a alocação da comanda.',
      400,
    );
  } else ensure(!input.tab_id, 'BAD_REQUEST', 'Pagamento não possui comanda alocada.', 400);
  if (payment.provider === 'CASH') {
    ensure(input.cash_session_id, 'BAD_REQUEST', 'Estorno em dinheiro exige caixa aberto.', 400);
    ensure(
      (await s.get('cash_sessions', input.cash_session_id)).status === 'OPEN',
      'INVALID_STATE',
      'Caixa encerrado.',
    );
  }
  const providerReference =
    payment.provider === 'mercadopago'
      ? await refundMercado(s, payment, input.amount, alreadyRefunded)
      : crypto.randomUUID();
  const refund = await s.insert('refunds', {
    payment_id: paymentId,
    tab_id: input.tab_id ?? null,
    amount: input.amount,
    reason: input.reason,
    created_by: s.actor.id,
    provider_reference: providerReference,
    status: 'APPROVED',
  });
  await s.update('payments', paymentId, {
    status: value + alreadyRefunded === money(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
  });
  if (payment.provider === 'CASH')
    await s.insert('cash_movements', {
      cash_session_id: input.cash_session_id,
      payment_id: paymentId,
      type: 'REFUND',
      amount: formatDecimal(-value),
      reason: input.reason,
      source_key: `refund:${refund.id}`,
    });
  await s.audit('payment.refunded', paymentId, {
    refund_id: refund.id,
    amount: input.amount,
    reason: input.reason,
  });
  await s.event('payment.refunded', paymentId);
  return refund;
}

/** Only called with a payment fetched from Mercado Pago with this venue's seller token. */
export async function reconcileMercadoPayment(s: Scope, remote: Row) {
  const intent = (
    await s.list(
      'payment_intents',
      sql`provider='mercadopago' AND provider_reference=${String(remote.external_reference ?? '')}`,
    )
  )[0];
  if (!intent) return { ignored: true };
  ensure(
    remote.currency_id === 'BRL' &&
      String(remote.collector_id) === intent.external_account_id &&
      /^\d+$/.test(String(remote.id)),
    'CONFLICT',
    'Moeda ou conta recebedora divergente.',
    409,
  );
  ensure(
    money(String(remote.transaction_amount)) === money(intent.amount),
    'CONFLICT',
    'Valor recebido diverge do pedido.',
    409,
  );
  if (!['approved', 'refunded', 'charged_back'].includes(remote.status)) return { pending: true };
  const event_id =
    'mp:' +
    remote.id +
    ':' +
    (await import('../../../packages/shared/src/index.js'))
      .hash(JSON.stringify([remote.status, remote.date_last_updated, remote.refunds ?? []]))
      .slice(0, 48);
  const captured = await capturePayment(s, {
    provider: 'mercadopago',
    payment_reference: String(remote.id),
    event_id,
    reference: intent.provider_reference,
    amount: intent.amount,
    status: 'APPROVED',
    settled: false,
    ...(Number(remote.transaction_amount_refunded ?? 0) > 0 ||
    remote.status === 'charged_back' ||
    remote.status === 'refunded'
      ? {
          review_reason:
            'Pagamento com estorno ou contestação no Mercado Pago. Confira antes de liberar o pedido.',
        }
      : {}),
  });
  const payment = await s.get('payments', captured.payment.id);
  const allocations = await s.list('payment_allocations', sql`payment_id=${payment.id}`);
  const known = await s.list('refunds', sql`payment_id=${payment.id} AND status='APPROVED'`);
  let refunded = known.reduce((total, refund) => total + money(refund.amount), 0n);
  let added = false;
  for (const refund of Array.isArray(remote.refunds) ? remote.refunds : []) {
    if (refund.status && refund.status !== 'approved') continue;
    const reference = String(refund.id);
    ensure(/^\d+$/.test(reference), 'CONFLICT', 'Referência de estorno inválida.', 409);
    if (known.some((item) => item.provider_reference === reference)) continue;
    const amount = money(String(refund.amount));
    ensure(
      amount > 0n && refunded + amount <= money(payment.amount),
      'CONFLICT',
      'Estorno externo divergente do pagamento.',
      409,
    );
    await s.insert('refunds', {
      payment_id: payment.id,
      tab_id: allocations.length === 1 ? allocations[0].tab_id : null,
      amount: formatDecimal(amount),
      reason: 'Estorno registrado no Mercado Pago',
      created_by: s.actor.id,
      provider_reference: reference,
      status: 'APPROVED',
    });
    refunded += amount;
    added = true;
  }
  if (added) {
    await s.update('payments', payment.id, {
      status: refunded === money(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      review_reason: 'Estorno externo recebido. Confira o consumo e o atendimento.',
    });
    await s.audit('payment.external_refund', payment.id, { amount: formatDecimal(refunded) });
    await s.event('payment.refunded', payment.id);
  }
  if (remote.status === 'charged_back') {
    const remaining = money(payment.amount) - refunded;
    if (remaining > 0n) {
      await s.insert('refunds', {
        payment_id: payment.id,
        tab_id: allocations.length === 1 ? allocations[0].tab_id : null,
        amount: formatDecimal(remaining),
        reason: 'Contestação confirmada no Mercado Pago',
        created_by: s.actor.id,
        provider_reference: 'chargeback:' + remote.id,
        status: 'APPROVED',
      });
      await s.event('payment.refunded', payment.id);
    }
    await s.update('payments', payment.id, {
      status: 'REFUNDED',
      review_reason: 'Pagamento contestado no Mercado Pago. Conciliação administrativa necessária.',
    });
  }
  return {
    payment: await s.get('payments', payment.id),
    requires_review: captured.requires_review ?? payment.review_reason ?? null,
  };
}
