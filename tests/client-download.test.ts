import { afterEach, it, expect, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
function storage() {
  const values = new Map<string, string>();
  const data = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  };
  data.setItem(
    'bar-staff',
    JSON.stringify({ token: 'old', refresh_token: 'refresh-old', actor: { id: 'staff' } }),
  );
  vi.stubGlobal('sessionStorage', data);
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  return data;
}
it('requisições concorrentes e download PDF compartilham uma única renovação de sessão', async () => {
  const store = storage();
  let refreshes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 2));
        return Response.json({ token: 'new', refresh_token: 'refresh-new' });
      }
      const auth = (options.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer old') {
        if (url.endsWith('receipt.pdf')) await new Promise((r) => setTimeout(r, 10));
        return Response.json({ error: { message: 'Expirou' } }, { status: 401 });
      }
      return url.endsWith('.pdf')
        ? new Response('%PDF-test', { headers: { 'Content-Type': 'application/pdf' } })
        : Response.json({ ok: true });
    }),
  );
  const { api } = await import('../packages/ui/src/client.js');
  const values = await Promise.all([
    api('/receipts/printers'),
    api('/tabs/receipt'),
    api('/orders/receipt.pdf', undefined, 'GET', crypto.randomUUID(), 'blob'),
  ]);
  expect(refreshes).toBe(1);
  expect(values[0].ok).toBe(true);
  expect(await (values[2] as Blob).text()).toBe('%PDF-test');
  expect(JSON.parse(store.getItem('bar-staff')!).token).toBe('new');
});
it('renovação em andamento não reativa uma sessão encerrada pelo usuário', async () => {
  const store = storage();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let started!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        started();
        await pending;
        return Response.json({ token: 'new', refresh_token: 'refresh-new' });
      }
      return Response.json({ error: { message: 'Expirou' } }, { status: 401 });
    }),
  );
  const { api } = await import('../packages/ui/src/client.js');
  const request = api('/orders/receipt.pdf', undefined, 'GET', crypto.randomUUID(), 'blob');
  await refreshStarted;
  store.removeItem('bar-staff');
  finish();
  await expect(request).rejects.toThrow('Expirou');
  expect(store.getItem('bar-staff')).toBeNull();
});
