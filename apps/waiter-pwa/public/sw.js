importScripts('/mesa-push-sw.js');
const CACHE = 'mesa-static-v4';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key === 'mesa-shell-v2' || (key.startsWith('mesa-static-v') && key !== CACHE))
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    request.headers.has('Authorization')
  )
    return;
  // No API, tenant HTML, orders, user data, or financial responses are ever cached.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sem conexão</title><body><h1>Você está sem conexão</h1><p>Conecte-se à internet para abrir este estabelecimento. Pedidos e pagamentos exigem conexão.</p><p>Reabra o aplicativo quando a conexão voltar.</p></body></html>',
            {
              status: 503,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'Content-Security-Policy':
                  "default-src 'none'; script-src 'none'; style-src 'none'",
              },
            },
          ),
      ),
    );
    return;
  }
  if (
    !/^\/assets\/[a-zA-Z0-9._-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|woff2?|ttf|png|svg)$/.test(
      url.pathname,
    ) ||
    url.search
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (
        response.ok &&
        response.type === 'basic' &&
        !/(?:private|no-store)/i.test(response.headers.get('Cache-Control') ?? '')
      )
        await cache.put(request, response.clone());
      return response;
    })(),
  );
});
