import type { PrintBridgeClient } from '@antoniosantos1999/printbridge';
import { it, expect, vi } from 'vitest';
import { PrintBridgeQueue, type BridgeCall } from '../packages/ui/src/printbridge-queue.js';
function fixture(
  format: 'pdf' | 'escpos' = 'pdf',
  savedJob: string | null = null,
  state: 'submitted' | 'unknown' = 'submitted',
) {
  const delivery = {
    generation: 'generation',
    idempotencyKey: 'frozen-key',
    printerId: 'native-printer',
    format,
    paperWidth: 80,
    createdAt: new Date().toISOString(),
    jobId: savedJob,
  };
  const bridge = {
    isConnected: true,
    isAuthorized: true,
    printPdf: vi.fn(async (_request: Parameters<PrintBridgeClient['printPdf']>[0]) => ({
      jobId: 'native-job',
    })),
    printRaw: vi.fn(async (_request: Parameters<PrintBridgeClient['printRaw']>[0]) => ({
      jobId: 'native-job',
    })),
    getJob: vi.fn(async () => ({
      id: 'native-job',
      printerId: 'native-printer',
      state,
      createdAt: 0,
      updatedAt: 0,
      spoolerId: 7,
      error: state === 'unknown' ? 'Resultado incerto' : null,
    })),
  };
  let claims = 0;
  const calls: { path: string; body: any }[] = [];
  const call = vi.fn<BridgeCall>(async (path, body, binary) => {
    calls.push({ path, body });
    if (path.endsWith('/claim'))
      return claims++
        ? { idle: true }
        : { id: 'server-job', printer_id: 'logical-printer', document_kind: 'TICKET' };
    if (path.endsWith('/prepare')) return delivery;
    if (path.endsWith('/state')) return { status: 'PROCESSING', generation: delivery.generation };
    if (binary) return new Blob(['%PDF-test']);
    return { status: 'PROCESSING' };
  });
  const activity = vi.fn();
  const queue = new PrintBridgeQueue(
    bridge,
    call,
    { 'logical-printer': { printerId: 'native-printer', format, paperWidth: 80 } },
    'http://localhost:5173',
    activity,
  );
  return { queue, bridge, calls, delivery, activity, call };
}
it('envia PDF pelo SDK, registra o identificador antes de acompanhar o resultado e confirma só o spooler', async () => {
  const f = fixture();
  await f.queue.step();
  expect(f.bridge.printPdf).toHaveBeenCalledWith(
    expect.objectContaining({
      printerId: 'native-printer',
      idempotencyKey: 'frozen-key',
      options: { copies: 1, orientation: 'portrait', fitToPage: false },
    }),
  );
  expect(f.calls.filter((c) => c.path.endsWith('/status')).map((c) => c.body.state)).toEqual([
    'queued',
    'submitted',
  ]);
  expect(f.queue.pending).toBe(false);
  await f.queue.step();
  expect(f.bridge.printPdf).toHaveBeenCalledTimes(1);
});
it('se a resposta da submissão se perde, recupera usando a mesma chave e os mesmos bytes sem duplicar o envio', async () => {
  const f = fixture();
  let physical = 0;
  const seen = new Set<string>();
  f.bridge.printPdf.mockImplementation(async (request) => {
    if (!seen.has(request.idempotencyKey)) {
      seen.add(request.idempotencyKey);
      physical++;
      throw new Error('TIMEOUT');
    }
    return { jobId: 'native-job' };
  });
  await expect(f.queue.step()).rejects.toThrow('TIMEOUT');
  expect(f.queue.pending).toBe(true);
  await f.queue.step();
  expect(physical).toBe(1);
  expect(f.bridge.printPdf.mock.calls[0][0].data).toEqual(f.bridge.printPdf.mock.calls[1][0].data);
  expect(f.calls.filter((c) => c.path.endsWith('/prepare'))).toHaveLength(1);
});
it('recupera trabalho nativo conhecido sem baixar ou reenviar o documento', async () => {
  const f = fixture('pdf', 'native-job');
  await f.queue.step();
  expect(f.bridge.printPdf).not.toHaveBeenCalled();
  expect(f.calls.some((c) => c.path.includes('/document?'))).toBe(false);
  expect(f.bridge.getJob).toHaveBeenCalledWith('native-job');
});
it('resultado incerto não gera nova via automática e ESC/POS usa os bytes originais', async () => {
  const f = fixture('escpos', null, 'unknown');
  await f.queue.step();
  await f.queue.step();
  expect(f.bridge.printRaw).toHaveBeenCalledTimes(1);
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }));
  expect(f.calls.filter((c) => c.path.endsWith('/status')).at(-1)?.body.state).toBe('unknown');
});
it('não reenvia silenciosamente um pedido antigo sem identificador nativo', async () => {
  const f = fixture();
  f.delivery.createdAt = new Date(Date.now() - 8 * 86400000).toISOString();
  await f.queue.step();
  expect(f.bridge.printPdf).not.toHaveBeenCalled();
  expect(f.calls.at(-1)?.body.state).toBe('unknown');
});
it('cancelamento após timeout descarta os bytes e impede reenvio do trabalho', async () => {
  const f = fixture();
  f.bridge.printPdf.mockRejectedValueOnce(new Error('TIMEOUT'));
  await expect(f.queue.step()).rejects.toThrow('TIMEOUT');
  expect(f.queue.pending).toBe(true);
  f.call.mockImplementationOnce(async () => ({ status: 'CANCELLED' }));
  await f.queue.step();
  expect(f.queue.pending).toBe(false);
  expect(f.bridge.printPdf).toHaveBeenCalledTimes(1);
  expect(f.bridge.getJob).not.toHaveBeenCalled();
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
});
it('confere cancelamento novamente depois do download e antes de enviar ao PrintBridge', async () => {
  const f = fixture();
  let checks = 0;
  const original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (path, body, binary) =>
    path.endsWith('/state') && ++checks === 2
      ? { status: 'CANCELLED' }
      : original(path, body, binary),
  );
  await f.queue.step();
  expect(checks).toBe(2);
  expect(f.bridge.printPdf).not.toHaveBeenCalled();
  expect(f.queue.pending).toBe(false);
});
it('respeita cancelamento ocorrido durante envio nativo sem voltar a processar ou repetir', async () => {
  const f = fixture();
  const original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (path, body, binary) =>
    path.endsWith('/status') ? { status: 'CANCELLED' } : original(path, body, binary),
  );
  await f.queue.step();
  await f.queue.step();
  expect(f.bridge.printPdf).toHaveBeenCalledTimes(1);
  expect(f.bridge.getJob).not.toHaveBeenCalled();
  expect(f.queue.pending).toBe(false);
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
});
