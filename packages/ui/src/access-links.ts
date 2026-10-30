import { useEffect, useState } from 'react';
import { frontendAccessUrl } from '../../shared/src/access-links.js';
import type { PwaSurface } from '../../shared/src/pwa.js';
import { api, session, type Data } from './client.js';
import { usePwaIdentity } from './pwa-context.js';
import { useRefresh } from './common.js';
export function accessUrl(surface: PwaSurface, slug: string) {
  return frontendAccessUrl(surface, slug, window.location.href, {
    admin: import.meta.env.VITE_ADMIN_URL,
    customer: import.meta.env.VITE_CUSTOMER_URL,
    waiter: import.meta.env.VITE_WAITER_URL,
    kitchen: import.meta.env.VITE_KITCHEN_URL,
  });
}
export function useAccessIdentity() {
  const branded = usePwaIdentity();
  const id = session()?.actor?.establishmentId;
  const [loaded, setLoaded] = useState<Data | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    setLoaded(null);
    setError('');
  }, [id]);
  useRefresh(async () => {
    if (!id) return;
    try {
      const identity = await api('/pwa/apps/' + id);
      setLoaded(identity);
      setError('');
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [id]);
  return {
    identity:
      loaded?.establishment_id === id ? loaded : branded?.establishment_id === id ? branded : null,
    error,
  };
}
