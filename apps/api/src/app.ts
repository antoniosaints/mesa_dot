import { paymentHttpSchema } from './payment-http-schema.js';
import { registerComplements } from './complements-routes.js';
import { trustedProxyAddresses } from './trusted-proxy.js';
import { paymentCheckout, paymentRefund } from './mercado-financial.js';
import { dashboardOverview } from './dashboard-overview.js';
import { productPhotoSchema, saveProductPhoto, registerProductPhotos } from './product-photos.js';
import {
  measurementUnitCodes,
  measurementUnits,
} from '../../../packages/shared/src/measurement-units.js';
import {
  businessProfilePatchSchema,
  readBusinessProfile,
} from '../../../packages/shared/src/business-profile.js';
import {
  pushConfiguration,
  ownPushContext,
  updatePushSettings,
  pushSettingsSchema,
  subscriptionSchema,
  registerPush,
  removeOwnPush,
  pushDevices,
  disablePushDevice,
  testPush,
} from './push.js';
import {
  stationDetails,
  stationHeartbeat,
  stationHeartbeatSchema,
  printStations,
  printerAvailability,
  updatePrintAgent,
} from './print-stations.js';
import { publicAccounts } from './public-accounts.js';
import { tableQrDocument, tableQrQuery, queueTableQr } from './table-qr.js';
import {
  operationControl,
  operationControlSchema,
  updateOperationControl,
  rotateControlCashSchema,
  rotateOperationCash,
  openOperationCash,
  openControlCashSchema,
} from './operation-control.js';
import { activeCashSessions, lockCashUnit } from './cash-sessions.js';
import { tableQrPdf } from './table-qr-pdf.js';
import { saleStockCatalog, visibleSaleCatalog } from './sale-stock.js';
import {
  businessHoursSchema,
  businessAvailability,
} from '../../../packages/shared/src/business-hours.js';
import { counterOrderInput, createCounterOrder, counterCashSessions } from './counter-orders.js';
import {
  createReplenishment,
  replenishmentList,
  replenishmentDetail,
  replenishmentSchema,
  replenishmentQuery,
} from './replenishments.js';
import { initializeProductStock } from './initial-stock.js';
import { changeStockLocation } from './stock-location.js';
import { registerPwa, pwaSettings, pwaSettingsSchema, updatePwaSettings } from './pwa.js';
import { assignSlug } from '../../../packages/database/src/slugs.js';
import { teamMembers, roleAccessSurfaces } from './team.js';
import { prepareBridge, bridgePayload, reportBridge } from './bridge-printing.js';
import { productionContext } from './production-context.js';
import { paymentOverview } from './payment-overview.js';
import { receiptDocument, queueReceipt } from './receipts.js';
import { receiptPdf } from './receipt-pdf.js';
import { financeContext, financeDashboard, financeRecords } from './finance.js';
import {
  validateCatalogResource,
  productManagement,
  makeDefaultStockLocation,
  removeCatalogLink,
  removeProductVariant,
} from './catalog-management.js';
import { orderCancellationContext } from './order-cancellation.js';
import { operationContext, tableRequestCounts } from './operation-context.js';
import Fastify, { type FastifyRequest, type HTTPMethods } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import {
  db,
  view,
  atomic,
  rows,
  sql,
  type Scope,
  type Row,
} from '../../../packages/database/src/index.js';
import {
  DomainError,
  ensure,
  permit,
  uuid,
  amount,
  orderInput,
  hash,
  equalSecret,
  type Permission,
  permissions,
} from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import {
  authenticate,
  login,
  accountLogin,
  logout,
  rotate,
  createStaff,
  switchBranch,
  resetStaffPassword,
  publicActor,
  assertAssignableRole,
} from './auth.js';
import { createOrder, confirmOrder, cancelOrder, accessOrder, accessTab, unit } from './orders.js';
import { capturePayment, receiveManual, tabBalance } from './payments.js';
import {
  ticketDocument,
  redeemTicket,
  deliverOrderTickets,
  requestTicket,
  claimRequest,
  cancelRequest,
  reprintTicket,
  advanceProduction,
} from './tickets.js';
import {
  publicUnit,
  createVisitor,
  createCounterVisitor,
  sessionDetails,
  tableAttendance,
  deleteTable,
  createTab,
  joinTab,
  checkoutTable,
  tableClosingReview,
  finalizeTable,
  releaseTable,
  transferOrder,
} from './tables.js';
import {
  dashboard,
  inventoryAdjustment,
  openCash,
  listCashSessions,
  closeCash,
  cashMovement,
  discount,
  createAgent,
  sanitizeRow,
} from './admin.js';
import {
  claimPrint,
  finishPrint,
  retryPrint,
  printJobDocument,
  cancelPrint,
  cancelPrintQueue,
  printJobState,
} from './printing.js';
import { registerSaas } from './saas.js';
import { registerSaasPublic } from './saas-public.js';
import { setupRealtime } from './realtime.js';

