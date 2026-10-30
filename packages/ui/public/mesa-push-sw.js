/* Shared by the management, waiter and kitchen service workers. No sessions or API data are cached. */
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        return;
      }
      if (
        !payload ||
        typeof payload.title !== 'string' ||
        typeof payload.body !== 'string' ||
        typeof payload.url !== 'string' ||
        !/^\/[a-z0-9-]+\//.test(payload.url)
      )
        return;
      const target = new URL(payload.url, self.location.origin);
      if (target.origin !== self.location.origin) return;
      const icon =
        typeof payload.icon === 'string' && payload.icon.startsWith('/pwa/assets/')
          ? payload.icon
          : '/icon.svg';
      await self.registration.showNotification(payload.title.slice(0, 160), {
        body: payload.body.slice(0, 240),
        icon,
        tag: typeof payload.tag === 'string' ? payload.tag : 'mesa-operation',
        renotify: false,
        data: { url: target.href, unit_id: payload.unit_id },
      });
    })(),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      let target;
      try {
        target = new URL(event.notification.data?.url, self.location.origin);
      } catch {
        return;
      }
      if (target.origin !== self.location.origin || !/^\/[a-z0-9-]+\//.test(target.pathname))
        return;
      const prefix = '/' + target.pathname.split('/')[1] + '/';
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        const current = new URL(client.url);
        if (current.origin === target.origin && current.pathname.startsWith(prefix)) {
          const navigated = await client.navigate(target.href);
          if (navigated) await navigated.focus();
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
