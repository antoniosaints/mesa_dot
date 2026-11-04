import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  reserveGatewayOperation,
  runGatewayOperation,
  gatewaySystem,
} from './gateway-operations.js';
import {
  db,
  rows,
  sql,
  atomic,
  view,
  type Scope,
  type Row,
} from '../../../packages/database/src/index.js';
import {
  ensure,
  equalSecret,
  hash,
  money,
  formatDecimal,
  type Actor,
} from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import {
  complement,
  credentials,
  saveComplement,
  sealOauth,
  openOauth,
  complementAdmin,
  providerJson,
} from './complement-store.js';
const api = 'https://api.mercadopago.com';
export interface MercadoCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id: string;
  test_mode: boolean;
}
export function mercadoConfigured() {
  return Boolean(
    env.DOCUMENT_KEY &&
    env.MERCADO_PAGO_CLIENT_ID &&
    env.MERCADO_PAGO_CLIENT_SECRET &&
    env.MERCADO_PAGO_REDIRECT_URI &&
    env.MERCADO_PAGO_WEBHOOK_SECRET,
  );
}
export function mercadoUrls() {
  ensure(
    mercadoConfigured(),
    'INVALID_STATE',
    'O gestor do SaaS precisa configurar a aplicação OAuth do Mercado Pago antes de conectar.',
    409,
  );
  const callback = new URL(env.MERCADO_PAGO_REDIRECT_URI!);
  ensure(
    callback.protocol === 'https:' ||
      (env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(callback.hostname)),
    'INVALID_STATE',
    'Configure uma URL pública HTTPS para o retorno do Mercado Pago.',
    409,
  );
  ensure(
    !callback.username &&
      !callback.password &&
      !callback.search &&
      !callback.hash &&
      callback.pathname === '/api/v1/complements/mercadopago/callback',
    'INVALID_STATE',
    'A URL de retorno OAuth deve terminar em /api/v1/complements/mercadopago/callback.',
    409,
  );
  const admin = new URL(
    process.env.ADMIN_PUBLIC_URL || process.env.VITE_ADMIN_URL || callback.origin,
  );
  ensure(
    ['http:', 'https:'].includes(admin.protocol) &&
      (env.NODE_ENV !== 'production' || admin.protocol === 'https:') &&
      !admin.username &&
      !admin.password,
    'INVALID_STATE',
    'Configure o endereço público da gestão.',
    409,
  );
  return {
    callback: callback.href,
    admin: admin.origin,
    webhook: callback.origin + '/api/v1/webhooks/payments/mercadopago',
  };
}
export const oauthCookie = (state: string) =>
  createHmac('sha256', env.DOCUMENT_KEY!)
    .update('mesa:mp:oauth-cookie:' + state)
    .digest('hex');
