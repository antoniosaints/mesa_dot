import { PrintBridgeClient, type Printer } from '@antoniosantos1999/printbridge';
import { PrintBridgeQueue, type BridgeActivity, type BridgeBinding } from './printbridge-queue.js';
import type { Data } from './client.js';
export class StationApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export interface StationConfig {
  connect: boolean;
  active: boolean;
  name: string;
}
export interface StationProfile {
  config: StationConfig;
  bindings: Record<string, BridgeBinding>;
  credential: { id: string; token: string } | null;
}
export interface StationSnapshot extends StationProfile {
  connected: boolean;
  connecting: boolean;
  running: boolean;
  waiting: boolean;
  error: string;
  printers: Printer[];
  activities: BridgeActivity[];
}
export const stationPrefix = (unit: string) => 'mesa:printbridge:station:' + unit;
export function readStationProfile(unit: string, legacyScope?: string): StationProfile {
  const prefix = stationPrefix(unit);
  const read = (storage: Storage, key: string, fallback: any) => {
    try {
      return JSON.parse(storage.getItem(key) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  };
  const config = read(localStorage, prefix + ':config', {});
  let bindings = read(localStorage, prefix + ':bindings', null),
    credential = read(localStorage, prefix + ':credential', null);
  if (legacyScope) {
    bindings ??= read(localStorage, 'mesa:printbridge:bindings:' + legacyScope, {});
    credential ??= read(sessionStorage, 'mesa:printbridge:agent:' + legacyScope, null);
  }
  return {
    config: {
      connect: config.connect === true,
      active: config.active === true,
      name: typeof config.name === 'string' ? config.name.slice(0, 100) : 'Computador de impressão',
    },
    bindings:
      bindings && typeof bindings === 'object' && !Array.isArray(bindings)
        ? Object.fromEntries(
            Object.entries(bindings as Record<string, BridgeBinding>).filter(([, v]) => {
              const b = v as BridgeBinding;
              return (
                b &&
                typeof b.printerId === 'string' &&
                ['pdf', 'escpos'].includes(b.format) &&
                [58, 80].includes(b.paperWidth)
              );
            }),
          )
        : {},
    credential:
      typeof credential?.token === 'string' && typeof credential?.id === 'string'
        ? credential
        : null,
  };
}
export function saveStationProfile(unit: string, profile: StationProfile) {
  const prefix = stationPrefix(unit);
  localStorage.setItem(prefix + ':bindings', JSON.stringify(profile.bindings));
  if (profile.credential)
    localStorage.setItem(prefix + ':credential', JSON.stringify(profile.credential));
  localStorage.setItem(prefix + ':config', JSON.stringify(profile.config));
}
export async function stationRequest(
  unit: string,
  credential: string,
  path: string,
  body?: unknown,
  binary = false,
): Promise<any> {
  const response = await fetch((import.meta.env.VITE_API_URL ?? '') + '/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + credential,
      'Content-Type': 'application/json',
      'X-Mesa-Establishment': unit,
      'Idempotency-Key': crypto.randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new StationApiError(
      error.error?.message ?? 'Falha na estação de impressão.',
      response.status,
    );
  }
  return binary ? response.blob() : response.json();
}
/** A single browser tab leads each persisted station. Native keys remain authoritative after reload. */
export class PrintStationRuntime {
  private profile: StationProfile;
  private snapshot: StationSnapshot;
  private client: PrintBridgeClient;
  private queue: PrintBridgeQueue | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private operation = false;
  private release: (() => void) | null = null;
  private leader = false;
  private failures = 0;
  private heartbeatAt = 0;
  constructor(
    private options: {
      unit: string;
      profile: StationProfile;
      change: (state: StationSnapshot) => void;
      issue?: (name: string) => Promise<Data>;
      client?: PrintBridgeClient;
      call?: (path: string, body?: unknown, binary?: boolean) => Promise<any>;
      locks?: LockManager | null;
    },
  ) {
    this.profile = options.profile;
    this.client =
      options.client ??
      new PrintBridgeClient({ appName: 'Mesa · estação de impressão', requestTimeoutMs: 15000 });
    this.snapshot = {
      ...this.profile,
      connected: false,
      connecting: false,
      running: false,
      waiting: false,
      error: '',
      printers: [],
      activities: [],
    };
  }
  get state() {
    return this.snapshot;
  }
  private publish(values: Partial<StationSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...this.profile, ...values };
    if (!this.stopped) this.options.change(this.snapshot);
  }
  private save() {
    saveStationProfile(this.options.unit, this.profile);
    this.publish();
  }
  private call = async (path: string, body?: unknown, binary = false) => {
    if (!this.profile.credential)
      throw new StationApiError(
        'Configure e ative esta estação pela gestão antes de usar o modo dedicado.',
        401,
      );
    return this.options.call
      ? this.options.call(path, body, binary)
      : stationRequest(this.options.unit, this.profile.credential.token, path, body, binary);
  };
  restore() {
    if (this.profile.config.connect) this.schedule(0);
  }
  sync(profile: StationProfile) {
    this.profile = profile;
    if (!profile.config.active) {
      this.publish({ running: false, waiting: false });
      if (this.leader) void this.heartbeat(false).catch(() => {});
      if (!this.operation) this.unlock();
    }
    if (!profile.config.connect) {
      this.client.disconnect();
      this.publish({ connected: false });
    }
    this.publish();
    this.schedule(0);
  }
  private schedule(delay = 1500) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), delay);
  }
  private async exclusive(work: () => Promise<void>) {
    if (this.operation || this.stopped) return;
    this.operation = true;
    try {
      await work();
    } finally {
      this.operation = false;
      if (this.stopped || !this.profile.config.active) this.unlock();
    }
  }
  private async lock() {
    if (this.leader) return true;
    const locks = this.options.locks === undefined ? navigator.locks : this.options.locks;
    if (!locks) {
      this.leader = true;
      return true;
    }
    return new Promise<boolean>((resolve, reject) => {
      void locks
        .request('mesa-print-station:' + this.options.unit, { ifAvailable: true }, async (lock) => {
          if (!lock || this.stopped) {
            resolve(false);
            return;
          }
          this.leader = true;
          const hold = new Promise<void>((release) => {
            this.release = release;
          });
          resolve(true);
          await hold;
        })
        .catch(reject);
    });
  }
  private unlock() {
    this.leader = false;
    this.release?.();
    this.release = null;
  }
  private async native(manual: boolean) {
    if (this.client.isConnected && this.client.isAuthorized && this.snapshot.printers.length)
      return;
    this.publish({ connecting: true });
    try {
      await this.client.connect();
      if (this.stopped) return;
      if (!this.client.isAuthorized) {
        if (!manual)
          throw new Error(
            'Autorize novamente este site no PrintBridge e clique em Conectar PrintBridge.',
          );
        await this.client.pair();
      }
      if (this.stopped) return;
      const printers = await this.client.listPrinters();
      if (this.stopped) return;
      this.publish({ connected: true, printers, error: '' });
    } finally {
      this.publish({ connecting: false });
    }
  }
  async connect() {
    await this.exclusive(async () => {
      try {
        await this.native(true);
        if (this.stopped) return;
        this.profile.config = { ...this.profile.config, connect: true };
        this.save();
        this.schedule();
      } catch (error) {
        this.publish({ connected: false, error: (error as Error).message });
      }
    });
  }
  async refreshPrinters() {
    try {
      this.publish({ printers: await this.client.listPrinters(), error: '' });
    } catch (error) {
      this.publish({ error: (error as Error).message });
    }
  }
  bind(id: string, binding: BridgeBinding | null) {
    if (this.profile.config.active) return;
    this.profile.bindings = { ...this.profile.bindings };
    if (binding) this.profile.bindings[id] = binding;
    else delete this.profile.bindings[id];
    this.queue = null;
    try {
      this.save();
    } catch {
      this.publish({ error: 'O navegador não permitiu salvar os vínculos desta estação.' });
    }
  }
  name(name: string) {
    if (this.profile.config.active) return;
    this.profile.config = { ...this.profile.config, name: name.slice(0, 100) };
    try {
      this.save();
    } catch {
      this.publish({ error: 'Não foi possível salvar o nome do computador.' });
    }
  }
  async start() {
    await this.exclusive(async () => {
      try {
        await this.native(false);
        if (this.stopped) return;
        this.validateBindings();
        if (!this.profile.credential) {
          if (!this.options.issue)
            throw new Error('Configure esta estação no menu Impressão da gestão.');
          const issued = await this.options.issue(
            this.profile.config.name.trim() || 'Computador de impressão',
          );
          if (!issued.token)
            throw new Error(
              'Não foi possível obter a credencial da estação. Tente ativar novamente.',
            );
          this.profile.credential = { id: issued.id, token: issued.token };
          this.save();
        }
        await this.call('/print/station');
        if (this.stopped) return;
        this.profile.config = { ...this.profile.config, connect: true, active: true };
        this.save();
        this.heartbeatAt = 0;
        this.schedule(0);
      } catch (error) {
        this.publish({ error: (error as Error).message });
      }
    });
  }
  private validateBindings() {
    const bindings = Object.values(this.profile.bindings);
    if (!bindings.length)
      throw new Error('Vincule ao menos uma impressora do sistema a uma impressora local.');
    if (
      bindings.some(
        (binding) => !this.snapshot.printers.some((printer) => printer.id === binding.printerId),
      )
    )
      throw new Error(
        'Uma impressora vinculada não está autorizada ou foi removida. Atualize a lista.',
      );
  }
  pause() {
    this.profile.config = { ...this.profile.config, active: false };
    try {
      this.save();
    } catch {
      this.publish({
        error: 'Não foi possível salvar a pausa. Confira as permissões de armazenamento.',
      });
    }
    this.publish({ running: false, waiting: false });
    if (this.timer) clearTimeout(this.timer);
    if (this.leader) void this.heartbeat(false).catch(() => {});
    if (!this.operation) this.unlock();
  }
  disconnect() {
    this.pause();
    this.profile.config = { ...this.profile.config, connect: false };
    try {
      this.save();
    } catch {
      /* The connection is closed even when browser storage is unavailable. */
    }
    this.client.disconnect();
    this.publish({ connected: false });
  }
  private async heartbeat(running: boolean) {
    await this.call('/print/station/heartbeat', {
      printer_ids: Object.keys(this.profile.bindings),
      connected: this.client.isConnected && this.client.isAuthorized,
      running,
      name: this.profile.config.name.trim() || 'Computador de impressão',
    });
    this.heartbeatAt = Date.now();
  }
  private async tick() {
    if (this.operation) {
      this.schedule();
      return;
    }
    await this.exclusive(async () => {
      let delay = 1500;
      try {
        if (!this.profile.config.connect) return;
        if (this.profile.config.active && !(await this.lock())) {
          this.publish({ waiting: true, running: false, error: '' });
          delay = 3000;
          return;
        }
        await this.native(false);
        if (this.stopped || !this.profile.config.active) return;
        this.validateBindings();
        if (!this.queue)
          this.queue = new PrintBridgeQueue(
            this.client,
            this.call,
            this.profile.bindings,
            location.origin,
            (activity) =>
              this.publish({
                activities: [
                  activity,
                  ...this.snapshot.activities.filter((item) => item.id !== activity.id),
                ].slice(0, 8),
              }),
          );
        if (Date.now() - this.heartbeatAt > 10000) await this.heartbeat(true);
        if (this.stopped || !this.profile.config.active) return;
        this.publish({ running: true, waiting: false, error: '' });
        await this.queue.step();
        this.failures = 0;
      } catch (error) {
        this.failures++;
        const failure = error as Error & { code?: string };
        const leaseExpired =
          error instanceof StationApiError && error.status === 409 && /lease/i.test(error.message);
        if (leaseExpired) this.queue = null;
        const transient =
          error instanceof StationApiError
            ? error.status >= 500 || error.status === 429 || leaseExpired
            : error instanceof TypeError ||
              ['TimeoutError', 'AbortError'].includes(failure.name) ||
              [
                'TIMEOUT',
                'DISCONNECTED',
                'AGENT_UNAVAILABLE',
                'CONNECTION_BLOCKED_OR_UNAVAILABLE',
              ].includes(failure.code ?? '');
        this.publish({
          running: false,
          connected: this.client.isConnected && this.client.isAuthorized,
          error:
            failure.message +
            (transient
              ? ' Reconexão automática em andamento.'
              : ' A estação foi pausada; confira a configuração e ative novamente.'),
        });
        if (!transient) {
          this.profile.config = { ...this.profile.config, active: false };
          try {
            this.save();
          } catch {
            /* Keep the station paused in memory. */
          }
        }
        delay = Math.min(30000, 1500 * 2 ** Math.min(this.failures, 5));
      } finally {
        if (
          !this.stopped &&
          this.profile.config.connect &&
          (this.profile.config.active || !this.snapshot.connected)
        )
          this.schedule(delay);
      }
    });
  }
  dispose() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.client.disconnect();
    if (!this.operation) this.unlock();
  }
}
