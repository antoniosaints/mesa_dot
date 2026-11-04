import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
/** Synthetic provider transport. Imported exclusively by automated tests, never by the API. */
export function fakeComplementProviders(approveOnSearch = false) {
  const calls: { url: URL; init: RequestInit; body: any }[] = [];
  const payments = new Map<string, any>();
  const preferences = new Map<string, any>();
  const refunds = new Map<string, any>();
  let sequence = Number(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)));
  let failGeneration = false;
  let generationBarrier: Promise<void> | undefined;
  let invalidImage = false;
  let mercadoBarrier: { path: string; promise: Promise<void> } | undefined;
  let failPaymentSearch = false;
  let failPreferenceAfterApply = false,
    failRefundAfterApply = false;
  const original = globalThis.fetch;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const transport: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (!['api.mercadopago.com', 'generativelanguage.googleapis.com'].includes(url.hostname))
      return original(input, init);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, init, body });
    const headers = new Headers(init.headers);
    if (url.hostname === 'generativelanguage.googleapis.com') {
      if (headers.get('x-goog-api-key')?.startsWith('invalid')) return json({ error: 'test' }, 403);
      if (url.pathname.endsWith('/models'))
        return json({
          models: [
            {
              name: 'models/gemini-3.8-flash',
              displayName: 'Gemini Flash de teste',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-test-pro',
              displayName: 'Gemini Pro de teste',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-3.1-flash-image',
              displayName: 'Gemini Imagem de teste',
              supportedGenerationMethods: ['generateContent'],
            },
            { name: 'models/embedding-test', supportedGenerationMethods: ['embedContent'] },
          ],
        });
      if (failGeneration) return json({ error: 'test quota' }, 429);
      if (generationBarrier) await generationBarrier;
      if (body.generationConfig?.responseModalities?.includes('IMAGE')) {
        const png = new PNG({ width: 4, height: 4 });
        for (let offset = 0; offset < png.data.length; offset += 4) {
          png.data[offset] = 22;
          png.data[offset + 1] = 121;
          png.data[offset + 2] = 238;
          png.data[offset + 3] = 255;
        }
        return json({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'Pensamento privado' },
                  { text: 'Ilustração de teste para revisão.' },
                  {
                    inlineData: {
                      mimeType: invalidImage ? 'image/svg+xml' : 'image/png',
                      data: PNG.sync.write(png).toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return json({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Pensamento privado', thought: true },
                {
                  text: String(body.contents?.at(-1)?.parts?.[0]?.text ?? '').startsWith(
                    'Crie somente',
                  )
                    ? 'Descrição sugerida: uma opção fresca e convidativa, conforme as informações fornecidas.'
                    : 'Resumo de teste: confira os recebimentos e as entregas na filial atual.',
                },
              ],
            },
          },
        ],
        usageMetadata: { totalTokenCount: 42 },
      });
    }
    if (mercadoBarrier && url.pathname === mercadoBarrier.path) await mercadoBarrier.promise;
    const account = headers.get('authorization')?.split('-').at(-1) || '123456';
    if (url.pathname === '/oauth/token') {
      const id =
        body.grant_type === 'refresh_token' ? body.refresh_token.split('-').at(-1) : body.code;
      return json({
        access_token: 'fake-access-token-' + id,
        refresh_token: 'fake-refresh-token-' + id,
        expires_in: 3600,
        user_id: Number(id),
      });
    }
    if (url.pathname === '/users/me')
      return json({ id: Number(account), nickname: 'Conta de homologação', site_id: 'MLB' });
    if (url.pathname === '/checkout/preferences/search') {
      return json({
        elements: [...preferences.entries()]
          .filter(
            ([, pref]) => pref.external_reference === url.searchParams.get('external_reference'),
          )
          .map(([id, pref]) => ({ id, ...pref })),
        total: preferences.size,
      });
    }
    if (url.pathname.startsWith('/checkout/preferences/'))
      return json(
        preferences.get(url.pathname.split('/').at(-1)!) ?? {},
        preferences.has(url.pathname.split('/').at(-1)!) ? 200 : 404,
      );
    if (url.pathname === '/checkout/preferences') {
      const id = String(++sequence);
      preferences.set(id, {
        ...body,
        id,
        collector_id: Number(account),
        init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=' + id,
        sandbox_init_point: 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=' + id,
      });
      payments.set(id, {
        id: Number(id),
        external_reference: body.external_reference,
        collector_id: Number(account),
        currency_id: 'BRL',
        transaction_amount: body.items[0].unit_price,
        transaction_amount_refunded: 0,
        status: 'pending',
        date_last_updated: '2026-10-30T10:00:00Z',
        refunds: [],
      });
      if (failPreferenceAfterApply) {
        failPreferenceAfterApply = false;
        throw new Error('synthetic connection lost after preference');
      }
      return json({
        id,
        init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=' + id,
        sandbox_init_point: 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=' + id,
      });
    }
    if (url.pathname === '/v1/payments/search') {
      if (failPaymentSearch) {
        failPaymentSearch = false;
        return json({ error: 'synthetic unavailable' }, 503);
      }
      const found = [...payments.values()].filter(
        (payment) => payment.external_reference === url.searchParams.get('external_reference'),
      );
      if (approveOnSearch) for (const payment of found) payment.status = 'approved';
      const offset = Number(url.searchParams.get('offset') ?? 0),
        limit = Number(url.searchParams.get('limit') ?? 50);
      return json({
        results: found.slice(offset, offset + limit),
        paging: { total: found.length, offset, limit },
      });
    }
    const match = url.pathname.match(/^\/v1\/payments\/(\d+)(\/refunds)?$/);
    if (match) {
      const payment = payments.get(match[1]);
      if (!payment) return json({}, 404);
      if (!match[2]) return json(payment);
      if (init.method === 'POST') {
        const key = headers.get('x-idempotency-key')!;
        if (!refunds.has(key)) {
          const refund = { id: ++sequence, amount: body.amount, status: 'approved' };
          refunds.set(key, refund);
          payment.refunds.push(refund);
          payment.transaction_amount_refunded += body.amount;
          payment.status =
            payment.transaction_amount_refunded === payment.transaction_amount
              ? 'refunded'
              : 'approved';
          payment.date_last_updated = new Date().toISOString();
        }
        if (failRefundAfterApply) {
          failRefundAfterApply = false;
          throw new Error('synthetic connection lost after refund');
        }
        return json(refunds.get(key));
      }
      return json(payment.refunds);
    }
    throw new Error('Unexpected synthetic provider request: ' + url.pathname);
  };
  return {
    transport,
    calls,
    payments,
    preferences,
    refunds,
    nextId: () => ++sequence,
    failNextPaymentSearch: () => {
      failPaymentSearch = true;
    },
    failNextPreferenceAfterApply: () => {
      failPreferenceAfterApply = true;
    },
    failNextRefundAfterApply: () => {
      failRefundAfterApply = true;
    },
    pauseMercado: (path: string) => {
      let release!: () => void;
      mercadoBarrier = {
        path,
        promise: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      return () => {
        mercadoBarrier = undefined;
        release();
      };
    },
    setInvalidImage: (value: boolean) => {
      invalidImage = value;
    },
    pauseGeneration: () => {
      let release: () => void;
      generationBarrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        generationBarrier = undefined;
        release();
      };
    },
    setFailGeneration: (value: boolean) => {
      failGeneration = value;
    },
  };
}