export async function beginMercado(s: Scope) {
  complementAdmin(s);
  const urls = mercadoUrls();
  const state = randomBytes(32).toString('hex'),
    verifier = randomBytes(48).toString('base64url');
  await s.tx.execute(
    sql`DELETE FROM complement_oauth_states WHERE ${s.where(sql`expires_at<DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)`)}`,
  );
  await s.insert('complement_oauth_states', {
    initiated_by: s.actor.id,
    state_hash: hash(state),
    verifier: sealOauth(s, { verifier }),
    expires_at: new Date(Date.now() + 10 * 60_000),
  });
  const url = new URL('https://auth.mercadopago.com/authorization');
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: env.MERCADO_PAGO_CLIENT_ID!,
    redirect_uri: urls.callback,
    platform_id: 'mp',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }))
    url.searchParams.set(key, value);
  await s.audit('complement.oauth_started', s.actor.establishmentId, { provider: 'mercadopago' });
  return { authorization_url: url.href, state };
}
async function tokenRequest(body: Row) {
  return providerJson(
    api + '/oauth/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.MERCADO_PAGO_CLIENT_ID,
        client_secret: env.MERCADO_PAGO_CLIENT_SECRET,
        ...body,
      }),
    },
    'Mercado Pago',
  );
}
function readToken(response: Row, previous?: MercadoCredentials): MercadoCredentials {
  ensure(
    typeof response.access_token === 'string' &&
      response.access_token.length > 10 &&
      Number(response.expires_in) > 60 &&
      Number(response.expires_in) < 365 * 86400,
    'UNAVAILABLE',
    'Mercado Pago retornou uma autorização inválida.',
    409,
  );
  const account_id = String(response.user_id ?? previous?.account_id ?? '');
  ensure(
    /^\d{1,80}$/.test(account_id),
    'UNAVAILABLE',
    'Conta do Mercado Pago não identificada.',
    409,
  );
  ensure(
    !previous || account_id === previous.account_id,
    'CONFLICT',
    'A renovação retornou uma conta diferente.',
    409,
  );
  const refresh_token = response.refresh_token || previous?.refresh_token;
  ensure(
    typeof refresh_token === 'string' && refresh_token.length > 10,
    'UNAVAILABLE',
    'Mercado Pago não retornou uma autorização renovável. Autorize novamente.',
    409,
  );
  return {
    access_token: response.access_token,
    refresh_token,
    expires_at: Date.now() + Number(response.expires_in) * 1000,
    account_id,
    test_mode: previous?.test_mode ?? env.MERCADO_PAGO_TEST_MODE === 'true',
  };
}
export async function completeMercado(
  actor: Actor,
  stateId: string,
  code: string | undefined,
  denied: boolean,
) {
  const state = await atomic(
    actor,
    crypto.randomUUID(),
    'complement.oauth.claim',
    { stateId },
    async (s) => {
      complementAdmin(s);
      const state = await s.get('complement_oauth_states', stateId, true);
      ensure(
        !state.used_at &&
          new Date(String(state.expires_at) + 'Z').getTime() > Date.now() &&
          state.initiated_by === actor.id,
        'FORBIDDEN',
        'Autorização expirada ou já utilizada.',
        403,
      );
      await s.update('complement_oauth_states', state.id, { used_at: new Date() });
      return state;
    },
  );
  if (denied) return { result: 'denied' };
  ensure(code, 'BAD_REQUEST', 'Código de autorização ausente.', 400);
  const s = view(actor);
  const { verifier } = openOauth<{ verifier: string }>(s, state.verifier);
  const token = readToken(
    await tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: mercadoUrls().callback,
      test_token: env.MERCADO_PAGO_TEST_MODE === 'true',
    }),
  );
  const me = await providerJson(
    api + '/users/me',
    { headers: { Authorization: 'Bearer ' + token.access_token } },
    'Mercado Pago',
  );
  ensure(
    String(me.id) === token.account_id && (!me.site_id || me.site_id === 'MLB'),
    'CONFLICT',
    'Autorize uma conta brasileira do Mercado Pago.',
    409,
  );
  return atomic(actor, 'mp-save:' + stateId, 'complement.oauth.save', { stateId }, async (s) => {
    complementAdmin(s);
    const previous = await complement(s, 'mercadopago');
    if (previous?.external_account_id && previous.external_account_id !== token.account_id)
      ensure(
        !(await s.list('payment_intents', sql`provider='mercadopago'`)).length,
        'CONFLICT',
        'Já existem pagamentos vinculados à conta anterior nesta filial. Reconecte a mesma conta.',
        409,
      );
    await saveComplement(
      s,
      'mercadopago',
      {
        enabled: true,
        external_account_id: token.account_id,
        settings: {
          nickname: String(me.nickname ?? 'Conta Mercado Pago').slice(0, 100),
          test_mode: token.test_mode,
        },
        connected_at: new Date(),
        last_checked_at: new Date(),
      },
      token,
    );
    await s.audit('complement.connected', previous?.id ?? s.actor.establishmentId, {
      provider: 'mercadopago',
      account_id: token.account_id,
    });
    return { result: 'success' };
  });
}
/** A durable lease serializes refreshes without holding the venue transaction during OAuth I/O. */
export async function prepareMercado(actor: Actor) {
  const record = await complement(view(actor), 'mercadopago');
  if (!record?.credentials) return;
  const token = credentials<MercadoCredentials>(view(actor), record);
  if (token.expires_at > Date.now() + 60000) return;
  mercadoUrls();
  const fingerprint = hash(record.credentials);
  const op = await atomic(
    gatewaySystem(actor),
    crypto.randomUUID(),
    'complement.refresh.reserve',
    { fingerprint },
    (s) =>
      reserveGatewayOperation(s, 'TOKEN_REFRESH', record.id, 'refresh:' + fingerprint, {
        fingerprint,
      }),
  );
  await runGatewayOperation(
    actor,
    op.id,
    async () =>
      readToken(
        await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token }),
        token,
      ),
    async (s, _op, next) => {
      const latest = await complement(s, 'mercadopago');
      ensure(latest?.credentials, 'INVALID_STATE', 'Reconecte o Mercado Pago.', 409);
      if (hash(latest.credentials) !== fingerprint) return { refreshed: false };
      await saveComplement(s, 'mercadopago', {}, next);
      return { refreshed: true };
    },
  );
}
export async function mercadoToken(s: Scope, accountId?: string, enabledOnly = false) {
  const record = await complement(s, 'mercadopago');
  ensure(
    record?.credentials && (!enabledOnly || record.enabled),
    'INVALID_STATE',
    'O Mercado Pago não está ativo nesta filial.',
    409,
  );
  const token = credentials<MercadoCredentials>(s, record);
  ensure(
    !accountId || token.account_id === accountId,
    'CONFLICT',
    'Este pagamento pertence a outra conta do Mercado Pago. Reconecte a conta original.',
    409,
  );
  ensure(
    token.expires_at > Date.now() + 5000,
    'INVALID_STATE',
    'A autorização do Mercado Pago expirou. Atualize a conexão e tente novamente.',
    409,
  );
  return token;
}
export async function mercadoRequest(
  s: Scope,
  path: string,
  init: RequestInit = {},
  accountId?: string,
) {
  ensure(
    s.tx === db,
    'INTERNAL_ERROR',
    'Chamadas ao provedor devem ocorrer fora da transação.',
    500,
  );
  const token = await mercadoToken(s, accountId);
  return providerJson(
    api + path,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
        Authorization: 'Bearer ' + token.access_token,
      },
    },
    'Mercado Pago',
  );
}
export async function testMercado(s: Scope) {
  complementAdmin(s);
  const token = await mercadoToken(s);
  const me = await mercadoRequest(s, '/users/me');
  ensure(String(me.id) === token.account_id, 'CONFLICT', 'Conta vinculada divergente.', 409);
  const record = await complement(s, 'mercadopago');
  return { connected: true, account_id: token.account_id, fingerprint: hash(record!.credentials) };
}
/** Read the full payment and authoritative refund ledger, including search results with omitted refunds. */
export async function mercadoPayment(s: Scope, id: string, accountId?: string) {
  ensure(/^\d{1,40}$/.test(id), 'CONFLICT', 'Referência de pagamento inválida.', 409);
  const payment = await mercadoRequest(s, '/v1/payments/' + id, {}, accountId);
  ensure(String(payment.id) === id, 'CONFLICT', 'Referência do pagamento divergente.', 409);
  const refunded = money(
    String(
      payment.transaction_amount_refunded ??
        (payment.status === 'refunded' ? payment.transaction_amount : 0),
    ),
  );
  if (refunded > 0n) {
    const refunds = await mercadoRequest(s, '/v1/payments/' + id + '/refunds', {}, accountId);
    ensure(
      Array.isArray(refunds),
      'CONFLICT',
      'Não foi possível conferir os estornos do pagamento.',
      409,
    );
    const confirmed = refunds.filter(
      (refund: Row) => !refund.status || refund.status === 'approved',
    );
    ensure(
      confirmed.reduce((sum: bigint, refund: Row) => sum + money(String(refund.amount)), 0n) ===
        refunded,
      'CONFLICT',
      'Estornos ainda em atualização no Mercado Pago. Tente sincronizar novamente.',
      409,
    );
    payment.refunds = confirmed;
  }
  return payment;
}
export function validCheckoutUrl(value: unknown) {
  const url = new URL(String(value));
  ensure(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /(^|\.)mercadopago\.com\.br$/.test(url.hostname),
    'UNAVAILABLE',
    'Mercado Pago retornou um endereço de pagamento inválido.',
    409,
  );
  return url.href;
}
export async function mercadoPreference(s: Scope, intent: Row) {
  const unit = (
    await rows(
      s.tx,
      sql`SELECT id FROM establishments WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
    )
  )[0];
  const customerBase = (
    process.env.CUSTOMER_PUBLIC_URL ||
    process.env.VITE_CUSTOMER_URL ||
    'http://localhost:5174'
  ).replace(/\/$/, '');
  const back = new URL(customerBase + '/pwa/apps/' + unit.id + '/');
  const order = await s.get('orders', intent.order_id);
  if (order.table_id)
    back.searchParams.set('table', (await s.get('dining_tables', order.table_id)).public_code);
  ensure(
    back.protocol === 'https:' || env.NODE_ENV !== 'production',
    'INVALID_STATE',
    'Configure o endereço público HTTPS do cardápio.',
    409,
  );
  back.searchParams.set('payment_return', intent.id);
  const expiry =
    intent.expires_at instanceof Date
      ? intent.expires_at
      : new Date(
          String(intent.expires_at).replace(' ', 'T') +
            (/Z|[+-]\d\d:\d\d$/.test(String(intent.expires_at)) ? '' : 'Z'),
        );
  return {
    external_reference: intent.provider_reference,
    items: [
      {
        id: intent.order_id,
        title: 'Pedido Mesa · ' + intent.order_id.slice(0, 6).toUpperCase(),
        quantity: 1,
        currency_id: 'BRL',
        unit_price: Number(intent.amount),
      },
    ],
    back_urls: { success: back.href, pending: back.href, failure: back.href },
    ...(back.protocol === 'https:' ? { auto_return: 'approved' } : {}),
    notification_url: mercadoUrls().webhook + '?unit=' + unit.id,
    expires: true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to: expiry.toISOString(),
  };
}
/** A preference POST with an uncertain outcome is recovered by external_reference, never blindly resent. */
export async function createMercadoCheckout(
  s: Scope,
  intent: Row,
  operation: Row,
  beforePost: () => Promise<void>,
) {
  const token = await mercadoToken(s, intent.external_account_id);
  const found = await mercadoRequest(
    s,
    '/checkout/preferences/search?' +
      new URLSearchParams({ external_reference: intent.provider_reference, limit: '2' }).toString(),
    {},
    intent.external_account_id,
  );
  ensure(
    Array.isArray(found.elements),
    'UNAVAILABLE',
    'Não foi possível conferir o checkout anterior.',
    409,
  );
  let response: Row;
  if (found.elements.length) {
    ensure(
      found.elements.length === 1,
      'CONFLICT',
      'Há mais de um checkout para esta referência. Conciliação necessária.',
      409,
    );
    response = await mercadoRequest(
      s,
      '/checkout/preferences/' + encodeURIComponent(String(found.elements[0].id)),
      {},
      intent.external_account_id,
    );
    ensure(
      response.external_reference === intent.provider_reference &&
        String(response.collector_id) === intent.external_account_id,
      'CONFLICT',
      'Checkout recuperado divergente.',
      409,
    );
    const total = (response.items ?? []).reduce(
      (sum: bigint, item: Row) => sum + money(String(item.unit_price)) * BigInt(item.quantity),
      0n,
    );
    ensure(
      total === money(intent.amount),
      'CONFLICT',
      'Valor do checkout recuperado divergente.',
      409,
    );
  } else {
    ensure(
      !operation.payload.provider_started_at,
      'UNAVAILABLE',
      'O checkout aguarda confirmação do Mercado Pago. Atualize em instantes, sem pagar novamente.',
      409,
    );
    ensure(
      new Date(String(operation.payload.preference.expiration_date_to)).getTime() > Date.now(),
      'INVALID_STATE',
      'Checkout expirado. Confira pagamentos antes de iniciar outro pedido.',
      409,
    );
    await beforePost();
    response = await mercadoRequest(
      s,
      '/checkout/preferences',
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': intent.provider_reference },
        body: JSON.stringify(operation.payload.preference),
      },
      intent.external_account_id,
    );
  }
  return {
    checkout_url: validCheckoutUrl(
      token.test_mode ? response.sandbox_init_point : response.init_point,
    ),
    external_account_id: token.account_id,
  };
}
export async function refundMercado(
  s: Scope,
  payment: Row,
  amount: string,
  refunded: bigint,
  operationKey?: string,
) {
  const intent = await s.get('payment_intents', payment.intent_id);
  const response = await mercadoRequest(
    s,
    '/v1/payments/' + encodeURIComponent(payment.provider_reference) + '/refunds',
    {
      method: 'POST',
      headers: {
        'X-Idempotency-Key':
          operationKey ?? hash(`mp-refund:${payment.id}:${formatDecimal(refunded)}:${amount}`),
      },
      body: JSON.stringify({ amount: Number(amount) }),
    },
    intent.external_account_id,
  );
  ensure(
    response.status === 'approved' &&
      money(String(response.amount)) === money(amount) &&
      /^\d+$/.test(String(response.id)),
    'UNAVAILABLE',
    'O Mercado Pago ainda não confirmou este estorno. Atualize o pagamento antes de tentar novamente.',
    409,
  );
  return String(response.id);
}
export function verifyMercadoSignature(id: string, requestId: string, signature: string) {
  ensure(env.MERCADO_PAGO_WEBHOOK_SECRET, 'FORBIDDEN', 'Webhook não configurado.', 403);
  const fields = Object.fromEntries(signature.split(',').map((item) => item.trim().split('=')));
  ensure(
    /^\d{10,13}$/.test(fields.ts ?? '') &&
      /^[a-f0-9]{64}$/i.test(fields.v1 ?? '') &&
      requestId.length > 0 &&
      requestId.length <= 200,
    'UNAUTHORIZED',
    'Assinatura inválida.',
    401,
  );
  const timestamp = Number(fields.ts) * (fields.ts.length === 10 ? 1000 : 1);
  ensure(
    Math.abs(Date.now() - timestamp) < 5 * 60_000,
    'UNAUTHORIZED',
    'Notificação expirada.',
    401,
  );
  const expected = createHmac('sha256', env.MERCADO_PAGO_WEBHOOK_SECRET)
    .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${fields.ts};`)
    .digest('hex');
  ensure(equalSecret(expected, fields.v1), 'UNAUTHORIZED', 'Assinatura inválida.', 401);
}
export async function oauthState(raw: string) {
  const states = await rows(
    db,
    sql`SELECT * FROM complement_oauth_states WHERE state_hash=${hash(raw)} AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(3)`,
  );
  ensure(states.length, 'FORBIDDEN', 'Autorização expirada ou já utilizada.', 403);
  return states[0];
}
