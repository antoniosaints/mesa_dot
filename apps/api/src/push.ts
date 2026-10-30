import { createECDH, ECDH } from 'node:crypto';
import { z } from 'zod';
import { rows, sql, type Scope } from '../../../packages/database/src/index.js';
import { ensure, hash, equalSecret } from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import {
  pushEvents,
  pushSettingsSchema,
  type PushRule,
} from '../../../packages/shared/src/push.js';
import { sealPush, openPush } from '../../../packages/shared/src/push-crypto.js';
import { sqlPage, pageFields } from './pagination.js';
export { pushSettingsSchema };
export function webPushReady() {
  if (!env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY || !env.DOCUMENT_KEY) return false;
  try {
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(env.WEB_PUSH_PRIVATE_KEY, 'base64url'));
    return (
      key.getPublicKey().toString('base64url') === env.WEB_PUSH_PUBLIC_KEY &&
      ['https:', 'mailto:'].includes(new URL(env.WEB_PUSH_SUBJECT).protocol)
    );
  } catch {
    return false;
  }
}
export function pushAdmin(s: Scope) {
  ensure(
    s.actor.kind === 'STAFF' && s.actor.isAccountAdmin,
    'FORBIDDEN',
    'Somente o admin geral da conta pode configurar notificações.',
    403,
  );
}
export function pushStaff(s: Scope) {
  ensure(s.actor.kind === 'STAFF', 'FORBIDDEN', 'Notificações exclusivas da equipe.', 403);
}
export const subscriptionSchema = z
  .object({
    subscription: z
      .object({
        endpoint: z.url().max(2048),
        expirationTime: z.number().int().min(1).max(8640000000000000).nullable().optional(),
        keys: z
          .object({
            p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
            auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
          })
          .strict(),
      })
      .strict(),
    origin: z.url().max(255),
    surface: z.enum(['admin', 'waiter', 'kitchen']),
    device_name: z.string().trim().min(1).max(100),
    activate: z.boolean().default(false),
  })
  .strict();
