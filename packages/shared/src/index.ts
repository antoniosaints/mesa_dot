import { createHash, createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { z } from 'zod';

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  code: string,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
export const decimal = (value: string, scale = 2): bigint => {
  ensure(
    typeof value === 'string' && new RegExp(`^-?\\d{1,12}(\\.\\d{1,${scale}})?$`).test(value),
    'BAD_REQUEST',
    'Valor decimal inválido.',
    400,
  );
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'));
  return negative ? -result : result;
};
export const formatDecimal = (value: bigint, scale = 2): string => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const base = 10n ** BigInt(scale);
  return `${sign}${absolute / base}.${(absolute % base).toString().padStart(scale, '0')}`;
};
export const money = (value: string) => decimal(value, 2);
export const quantity = (value: string) => decimal(value, 3);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const opaqueToken = () => randomBytes(32).toString('base64url');
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function deriveToken(key: string, purpose: string, id: string, nonce: string) {
  ensure(
    /^[a-f0-9]{64}$/i.test(key),
    'INTERNAL_ERROR',
    'DOCUMENT_KEY deve conter 32 bytes hexadecimais.',
    500,
  );
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${purpose}:${id}:${nonce}`)
    .digest('base64url');
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(':');
  if (!salt || !expected) return false;
  return equalSecret(scryptSync(password, salt, 64).toString('hex'), expected);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const permissions = [
  'table.view',
  'table.manage',
  'table.release',
  'order.create',
  'order.postpaid',
  'order.cancel',
  'order.discount',
  'tab.transfer',
  'ticket.view',
  'ticket.redeem',
  'ticket.reprint',
  'payment.receive',
  'payment.refund',
  'inventory.view',
  'inventory.adjust',
  'catalog.manage',
  'settings.update',
  'staff.manage',
  'production.manage',
  'print.manage',
  'reports.view',
  'cash.manage',
] as const;
export type Permission = (typeof permissions)[number];
export interface Actor {
  id: string;
  tenantId: string;
  establishmentId: string;
  kind: 'STAFF' | 'VISITOR' | 'AGENT' | 'SYSTEM';
  permissions: string[];
  isAccountAdmin?: boolean;
  customerId?: string;
  tableId?: string;
  serviceMode?: 'TABLE' | 'COUNTER';
  sessionId?: string | null;
}
export function permit(actor: Actor, permission: Permission) {
  ensure(
    actor.kind === 'STAFF' && actor.permissions.includes(permission),
    'FORBIDDEN',
    'Operação não autorizada para seu perfil.',
    403,
  );
}
export const uuid = z.uuid();
export const amount = z.string().regex(/^\d{1,12}\.\d{2}$/);
export const orderInput = z
  .object({
    table_id: uuid,
    tab_id: uuid.optional(),
    source: z.enum(['CUSTOMER', 'WAITER', 'POS']),
    payment_policy: z.enum(['PREPAID', 'POSTPAID']),
    items: z
      .array(
        z
          .object({
            product_id: uuid,
            variant_id: uuid.optional(),
            quantity: z.number().int().min(1).max(100),
            modifiers: z.array(uuid).max(20).default([]),
            notes: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type OrderInput = z.infer<typeof orderInput>;
