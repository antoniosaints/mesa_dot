import { closeCounterIfComplete } from './counter-lifecycle.js';
import { businessAvailability } from '../../../packages/shared/src/business-hours.js';
import { lockCashUnit, selectOrderCash } from './cash-sessions.js';
import { randomBytes } from 'node:crypto';
import { sql, rows, type Scope, type Row } from '../../../packages/database/src/index.js';
import {
  ensure,
  permit,
  money,
  formatDecimal,
  deriveToken,
  hash,
  type OrderInput,
} from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { componentsFor, reserveTicket, releaseHolds, cancelTicketStock } from './inventory.js';
import { assertSaleStock } from './sale-stock.js';
import { tabBalance, approvedForOrder } from './payments.js';
export async function unit(s: Scope): Promise<Row> {
  const units = await rows(
    s.tx,
    sql`SELECT * FROM establishments WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
  );
  ensure(units.length, 'NOT_FOUND', 'Unidade inexistente.', 404);
  return units[0];
}
export async function accessTab(s: Scope, id: string): Promise<Row> {
  const tab = await s.get('tabs', id);
  if (s.actor.kind === 'VISITOR') {
    ensure(
      s.actor.serviceMode === 'COUNTER'
        ? tab.mode === 'COUNTER'
        : tab.mode !== 'COUNTER' && tab.session_id === s.actor.sessionId,
      'FORBIDDEN',
      'Comanda de outro atendimento.',
      403,
    );
    const members = await s.list(
      'tab_customers',
      sql`tab_id=${id} AND customer_id=${s.actor.customerId}`,
    );
    ensure(members.length, 'FORBIDDEN', 'Você não participa desta comanda.', 403);
  }
  return tab;
}
export async function accessOrder(s: Scope, id: string): Promise<Row> {
  const order = await s.get('orders', id);
  if (s.actor.kind === 'VISITOR')
    ensure(
      order.customer_id === s.actor.customerId,
      'FORBIDDEN',
      'Pedido de outro participante.',
      403,
    );
  return order;
}
export async function createOrder(
  s: Scope,
  input: Omit<OrderInput, 'table_id'> & { table_id?: string },
  counter?: { customerName?: string; cashSessionId?: string },
) {
  const u = await lockCashUnit(s);
  const customerCounter = s.actor.kind === 'VISITOR' && s.actor.serviceMode === 'COUNTER';
  const isCounter = Boolean(counter) || customerCounter;
  const orderCash = await selectOrderCash(s, u, counter?.cashSessionId);
  const availability = businessAvailability({ is_open: u.is_open, opening_hours: u.opening_hours });
  ensure(availability.is_open, 'INVALID_STATE', availability.message);
  ensure(
    s.actor.kind === 'VISITOR' || s.actor.kind === 'STAFF',
    'FORBIDDEN',
    'Operação não permitida.',
    403,
  );
  if (s.actor.kind === 'VISITOR') {
    ensure(
      (customerCounter ? !input.table_id && !input.tab_id : s.actor.tableId === input.table_id) &&
        input.source === 'CUSTOMER' &&
        input.payment_policy === 'PREPAID',
      'FORBIDDEN',
      'Cliente deve usar seu atendimento e pagamento pré-pago.',
      403,
    );
  } else {
    permit(s.actor, 'order.create');
    ensure(input.source !== 'CUSTOMER', 'BAD_REQUEST', 'Origem inválida para funcionário.', 400);
  }
  if (counter) {
    permit(s.actor, 'payment.receive');
    ensure(
      input.source === 'POS' && !input.table_id && !input.tab_id,
      'BAD_REQUEST',
      'Pedido avulso não deve ter mesa ou comanda existente.',
      400,
    );
  }
  if (!isCounter && input.payment_policy === 'POSTPAID') permit(s.actor, 'order.postpaid');
  ensure(
    isCounter ||
      (!(u.payment_mode === 'PREPAID_ONLY' && input.payment_policy === 'POSTPAID') &&
        !(u.payment_mode === 'POSTPAID_ONLY' && input.payment_policy === 'PREPAID')),
    'INVALID_STATE',
    'Regime de pagamento indisponível.',
  );
  if (!isCounter) {
    ensure(input.table_id, 'BAD_REQUEST', 'Informe a mesa do pedido.', 400);
    const table = await s.get('dining_tables', input.table_id);
    ensure(table.enabled && !table.deleted_at, 'INVALID_STATE', 'Mesa desativada ou excluída.');
    const active = await s.list('table_sessions', sql`table_id=${table.id} AND status<>'CLOSED'`);
    ensure(!active.length || active[0].status === 'OPEN', 'INVALID_STATE', 'Mesa em fechamento.');
    if (s.actor.kind === 'VISITOR' && active.length)
      ensure(
        s.actor.sessionId === active[0].id,
        'CONFLICT',
        'Mesa ocupada. Solicite o código de participação ao garçom.',
      );
    if (input.tab_id) {
      const tab = await accessTab(s, input.tab_id);
      ensure(
        active[0]?.id === tab.session_id && tab.status === 'OPEN',
        'INVALID_STATE',
        'Comanda não pertence à mesa aberta.',
      );
    }
  }
  const items: Row[] = [];
  let total = 0n;
  for (const line of input.items) {
    const product = await s.get('products', line.product_id);
    ensure(product.enabled, 'INVALID_STATE', 'Produto indisponível.');
    const rules = await s.list('availability_rules', sql`product_id=${product.id}`);
    if (rules.length) {
      const now = new Date();
      const local = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
        local.find((p) => p.type === 'weekday')!.value,
      );
      const time = `${local.find((p) => p.type === 'hour')!.value}:${local.find((p) => p.type === 'minute')!.value}:00`;
      ensure(
        rules.some((r) => r.weekday === day && time >= r.start_time && time <= r.end_time),
        'INVALID_STATE',
        'Produto fora do horário de venda.',
      );
    }
    let price = money(product.price);
    let variant: Row | undefined;
    if (line.variant_id) {
      variant = await s.get('product_variants', line.variant_id);
      ensure(
        variant.product_id === product.id && variant.enabled,
        'BAD_REQUEST',
        'Variação inválida.',
        400,
      );
      price = money(variant.price);
    }
    ensure(
      new Set(line.modifiers).size === line.modifiers.length,
      'BAD_REQUEST',
      'Adicionais duplicados.',
      400,
    );
    const links = await s.list('product_modifiers', sql`product_id=${product.id}`);
    const selected: Row[] = [];
    for (const id of line.modifiers) {
      const modifier = await s.get('modifiers', id);
      ensure(
        modifier.enabled && links.some((l) => l.group_id === modifier.group_id),
        'BAD_REQUEST',
        'Adicional inválido.',
        400,
      );
      selected.push(modifier);
      price += money(modifier.price);
    }
    for (const link of links) {
      const group = await s.get('modifier_groups', link.group_id);
      const count = selected.filter((m) => m.group_id === group.id).length;
      ensure(
        count >= group.min_choices && count <= group.max_choices,
        'BAD_REQUEST',
        `Seleção inválida para ${group.name}.`,
        400,
      );
    }
    const lineTotal = price * BigInt(line.quantity);
    total += lineTotal;
    items.push({
      product_id: product.id,
      variant_id: variant?.id ?? null,
      quantity: line.quantity,
      name_snapshot: `${product.name}${variant ? ` - ${variant.name}` : ''}`,
      unit_price: formatDecimal(price),
      total: formatDecimal(lineTotal),
      stock_policy_snapshot: product.stock_policy,
      stock_components: await componentsFor(s, product, variant),
      requires_production: Boolean(
        product.requires_production || product.stock_policy === 'ON_PRODUCTION',
      ),
      notes: line.notes ?? null,
      modifiers: selected,
      sector: product.sector,
    });
  }
  ensure(total > 0n && total <= 99999999999999n, 'BAD_REQUEST', 'Total de pedido inválido.', 400);
  await assertSaleStock(s, items);
  const order = await s.insert('orders', {
    cash_session_id: orderCash?.id ?? null,
    table_id: input.table_id ?? null,
    service_mode: isCounter ? 'COUNTER' : 'TABLE',
    customer_name:
      counter?.customerName ||
      (customerCounter
        ? String((await s.get('customers', s.actor.customerId!)).name).slice(0, 80)
        : null),
    tab_id: input.tab_id ?? null,
    customer_id: s.actor.customerId ?? null,
    source: input.source,
    status: input.payment_policy === 'PREPAID' ? 'PENDING_PAYMENT' : 'DRAFT',
    payment_policy_snapshot: counter ? 'IMMEDIATE' : input.payment_policy,
    total: formatDecimal(total),
    idempotency_key: `order:${crypto.randomUUID()}`,
    created_by: s.actor.id,
  });
  for (const item of items) {
    const { modifiers, sector: _sector, ...data } = item;
    const record = await s.insert('order_items', { ...data, order_id: order.id });
    for (const m of modifiers)
      await s.insert('order_item_modifiers', {
        order_item_id: record.id,
        modifier_id: m.id,
        name_snapshot: m.name,
        price: m.price,
      });
  }
  await s.insert('order_status_events', {
    order_id: order.id,
    status: order.status,
    actor_id: s.actor.id,
  });
  await s.audit('order.created', order.id);
  await s.event('order.created', order.id);
  return order;
}
export async function confirmOrder(s: Scope, id: string, internal = false): Promise<Row> {
  if (!internal) {
    if (s.actor.kind === 'STAFF') permit(s.actor, 'order.create');
    else ensure(s.actor.kind === 'VISITOR', 'FORBIDDEN', 'Perfil não autorizado.', 403);
  }
  const order = internal ? await s.get('orders', id, true) : await accessOrder(s, id);
  if (order.status === 'CONFIRMED') return order;
  ensure(
    ['DRAFT', 'PENDING_PAYMENT'].includes(order.status),
    'INVALID_STATE',
    'Pedido não pode ser confirmado.',
  );
  const u = await unit(s);
  ensure(u.is_open, 'INVALID_STATE', 'Estabelecimento fechado.');
  if (order.payment_policy_snapshot === 'PREPAID')
    ensure(
      (await approvedForOrder(s, order.id)) >= money(order.total),
      'PAYMENT_REQUIRED',
      'Pagamento ainda não aprovado pelo provedor.',
      402,
    );
  else if (order.payment_policy_snapshot === 'IMMEDIATE')
    ensure(
      internal && order.service_mode === 'COUNTER',
      'INVALID_STATE',
      'Conclua a venda pelo fluxo de pedido avulso.',
    );
  else permit(s.actor, 'order.postpaid');
  let tab: Row;
  let session: Row | null = null;
  if (order.service_mode === 'COUNTER') {
    tab = await s.insert('tabs', {
      session_id: null,
      mode: 'COUNTER',
      label:
        'Avulso #' +
        order.id.slice(0, 6).toUpperCase() +
        (order.customer_name ? ' · ' + order.customer_name : ''),
      owner_customer_id: order.customer_id ?? null,
    });
    if (order.customer_id)
      await s.insert('tab_customers', { tab_id: tab.id, customer_id: order.customer_id });
  } else {
    const table = await s.get('dining_tables', order.table_id, true);
    ensure(table.enabled && !table.deleted_at, 'INVALID_STATE', 'Mesa desativada ou excluída.');
    let sessions = await s.list('table_sessions', sql`table_id=${table.id} AND status<>'CLOSED'`);
    if (order.customer_id && sessions.length) {
      const membership = await s.list(
        'table_participants',
        sql`session_id=${sessions[0].id} AND customer_id=${order.customer_id}`,
      );
      ensure(
        membership.length,
        'CONFLICT',
        'Mesa ocupada por outro grupo. Pagamento preservado para conciliação ou estorno.',
      );
    }
    if (!sessions.length) {
      sessions = [
        await s.insert('table_sessions', {
          table_id: table.id,
          status: 'OPEN',
          opened_at: new Date(),
          opened_by: s.actor.id,
          join_nonce: randomBytes(32).toString('hex'),
        }),
      ];
      await s.event('table.occupied', sessions[0].id);
    }
    session = sessions[0];
    ensure(session.status === 'OPEN', 'INVALID_STATE', 'Sessão em fechamento.');
    if (order.customer_id) {
      const participants = await s.list(
        'table_participants',
        sql`session_id=${session.id} AND customer_id=${order.customer_id}`,
      );
      if (!participants.length)
        await s.insert('table_participants', {
          session_id: session.id,
          customer_id: order.customer_id,
        });
      const visitorSessions = await s.list(
        'visitor_sessions',
        sql`customer_id=${order.customer_id} AND table_id=${table.id}`,
      );
      for (const visitor of visitorSessions)
        await s.update('visitor_sessions', visitor.id, { session_id: session.id });
    }
    if (order.tab_id) {
      tab = await s.get('tabs', order.tab_id);
      ensure(
        tab.session_id === session.id && tab.status === 'OPEN',
        'INVALID_STATE',
        'Comanda indisponível.',
      );
    } else {
      tab = await s.insert('tabs', {
        session_id: session.id,
        mode: order.customer_id ? 'INDIVIDUAL' : 'SHARED',
        label: order.customer_id ? 'Minha comanda' : 'Comanda da mesa',
        owner_customer_id: order.customer_id,
      });
      if (order.customer_id)
        await s.insert('tab_customers', { tab_id: tab.id, customer_id: order.customer_id });
    }
    if (order.payment_policy_snapshot === 'POSTPAID') {
      let totalDebt = 0n;
      for (const t of await s.list('tabs', sql`session_id=${session.id}`))
        totalDebt += money((await tabBalance(s, t.id)).balance);
      ensure(
        totalDebt + money(order.total) <= money(u.postpaid_limit),
        'PAYMENT_REQUIRED',
        'Limite de consumo pós-pago excedido.',
        402,
      );
    }
  }
  await assertSaleStock(s, await s.list('order_items', sql`order_id=${order.id}`), order.id);
  await releaseHolds(s, order.id, 'CONSUMED');
  await s.insert('financial_entries', {
    tab_id: tab.id,
    order_id: order.id,
    type: 'CHARGE',
    amount: order.total,
    source_key: `charge:${order.id}`,
    created_by: s.actor.id,
  });
  if (order.payment_policy_snapshot === 'PREPAID') {
    const intents = await s.list('payment_intents', sql`order_id=${order.id}`);
    for (const intent of intents) {
      const payments = await s.list('payments', sql`intent_id=${intent.id} AND status='APPROVED'`);
      for (const payment of payments) {
        await s.insert('payment_allocations', {
          payment_id: payment.id,
          tab_id: tab.id,
          amount: payment.amount,
        });
        await s.update('payments', payment.id, { review_reason: null });
      }
    }
  }
  for (const item of await s.list('order_items', sql`order_id=${order.id}`)) {
    await s.insert('order_item_assignments', { order_item_id: item.id, tab_id: tab.id });
    const product = await s.get('products', item.product_id);
    for (let i = 0; i < item.quantity; i++) {
      const ticketId = crypto.randomUUID();
      const nonce = randomBytes(32).toString('hex');
      const token = deriveToken(env.DOCUMENT_KEY ?? '', 'ticket', ticketId, nonce);
      const ticket = await s.insert('tickets', {
        id: ticketId,
        order_item_id: item.id,
        token_hash: hash(token),
        token_nonce: nonce,
        public_number: randomBytes(8).toString('hex').toUpperCase(),
        qty: 1,
        status: item.requires_production ? 'PENDING' : 'AVAILABLE',
      });
      await reserveTicket(s, ticket, item);
      await s.insert('ticket_events', {
        ticket_id: ticket.id,
        event: 'ISSUED',
        actor_id: s.actor.id,
      });
      if (item.requires_production)
        await s.insert('production_jobs', {
          ticket_id: ticket.id,
          sector: product.sector,
          status: 'PENDING',
        });
      for (const printer of await s.list(
        'printers',
        sql`enabled=TRUE AND sector=${product.sector}`,
      ))
        await s.insert('print_jobs', {
          ticket_id: ticket.id,
          printer_id: printer.id,
          status: 'PENDING',
          is_copy: false,
        });
      await s.event('ticket.issued', ticket.id);
    }
  }
  await s.update('orders', order.id, {
    tab_id: tab.id,
    status: 'CONFIRMED',
    confirmed_at: new Date(),
    version: order.version + 1,
  });
  await s.insert('order_status_events', {
    order_id: order.id,
    status: 'CONFIRMED',
    actor_id: s.actor.id,
  });
  await s.event('order.confirmed', order.id, {}, order.version + 1);
  if (session) await s.event('table.updated', session.id);
  await s.audit('order.confirmed', order.id);
  return s.get('orders', order.id);
}
export async function cancelOrder(s: Scope, id: string, reason: string) {
  permit(s.actor, 'order.cancel');
  const order = await s.get('orders', id, true);
  ensure(order.status !== 'CANCELLED', 'INVALID_STATE', 'Pedido já cancelado.');
  ensure(
    (await approvedForOrder(s, id)) === 0n,
    'INVALID_STATE',
    'Estorne o pagamento do pedido antes de cancelar.',
  );
  for (const item of await s.list('order_items', sql`order_id=${id}`))
    for (const ticket of await s.list('tickets', sql`order_item_id=${item.id}`)) {
      ensure(
        !['REDEEMED', 'PREPARING'].includes(ticket.status),
        'INVALID_STATE',
        'Produto entregue ou em preparo exige tratamento manual.',
      );
      const jobs = await s.list('production_jobs', sql`ticket_id=${ticket.id}`);
      ensure(
        !jobs.some((j) => j.status === 'READY'),
        'INVALID_STATE',
        'Produto produzido exige tratamento de perda no estoque.',
      );
      await cancelTicketStock(s, ticket.id);
      await s.update('tickets', ticket.id, { status: 'CANCELLED', version: ticket.version + 1 });
      for (const job of jobs) await s.update('production_jobs', job.id, { status: 'CANCELLED' });
      for (const request of await s.list(
        'service_requests',
        sql`ticket_id=${ticket.id} AND status IN ('OPEN','CLAIMED')`,
      ))
        await s.update('service_requests', request.id, { status: 'CANCELLED' });
      await s.insert('ticket_events', {
        ticket_id: ticket.id,
        event: 'CANCELLED',
        actor_id: s.actor.id,
      });
    }
  await releaseHolds(s, id, 'RELEASED');
  if (order.status === 'CONFIRMED') {
    const tab = await s.get('tabs', order.tab_id);
    ensure(tab.status !== 'CLOSED', 'INVALID_STATE', 'Comanda encerrada.');
    for (const item of await s.list('order_items', sql`order_id=${id}`)) {
      const assignments = await s.list('order_item_assignments', sql`order_item_id=${item.id}`);
      const assignedTab = assignments[0]?.tab_id ?? order.tab_id;
      ensure(
        (await s.get('tabs', assignedTab)).status !== 'CLOSED',
        'INVALID_STATE',
        'Comanda do item está encerrada.',
      );
      if (money(item.total) === 0n) continue;
      await s.insert('financial_entries', {
        tab_id: assignedTab,
        order_id: id,
        type: 'CREDIT',
        amount: item.total,
        source_key: `cancel:${id}:${item.id}`,
        reason,
        created_by: s.actor.id,
      });
    }
  }
  await s.update('orders', id, { status: 'CANCELLED', version: order.version + 1 });
  await s.insert('order_status_events', {
    order_id: id,
    status: 'CANCELLED',
    actor_id: s.actor.id,
  });
  await s.audit('order.cancelled', id, { reason });
  await s.event('order.cancelled', id);
  await closeCounterIfComplete(s, { ...order, status: 'CANCELLED' });
  return s.get('orders', id);
}