export type RegisteredPush = { endpoint: string; keys: { p256dh: string; auth: string } };
export function validatePushEndpoint(endpoint: string) {
  const url = new URL(endpoint),
    hosts = env.WEB_PUSH_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  ensure(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === '443') &&
      hosts.some((host) => url.hostname === host || url.hostname.endsWith('.' + host)),
    'BAD_REQUEST',
    'Serviço de push não permitido.',
    400,
  );
}
export async function loadPushSettings(
  s: Scope,
): Promise<{ id?: string; enabled: boolean; enabled_since: string | null; rules: PushRule[] }> {
  const [saved] = await s.list('push_settings');
  if (saved)
    return {
      id: saved.id,
      enabled: Boolean(saved.enabled),
      enabled_since: saved.enabled_since,
      rules: pushSettingsSchema.shape.rules.parse(saved.rules),
    };
  const roles = await s.list('roles');
  return {
    enabled: false,
    enabled_since: null,
    rules: pushEvents.map((event) => ({
      event: event.key,
      enabled: true,
      role_ids: roles
        .filter((role) => (event.roles as readonly string[]).includes(role.name))
        .map((role) => role.id),
    })),
  };
}
export async function pushConfiguration(s: Scope) {
  pushAdmin(s);
  const grants = await rows(
    s.tx,
    sql`SELECT rp.role_id,p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${s.actor.tenantId} AND rp.establishment_id=${s.actor.establishmentId}`,
  );
  return {
    ...(await loadPushSettings(s)),
    configured: webPushReady(),
    events: pushEvents.map((event) => ({
      key: event.key,
      label: event.label,
      description: event.description,
      permission: event.permission,
    })),
    roles: (await s.list('roles')).map((role) => ({
      id: role.id,
      name: role.name,
      permissions: grants.filter((grant) => grant.role_id === role.id).map((grant) => grant.code),
    })),
  };
}
export async function updatePushSettings(s: Scope, input: z.infer<typeof pushSettingsSchema>) {
  pushAdmin(s);
  ensure(
    !input.enabled || webPushReady(),
    'INVALID_STATE',
    'Configure as chaves VAPID no servidor antes de ativar o Web Push.',
  );
  const roles = await s.list('roles');
  for (const rule of input.rules)
    for (const roleId of rule.role_ids)
      ensure(
        roles.some((role) => role.id === roleId),
        'BAD_REQUEST',
        'Perfil de outra filial.',
        400,
      );
  const grants = await rows(
    s.tx,
    sql`SELECT rp.role_id,p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${s.actor.tenantId} AND rp.establishment_id=${s.actor.establishmentId}`,
  );
  for (const rule of input.rules)
    if (rule.enabled) {
      const definition = pushEvents.find((event) => event.key === rule.event)!;
      for (const roleId of rule.role_ids)
        ensure(
          grants.some((grant) => grant.role_id === roleId && grant.code === definition.permission),
          'BAD_REQUEST',
          'Um perfil selecionado não tem permissão para esta operação.',
          400,
        );
    }
  const [previous] = await s.list('push_settings');
  const values = {
    ...input,
    enabled_since: input.enabled ? (previous?.enabled ? previous.enabled_since : new Date()) : null,
  };
  if (previous) await s.update('push_settings', previous.id, values);
  else await s.insert('push_settings', values);
  await s.audit('push.settings_updated', s.actor.establishmentId);
  return pushConfiguration(s);
}
export async function ownPushContext(s: Scope) {
  pushStaff(s);
  const config = await loadPushSettings(s);
  return {
    configured: webPushReady(),
    enabled: Boolean(config.enabled),
    public_key: webPushReady() ? env.WEB_PUSH_PUBLIC_KEY : null,
    subscriptions: (await s.list('push_subscriptions', sql`user_id=${s.actor.id}`)).map(
      (device) => ({
        id: device.id,
        endpoint_hash: device.endpoint_hash,
        device_name: device.device_name,
        enabled: Boolean(device.enabled),
        surface: device.surface,
        vapid_key_hash: device.vapid_key_hash,
      }),
    ),
  };
}
export async function registerPush(
  s: Scope,
  input: z.infer<typeof subscriptionSchema>,
  token: string,
  requestOrigin?: string,
) {
  pushStaff(s);
  ensure(webPushReady(), 'INVALID_STATE', 'O Web Push ainda não foi configurado no servidor.');
  ensure(
    input.surface !== 'kitchen' || s.actor.permissions.includes('production.manage'),
    'FORBIDDEN',
    'Sem acesso ao aplicativo da cozinha.',
    403,
  );
  ensure(
    input.surface !== 'waiter' ||
      (s.actor.permissions.includes('table.view') && s.actor.permissions.includes('ticket.redeem')),
    'FORBIDDEN',
    'Sem acesso ao aplicativo do garçom.',
    403,
  );
  validatePushEndpoint(input.subscription.endpoint);
  try {
    ECDH.convertKey(Buffer.from(input.subscription.keys.p256dh, 'base64url'), 'prime256v1');
  } catch {
    ensure(false, 'BAD_REQUEST', 'Chave pública do dispositivo inválida.', 400);
  }
  const allowed = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  ensure(
    new URL(input.origin).origin === input.origin &&
      allowed.includes(input.origin) &&
      (!requestOrigin || requestOrigin === input.origin),
    'BAD_REQUEST',
    'Origem de aplicativo inválida.',
    400,
  );
  ensure(
    !input.subscription.expirationTime || input.subscription.expirationTime > Date.now(),
    'BAD_REQUEST',
    'Assinatura expirada. Ative as notificações novamente.',
    400,
  );
  const [staff] = await s.list(
    'staff_sessions',
    sql`user_id=${s.actor.id} AND token_hash=${hash(token)} AND revoked_at IS NULL`,
  );
  ensure(staff, 'UNAUTHORIZED', 'Sessão de equipe inválida.', 401);
  const endpointHash = hash(input.subscription.endpoint);
  // A browser origin has one native subscription. Rebinding requires its encryption secrets,
  // preventing a shared computer from continuing to receive the previous operator's messages.
  const bindings = await rows(
    s.tx,
    sql`SELECT id,user_id,credentials,tenant_id,establishment_id FROM push_subscriptions WHERE endpoint_hash=${endpointHash} FOR UPDATE`,
  );
  for (const binding of bindings)
    if (binding.user_id !== s.actor.id) {
      const old = openPush<RegisteredPush>(binding.credentials);
      ensure(
        equalSecret(old.keys.auth, input.subscription.keys.auth) &&
          equalSecret(old.keys.p256dh, input.subscription.keys.p256dh),
        'CONFLICT',
        'Assinatura do dispositivo inválida. Reative as notificações.',
      );
      await s.tx.execute(
        sql`DELETE FROM push_subscriptions WHERE id=${binding.id} AND endpoint_hash=${endpointHash}`,
      );
    }
  const [existing] = await s.list(
    'push_subscriptions',
    sql`user_id=${s.actor.id} AND endpoint_hash=${endpointHash}`,
  );
  if (existing && !existing.enabled && !input.activate) return { id: existing.id, enabled: false };
  const values = {
    user_id: s.actor.id,
    staff_session_id: staff.id,
    endpoint_hash: endpointHash,
    credentials: sealPush({ endpoint: input.subscription.endpoint, keys: input.subscription.keys }),
    vapid_key_hash: hash(env.WEB_PUSH_PUBLIC_KEY!),
    origin: input.origin,
    surface: input.surface,
    device_name: input.device_name,
    enabled: true,
    last_seen_at: new Date(),
    expires_at: input.subscription.expirationTime
      ? new Date(input.subscription.expirationTime)
      : null,
  };
  const record = existing
    ? (await s.update('push_subscriptions', existing.id, values), existing)
    : await s.insert('push_subscriptions', values);
  if (!existing || input.activate) await s.audit('push.device_registered', record.id);
  return { id: record.id, enabled: true };
}
export async function removeOwnPush(s: Scope, id: string) {
  pushStaff(s);
  const device = await s.get('push_subscriptions', id);
  ensure(device.user_id === s.actor.id, 'FORBIDDEN', 'Dispositivo de outro usuário.', 403);
  await s.tx.execute(
    sql`DELETE FROM push_subscriptions WHERE ${s.where(sql`id=${id} AND user_id=${s.actor.id}`)}`,
  );
  return { removed: true };
}
const devicesQuery = z
  .object({ ...pageFields, search: z.string().trim().max(100).default('') })
  .strict();
