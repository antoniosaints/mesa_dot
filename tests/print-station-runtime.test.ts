import type { BridgeCall } from '../packages/ui/src/printbridge-queue.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PrintBridgeClient } from '@antoniosantos1999/printbridge';
import {
  PrintStationRuntime,
  readStationProfile,
  saveStationProfile,
  StationApiError,
  type StationProfile,
} from '../packages/ui/src/print-station-runtime.js';
class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const unit = '00000000-0000-4000-8000-000000000001';
let runtimes: PrintStationRuntime[] = [];
function fixture(change: Partial<StationProfile['config']> = {}) {
  const profile: StationProfile = {
    config: { connect: true, active: true, name: 'Balcão', ...change },
    credential: { id: 'agent', token: 'test-only-agent' },
    bindings: { logical: { printerId: 'native', format: 'pdf', paperWidth: 80 } },
  };
  const client = {
    isConnected: false,
    isAuthorized: true,
    connect: vi.fn(async () => {
      client.isConnected = true;
    }),
    pair: vi.fn(async () => {
      client.isAuthorized = true;
    }),
    listPrinters: vi.fn(async () => [
      { id: 'native', name: 'Local', isDefault: true, status: 'unknown' },
    ]),
    disconnect: vi.fn(() => {
      client.isConnected = false;
    }),
    printPdf: vi.fn(async () => ({ jobId: 'native-job' })),
    printRaw: vi.fn(),
    getJob: vi.fn(),
  };
  const call = vi.fn<BridgeCall>(async (path: string) =>
      path.endsWith('/claim') ? { idle: true } : {},
    ),
    issue = vi.fn(),
    changeState = vi.fn();
  const runtime = new PrintStationRuntime({
    unit,
    profile,
    client: client as unknown as PrintBridgeClient,
    call,
    issue,
    change: changeState,
    locks: null,
  });
  runtimes.push(runtime);
  return { profile, client, call, issue, runtime, changeState };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('location', { origin: 'https://mesa.example' });
  vi.stubGlobal('navigator', {});
});
afterEach(() => {
  runtimes.forEach((runtime) => runtime.dispose());
  runtimes = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('retoma a mesma credencial e os vínculos depois de recarregar sem pedir pareamento ou criar outro agente', async () => {
  const first = fixture();
  saveStationProfile(unit, first.profile);
  first.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(first.runtime.state.running).toBe(true);
  first.runtime.dispose();
  const saved = readStationProfile(unit);
  expect(saved.credential).toEqual(first.profile.credential);
  const second = fixture();
  second.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(second.runtime.state.running).toBe(true);
  expect(second.client.pair).not.toHaveBeenCalled();
  expect(second.issue).not.toHaveBeenCalled();
  expect(second.call).toHaveBeenCalledWith(
    '/print/station/heartbeat',
    expect.objectContaining({ printer_ids: ['logical'], running: true }),
    false,
  );
});
it('migra a credencial antiga da aba e os vínculos sem descartá-los', () => {
  sessionStorage.setItem(
    'mesa:printbridge:agent:legacy',
    JSON.stringify({ id: 'original-agent', token: 'test-only-old-token' }),
  );
  localStorage.setItem(
    'mesa:printbridge:bindings:legacy',
    JSON.stringify({ logical: { printerId: 'native', format: 'escpos', paperWidth: 58 } }),
  );
  const old = readStationProfile(unit, 'legacy');
  saveStationProfile(unit, old);
  expect(readStationProfile(unit).credential?.id).toBe('original-agent');
  expect(readStationProfile(unit).bindings.logical.paperWidth).toBe(58);
});
it('reconecta após indisponibilidade temporária sem perder a intenção de processar a fila', async () => {
  const f = fixture();
  f.client.connect.mockRejectedValueOnce(
    Object.assign(new Error('Sem conexão local'), { code: 'CONNECTION_BLOCKED_OR_UNAVAILABLE' }),
  );
  f.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.runtime.state.running).toBe(false);
  expect(f.runtime.state.config.active).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.runtime.state.running).toBe(true);
  expect(f.client.connect).toHaveBeenCalledTimes(2);
  expect(f.issue).not.toHaveBeenCalled();
});
it('uma pausa explícita permanece após reiniciar e não consome a fila', async () => {
  const f = fixture();
  f.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  f.runtime.pause();
  f.runtime.dispose();
  const saved = readStationProfile(unit);
  expect(saved.config.active).toBe(false);
  const next = fixture(saved.config);
  next.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(next.runtime.state.running).toBe(false);
  expect(next.call.mock.calls.some(([path]) => path.endsWith('/claim'))).toBe(false);
});
it('não tenta parear automaticamente se a autorização nativa foi revogada', async () => {
  const f = fixture();
  f.client.isAuthorized = false;
  f.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.client.pair).not.toHaveBeenCalled();
  expect(f.runtime.state.config.active).toBe(false);
  expect(f.runtime.state.error).toContain('Autorize novamente');
});
it('para ao revogar a credencial e não cria uma substituta automaticamente', async () => {
  const f = fixture();
  f.call.mockRejectedValueOnce(new StationApiError('Agente revogado', 401));
  f.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.runtime.state.running).toBe(false);
  expect(f.runtime.state.config.active).toBe(false);
  expect(f.issue).not.toHaveBeenCalled();
});
it('recupera o lease expirado na API antes de continuar a emissão congelada', async () => {
  const f = fixture();
  let claims = 0,
    downloads = 0;
  f.client.getJob.mockResolvedValue({ id: 'native-job', state: 'submitted', error: null });
  f.call.mockImplementation(async (path: string) => {
    if (path.endsWith('/claim')) {
      claims++;
      return { id: 'job', printer_id: 'logical', document_kind: 'RECEIPT' };
    }
    if (path.endsWith('/prepare'))
      return {
        generation: 'generation',
        idempotencyKey: 'same-frozen-key',
        printerId: 'native',
        format: 'pdf',
        paperWidth: 80,
        createdAt: new Date().toISOString(),
        jobId: null,
      };
    if (path.endsWith('/state')) return { status: 'PROCESSING', generation: 'generation' };
    if (path.includes('/document?')) {
      if (!downloads++) throw new StationApiError('Lease expirado. Recupere o trabalho.', 409);
      return new Blob(['%PDF-test']);
    }
    return {};
  });
  f.runtime.restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.runtime.state.config.active).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(claims).toBe(2);
  expect(f.client.printPdf).toHaveBeenCalledTimes(1);
  expect(f.client.printPdf).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: 'same-frozen-key' }),
  );
  expect(f.runtime.state.running).toBe(true);
});
