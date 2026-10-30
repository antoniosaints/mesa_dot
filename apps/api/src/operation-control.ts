import { z } from 'zod';
import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { amount, ensure, permit } from '../../../packages/shared/src/index.js';
import { businessAvailability } from '../../../packages/shared/src/business-hours.js';
import { openCash, closeCash } from './admin.js';
import { lockCashUnit, selectOrderCash, setOrderCash } from './cash-sessions.js';
export const openControlCashSchema = z
  .strictObject({
    register_id: z.uuid().optional(),
    register_name: z.string().trim().min(1).max(100).optional(),
    opening_amount: amount,
  })
  .refine(
    (value) => Boolean(value.register_id) !== Boolean(value.register_name),
    'Escolha um caixa ou informe o nome do novo caixa.',
  );
export const operationControlSchema = z
  .strictObject({
    is_open: z.boolean(),
    cash_session_id: z.uuid().optional(),
    open_cash: openControlCashSchema.optional(),
  })
  .refine(
    (value) => !(value.open_cash && value.cash_session_id),
    'Escolha um caixa aberto ou abra um novo.',
  );
export const rotateControlCashSchema = z.strictObject({
  cash_session_id: z.uuid(),
  counted_amount: amount,
  open_cash: openControlCashSchema,
  activate_orders: z.boolean().optional(),
});
export async function operationControl(s: Scope) {
  const canToggle = s.actor.permissions.includes('settings.update'),
    canCash = s.actor.permissions.includes('cash.manage');
  ensure(
    s.actor.kind === 'STAFF' && (canToggle || canCash),
    'FORBIDDEN',
    'Operação não autorizada para seu perfil.',
    403,
  );
  const [units, sessions, registers] = await Promise.all([
    rows(
      s.tx,
      sql`SELECT is_open,opening_hours,order_cash_session_id FROM establishments WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
    ),
    rows(
      s.tx,
      sql`SELECT c.id,c.register_id,r.name register_name,UNIX_TIMESTAMP(c.created_at) opened_epoch,u.name opened_by_name,c.opening_amount + COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.tenant_id=c.tenant_id AND m.establishment_id=c.establishment_id AND m.cash_session_id=c.id AND m.type IN ('CASH','REFUND','WITHDRAWAL','SUPPLY')),0) expected_amount FROM cash_sessions c JOIN cash_registers r ON r.id=c.register_id AND r.tenant_id=c.tenant_id AND r.establishment_id=c.establishment_id LEFT JOIN users u ON u.id=c.opened_by WHERE c.tenant_id=${s.actor.tenantId} AND c.establishment_id=${s.actor.establishmentId} AND c.status='OPEN' ORDER BY c.created_at,c.id`,
    ),
    canCash ? s.list('cash_registers') : Promise.resolve([]),
  ]);
  ensure(units.length, 'NOT_FOUND', 'Unidade inexistente.', 404);
  const now = Date.now(),
    unit = units[0];
  const open = sessions.map<Row>(({ opened_epoch, expected_amount, ...cash }) => ({
    ...cash,
    opened_at_iso: new Date(Number(opened_epoch) * 1000).toISOString(),
    overdue: now - Number(opened_epoch) * 1000 > 86400000,
    ...(canCash ? { expected_amount } : {}),
  }));
  return {
    is_open: Boolean(unit.is_open),
    availability: businessAvailability({
      is_open: unit.is_open,
      opening_hours: unit.opening_hours,
    }),
    opening_hours: unit.opening_hours,
    order_cash_session_id:
      open.find((cash) => cash.id === unit.order_cash_session_id)?.id ?? open[0]?.id ?? null,
    sessions: open,
    registers: registers.map((row) => ({ id: row.id, name: row.name })),
    can_toggle: canToggle,
    can_manage_cash: canCash,
    server_time: new Date(now).toISOString(),
  };
}
export async function openControlCash(s: Scope, input: z.infer<typeof openControlCashSchema>) {
  permit(s.actor, 'cash.manage');
  let registerId = input.register_id;
  if (!registerId) {
    const register = await s.insert('cash_registers', { name: input.register_name });
    await s.audit('cash-registers.created', register.id);
    registerId = register.id;
  }
  return openCash(s, { register_id: registerId!, opening_amount: input.opening_amount });
}
export async function openOperationCash(s: Scope, input: z.infer<typeof openControlCashSchema>) {
  await lockCashUnit(s);
  await openControlCash(s, input);
  return operationControl(s);
}
export async function updateOperationControl(
  s: Scope,
  input: z.infer<typeof operationControlSchema>,
) {
  permit(s.actor, 'settings.update');
  const unit = await lockCashUnit(s);
  const opened = input.open_cash ? await openControlCash(s, input.open_cash) : null;
  const select = input.is_open || Boolean(opened || input.cash_session_id);
  const selected = select
    ? await selectOrderCash(s, unit, opened?.id ?? input.cash_session_id)
    : null;
  if (select) await setOrderCash(s, selected?.id ?? null);
  await s.tx.execute(
    sql`UPDATE establishments SET is_open=${input.is_open} WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
  );
  await s.audit('operation.orders_toggled', s.actor.establishmentId, {
    is_open: input.is_open,
    cash_session_id: selected?.id ?? null,
  });
  await s.event('settings.updated', s.actor.establishmentId, {
    fields: ['is_open', 'order_cash_session_id'],
  });
  return operationControl(s);
}
export async function rotateOperationCash(
  s: Scope,
  input: z.infer<typeof rotateControlCashSchema>,
) {
  permit(s.actor, 'cash.manage');
  if (input.activate_orders !== undefined) permit(s.actor, 'settings.update');
  await lockCashUnit(s);
  const closed = await closeCash(s, input.cash_session_id, input.counted_amount);
  const opened = await openControlCash(s, input.open_cash);
  await setOrderCash(s, opened.id);
  if (input.activate_orders !== undefined)
    await s.tx.execute(
      sql`UPDATE establishments SET is_open=${input.activate_orders} WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
    );
  await s.audit('cash.rotated', opened.id, { previous_cash_session_id: closed.id });
  await s.event('settings.updated', s.actor.establishmentId, { fields: ['order_cash_session_id'] });
  return { ...(await operationControl(s)), rotation: { closed, opened_id: opened.id } };
}
