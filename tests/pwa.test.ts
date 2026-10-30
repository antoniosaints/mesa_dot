import { describe, it, expect, vi } from 'vitest';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { slugBase, slugCandidate, reservedSlugs } from '../packages/shared/src/slug.js';
import {
  pwaManifest,
  brandPwaHtml,
  parsePwaPath,
  safePwaSearch,
  stableBase,
  type PwaIdentity,
} from '../packages/shared/src/pwa.js';
import { fallbackIcon, normalizePwaIcon } from '../apps/api/src/pwa-icons.js';
const id = 'a1111111-1111-4111-8111-111111111111';
const identity: PwaIdentity = {
  establishment_id: id,
  slug: 'bar-do-joao',
  name: 'Bar do João',
  short_name: 'Bar João',
  primary_color: '#2584f8',
  background_color: '#ffffff',
  icon_revision: 'default-2584f8-ffffff',
};
describe('identidade pública PWA', () => {
  it.each([
    ['Bar do João', 'bar-do-joao'],
    ['Espetinho & Cia', 'espetinho-cia'],
    ['Açaí São José', 'acai-sao-jose'],
    ['PUB CENTRAL', 'pub-central'],
    ['Restaurante 24 Horas', 'restaurante-24-horas'],
    ['💖', 'estabelecimento'],
  ])('normaliza %s', (name, result) => expect(slugBase(name)).toBe(result));
  it('limita tamanho, reserva rotas reais e acomoda sufixos', () => {
    expect(slugBase('A '.repeat(100)).length).toBeLessThanOrEqual(80);
    expect(slugCandidate('a'.repeat(80), 100)).toHaveLength(80);
    for (const name of [
      'api',
      'pwa',
      'chamados',
      'conferir-ficha',
      'dashboard',
      'equipe',
      'criar-conta',
      'gestor',
    ])
      expect(reservedSlugs.has(name)).toBe(true);
  });
  it('mantém id, start_url e scope estáveis após renomear', () => {
    const before = pwaManifest(identity, 'customer'),
      after = pwaManifest(
        { ...identity, name: 'Bar do João Premium', slug: 'bar-do-joao-premium' },
        'customer',
      );
    expect(after.id).toBe(before.id);
    expect(after.scope).toBe(before.scope);
    expect(after.start_url).toBe(before.start_url);
    expect(after.name).toBe('Bar do João Premium');
    expect(after.id).not.toContain('bar-do-joao');
    expect(JSON.stringify(after)).not.toMatch(/token|credential|tenant_id/);
  });
  it('respeita rotas existentes e filtra parâmetros de redirecionamento', () => {
    expect(parsePwaPath('/bar-do-joao/cardapio', 'customer')?.value).toBe('bar-do-joao');
    expect(parsePwaPath(stableBase(id) + 'consumo', 'customer')?.kind).toBe('id');
    expect(parsePwaPath('/bar-do-joao/financeiro', 'customer')).toBeNull();
    expect(parsePwaPath('/bar-do-joao/financeiro', 'admin')).not.toBeNull();
    for (const path of [
      '/api/v1/orders',
      '/assets/icon.png',
      '/dashboard',
      '/bar-do-joao/../../api',
    ])
      expect(parsePwaPath(path, 'admin')).toBeNull();
    expect(
      safePwaSearch(
        new URLSearchParams({
          table: id,
          token: 'secret',
          next: 'https://evil.test',
          aba: 'vendas',
        }),
        'customer',
      ),
    ).toBe('table=' + id);
  });
  it('personaliza o HTML antes do JavaScript sem injetar HTML executável', () => {
    const html = brandPwaHtml(
      '<html><head><title>Mesa</title><link rel="manifest" href="/manifest.webmanifest"></head><body><strong id="mesa-boot-name"></strong></body></html>',
      {
        ...identity,
        name: 'Bar </title><script>alert(1)</script>',
        surface: 'customer',
        base_path: '/bar-do-joao/',
      },
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('application/json');
    expect(html).toContain('Bar &lt;/title&gt;');
    expect(html).toContain('<strong id="mesa-boot-name">Bar &lt;/title&gt;&lt;script&gt;');
    expect(html).toContain(stableBase(id) + 'manifest.webmanifest');
    expect(html).toContain('apple-touch-icon');
  });
  it('gera os quatro tamanhos PNG e rejeita imagem inválida', () => {
    for (const size of [32, 180, 192, 512]) {
      const png = PNG.sync.read(fallbackIcon('#2584f8', size));
      expect(png.width).toBe(size);
      expect(png.height).toBe(size);
    }
    expect(() => normalizePwaIcon(Buffer.from('<svg/>').toString('base64'))).toThrow();
    expect(() => normalizePwaIcon(fallbackIcon('#2584f8', 192).toString('base64'))).toThrow();
    expect(normalizePwaIcon(fallbackIcon('#2584f8', 512).toString('base64')).image.width).toBe(512);
  });
});
describe('Service Worker sem cache de dados de clientes', () => {
  function worker() {
    const listeners: Record<string, (event: any) => any> = {},
      cache = { match: vi.fn(), put: vi.fn() },
      caches = {
        open: vi.fn(async () => cache),
        keys: vi.fn(async () => ['mesa-shell-v2', 'mesa-static-v2', 'other-app-cache']),
        delete: vi.fn(async () => true),
      },
      fetch = vi.fn(async () => new Response('network'));
    const self = {
      location: { origin: 'https://app.test' },
      addEventListener: (name: string, fn: (event: any) => any) => {
        listeners[name] = fn;
      },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    };
    runInNewContext(readFileSync('apps/customer-pwa/public/sw.js', 'utf8'), {
      self,
      caches,
      fetch,
      URL,
      Response,
    });
    return { listeners, caches, fetch };
  }
  it('não intercepta APIs nem requisições autenticadas e não apaga caches alheios', async () => {
    const w = worker();
    for (const url of ['https://app.test/api/v1/orders', 'https://app.test/socket.io/']) {
      const respondWith = vi.fn();
      w.listeners.fetch({
        request: { url, method: 'GET', headers: new Headers(), mode: 'cors' },
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
    const respondWith = vi.fn();
    w.listeners.fetch({
      request: {
        url: 'https://app.test/assets/x-abcdefgh.js',
        method: 'GET',
        headers: new Headers({ Authorization: 'Bearer test' }),
        mode: 'cors',
      },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
    let done: Promise<unknown> = Promise.resolve();
    w.listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(w.caches.delete).toHaveBeenCalledWith('mesa-shell-v2');
    expect(w.caches.delete).not.toHaveBeenCalledWith('other-app-cache');
  });
  it('navegação offline retorna uma página neutra sem armazenar HTML de tenant', async () => {
    const w = worker();
    w.fetch.mockRejectedValueOnce(new Error('offline'));
    let result: Promise<Response> = Promise.resolve(new Response());
    w.listeners.fetch({
      request: {
        url: 'https://app.test/bar-a/',
        method: 'GET',
        headers: new Headers(),
        mode: 'navigate',
      },
      respondWith: (p: Promise<Response>) => (result = p),
    });
    const response = await result;
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('sem conexão');
    expect(w.caches.open).not.toHaveBeenCalled();
  });
});
