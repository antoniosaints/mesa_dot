import type { PrintBridgeClient } from '@antoniosantos1999/printbridge';
import type { Data } from './client.js';
export interface BridgeBinding {
  printerId: string;
  format: 'pdf' | 'escpos';
  paperWidth: 58 | 80;
}
export type BridgeCall = (path: string, body?: unknown, binary?: boolean) => Promise<any>;
export interface BridgeActivity {
  id: string;
  kind: string;
  status: string;
  message: string;
}
/** One job at a time; native idempotency keys and documents are frozen by the API. */
export class PrintBridgeQueue {
  private current: {
    job: Data;
    delivery: Data;
    bytes?: Uint8Array;
    nativeId?: string;
    registered?: boolean;
  } | null = null;
  private stepping = false;
  constructor(
    private bridge: Pick<
      PrintBridgeClient,
      'isConnected' | 'isAuthorized' | 'printPdf' | 'printRaw' | 'getJob'
    >,
    private call: BridgeCall,
    private bindings: Record<string, BridgeBinding>,
    private origin: string,
    private activity: (value: BridgeActivity) => void,
  ) {}
  get pending() {
    return Boolean(this.current);
  }
  private async stopIfInactive() {
    if (!this.current) return true;
    const { job, delivery } = this.current;
    const state = await this.call(`/print/jobs/${job.id}/state`);
    if (state.status === 'PROCESSING' && state.generation === delivery.generation) return false;
    this.activity({
      id: job.id,
      kind: job.document_kind,
      status: state.status === 'CANCELLED' ? 'cancelled' : 'stopped',
      message:
        state.status === 'CANCELLED'
          ? 'Cancelada no sistema; novos envios interrompidos.'
          : 'Trabalho encerrado ou substituído; envio interrompido.',
    });
    this.current = null;
    return true;
  }
  private cancelled(id: string, kind: string) {
    this.activity({
      id,
      kind,
      status: 'cancelled',
      message: 'Cancelada no sistema. Confira a fila local se o envio já havia começado.',
    });
    this.current = null;
  }
  async step() {
    if (this.stepping) return;
    this.stepping = true;
    try {
      if (!this.bridge.isConnected || !this.bridge.isAuthorized)
        throw new Error(
          'PrintBridge desconectado. Conecte novamente para recuperar o envio anterior.',
        );
      if (!this.current) {
        const ids = Object.keys(this.bindings);
        if (!ids.length) return;
        const job = await this.call('/print/jobs/claim', { printer_ids: ids });
        if (job.idle) return;
        const binding = this.bindings[job.printer_id];
        if (!binding) throw new Error('Impressora da fila sem vínculo local.');
        const delivery = await this.call(`/print/jobs/${job.id}/bridge/prepare`, {
          origin: this.origin,
          printer_id: binding.printerId,
          format: binding.format,
          paper_width: binding.paperWidth,
        });
        this.current = {
          job,
          delivery,
          nativeId: delivery.jobId ?? undefined,
          registered: Boolean(delivery.jobId),
        };
      }
      const current = this.current,
        d = current.delivery,
        id = current.job.id;
      if (await this.stopIfInactive()) return;
      if (!current.nativeId) {
        // The native agent deduplicates for seven days after terminal state.
        // Never silently recreate an old submission whose response was lost.
        if (Date.now() - Date.parse(d.createdAt) > 6 * 86400000) {
          await this.call(`/print/jobs/${id}/bridge/status`, {
            generation: d.generation,
            state: 'unknown',
            error: 'Envio antigo sem identificador local. Confira antes de solicitar outra via.',
          });
          this.activity({
            id,
            kind: current.job.document_kind,
            status: 'unknown',
            message: 'Envio antigo exige conferência.',
          });
          this.current = null;
          return;
        }
        if (!current.bytes) {
          const blob: Blob = await this.call(
            `/print/jobs/${id}/bridge/document?generation=${d.generation}`,
            undefined,
            true,
          );
          current.bytes = new Uint8Array(await blob.arrayBuffer());
        }
        if (await this.stopIfInactive()) return;
        const request = {
          printerId: d.printerId,
          idempotencyKey: d.idempotencyKey,
          data: current.bytes,
        };
        const result =
          d.format === 'pdf'
            ? await this.bridge.printPdf({
                ...request,
                options: { copies: 1, orientation: 'portrait', fitToPage: false },
              })
            : await this.bridge.printRaw({ ...request, language: 'escpos' });
        current.nativeId = result.jobId;
      }
      if (!current.registered) {
        const registered = await this.call(`/print/jobs/${id}/bridge/status`, {
          generation: d.generation,
          job_id: current.nativeId,
          state: 'queued',
        });
        if (registered.status === 'CANCELLED') {
          this.cancelled(id, current.job.document_kind);
          return;
        }
        current.registered = true;
      }
      const job = await this.bridge.getJob(current.nativeId!);
      const result = await this.call(`/print/jobs/${id}/bridge/status`, {
        generation: d.generation,
        job_id: job.id,
        state: job.state,
        ...(job.error ? { error: job.error.slice(0, 255) } : {}),
      });
      if (result.status === 'CANCELLED') {
        this.cancelled(id, current.job.document_kind);
        return;
      }
      const labels: Record<string, string> = {
        queued: 'Na fila do PrintBridge',
        processing: 'Enviando ao sistema de impressão',
        submitted: 'Entregue à fila de impressão do sistema',
        failed: 'Falha de impressão; corrija a causa e solicite outra via',
        unknown: 'Resultado incerto; confira a saída antes de solicitar outra via',
      };
      this.activity({
        id,
        kind: current.job.document_kind,
        status: job.state,
        message: labels[job.state] ?? job.state,
      });
      if (['submitted', 'failed', 'unknown'].includes(job.state)) this.current = null;
    } finally {
      this.stepping = false;
    }
  }
}