export async function pushDevices(s: Scope, raw: unknown) {
  pushAdmin(s);
  const q = devicesQuery.parse(raw);
  const source = sql`SELECT ps.id,ps.device_name,ps.surface,ps.origin,ps.enabled,ps.last_seen_at,ps.created_at,u.name user_name,r.name role_name FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id JOIN staff_memberships m ON m.tenant_id=ps.tenant_id AND m.establishment_id=ps.establishment_id AND m.user_id=ps.user_id JOIN roles r ON r.id=m.role_id AND r.tenant_id=m.tenant_id AND r.establishment_id=m.establishment_id WHERE ps.tenant_id=${s.actor.tenantId} AND ps.establishment_id=${s.actor.establishmentId}`;
  const literal = '%' + q.search.replace(/[!%_]/g, (c) => '!' + c) + '%';
  return sqlPage(
    s.tx,
    source,
    sql`(device_name LIKE ${literal} ESCAPE '!' OR user_name LIKE ${literal} ESCAPE '!')`,
    sql`last_seen_at DESC,id`,
    q,
  );
}
export async function disablePushDevice(s: Scope, id: string) {
  pushAdmin(s);
  await s.get('push_subscriptions', id);
  await s.update('push_subscriptions', id, { enabled: false });
  await s.audit('push.device_disabled', id);
  return { disabled: true };
}
export async function testPush(s: Scope, id: string) {
  pushStaff(s);
  ensure(webPushReady(), 'INVALID_STATE', 'Web Push não configurado.');
  const device = await s.get('push_subscriptions', id);
  ensure(
    device.user_id === s.actor.id && device.enabled,
    'FORBIDDEN',
    'Ative este dispositivo antes de testar.',
    403,
  );
  await s.event('push.test', id, { subscription_id: id, user_id: s.actor.id });
  return { queued: true };
}
export function roleReceives(rules: PushRule[], event: string, roleId: string) {
  return rules.some(
    (rule) => rule.event === event && rule.enabled && rule.role_ids.includes(roleId),
  );
}
