import type { PwaSurface } from '../../shared/src/pwa.js';
import { pwaContext, tenantStorageKey, expectedUnitHeaders } from './pwa-context.js';
import { io } from 'socket.io-client';
export type Data = Record<string, any>;
const base = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';
let storageKey = tenantStorageKey('bar-staff');
export function useStorageKey(key: string) {
  storageKey = tenantStorageKey(key);
  if (
    key === 'bar-staff' &&
    storageKey !== key &&
    !sessionStorage.getItem(storageKey) &&
    !sessionStorage.getItem(storageKey + ':legacy-checked')
  ) {
    try {
      sessionStorage.setItem(storageKey + ':legacy-checked', '1');
      const legacy = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (legacy?.actor?.establishmentId === pwaContext()?.establishment_id)
        sessionStorage.setItem(storageKey, JSON.stringify(legacy));
    } catch {
      /* Ignore legacy sessions that do not belong to this establishment. */
    }
  }
}
export function session(): Data | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    const unit = pwaContext()?.establishment_id;
    if (unit && value && (value.actor?.establishmentId ?? value.establishment_id) !== unit)
      return null;
    return value;
  } catch {
    return null;
  }
}
export function saveSession(value: Data | null) {
  if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
  else sessionStorage.removeItem(storageKey);
  window.dispatchEvent(new Event('mesa:session-change'));
}
/** Login may select an assigned branch when entering through the account's main unit. */
export function saveLoginSession(value: Data, surface: PwaSurface) {
  const current = pwaContext();
  if (!current || value?.actor?.establishmentId === current.establishment_id) {
    saveSession(value);
    return false;
  }
  if (
    value?.actor?.kind !== 'STAFF' ||
    !/^[a-f0-9-]{36}$/.test(value.actor.establishmentId) ||
    !/^[a-z0-9-]{1,80}$/.test(value.slug)
  )
    throw new Error('Sessão da filial inválida.');
  sessionStorage.setItem(
    `mesa:${surface}:${value.actor.establishmentId}:bar-staff`,
    JSON.stringify(value),
  );
  window.location.assign('/' + value.slug + '/');
  return true;
}
/** Store only the server-issued session for the selected branch on this frontend origin. */
export function storeBranchSession(value: Data) {
  const original = session();
  if (
    !original ||
    value?.actor?.kind !== 'STAFF' ||
    value.actor.id !== original.actor.id ||
    value.actor.tenantId !== original.actor.tenantId ||
    !/^[a-f0-9-]{36}$/.test(value.actor.establishmentId) ||
    !/^[a-z0-9-]{1,80}$/.test(value.slug)
  )
    throw new Error('Sessão da filial inválida.');
  sessionStorage.setItem(
    `mesa:admin:${value.actor.establishmentId}:bar-staff`,
    JSON.stringify(value),
  );
}
let refreshPending: Promise<boolean> | null = null;
async function refreshStaffSession() {
  if (refreshPending) return refreshPending;
  const original = session();
  if (!original?.refresh_token) return false;
  refreshPending = (async () => {
    const refreshed = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...expectedUnitHeaders() },
      body: JSON.stringify({ refresh_token: original.refresh_token }),
    });
    const current = session();
    // Never restore a logged-out session or overwrite a subsequent login.
    if (!current || current.refresh_token !== original.refresh_token)
      return Boolean(current?.token);
    if (refreshed.ok) {
      saveSession({ ...current, ...(await refreshed.json()) });
      return true;
    }
    saveSession(null);
    window.dispatchEvent(new Event('bar:logout'));
    return false;
  })().finally(() => {
    refreshPending = null;
  });
  return refreshPending;
}
export async function api(
  path: string,
  body?: unknown,
  method?: string,
  key: string = crypto.randomUUID(),
  responseType: 'json' | 'blob' = 'json',
  signal?: AbortSignal,
  visitorToken?: string,
): Promise<any> {
  const send = () =>
    fetch(`${base}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      cache: 'no-store',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...expectedUnitHeaders(),
        ...((visitorToken ?? session()?.token)
          ? { Authorization: `Bearer ${visitorToken ?? session()!.token}` }
          : {}),
        'Idempotency-Key': key,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  const attemptedToken = session()?.token;
  let response = await send();
  if (
    visitorToken === undefined &&
    response.status === 401 &&
    session()?.refresh_token &&
    !path.startsWith('/auth/')
  ) {
    if ((session()?.token && session()?.token !== attemptedToken) || (await refreshStaffSession()))
      response = await send();
  }
  if (response.ok && responseType === 'blob') return response.blob();
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(value.error?.message ?? 'Não foi possível concluir a operação.'),
      { code: value.error?.code },
    );
  return value;
}
/** Read or operate a saved visitor session without changing the active ordering context. */
export function visitorApi(path: string, token: string, body?: unknown) {
  return api(path, body, undefined, crypto.randomUUID(), 'json', undefined, token);
}
export function subscribe(onChange: () => void) {
  const socket = io(import.meta.env.VITE_API_URL ?? window.location.origin, {
    auth: (cb) => cb({ token: session()?.token }),
    autoConnect: Boolean(session()?.token),
  });
  const seen = new Set<string>();
  socket.on('connect', onChange);
  socket.on('domain.event', (event) => {
    if (!seen.has(event.event_id)) {
      seen.add(event.event_id);
      if (event.event === 'settings.updated') {
        window.dispatchEvent(new Event('mesa:appearance-updated'));
        window.dispatchEvent(new Event('mesa:pwa-refresh'));
      }
      if (seen.size > 500) seen.clear();
      onChange();
    }
  });
  const timer = window.setInterval(onChange, 15000);
  return () => {
    socket.disconnect();
    clearInterval(timer);
  };
}
export const brl = (value: string | number = '0') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
export const statusLabel: Data = {
  FREE: 'Livre',
  OPEN: 'Em atendimento',
  CLOSING: 'Em fechamento',
  AWAITING_RELEASE: 'Aguardando liberação',
  CLOSED: 'Encerrada',
  PENDING_PAYMENT: 'Aguardando pagamento',
  DRAFT: 'Rascunho',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
  PENDING: 'Pendente',
  PREPARING: 'Em preparo',
  AVAILABLE: 'Disponível',
  REQUESTED: 'Solicitada',
  ASSIGNED: 'Atribuída',
  REDEEMED: 'Entregue',
  APPROVED: 'Aprovado',
  FAILED: 'Falhou',
  PROCESSING: 'Processando',
  COMPLETED: 'Concluído',
  REFUNDED: 'Estornado',
  PARTIALLY_REFUNDED: 'Estorno parcial',
  READY: 'Pronto',
  CLAIMED: 'Assumido',
};
