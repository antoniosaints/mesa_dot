import { useSyncExternalStore } from 'react';
import type { PwaContext } from '../../shared/src/pwa.js';
import { iconPath, stableBase, surfaceNames } from '../../shared/src/pwa.js';
const listeners = new Set<() => void>();
let context: PwaContext | null = null;
try {
  const raw =
    typeof document === 'undefined'
      ? null
      : document.getElementById('mesa-pwa-context')?.textContent;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (
      /^[a-f0-9-]{36}$/.test(parsed.establishment_id) &&
      /^#[a-f0-9]{6}$/i.test(parsed.primary_color) &&
      /^#[a-f0-9]{6}$/i.test(parsed.background_color)
    )
      context = parsed;
  }
} catch {
  /* Invalid public metadata never becomes authority for API access. */
}
export function pwaContext() {
  return context;
}
export function usePwaIdentity() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => context,
    () => null,
  );
}
export function tenantStorageKey(key: string) {
  return context ? `mesa:${context.surface}:${context.establishment_id}:${key}` : key;
}
export function expectedUnitHeaders(): Record<string, string> {
  return context ? { 'X-Mesa-Establishment': context.establishment_id } : {};
}
export function installPwaRuntime() {
  if ('serviceWorker' in navigator)
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {});
  if (!context) return;
  const boot = context;
  const refresh = async () => {
    try {
      const response = await fetch('/api/v1/pwa/apps/' + boot.establishment_id, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const value = await response.json();
      context = { ...value, surface: boot.surface, base_path: boot.base_path };
      document.title =
        value.name + (boot.surface === 'customer' ? '' : ' · ' + surfaceNames[boot.surface]);
      document
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.setAttribute('content', value.short_name);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', value.primary_color);
      document.querySelector('link[rel="icon"]')?.setAttribute('href', iconPath(value, 32));
      document
        .querySelector('link[rel="apple-touch-icon"]')
        ?.setAttribute('href', iconPath(value, 180));
      listeners.forEach((listener) => listener());
      window.dispatchEvent(new Event('mesa:pwa-identity-updated'));
    } catch {
      /* Keep the first-response identity during temporary network failures. */
    }
  };
  window.addEventListener('mesa:pwa-refresh', () => void refresh());
}
export function stableInstallUrl() {
  return context ? stableBase(context.establishment_id) : null;
}