const reason = z.string().min(3).max(255);
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const idBody = strict({ order_id: uuid });
export async function buildApp(options: { realtime?: boolean; logger?: boolean } = {}) {
  const app = Fastify({
    trustProxy: trustedProxyAddresses(env.TRUSTED_PROXIES),
    logger:
      options.logger !== false
        ? {
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body',
              'res.headers.set-cookie',
            ],
            serializers: {
              req: (request: Row) => ({
                method: request.method,
                ip: request.ip,
                url: String(request.url).startsWith('/api/v1/complements/mercadopago/callback')
                  ? '/api/v1/complements/mercadopago/callback'
                  : request.url,
              }),
            },
          }
        : false,
    bodyLimit: 128 * 1024,
    requestIdHeader: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(','),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Signature',
      'X-Timestamp',
      'X-Mesa-Establishment',
    ],
  });
  await app.register(helmet);
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/v1/') && !reply.hasHeader('Cache-Control'))
      reply.header('Cache-Control', 'no-store, private');
    return payload;
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Bar SaaS API',
        version: '1.0.0',
        description: 'Operações financeiras e de estoque exigem Idempotency-Key. MySQL 8.4.',
      },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  });
  await app.register(swaggerUI, { routePrefix: '/docs' });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Dados inválidos.',
          details: error.issues,
          correlation_id: request.id,
        },
      });
    const e = error as any;
    const cause = e.cause ?? e;
    let status = e.status ?? e.statusCode ?? 500;
    let code = e.code ?? 'INTERNAL_ERROR';
    let message = e.message;
    if (cause.code === 'ER_DUP_ENTRY') {
      status = 409;
      code = 'CONFLICT';
      message = 'Registro ou operação já existente.';
    }
    if (['ER_NO_REFERENCED_ROW_2', 'ER_CHECK_CONSTRAINT_VIOLATED'].includes(cause.code)) {
      status = 409;
      code = 'CONFLICT';
      message = 'Referência inválida ou regra de integridade violada.';
    }
    if (status === 400) code = 'BAD_REQUEST';
    if (status >= 500) {
      request.log.error(
        { error: { code: cause.code, message: 'Falha interna' } },
        'Falha na operação',
      );
      message = 'Erro interno. Informe o identificador de correlação.';
      code = 'INTERNAL_ERROR';
    }
    reply.code(status).send({ error: { code, message, correlation_id: request.id } });
  });
  const token = (req: FastifyRequest) => req.headers.authorization?.replace(/^Bearer /i, '') ?? '';
  const expectedUnit = (req: FastifyRequest) =>
    req.headers['x-mesa-establishment'] === undefined
      ? undefined
      : uuid.parse(req.headers['x-mesa-establishment']);
  const actor = async (req: FastifyRequest) => {
    const a = await authenticate(token(req));
    ensure(
      !expectedUnit(req) || a.establishmentId === expectedUnit(req),
      'FORBIDDEN',
      'Esta sessão pertence a outro estabelecimento.',
      403,
    );
    return a;
  };
  const id = (req: FastifyRequest) => uuid.parse((req.params as Row).id);
  const key = (req: FastifyRequest) =>
    z.string().min(8).max(128).parse(req.headers['idempotency-key']);
  type Handler = (s: Scope, input: any, req: FastifyRequest) => Promise<any>;
  function route(
    method: HTTPMethods,
    path: string,
    permission: Permission | null,
    body: z.ZodType | null,
    handler: Handler,
    mutation = method !== 'GET',
  ) {
    app.route({
      method,
      ...(['/settings/pwa', '/products', '/products/:id'].includes(path)
        ? { bodyLimit: 2100000 }
        : {}),
      url: `/api/v1${path}`,
      schema: {
        tags: [path.split('/')[1]],
        security: [{ bearerAuth: [] }],
        ...(body
          ? { body: z.toJSONSchema(body, { unrepresentable: 'any', target: 'draft-7' }) as any }
          : {}),
        ...(mutation
          ? {
              headers: {
                type: 'object',
                required: ['idempotency-key'],
                properties: { 'idempotency-key': { type: 'string', minLength: 8, maxLength: 128 } },
              },
            }
          : {}),
      },
      handler: async (req) => {
        const a = await actor(req);
        if (
          !path.startsWith('/print/jobs') &&
          !['/print/station', '/print/station/heartbeat'].includes(path)
        )
          ensure(['STAFF', 'VISITOR'].includes(a.kind), 'FORBIDDEN', 'Perfil não autorizado.', 403);
        if (permission) permit(a, permission);
        const input = body ? body.parse(req.body) : {};
        if (mutation)
          return atomic(
            a,
            key(req),
            `${method}:${path}`,
            { params: req.params, body: input },
            (s) => {
              if (permission) permit(s.actor, permission);
              return handler(s, input, req);
            },
            [
              '/establishments',
              '/account/users/:id/branches',
              '/staff/:id',
              '/staff/:id/password',
            ].includes(path)
              ? 'tenant'
              : 'unit',
          );
        return handler(view(a), input, req);
      },
    });
  }
  let realtimeReady = () => true;
  registerComplements(app, { route, actor, key });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      ensure(realtimeReady(), 'INTERNAL_ERROR', 'Redis indisponível.', 503);
      await rows(db, sql`SELECT 1`);
      return { status: 'ready', database: 'mysql' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.get('/api/v1/openapi.json', async () => app.swagger());
  app.get('/api/v1/auth/establishments', async () => publicAccounts());
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) =>
      login(
        strict({
          email: z.email().max(190),
          password: z.string().min(1).max(200),
          establishment_slug: z.string().max(80),
        }).parse(req.body),
        expectedUnit(req),
      ),
  );
  app.post(
    '/api/v1/auth/account-login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) =>
      accountLogin(
        strict({
          email: z.email().max(190),
          password: z.string().min(1).max(200),
          establishment_slug: z.string().max(80),
        }).parse(req.body),
        expectedUnit(req),
      ),
  );
  app.post('/api/v1/auth/refresh', async (req) =>
    rotate(
      strict({ refresh_token: z.string().min(32).max(100) }).parse(req.body).refresh_token,
      expectedUnit(req),
    ),
  );
  app.post('/api/v1/auth/logout', async (req) => {
    if (expectedUnit(req)) await actor(req);
    return logout(token(req));
  });
  app.get('/api/v1/me', async (req) => actor(req));
  // Authentication responses are never stored in generic idempotency records.
  app.post(
    '/api/v1/auth/switch-branch',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const source = await actor(req);
      const input = strict({ establishment_id: uuid }).parse(req.body);
      return reply
        .header('Cache-Control', 'no-store')
        .send(await switchBranch(source, input.establishment_id));
    },
  );
  await registerSaasPublic(app);
  await registerSaas(route);
  route('GET', '/finance/context', null, null, async (s) => financeContext(s));
  route('GET', '/finance/dashboard', null, null, async (s, _b, req) =>
    financeDashboard(s, req.query),
  );
  route('GET', '/finance/records', null, null, async (s, _b, req) => financeRecords(s, req.query));
  route('GET', '/dashboard', 'reports.view', null, async (s) => dashboard(s));
  route('GET', '/dashboard/overview', 'reports.view', null, async (s, _b, req) =>
    dashboardOverview(s, req.query),
  );
  route('GET', '/push/context', null, null, (s) => ownPushContext(s));
  route('GET', '/push/settings', null, null, (s) => pushConfiguration(s));
  route('PATCH', '/push/settings', null, pushSettingsSchema, (s, b) => updatePushSettings(s, b));
  route('POST', '/push/subscriptions', null, subscriptionSchema, (s, b, req) =>
    registerPush(s, b, token(req), req.headers.origin),
  );
  route('DELETE', '/push/subscriptions/:id', null, null, (s, _b, req) => removeOwnPush(s, id(req)));
  route('GET', '/push/devices', null, null, (s, _b, req) => pushDevices(s, req.query));
  route('POST', '/push/devices/:id/disable', null, null, (s, _b, req) =>
    disablePushDevice(s, id(req)),
  );
  route('POST', '/push/subscriptions/:id/test', null, null, (s, _b, req) => testPush(s, id(req)));

  const paperQuery = strict({
    paper_width: z.coerce
      .number()
      .pipe(z.union([z.literal(58), z.literal(80)]))
      .default(80),
  });
  for (const [resource, kind] of [
    ['orders', 'ORDER'],
    ['tabs', 'TAB'],
  ] as const) {
    route('GET', `/${resource}/:id/receipt`, 'table.view', null, async (s, _b, req) =>
      receiptDocument(s, kind, id(req), paperQuery.parse(req.query).paper_width),
    );
    route(
      'POST',
      `/${resource}/:id/receipt/print`,
      'table.view',
      strict({
        printer_id: uuid,
        paper_width: z.union([z.literal(58), z.literal(80)]).default(80),
      }),
      async (s, b, req) => queueReceipt(s, kind, id(req), b),
    );
    app.get(`/api/v1/${resource}/:id/receipt.pdf`, async (req, reply) => {
      const a = await actor(req);
      const paper = paperQuery.parse(req.query).paper_width;
      const document = await receiptDocument(view(a), kind, id(req), paper);
      const pdf = await receiptPdf(document);
      return reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="cupom-${kind === 'ORDER' ? 'pedido' : 'comanda'}-${id(req).slice(0, 8)}-${paper}mm.pdf"`,
        )
        .header('Cache-Control', 'no-store, private')
        .send(pdf);
    });
  }
  route('GET', '/receipts/printers', 'table.view', null, async (s) => printerAvailability(s));
  route('GET', '/receipts/jobs/:id', 'table.view', null, async (s, _b, req) => {
    const job = await s.get('print_jobs', id(req));
    ensure(job.document_kind === 'RECEIPT', 'NOT_FOUND', 'Cupom não encontrado.', 404);
    return { id: job.id, status: job.status, attempts: job.attempts, last_error: job.last_error };
  });
  route('GET', '/tables/:id/qr', 'table.view', null, async (s, _b, req) =>
    tableQrDocument(s, id(req), tableQrQuery.parse(req.query).format),
  );
  route(
    'POST',
    '/tables/:id/qr/print',
    'table.view',
    strict({ printer_id: uuid, paper_width: z.union([z.literal(58), z.literal(80)]).default(80) }),
    async (s, b, req) => queueTableQr(s, id(req), b),
  );
  route('GET', '/tables/qr/jobs/:id', 'table.view', null, async (s, _b, req) => {
    const job = await s.get('print_jobs', id(req));
    ensure(job.document_kind === 'TABLE_QR', 'NOT_FOUND', 'QR da mesa não encontrado.', 404);
    return { id: job.id, status: job.status, attempts: job.attempts, last_error: job.last_error };
  });
  app.get('/api/v1/tables/:id/qr.pdf', async (req, reply) => {
    const a = await actor(req),
      document = await tableQrDocument(view(a), id(req), tableQrQuery.parse(req.query).format);
    return reply
      .type('application/pdf')
      .header('Cache-Control', 'no-store, private')
      .header(
        'Content-Disposition',
        `attachment; filename="qr-mesa-${id(req).slice(0, 8)}-${document.format}.pdf"`,
      )
      .send(await tableQrPdf(document));
  });
  route('GET', '/tables', 'table.view', null, async (s) => {
    const [sessions, requests, attendance] = await Promise.all([
      rows(
        s.tx,
        sql`SELECT id,table_id,status,UNIX_TIMESTAMP(opened_at) opened_epoch FROM table_sessions WHERE ${s.where(sql`status<>'CLOSED'`)}`,
      ),
      tableRequestCounts(s),
      tableAttendance(s),
    ]);
    const sessionByTable = new Map(sessions.map((item) => [item.table_id, item]));
    const requestsByTable = new Map(requests.map((item) => [item.table_id, item]));
    return (await s.list('dining_tables', sql`deleted_at IS NULL`)).map((table) => {
      const session = sessionByTable.get(table.id),
        requests = requestsByTable.get(table.id);
      return {
        ...table,
        status: session?.status ?? 'FREE',
        session_id: session?.id ?? null,
        opened_at_iso: session ? new Date(Number(session.opened_epoch) * 1000).toISOString() : null,
        attendance: session ? (attendance.get(session.id) ?? null) : null,
        service_request_count: Number(requests?.pending_requests ?? 0),
        unclaimed_request_count: Number(requests?.unclaimed_requests ?? 0),
      };
    });
  });
  route('DELETE', '/tables/:id', 'table.manage', null, (s, _b, req) => deleteTable(s, id(req)));
  route('GET', '/tables/:id/session', null, null, async (s, _b, req) => sessionDetails(s, id(req)));
  route('POST', '/tables/:id/open', 'order.create', null, async (s, _b, req) => {
    const table = await s.get('dining_tables', id(req));
    ensure(!table.deleted_at && table.enabled, 'NOT_FOUND', 'Mesa indisponível.', 404);
    return { table_id: table.id, status: 'AWAITING_FIRST_ORDER' };
  });
  route('GET', '/tables/:id/closing-review', 'table.view', null, async (s, _b, req) =>
    tableClosingReview(s, id(req)),
  );
  route(
    'POST',
    '/tables/:id/finalize',
    'table.release',
    strict({ session_id: uuid }),
    async (s, b, req) => finalizeTable(s, id(req), b.session_id),
  );
  route('POST', '/tables/:id/checkout', 'payment.receive', null, async (s, _b, req) =>
    checkoutTable(s, id(req)),
  );
  route('POST', '/tables/:id/release', 'table.release', null, async (s, _b, req) =>
    releaseTable(s, id(req)),
  );
  route('POST', '/tables/:id/reopen', 'payment.receive', null, async (s, _b, req) => {
    const sessions = await s.list(
      'table_sessions',
      sql`table_id=${id(req)} AND status IN ('CLOSING','AWAITING_RELEASE')`,
    );
    ensure(sessions.length, 'INVALID_STATE', 'Mesa não está em fechamento.');
    await s.update('table_sessions', sessions[0].id, {
      status: 'OPEN',
      version: sessions[0].version + 1,
    });
    for (const tab of await s.list('tabs', sql`session_id=${sessions[0].id}`))
      await s.update('tabs', tab.id, { status: 'OPEN' });
    await s.audit('table.reopened', sessions[0].id);
    await s.event('table.updated', sessions[0].id);
    return { status: 'OPEN' };
  });
  route('GET', '/tabs/:id', null, null, async (s, _b, req) => {
    if (s.actor.kind === 'STAFF') permit(s.actor, 'table.view');
    const tab = await accessTab(s, id(req));
    const assignments = await s.list('order_item_assignments', sql`tab_id=${tab.id}`);
    const items = [];
    for (const assignment of assignments)
      items.push(await s.get('order_items', assignment.order_item_id));
    return {
      ...tab,
      financial: await tabBalance(s, tab.id),
      orders: await s.list('orders', sql`tab_id=${tab.id}`),
      items,
    };
  });
  route(
    'POST',
    '/tabs',
    null,
    strict({
      session_id: uuid,
      mode: z.enum(['SHARED', 'INDIVIDUAL']),
      label: z.string().min(1).max(100),
    }),
    async (s, b) => createTab(s, b),
  );
  route('POST', '/tabs/:id/join', null, null, async (s, _b, req) => joinTab(s, id(req)));
  route(
    'POST',
    '/tabs/:id/transfer-items',
    'tab.transfer',
    strict({
      order_id: uuid.optional(),
      item_ids: z.array(uuid).min(1).max(100).optional(),
      target_tab_id: uuid,
    }),
    async (s, b, req) => {
      ensure(
        Boolean(b.order_id) !== Boolean(b.item_ids),
        'BAD_REQUEST',
        'Informe order_id ou item_ids, exclusivamente.',
        400,
      );
      return transferOrder(s, id(req), b);
    },
  );
  route(
    'POST',
    '/tabs/:id/discount',
    'order.discount',
    strict({ amount, reason }),
    async (s, b, req) => discount(s, id(req), b),
  );
  route('GET', '/orders/counter/cash-sessions', 'order.create', null, async (s) =>
    counterCashSessions(s),
  );
  route('POST', '/orders/counter', 'order.create', counterOrderInput, async (s, b) =>
    createCounterOrder(s, b),
  );
  route('POST', '/orders', null, orderInput, async (s, b) => createOrder(s, b));
  route('GET', '/orders', 'table.view', null, async (s) => (await operationContext(s)).orders);
  route('GET', '/orders/:id', null, null, async (s, _b, req) => {
    if (s.actor.kind === 'STAFF') permit(s.actor, 'table.view');
    const order = await accessOrder(s, id(req));
    const context = await operationContext(s);
    return {
      ...order,
      ...context.orders.find((row) => row.id === order.id),
      items: await s.list('order_items', sql`order_id=${order.id}`),
      tickets:
        s.actor.kind === 'VISITOR' ||
        (s.actor.kind === 'STAFF' && s.actor.permissions.includes('ticket.view'))
          ? context.tickets.filter((ticket) => ticket.order_id === order.id)
          : [],
    };
  });
  route('GET', '/orders/:id/cancellation-context', 'order.cancel', null, async (s, _b, req) =>
    orderCancellationContext(s, id(req)),
  );
  route('POST', '/orders/:id/confirm', null, null, async (s, _b, req) => confirmOrder(s, id(req)));
  route('POST', '/orders/:id/cancel', 'order.cancel', strict({ reason }), async (s, b, req) =>
    cancelOrder(s, id(req), b.reason),
  );
  route('POST', '/orders/:id/deliver-tickets', 'ticket.redeem', strict({}), async (s, _b, req) =>
    deliverOrderTickets(s, id(req)),
  );
  route('GET', '/tickets', 'ticket.view', null, async (s) => (await operationContext(s)).tickets);
  route(
    'POST',
    '/tickets/resolve',
    'ticket.redeem',
    strict({ token: z.string().min(32).max(200) }),
    async (s, b) => {
      const matches = await s.list('tickets', sql`token_hash=${hash(b.token)}`);
      ensure(matches.length, 'NOT_FOUND', 'Ficha não encontrada.', 404);
      return ticketDocument(s, matches[0].id);
    },
    false,
  );
  route('GET', '/tickets/:id', null, null, async (s, _b, req) => ticketDocument(s, id(req)));
  route(
    'POST',
    '/tickets/:id/redeem',
    'ticket.redeem',
    strict({ token: z.string().min(32).max(200) }),
    async (s, b, req) => redeemTicket(s, id(req), b.token),
  );
  route('POST', '/tickets/:id/request', null, null, async (s, _b, req) =>
    requestTicket(s, id(req)),
  );
  route('POST', '/tickets/:id/reprint', 'ticket.reprint', strict({ reason }), async (s, b, req) =>
    reprintTicket(s, id(req), b.reason),
  );
  route('GET', '/service-requests', 'ticket.redeem', null, async (s) => {
    return (await operationContext(s)).requests;
  });
  route('POST', '/service-requests/:id/claim', 'ticket.redeem', null, async (s, _b, req) =>
    claimRequest(s, id(req)),
  );
  route('POST', '/service-requests/:id/cancel', null, null, async (s, _b, req) =>
    cancelRequest(s, id(req)),
  );
  app.post('/api/v1/payments/intents', paymentHttpSchema(idBody), async (req) => {
    const current = await actor(req),
      input = idBody.parse(req.body);
    return paymentCheckout(current, key(req), input.order_id);
  });
  route('GET', '/catalog/operational', 'order.create', null, async (s) => {
    const settings = await unit(s);
    const [products, categories, variants, groups, modifiers, links] = await Promise.all([
      s.list('products', sql`enabled=TRUE`),
      s.list('categories'),
      s.list('product_variants', sql`enabled=TRUE AND deleted_at IS NULL`),
      s.list('modifier_groups'),
      s.list('modifiers', sql`enabled=TRUE`),
      s.list('product_modifiers'),
    ]);
    return {
      ...visibleSaleCatalog(
        await saleStockCatalog(s, products, variants),
        settings.show_out_of_stock,
      ),
      categories,
      modifier_groups: groups,
      modifiers,
      product_modifiers: links,
      payment_mode: settings.payment_mode,
      establishment: {
        ...businessAvailability({
          is_open: settings.is_open,
          opening_hours: settings.opening_hours,
        }),
      },
    };
  });
  route(
    'GET',
    '/products/operational',
    'order.create',
    null,
    async (s) =>
      visibleSaleCatalog(
        await saleStockCatalog(
          s,
          await s.list('products', sql`enabled=TRUE`),
          await s.list('product_variants', sql`enabled=TRUE AND deleted_at IS NULL`),
        ),
        (await unit(s)).show_out_of_stock,
      ).products,
  );
  route(
    'GET',
    '/payments/:id',
    'payment.receive',
    null,
    async (s, _b, req) => (await paymentOverview(s, id(req)))[0],
  );
  route('GET', '/payments', 'payment.receive', null, async (s) => paymentOverview(s));
  route(
    'POST',
    '/payments/manual',
    'payment.receive',
    strict({
      method: z.enum(['CASH', 'CARD_MANUAL', 'PIX_MANUAL']),
      allocations: z
        .array(strict({ tab_id: uuid, amount }))
        .min(1)
        .max(100),
      cash_session_id: uuid.optional(),
    }),
    async (s, b) => receiveManual(s, b),
  );
  app.post(
    '/api/v1/payments/:id/refund',
    paymentHttpSchema(
      strict({ amount, tab_id: uuid.optional(), reason, cash_session_id: uuid.optional() }),
    ),
    async (req) => {
      const current = await actor(req);
      permit(current, 'payment.refund');
      const input = strict({
        amount,
        tab_id: uuid.optional(),
        reason,
        cash_session_id: uuid.optional(),
      }).parse(req.body);
      return paymentRefund(current, key(req), id(req), input);
    },
  );
  const gatewaySchema = strict({
    event_id: z.string().min(8).max(128),
    reference: z.string().min(8).max(100),
    amount,
    status: z.enum(['APPROVED', 'FAILED']),
    settled: z.boolean().default(false),
  });
  app.post('/api/v1/webhooks/payments/:provider', async (req) => {
    ensure(
      (req.params as Row).provider === 'sandbox' && env.PAYMENT_WEBHOOK_SECRET,
      'FORBIDDEN',
      'Provedor não configurado.',
      403,
    );
    const timestamp = z
      .string()
      .regex(/^\d{10}$/)
      .parse(req.headers['x-timestamp']);
    ensure(
      Math.abs(Date.now() / 1000 - Number(timestamp)) < 300,
      'UNAUTHORIZED',
      'Webhook expirado.',
      401,
    );
    // The provider signs the exact UTF-8 bytes (captured by the custom JSON parser below).
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    const expected = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    ensure(
      equalSecret(expected, String(req.headers['x-signature'] ?? '')),
      'UNAUTHORIZED',
      'Assinatura de webhook inválida.',
      401,
    );
    const event = gatewaySchema.parse(req.body);
    const intents = await rows(
      db,
      sql`SELECT e.* FROM payment_intents i JOIN establishments e ON e.tenant_id=i.tenant_id AND e.id=i.establishment_id WHERE i.provider='sandbox' AND i.provider_reference=${event.reference}`,
    );
    ensure(intents.length, 'NOT_FOUND', 'Referência não encontrada.', 404);
    return atomic(
      publicActor(intents[0]),
      `webhook:${event.event_id}`,
      'payment.webhook',
      event,
      (s) => capturePayment(s, event),
    );
  });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      (req as FastifyRequest & { rawBody: string }).rawBody = body as string;
      done(null, JSON.parse(body as string));
    } catch {
      done(new DomainError('BAD_REQUEST', 'JSON inválido.', 400));
    }
  });
  if (env.NODE_ENV !== 'production')
    route('POST', '/sandbox/pay', null, strict({ intent_id: uuid }), async (s, b) => {
      const intent = await s.get('payment_intents', b.intent_id);
      ensure(
        intent.provider === 'sandbox',
        'FORBIDDEN',
        'Pagamentos reais só podem ser confirmados pelo provedor.',
        403,
      );
      await accessOrder(s, intent.order_id);
      if (s.actor.kind === 'STAFF') permit(s.actor, 'payment.receive');
      return capturePayment(s, {
        event_id: `sandbox:${intent.id}`,
        reference: intent.provider_reference,
        amount: intent.amount,
        status: 'APPROVED',
        settled: true,
      });
    });
  route('GET', '/products/:id/management', null, null, async (s, _b, req) =>
    productManagement(s, id(req)),
  );
  route('GET', '/measurement-units', null, null, async () => measurementUnits);
  route('GET', '/inventory/catalog', 'inventory.view', null, async (s) => ({
    products: (await s.list('products')).map((p) => ({
      id: p.id,
      name: p.name,
      default_variant_name: p.default_variant_name,
      enabled: p.enabled,
      unit_code: p.unit_code,
      stock_policy: p.stock_policy,
      stock_location_id: p.stock_location_id,
    })),
    variants: (await s.list('product_variants')).map((v) => ({
      id: v.id,
      product_id: v.product_id,
      name: v.name,
      stock_mode: v.stock_mode,
      deleted_at: v.deleted_at,
    })),
    locations: await s.list('stock_locations'),
  }));
  route('POST', '/inventory/locations/:id/default', 'inventory.adjust', null, async (s, _b, req) =>
    makeDefaultStockLocation(s, id(req)),
  );
  route('DELETE', '/product-variants/:id', 'catalog.manage', null, async (s, _body, request) =>
    removeProductVariant(s, id(request)),
  );
  route('DELETE', '/recipe-items/:id', 'catalog.manage', null, async (s, _b, req) =>
    removeCatalogLink(s, 'recipe_items', id(req)),
  );
  route('DELETE', '/product-modifiers/:id', 'catalog.manage', null, async (s, _b, req) =>
    removeCatalogLink(s, 'product_modifiers', id(req)),
  );
  route(
    'POST',
    '/products/:id/initial-stock',
    'inventory.adjust',
    strict({
      location_id: uuid,
      quantity: z
        .string()
        .regex(/^\d{1,11}\.\d{3}$/)
        .default('0.000'),
      use_for_consumption: z.boolean().default(false),
    }),
    async (s, b, req) => initializeProductStock(s, id(req), b),
  );
  route(
    'POST',
    '/inventory/replenishments',
    'inventory.adjust',
    replenishmentSchema,
    async (s, b) => createReplenishment(s, b),
  );
  route('GET', '/inventory/replenishments', 'inventory.view', null, async (s, _b, req) =>
    replenishmentList(s, replenishmentQuery.parse(req.query)),
  );
  route('GET', '/inventory/replenishments/:id', 'inventory.view', null, async (s, _b, req) =>
    replenishmentDetail(s, id(req)),
  );
  route('GET', '/inventory/balances', 'inventory.view', null, async (s) =>
    s.list('stock_balances'),
  );
  route(
    'PATCH',
    '/stock-balances/:id/location',
    'inventory.adjust',
    strict({ location_id: uuid, version: z.number().int().positive() }),
    (s, b, req) => changeStockLocation(s, id(req), b),
  );
  route('GET', '/inventory/movements', 'inventory.view', null, async (s) =>
    s.list('stock_movements'),
  );
  route(
    'POST',
    '/inventory/adjustments',
    'inventory.adjust',
    strict({
      balance_id: uuid,
      quantity: z.string().regex(/^-?\d{1,11}\.\d{3}$/),
      type: z.enum(['PURCHASE', 'LOSS', 'ADJUSTMENT', 'COUNT']),
      reason,
    }),
    async (s, b) => inventoryAdjustment(s, b),
  );
  route('GET', '/production/jobs', 'production.manage', null, async (s) => productionContext(s));
  route(
    'POST',
    '/production/jobs/:id/status',
    'production.manage',
    strict({ status: z.enum(['PREPARING', 'READY']) }),
    async (s, b, req) => advanceProduction(s, id(req), b.status),
  );
  route('GET', '/cash/sessions', 'cash.manage', null, async (s) => listCashSessions(s));
  route('GET', '/cash/active', 'payment.receive', null, async (s) => activeCashSessions(s));
  route(
    'POST',
    '/cash/sessions',
    'cash.manage',
    strict({ register_id: uuid, opening_amount: amount }),
    async (s, b) => openCash(s, b),
  );
  route(
    'POST',
    '/cash/sessions/:id/close',
    'cash.manage',
    strict({ counted_amount: amount }),
    async (s, b, req) => closeCash(s, id(req), b.counted_amount),
  );
  route(
    'POST',
    '/cash/movements',
    'cash.manage',
    strict({ cash_session_id: uuid, type: z.enum(['WITHDRAWAL', 'SUPPLY']), amount, reason }),
    async (s, b) => cashMovement(s, b),
  );
  route('GET', '/appearance', null, null, async (s) => {
    const appearance = await unit(s);
    return { primary_color: appearance.primary_color, sidebar_color: appearance.sidebar_color };
  });
  await registerPwa(app);
  registerProductPhotos(app);
  route('GET', '/settings/pwa', 'settings.update', null, async (s) => pwaSettings(s));
  route('PATCH', '/settings/pwa', 'settings.update', pwaSettingsSchema, async (s, b) =>
    updatePwaSettings(s, b),
  );
  route('GET', '/settings', 'settings.update', null, async (s) => unit(s));
  route('GET', '/operation/control', null, null, async (s) => operationControl(s));
  route('PATCH', '/operation/control', 'settings.update', operationControlSchema, async (s, b) =>
    updateOperationControl(s, b),
  );
  route('POST', '/operation/cash/rotate', 'cash.manage', rotateControlCashSchema, async (s, b) =>
    rotateOperationCash(s, b),
  );
  route('POST', '/operation/cash/open', 'cash.manage', openControlCashSchema, async (s, b) =>
    openOperationCash(s, b),
  );
  route(
    'PATCH',
    '/settings',
    'settings.update',
    strict({
      primary_color: z
        .string()
        .length(7)
        .regex(/^#[0-9a-fA-F]{6}$/)
        .transform((value) => value.toLowerCase())
        .optional(),
      sidebar_color: z
        .string()
        .length(7)
        .regex(/^#[0-9a-fA-F]{6}$/)
        .transform((value) => value.toLowerCase())
        .optional(),
      name: z.string().trim().min(1).max(160).optional(),
      business_profile: businessProfilePatchSchema.optional(),
      payment_mode: z.enum(['MIXED', 'PREPAID_ONLY', 'POSTPAID_ONLY']).optional(),
      is_open: z.boolean().optional(),
      postpaid_limit: amount.optional(),
      visitor_ttl_minutes: z.number().int().min(10).max(1440).optional(),
      retention_days: z.number().int().min(30).max(3650).optional(),
      opening_hours: z
        .union([
          businessHoursSchema,
          z
            .record(z.string(), z.string().max(160))
            .refine(
              (value) => !['enabled', 'timezone', 'days'].some((key) => key in value),
              'Configuração de horários inválida.',
            ),
        ])
        .optional(),
      show_out_of_stock: z.boolean().optional(),
    }),
    async (s, b) => {
      const previous = await lockCashUnit(s);
      const patch = {
        ...b,
        ...(b.business_profile
          ? {
              business_profile: {
                ...readBusinessProfile(previous.business_profile),
                ...b.business_profile,
              },
            }
          : {}),
      };
      const sets = Object.entries(patch).map(
        ([k, v]) => sql`${sql.identifier(k)}=${typeof v === 'object' ? JSON.stringify(v) : v}`,
      );
      ensure(sets.length, 'BAD_REQUEST', 'Configuração vazia.', 400);
      await s.tx.execute(
        sql`UPDATE establishments SET ${sql.join(sets, sql`, `)} WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
      );
      const address =
        b.name !== undefined
          ? await assignSlug(s.tx, s.actor.tenantId, s.actor.establishmentId, b.name)
          : null;
      if (address && address.previous_slug !== address.slug)
        await s.audit('establishment.slug_updated', s.actor.establishmentId, {
          previous_name: previous.name,
          name: b.name,
          ...address,
        });
      await s.audit('settings.updated', s.actor.establishmentId, { fields: Object.keys(b) });
      await s.event('settings.updated', s.actor.establishmentId, { fields: Object.keys(b) });
      return unit(s);
    },
  );
  route('GET', '/roles', 'staff.manage', null, async (s) => roleAccessSurfaces(s));
  route(
    'POST',
    '/roles',
    'staff.manage',
    strict({
      name: z.string().min(1).max(80),
      permissions: z.array(z.enum(permissions)).max(permissions.length),
    }),
    async (s, b) => {
      ensure(
        b.permissions.every((p: string) => s.actor.permissions.includes(p)),
        'FORBIDDEN',
        'Você não pode conceder permissões que não possui.',
        403,
      );
      const role = await s.insert('roles', { name: b.name });
      for (const p of new Set(b.permissions)) {
        const grants = await rows(s.tx, sql`SELECT id FROM permissions WHERE code=${p}`);
        ensure(grants.length, 'INVALID_STATE', 'Permissões não provisionadas.');
        await s.insert('role_permissions', { role_id: role.id, permission_id: grants[0].id });
      }
      await s.audit('role.created', role.id);
      return role;
    },
  );
  route('GET', '/staff', 'staff.manage', null, async (s, _b, req) => teamMembers(s, req.query));
  route(
    'POST',
    '/staff',
    'staff.manage',
    strict({
      name: z.string().min(1).max(160),
      email: z.email().max(190),
      password: z.string().min(12).max(200),
      role_id: uuid,
    }),
    async (s, b) => createStaff(s, b),
  );
  route(
    'PATCH',
    '/staff/:id',
    'staff.manage',
    strict({ enabled: z.boolean(), role_id: uuid.optional() }),
    async (s, b, req) => {
      const member = await s.get('staff_memberships', id(req));
      ensure(member.user_id !== s.actor.id, 'INVALID_STATE', 'Não altere seu próprio vínculo.');
      if (b.role_id) await assertAssignableRole(s, b.role_id);
      await s.update('staff_memberships', member.id, b);
      if (Boolean(member.enabled) !== b.enabled || (b.role_id && b.role_id !== member.role_id))
        await s.tx.execute(
          sql`UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${s.actor.establishmentId} AND user_id=${member.user_id} AND revoked_at IS NULL`,
        );
      await s.audit('staff.updated', member.id, b);
      await s.event('staff.updated', member.id, { user_id: member.user_id });
      return { id: member.id, ...b };
    },
  );
  route(
    'POST',
    '/staff/:id/password',
    'staff.manage',
    strict({ password: z.string().min(12).max(200) }),
    async (s, b, req) => resetStaffPassword(s, id(req), b.password),
  );
  // Agent credentials are returned once and excluded from persisted idempotency responses.
  app.post('/api/v1/print/agents', async (req) => {
    const a = await actor(req);
    permit(a, 'print.manage');
    const b = strict({
      name: z.string().min(1).max(100),
      transport: z.enum(['TCP', 'PRINTBRIDGE']).optional(),
    }).parse(req.body);
    let issued: string | undefined;
    const result = await atomic(a, key(req), 'print.agent.create', b, async (s) => {
      const agent = await createAgent(s, b.name, b.transport);
      issued = agent.token;
      return { id: agent.id, name: agent.name };
    });
    return { ...result, token: issued ?? null };
  });
  route('GET', '/print/station', null, null, async (s) => stationDetails(s));
  route('POST', '/print/station/heartbeat', null, stationHeartbeatSchema, async (s, b) =>
    stationHeartbeat(s, b),
  );
  route('GET', '/print/stations', 'print.manage', null, async (s) => printStations(s));
  route(
    'PATCH',
    '/print/agents/:id',
    'print.manage',
    strict({ enabled: z.boolean() }),
    async (s, b, req) => updatePrintAgent(s, id(req), b),
  );
  route(
    'POST',
    '/print/jobs/claim',
    null,
    strict({ printer_ids: z.array(uuid).min(1).max(50).optional() }),
    async (s, b) => {
      const job = await claimPrint(s, b.printer_ids);
      if ('document' in job) {
        const {
          document: _doc,
          receipt_snapshot: _snapshot,
          table_qr_snapshot: _tableQr,
          bridge_delivery: _bridge,
          ...safe
        } = job;
        return safe;
      }
      return job;
    },
  );
  // Read the document after claim so the token is never stored in an idempotency record.
  route('GET', '/print/jobs/:id/document', null, null, async (s, _b, req) => {
    ensure(s.actor.kind === 'AGENT', 'FORBIDDEN', 'Agente necessário.', 403);
    const job = await s.get('print_jobs', id(req));
    ensure(
      job.agent_id === s.actor.id && job.status === 'PROCESSING',
      'FORBIDDEN',
      'Job de outro agente.',
      403,
    );
    return printJobDocument(s, job);
  });
  route(
    'POST',
    '/print/jobs/:id/finish',
    null,
    strict({ success: z.boolean(), error: z.string().max(255).optional() }),
    async (s, b, req) => finishPrint(s, id(req), b),
  );
  route(
    'POST',
    '/print/jobs/:id/retry',
    'print.manage',
    strict({ reason: reason.optional() }),
    async (s, b, req) => retryPrint(s, id(req), b.reason),
  );
  const printCancelBody = strict({ reason: z.string().trim().max(255).optional() });
  route('POST', '/print/jobs/cancel', 'print.manage', printCancelBody, async (s, b) =>
    cancelPrintQueue(s, b.reason),
  );
  route('POST', '/print/jobs/:id/cancel', 'print.manage', printCancelBody, async (s, b, req) =>
    cancelPrint(s, id(req), b.reason),
  );
  route('GET', '/print/jobs/:id/state', null, null, async (s, _b, req) =>
    printJobState(s, id(req)),
  );
  route(
    'POST',
    '/print/jobs/:id/bridge/prepare',
    null,
    strict({
      origin: z
        .string()
        .max(200)
        .refine((v) => {
          try {
            const u = new URL(v);
            return (
              u.origin === v &&
              (u.protocol === 'https:' ||
                (u.protocol === 'http:' &&
                  ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
            );
          } catch {
            return false;
          }
        }, 'Origem inválida.'),
      printer_id: z.string().min(1).max(500),
      format: z.enum(['pdf', 'escpos']),
      paper_width: z.union([z.literal(58), z.literal(80)]),
    }),
    async (s, b, req) => prepareBridge(s, id(req), b),
  );
  route(
    'POST',
    '/print/jobs/:id/bridge/status',
    null,
    strict({
      generation: uuid,
      job_id: z.string().min(1).max(128).optional(),
      state: z.enum(['queued', 'processing', 'submitted', 'failed', 'unknown']),
      error: z.string().max(255).optional(),
    }),
    async (s, b, req) => reportBridge(s, id(req), b),
  );
  app.get('/api/v1/print/jobs/:id/bridge/document', async (req, reply) => {
    const a = await actor(req);
    const generation = strict({ generation: uuid }).parse(req.query).generation;
    const document = await bridgePayload(view(a), id(req), generation);
    return reply
      .header('Cache-Control', 'no-store, private')
      .type(document.contentType)
      .send(document.data);
  });
  // Generic administration only uses this fixed resource/schema allowlist. Composite FKs enforce references.
  const resources = [
    ['areas', 'areas', 'table.manage', strict({ name: z.string().min(1).max(100) })],
    [
      'tables',
      'dining_tables',
      'table.manage',
      strict({
        area_id: uuid.nullable().optional(),
        number: z.string().min(1).max(16),
        capacity: z.number().int().min(1).max(100),
        enabled: z.boolean().optional(),
        position_x: z.number().int().min(0).max(2000).optional(),
        position_y: z.number().int().min(0).max(2000).optional(),
        shape: z.enum(['square', 'round']).optional(),
      }),
    ],
    [
      'categories',
      'categories',
      'catalog.manage',
      strict({
        name: z.string().min(1).max(100),
        sort_order: z.number().int().min(-2147483648).max(2147483647).optional(),
        color: z
          .string()
          .length(7)
          .regex(/^#[0-9a-fA-F]{6}$/)
          .transform((v) => v.toLowerCase())
          .nullable()
          .optional(),
      }),
    ],
    [
      'products',
      'products',
      'catalog.manage',
      strict({
        category_id: uuid.nullable().optional(),
        name: z.string().min(1).max(160),
        default_variant_name: z.string().trim().min(1).max(100).optional(),
        photo_base64: productPhotoSchema,
        unit_code: z.enum(measurementUnitCodes).optional(),
        description: z.string().max(2000).nullable().optional(),
        price: amount,
        enabled: z.boolean().optional(),
        stock_location_id: uuid.nullable().optional(),
        stock_policy: z.enum([
          'ON_CONFIRMATION',
          'ON_DELIVERY',
          'ON_PRODUCTION',
          'RECIPE',
          'NO_CONTROL',
        ]),
        requires_production: z.boolean().optional(),
        sector: z.string().min(1).max(40).optional(),
      }),
    ],
    [
      'product-variants',
      'product_variants',
      'catalog.manage',
      strict({
        stock_mode: z.enum(['SHARED', 'OWN']).optional(),
        stock_location_id: uuid.nullable().optional(),
        product_id: uuid,
        name: z.string().trim().min(1).max(100),
        price: amount,
        enabled: z.boolean().optional(),
      }),
    ],
    [
      'modifier-groups',
      'modifier_groups',
      'catalog.manage',
      strict({
        name: z.string().min(1).max(100),
        min_choices: z.number().int().min(0),
        max_choices: z.number().int().min(0).max(20),
      }),
    ],
    [
      'modifiers',
      'modifiers',
      'catalog.manage',
      strict({
        group_id: uuid,
        name: z.string().min(1).max(100),
        price: amount,
        enabled: z.boolean().optional(),
      }),
    ],
    [
      'product-modifiers',
      'product_modifiers',
      'catalog.manage',
      strict({ product_id: uuid, group_id: uuid }),
    ],
    [
      'availability-rules',
      'availability_rules',
      'catalog.manage',
      strict({
        product_id: uuid,
        weekday: z.number().int().min(0).max(6),
        start_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
        end_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
      }),
    ],
    [
      'stock-locations',
      'stock_locations',
      'inventory.adjust',
      strict({
        name: z.string().min(1).max(100),
        is_default: z.boolean(),
        color: z
          .string()
          .length(7)
          .regex(/^#[0-9a-fA-F]{6}$/)
          .transform((v) => v.toLowerCase())
          .nullable()
          .optional(),
      }),
    ],
    [
      'stock-balances',
      'stock_balances',
      'inventory.adjust',
      strict({ location_id: uuid, product_id: uuid, variant_id: uuid.nullable().optional() }),
    ],
    ['recipes', 'recipes', 'catalog.manage', strict({ product_id: uuid })],
    [
      'recipe-items',
      'recipe_items',
      'catalog.manage',
      strict({
        recipe_id: uuid,
        ingredient_id: uuid,
        quantity: z
          .string()
          .regex(/^\d{1,8}\.\d{3}$/)
          .refine((value) => Number(value) > 0, 'A quantidade deve ser maior que zero.'),
      }),
    ],
    [
      'printers',
      'printers',
      'print.manage',
      strict({
        name: z.string().min(1).max(100),
        sector: z.string().min(1).max(40),
        enabled: z.boolean().optional(),
      }),
    ],
    [
      'cash-registers',
      'cash_registers',
      'cash.manage',
      strict({ name: z.string().min(1).max(100) }),
    ],
    [
      'floor-layouts',
      'floor_layouts',
      'table.manage',
      strict({ name: z.string().min(1).max(100), layout_json: z.record(z.string(), z.unknown()) }),
    ],
  ] as const;
  for (const [path, table, permission, schema] of resources) {
    if (path !== 'tables')
      route('GET', `/${path}`, permission, null, async (s) =>
        (
          await s.list(table, path === 'product-variants' ? sql`deleted_at IS NULL` : undefined)
        ).map(sanitizeRow),
      );
    route('POST', `/${path}`, permission, schema, async (s, b) => {
      const { photo_base64: photo, ...productData } = b;
      const data =
        path === 'tables'
          ? { ...b, public_code: crypto.randomUUID() }
          : path === 'products'
            ? {
                ...productData,
                unit_code: b.unit_code ?? 'UN',
                default_variant_name: b.default_variant_name ?? 'Padrão',
              }
            : b;
      await validateCatalogResource(s, path, data);
      const record = await s.insert(table, data);
      if (path === 'products' && photo !== undefined) await saveProductPhoto(s, record.id, photo);
      await s.audit(`${path}.created`, record.id);
      await s.event(`${path}.updated`, record.id);
      return path === 'products' ? s.get(table, record.id) : record;
    });
    if (path !== 'stock-balances')
      route('PATCH', `/${path}/:id`, permission, schema.partial(), async (s, b, req) => {
        const current = await s.get(table, id(req));
        if (path === 'tables') ensure(!current.deleted_at, 'NOT_FOUND', 'Mesa excluída.', 404);
        await validateCatalogResource(s, path, b, current);
        ensure(Object.keys(b).length, 'BAD_REQUEST', 'Alteração vazia.', 400);
        const { photo_base64: photo, ...productData } = b;
        const data = path === 'products' ? productData : b;
        if (Object.keys(data).length) await s.update(table, id(req), data);
        if (path === 'products' && photo !== undefined) await saveProductPhoto(s, id(req), photo);
        await s.audit(`${path}.updated`, id(req), { fields: Object.keys(b) });
        await s.event(`${path}.updated`, id(req));
        return s.get(table, id(req));
      });
  }
  for (const [path, table, permission] of [
    ['cash/movements', 'cash_movements', 'cash.manage'],
    ['print/jobs', 'print_jobs', 'print.manage'],
    ['print/agents', 'print_agents', 'print.manage'],
    ['audit-logs', 'audit_logs', 'reports.view'],
  ] as const)
    route('GET', `/${path}`, permission, null, async (s) => (await s.list(table)).map(sanitizeRow));
  app.get('/api/v1/public/:slug/menu', async (req) => {
    const u = await publicUnit((req.params as Row).slug);
    const s = view(publicActor(u));
    const availability = businessAvailability({
      is_open: u.is_open,
      opening_hours: u.opening_hours,
    });
    return {
      establishment: {
        name: u.name,
        business_profile: readBusinessProfile(u.business_profile),
        slug: u.slug,
        is_open: availability.is_open,
        accepting_orders: Boolean(u.is_open),
        opening_hours: u.opening_hours,
        closed_reason: availability.message,
        show_out_of_stock: Boolean(u.show_out_of_stock),
        payment_mode: u.payment_mode,
        primary_color: u.primary_color,
      },
      categories: await s.list('categories'),
      ...visibleSaleCatalog(
        await saleStockCatalog(
          s,
          await s.list('products', sql`enabled=TRUE`),
          await s.list('product_variants', sql`enabled=TRUE AND deleted_at IS NULL`),
        ),
        u.show_out_of_stock,
      ),
      modifier_groups: await s.list('modifier_groups'),
      modifiers: await s.list('modifiers', sql`enabled=TRUE`),
      product_modifiers: await s.list('product_modifiers'),
    };
  });
  app.get('/api/v1/public/:slug/opening-hours', async (req) => {
    const u = await publicUnit((req.params as Row).slug);
    return {
      opening_hours: u.opening_hours,
      ...businessAvailability({ is_open: u.is_open, opening_hours: u.opening_hours }),
    };
  });
  app.get('/api/v1/public/:slug/tables/availability', async (req) => {
    const u = await publicUnit((req.params as Row).slug);
    const s = view(publicActor(u));
    const active = await s.list('table_sessions', sql`status<>'CLOSED'`);
    return (await s.list('dining_tables', sql`enabled=TRUE AND deleted_at IS NULL`)).map((t) => ({
      id: t.id,
      number: t.number,
      capacity: t.capacity,
      available: !active.some((a) => a.table_id === t.id),
    }));
  });
  app.post(
    '/api/v1/public/:slug/visitor-sessions',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) =>
      createVisitor(
        (req.params as Row).slug,
        strict({
          table_code: z.string().min(16).max(64),
          name: z.string().trim().min(2).max(160),
          phone: z.string().regex(/^\+?[\d ()-]{8,25}$/),
          join_code: z.string().max(32).optional(),
        }).parse(req.body),
      ),
  );
  app.post(
    '/api/v1/public/:slug/counter-sessions',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) =>
      createCounterVisitor(
        (req.params as Row).slug,
        strict({
          name: z.string().trim().min(2).max(80),
          phone: z.string().regex(/^\+?[\d ()-]{8,25}$/),
        }).parse(req.body),
        expectedUnit(req),
      ),
  );
  app.post(
    '/api/v1/public/:slug/tables/resolve',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const u = await publicUnit((req.params as Row).slug);
      ensure(
        !expectedUnit(req) || expectedUnit(req) === u.id,
        'FORBIDDEN',
        'Estabelecimento diferente do aplicativo.',
        403,
      );
      const body = strict({ table_code: z.string().min(16).max(64) }).parse(req.body);
      const s = view(publicActor(u));
      const found = await s.list(
        'dining_tables',
        sql`public_code=${body.table_code} AND enabled=TRUE AND deleted_at IS NULL`,
      );
      ensure(found.length, 'NOT_FOUND', 'QR de mesa inválido para este estabelecimento.', 404);
      return { id: found[0].id, number: found[0].number, table_code: found[0].public_code };
    },
  );
  route(
    'POST',
    '/public/counter/orders',
    null,
    strict({ items: orderInput.shape.items }),
    async (s, b) => {
      ensure(
        s.actor.kind === 'VISITOR' && s.actor.serviceMode === 'COUNTER',
        'FORBIDDEN',
        'Identifique-se para pedir para retirada.',
        403,
      );
      return createOrder(s, { source: 'CUSTOMER', payment_policy: 'PREPAID', items: b.items });
    },
  );
  route('POST', '/public/orders', null, orderInput, async (s, b) => {
    ensure(s.actor.kind === 'VISITOR', 'FORBIDDEN', 'Sessão de visitante necessária.', 403);
    return createOrder(s, b);
  });
  route('GET', '/my-tabs', null, null, async (s) => {
    ensure(s.actor.kind === 'VISITOR', 'FORBIDDEN', 'Sessão de cliente necessária.', 403);
    const links = await s.list('tab_customers', sql`customer_id=${s.actor.customerId}`);
    const tabs = [];
    for (const link of links) {
      const tab = await s.get('tabs', link.tab_id);
      tabs.push({ ...tab, financial: await tabBalance(s, tab.id) });
    }
    return tabs;
  });
  route('GET', '/my-consumption', null, null, async (s) => {
    ensure(s.actor.kind === 'VISITOR', 'FORBIDDEN', 'Sessão de cliente necessária.', 403);
    return s.list('orders', sql`customer_id=${s.actor.customerId}`);
  });
  route('GET', '/my-tickets', null, null, async (s) => {
    ensure(s.actor.kind === 'VISITOR', 'FORBIDDEN', 'Sessão de cliente necessária.', 403);
    const documents = [];
    for (const order of await s.list(
      'orders',
      sql`customer_id=${s.actor.customerId} AND status='CONFIRMED'`,
    ))
      for (const item of await s.list('order_items', sql`order_id=${order.id}`))
        for (const t of await s.list('tickets', sql`order_item_id=${item.id}`))
          documents.push(await ticketDocument(s, t.id));
    return documents;
  });
  if (options.realtime !== false) realtimeReady = await setupRealtime(app);
  return app;
}
