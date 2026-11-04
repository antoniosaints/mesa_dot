import { paymentHttpSchema } from './payment-http-schema.js';
import type { FastifyInstance, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { geminiSupportsImages } from '../../../packages/shared/src/gemini-capabilities.js';
import {
  db,
  rows,
  sql,
  view,
  atomic,
  type Scope,
  type Row,
} from '../../../packages/database/src/index.js';
import {
  ensure,
  equalSecret,
  hash,
  canonical,
  uuid,
  type Actor,
} from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { publicActor } from './auth.js';
import { accessOrder } from './orders.js';
import { complement, complementAdmin, saveComplement } from './complement-store.js';
import {
  mercadoConfigured,
  mercadoUrls,
  beginMercado,
  completeMercado,
  oauthCookie,
  oauthState,
  prepareMercado,
  testMercado,
  mercadoPayment,
  verifyMercadoSignature,
} from './mercadopago.js';
import {
  geminiConfigSchema,
  geminiPromptSchema,
  geminiModels,
  saveGemini,
  testGemini,
  askGemini,
} from './gemini.js';
import { applyMercadoObservation, syncMercadoIntent } from './mercado-financial.js';
const empty = z.object({}).strict();
const providerSchema = z.enum(['mercadopago', 'gemini']);
const keySchema = geminiConfigSchema.pick({ api_key: true });
const cookieName = 'mesa_mp_oauth';
const callbackPath = '/api/v1/complements/mercadopago/callback';
const provider = (request: FastifyRequest) =>
  providerSchema.parse((request.params as Row).provider);
interface Dependencies {
  actor: (request: FastifyRequest) => Promise<Actor>;
  key: (request: FastifyRequest) => string;
  route: (
    method: HTTPMethods,
    path: string,
    permission: null,
    body: z.ZodType | null,
    handler: (s: Scope, body: any, request: FastifyRequest) => Promise<any>,
    mutation?: boolean,
  ) => void;
}
async function safeCatalog(s: Scope) {
  complementAdmin(s);
  const stored = await s.list('unit_complements');
  return ['mercadopago', 'gemini'].map((id) => {
    const record = stored.find((value) => value.provider === id);
    return {
      provider: id,
      installed: Boolean(record),
      enabled: Boolean(record?.enabled),
      configured: Boolean(record?.credentials),
      account_id: record?.external_account_id ?? null,
      model: id === 'gemini' ? (record?.settings?.model ?? 'gemini-3.8-flash') : null,
      image_model: id === 'gemini' ? (record?.settings?.image_model ?? null) : null,
      supports_images:
        id === 'gemini' &&
        geminiSupportsImages(record?.settings?.image_model || record?.settings?.model),
      nickname: id === 'mercadopago' ? (record?.settings?.nickname ?? null) : null,
      test_mode: id === 'mercadopago' ? Boolean(record?.settings?.test_mode) : false,
      last_checked_at: record?.last_checked_at ?? null,
      platform_ready: Boolean(env.DOCUMENT_KEY) && (id !== 'mercadopago' || mercadoConfigured()),
    };
  });
}
export function registerComplements(app: FastifyInstance, dependencies: Dependencies) {
  const { route, actor, key } = dependencies;
  const assistantLock = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2000),
  });
  assistantLock.on('error', () => {});
  app.addHook('onClose', async () => assistantLock.disconnect());
  const checkedMercado = new WeakMap<FastifyRequest, Row>();
  app.addHook('preHandler', async (request) => {
    const path = request.url.split('?')[0];
    if (
      request.method !== 'POST' ||
      !/^\/api\/v1\/complements\/mercadopago\/(test|enable)$/.test(path)
    )
      return;
    const current = await actor(request);
    complementAdmin(view(current));
    await prepareMercado(current);
    checkedMercado.set(request, await testMercado(view(current)));
  });
  async function recordMercadoTest(s: Scope, request: FastifyRequest) {
    complementAdmin(s);
    const checked = checkedMercado.get(request),
      connection = await complement(s, 'mercadopago');
    ensure(
      checked && connection?.credentials && hash(connection.credentials) === checked.fingerprint,
      'CONFLICT',
      'A conexão foi alterada. Teste novamente.',
      409,
    );
    await saveComplement(s, 'mercadopago', { last_checked_at: new Date() });
    return { connected: true, account_id: checked.account_id };
  }
  route('GET', '/complements', null, null, safeCatalog);
  route('POST', '/complements/:provider/install', null, empty, async (s, _body, request) => {
    complementAdmin(s);
    const id = provider(request);
    const existing = await complement(s, id);
    if (!existing) await saveComplement(s, id, { enabled: false });
    await s.audit('complement.installed', existing?.id ?? s.actor.establishmentId, {
      provider: id,
    });
    return safeCatalog(s);
  });
  for (const action of ['disable', 'enable'])
    route('POST', '/complements/:provider/' + action, null, empty, async (s, _body, request) => {
      complementAdmin(s);
      const id = provider(request),
        existing = await complement(s, id);
      ensure(existing, 'NOT_FOUND', 'Complemento não instalado.', 404);
      if (action === 'enable') {
        ensure(existing.credentials, 'INVALID_STATE', 'Configure a conexão antes de ativar.', 409);
        if (id === 'mercadopago') {
          ensure(
            mercadoConfigured(),
            'INVALID_STATE',
            'A aplicação OAuth do SaaS não está configurada.',
            409,
          );
          await recordMercadoTest(s, request);
        } else await testGemini(s);
      }
      await saveComplement(s, id, { enabled: action === 'enable' });
      await s.audit('complement.' + action, existing.id, { provider: id });
      return safeCatalog(s);
    });
  route('POST', '/complements/gemini/configure', null, geminiConfigSchema, saveGemini);
  route('POST', '/complements/gemini/models', null, keySchema, async (s, body) =>
    geminiModels(s, body.api_key),
  );
  route('POST', '/complements/gemini/test', null, empty, testGemini);
  route('POST', '/complements/gemini/remove-key', null, empty, async (s) => {
    complementAdmin(s);
    const record = await complement(s, 'gemini');
    ensure(record, 'NOT_FOUND', 'Gemini não instalado.', 404);
    await s.update('unit_complements', record.id, {
      credentials: null,
      enabled: false,
      connected_at: null,
      last_checked_at: null,
    });
    await s.audit('complement.key_removed', record.id, { provider: 'gemini' });
    return { removed: true };
  });
  route('POST', '/complements/mercadopago/test', null, empty, (s, _body, request) =>
    recordMercadoTest(s, request),
  );
  app.post(
    '/api/v1/complements/gemini/ask',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) =>
            hash(String(request.headers.authorization ?? request.ip)),
        },
      },
    },
    async (request) => {
      const current = await actor(request);
      complementAdmin(view(current));
      const input = geminiPromptSchema.parse(request.body);
      const requestKey = key(request),
        operation = 'complement.gemini.ask';
      ensure(
        requestKey.length >= 8 && requestKey.length <= 128,
        'BAD_REQUEST',
        'Envie Idempotency-Key de 8 a 128 caracteres.',
        400,
      );
      const lockKey =
        'mesa:gemini:request:' +
        hash([current.tenantId, current.establishmentId, current.id, requestKey].join(':'));
      const lease = crypto.randomUUID();
      let acquired: string | null = null;
      try {
        acquired = await assistantLock.set(
          lockKey,
          lease,
          'PX',
          input.mode === 'image' ? 180000 : 60000,
          'NX',
        );
      } catch {
        ensure(
          false,
          'UNAVAILABLE',
          'Assistente temporariamente indisponível. Tente novamente.',
          503,
        );
      }
      ensure(
        acquired === 'OK',
        'CONFLICT',
        'Esta consulta já está sendo processada. Aguarde a resposta.',
        409,
      );
      try {
        const s = view(current);
        const cached = (
          await s.list(
            'idempotency_records',
            sql`actor_id=${current.id} AND idempotency_key=${requestKey}`,
          )
        )[0];
        if (cached) {
          ensure(
            cached.operation === operation && cached.request_hash === hash(canonical(input)),
            'CONFLICT',
            'Idempotency-Key reutilizada com outro conteúdo.',
            409,
          );
          return cached.response_json;
        }
        // Provider latency must never hold the unit lock used by orders, money and stock.
        const generated = await askGemini(s, input);
        return await atomic(current, requestKey, operation, input, async (locked) => {
          complementAdmin(locked);
          const connection = await complement(locked, 'gemini');
          ensure(
            connection?.enabled && connection.credentials,
            'INVALID_STATE',
            'O Gemini foi desativado durante esta consulta.',
            409,
          );
          await locked.audit('complement.gemini_used', generated.connection_id, generated.audit);
          return generated.response;
        });
      } finally {
        try {
          await assistantLock.eval(
            "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
            1,
            lockKey,
            lease,
          );
        } catch {
          app.log.warn(
            'Não foi possível liberar a consulta Gemini; a reserva expirará automaticamente.',
          );
        }
      }
    },
  );
  app.post('/api/v1/complements/mercadopago/connect', async (request, reply) => {
    const current = await actor(request);
    complementAdmin(view(current));
    empty.parse(request.body);
    const result = await atomic(
      current,
      key(request),
      'complement.mercadopago.connect',
      {},
      beginMercado,
    );
    reply.header(
      'Set-Cookie',
      `${cookieName}=${oauthCookie(result.state)}; Path=${callbackPath}; HttpOnly; SameSite=Lax; Max-Age=600${mercadoUrls().callback.startsWith('https:') ? '; Secure' : ''}`,
    );
    return { authorization_url: result.authorization_url };
  });
  app.get(callbackPath, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const input = z
      .object({
        state: z.string().regex(/^[a-f0-9]{64}$/),
        code: z.string().min(1).max(2048).optional(),
        error: z.string().max(100).optional(),
      })
      .parse(request.query);
    const cookie =
      String(request.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1) ?? '';
    ensure(
      equalSecret(cookie, oauthCookie(input.state)),
      'FORBIDDEN',
      'A autorização deve ser concluída no navegador em que foi iniciada.',
      403,
    );
    const pending = await oauthState(input.state);
    const current: Actor = {
      id: pending.initiated_by,
      tenantId: pending.tenant_id,
      establishmentId: pending.establishment_id,
      kind: 'STAFF',
      permissions: [],
    };
    let result = 'error';
    try {
      result = (await completeMercado(current, pending.id, input.code, Boolean(input.error)))
        .result;
    } catch {
      /* No authorization code, token or provider response is exposed in the redirect. */
    }
    reply.header(
      'Set-Cookie',
      `${cookieName}=; Path=${callbackPath}; HttpOnly; SameSite=Lax; Max-Age=0${mercadoUrls().callback.startsWith('https:') ? '; Secure' : ''}`,
    );
    return reply.redirect(
      mercadoUrls().admin +
        '/pwa/apps/' +
        current.establishmentId +
        '/complementos?oauth=' +
        result,
    );
  });
  route('GET', '/payments/intents/:id', null, null, async (s, _body, request) => {
    const record = await s.get('payment_intents', uuid.parse((request.params as Row).id));
    await accessOrder(s, record.order_id);
    const payments = await s.list('payments', sql`intent_id=${record.id}`);
    return {
      id: record.id,
      order_id: record.order_id,
      amount: record.amount,
      status: record.status,
      expires_at: record.expires_at,
      provider: record.provider,
      checkout_url: record.checkout_url,
      sandbox: record.provider === 'sandbox',
      requires_review: payments.find((payment) => payment.review_reason)?.review_reason ?? null,
    };
  });
  app.post('/api/v1/payments/intents/:id/sync', paymentHttpSchema(empty), async (request) => {
    const current = await actor(request);
    empty.parse(request.body);
    return syncMercadoIntent(current, uuid.parse((request.params as Row).id), true, key(request));
  });
  app.post('/api/v1/webhooks/payments/mercadopago', async (request) => {
    const query = request.query as Row,
      body = (request.body ?? {}) as Row;
    const paymentId = z
      .string()
      .regex(/^\d{1,40}$/)
      .parse(String(query['data.id'] ?? body.data?.id ?? ''));
    verifyMercadoSignature(
      paymentId,
      String(request.headers['x-request-id'] ?? ''),
      String(request.headers['x-signature'] ?? ''),
    );
    if (body.type && body.type !== 'payment') return { received: true, ignored: true };
    const candidates = query.unit
      ? await rows(db, sql`SELECT * FROM establishments WHERE id=${uuid.parse(query.unit)}`)
      : await rows(
          db,
          sql`SELECT e.* FROM unit_complements c JOIN establishments e ON e.tenant_id=c.tenant_id AND e.id=c.establishment_id WHERE c.provider='mercadopago' AND c.external_account_id=${String(body.user_id ?? '')} AND c.credentials IS NOT NULL ORDER BY e.id LIMIT 1`,
        );
    if (!candidates.length) return { received: true, ignored: true };
    const candidateActor = publicActor(candidates[0]);
    await prepareMercado(candidateActor);
    const payment = await mercadoPayment(view(candidateActor), paymentId);
    const units = await rows(
      db,
      sql`SELECT e.* FROM payment_intents i JOIN establishments e ON e.tenant_id=i.tenant_id AND e.id=i.establishment_id WHERE i.provider='mercadopago' AND i.provider_reference=${String(payment.external_reference ?? '')} AND i.external_account_id=${String(payment.collector_id ?? '')}`,
    );
    if (!units.length) return { received: true, ignored: true };
    if (query.unit)
      ensure(
        units[0].id === query.unit,
        'FORBIDDEN',
        'A notificação pertence a outra filial.',
        403,
      );
    const target = publicActor(units[0]);
    await prepareMercado(target);
    return applyMercadoObservation(target, payment);
  });
}
