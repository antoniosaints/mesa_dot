import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { pushFailure, pushSettingsSchema, pushEvents } from '../packages/shared/src/push.js';
import { sealPush, openPush } from '../packages/shared/src/push-crypto.js';
import { validatePushEndpoint } from '../apps/api/src/push.js';
it('remove apenas assinaturas expiradas e diferencia falhas transitórias de erros de configuração', () => {
  for (const code of [404, 410]) expect(pushFailure(code)).toBe('expired');
  for (const code of [undefined, 429, 500, 503]) expect(pushFailure(code)).toBe('retry');
  for (const code of [400, 401, 403, 413]) expect(pushFailure(code)).toBe('permanent');
});
it('rejeita endpoints privados, credenciais na URL, portas alternativas e domínios falsos', () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/a',
    'https://127.0.0.1/a',
    'https://192.168.1.2/a',
    'https://localhost/a',
    'https://fcm.googleapis.com.evil.test/a',
    'https://user@fcm.googleapis.com/a',
    'https://fcm.googleapis.com:8443/a',
  ])
    expect(() => validatePushEndpoint(endpoint)).toThrow();
  for (const endpoint of [
    'https://fcm.googleapis.com/send/a',
    'https://updates.push.services.mozilla.com/wpush/a',
    'https://web.push.apple.com/a',
  ])
    expect(() => validatePushEndpoint(endpoint)).not.toThrow();
});
it('criptografa as credenciais do dispositivo e detecta adulteração', () => {
  const value = { endpoint: 'https://fcm.googleapis.com/a', keys: { auth: 'private-auth' } },
    encoded = sealPush(value);
  expect(encoded).not.toContain('fcm.googleapis');
  expect(encoded).not.toContain('private-auth');
  expect(openPush(encoded)).toEqual(value);
  const bytes = Buffer.from(encoded, 'base64');
  bytes[30] ^= 1;
  expect(() => openPush(bytes.toString('base64'))).toThrow();
});
it('as regras exigem um registro por evento e perfis sem duplicação', () => {
  const rules = pushEvents.map((event) => ({ event: event.key, enabled: true, role_ids: [] }));
  expect(pushSettingsSchema.safeParse({ enabled: true, rules }).success).toBe(true);
  expect(
    pushSettingsSchema.safeParse({ enabled: true, rules: [...rules.slice(1), rules[1]] }).success,
  ).toBe(false);
});
function worker() {
  const handlers: Record<string, (event: any) => void> = {},
    showNotification = vi.fn(async () => {}),
    focus = vi.fn(async () => {}),
    navigate = vi.fn(async () => ({ focus })),
    openWindow = vi.fn(async () => {});
  const self = {
    location: { origin: 'https://garcom.test' },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(async () => [
        { url: 'https://garcom.test/outra-filial/mesas', navigate: vi.fn() },
        { url: 'https://garcom.test/filial-centro/mesas', navigate },
      ]),
      openWindow,
    },
    addEventListener: (type: string, callback: (event: any) => void) => {
      handlers[type] = callback;
    },
  };
  runInNewContext(readFileSync('packages/ui/public/mesa-push-sw.js', 'utf8'), { self, URL });
  return { handlers, showNotification, focus, navigate, openWindow };
}
describe('Service Worker de notificações', () => {
  it('exibe o aviso em segundo plano e abre apenas o endereço da filial correta', async () => {
    const w = worker(),
      message = {
        title: 'Mesa',
        body: 'Mesa 02 · Água',
        url: '/filial-centro/chamados',
        tag: 'mesa-123',
        unit_id: 'unit',
        icon: '/pwa/assets/icon.png',
      };
    let pending = Promise.resolve();
    w.handlers.push({
      data: { json: () => message },
      waitUntil: (value: Promise<void>) => {
        pending = value;
      },
    });
    await pending;
    expect(w.showNotification).toHaveBeenCalledWith(
      'Mesa',
      expect.objectContaining({ body: message.body, tag: message.tag }),
    );
    const close = vi.fn();
    w.handlers.notificationclick({
      notification: { close, data: { url: 'https://garcom.test/filial-centro/chamados' } },
      waitUntil: (value: Promise<void>) => {
        pending = value;
      },
    });
    await pending;
    expect(close).toHaveBeenCalled();
    expect(w.navigate).toHaveBeenCalledWith('https://garcom.test/filial-centro/chamados');
    expect(w.focus).toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });
  it('ignora conteúdo malformado e links de outra origem', async () => {
    const w = worker();
    let pending = Promise.resolve();
    for (const url of ['https://evil.test/a', '//evil.test/a', 'javascript:alert(1)']) {
      w.handlers.push({
        data: { json: () => ({ title: 'Mesa', body: 'Aviso', url }) },
        waitUntil: (value: Promise<void>) => {
          pending = value;
        },
      });
      await pending;
      w.handlers.notificationclick({
        notification: { close() {}, data: { url } },
        waitUntil: (value: Promise<void>) => {
          pending = value;
        },
      });
      await pending;
    }
    expect(w.showNotification).not.toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });
});
