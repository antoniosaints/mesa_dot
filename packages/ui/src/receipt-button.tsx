import { RemotePrintHint } from './print-stations.js';
import { useEffect, useRef, useState } from 'react';
import { PdfPreviewModal } from './pdf-preview.js';
import { Modal, ModalCloseButton } from './common.js';
import { SearchSelect } from './controls.js';
import { Icon } from './appearance.js';
import { api, session, type Data } from './client.js';
import { useToasts } from './toasts.js';
import { receiptLines, receiptHtml, type ReceiptDocument } from '../../shared/src/receipt.js';
export function ReceiptButton({
  scope,
  id,
  label,
}: {
  scope: 'ORDER' | 'TAB';
  id: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (session()?.actor?.kind !== 'STAFF' || !session()?.actor?.permissions?.includes('table.view'))
    return null;
  return (
    <>
      <button onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="printing" size={15} />
        {label ?? 'Emitir cupom'}
      </button>
      {open && <ReceiptDialog scope={scope} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
export function ReceiptDialog({
  scope,
  id,
  onClose,
}: {
  scope: 'ORDER' | 'TAB';
  id: string;
  onClose: () => void;
}) {
  const [paper, setPaper] = useState<58 | 80>(80),
    [receipt, setReceipt] = useState<ReceiptDocument | null>(null),
    [printers, setPrinters] = useState<Data[]>([]),
    [printer, setPrinter] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [job, setJob] = useState<Data | null>(null),
    [retry, setRetry] = useState(0),
    [previewPdf, setPreviewPdf] = useState(false);
  const active = useRef(true),
    toast = useToasts();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const base = `/${scope === 'ORDER' ? 'orders' : 'tabs'}/${id}/receipt`;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void Promise.all([api(base + '?paper_width=' + paper), api('/receipts/printers')])
      .then(([doc, devices]) => {
        if (live) {
          setReceipt(doc);
          setPrinters(devices);
          setPrinter((previous) =>
            devices.some((p: Data) => p.id === previous) ? previous : (devices[0]?.id ?? ''),
          );
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setReceipt(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [scope, id, paper, retry]);
  useEffect(() => {
    if (!job?.id || ['COMPLETED', 'CANCELLED'].includes(job.status) || job.attempts >= 5) return;
    let live = true;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void api('/receipts/jobs/' + job.id)
        .then((value) => {
          if (live) setJob(value);
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    }, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status, job?.attempts]);
  function printBrowser() {
    if (!receipt) return;
    const popup = window.open('', '_blank', 'popup,width=460,height=720');
    if (!popup) {
      setError('Permita a abertura da janela de impressão neste navegador.');
      return;
    }
    popup.document.write(receiptHtml(receipt));
    popup.document.close();
    popup.focus();
    popup.print();
    toast.info('Janela de impressão aberta. Selecione a impressora e o papel correspondente.');
  }
  async function thermal() {
    if (!receipt || !printer || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(base + '/print', { printer_id: printer, paper_width: paper });
      if (active.current) setJob(result);
      toast.success('Cupom enviado para a fila de impressão.');
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const queued = Boolean(
    job &&
    (['PENDING', 'PROCESSING'].includes(job.status) ||
      (job.status === 'FAILED' && job.attempts < 5)),
  );
  return (
    <Modal
      className="receipt-modal"
      title={'Cupom ' + (scope === 'ORDER' ? 'do pedido' : 'da comanda')}
      onClose={onClose}
      closeDisabled={busy}
    >
      <div className="receipt-body">
        <div className="receipt-controls">
          <label>
            Largura do papel
            <select
              aria-label="Largura do cupom"
              value={paper}
              onChange={(e) => setPaper(Number(e.target.value) as 58 | 80)}
              disabled={busy || queued}
            >
              <option value="80">80 mm</option>
              <option value="58">58 mm</option>
            </select>
          </label>
          <button onClick={() => setRetry((v) => v + 1)} disabled={loading || busy}>
            <Icon name="refresh" size={16} />
            Atualizar valores
          </button>
        </div>
        <p className="field-hint">
          Cupom não fiscal para conferência do consumo. A emissão não registra pagamento nem altera
          pedidos ou fichas.
        </p>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <p role="status" className="muted">
            Preparando cupom…
          </p>
        ) : (
          receipt && (
            <div className="receipt-preview" aria-label="Prévia do cupom">
              <pre style={{ maxWidth: paper + 'mm' }}>{receiptLines(receipt).join('\n')}</pre>
            </div>
          )
        )}
        <section className="receipt-thermal">
          <h3>
            <Icon name="printing" size={18} />
            Envio direto para térmica
          </h3>
          {printers.length ? (
            <>
              <label>
                Impressora
                <SearchSelect
                  label="Impressora do cupom"
                  options={printers.map((p) => ({ id: p.id, name: p.name + ' · ' + p.sector }))}
                  value={printer}
                  onChange={setPrinter}
                  allowClear={false}
                  disabled={busy || Boolean(queued)}
                />
              </label>
              <p className="field-hint">
                O cupom é enviado à fila da unidade e impresso pelo computador vinculado à
                impressora, mesmo quando solicitado fora do local.
              </p>
              <RemotePrintHint printer={printer} />
              <button
                onClick={() => void thermal()}
                disabled={busy || loading || !receipt || !printer || Boolean(queued)}
              >
                <Icon name="send" size={16} />
                {queued
                  ? 'Aguardando impressão…'
                  : job
                    ? 'Enviar outra via para térmica'
                    : 'Enviar para térmica'}
              </button>
            </>
          ) : (
            <p className="muted small">
              Nenhuma térmica cadastrada nesta unidade. Use a impressão pelo navegador ou cadastre a
              impressora e configure o agente no menu Impressão.
            </p>
          )}
          {job && (
            <div
              className={'receipt-job ' + (job.status === 'FAILED' ? 'error' : '')}
              role="status"
            >
              {job.status === 'CANCELLED'
                ? 'Impressão cancelada na fila do sistema.'
                : job.status === 'COMPLETED'
                  ? 'Envio ao dispositivo concluído.'
                  : job.status === 'PROCESSING'
                    ? 'Agente enviando cupom para a impressora…'
                    : job.status === 'FAILED'
                      ? 'Falha no envio: ' + (job.last_error ?? 'Confira a impressora e o agente.')
                      : 'Cupom na fila. Aguardando o agente de impressão.'}
            </div>
          )}
        </section>
      </div>
      <div className="modal-footer receipt-footer">
        <ModalCloseButton disabled={busy}>Fechar cupom</ModalCloseButton>
        <button onClick={() => setPreviewPdf(true)} disabled={busy || loading || !receipt}>
          <Icon name="eye" size={16} />
          Visualizar PDF
        </button>
        <button className="primary" onClick={printBrowser} disabled={busy || loading || !receipt}>
          <Icon name="printing" size={16} />
          Imprimir pelo navegador
        </button>
      </div>
      {previewPdf && (
        <ReceiptPdfDialog
          scope={scope}
          id={id}
          initialPaper={paper}
          onClose={() => setPreviewPdf(false)}
        />
      )}
    </Modal>
  );
}

export function ReceiptPdfDialog({
  scope,
  id,
  initialPaper = 80,
  onClose,
}: {
  scope: 'ORDER' | 'TAB';
  id: string;
  initialPaper?: 58 | 80;
  onClose: () => void;
}) {
  const [paper, setPaper] = useState<58 | 80>(initialPaper);
  return (
    <PdfPreviewModal
      title={'Prévia PDF ' + (scope === 'ORDER' ? 'do pedido' : 'da comanda')}
      source={`/${scope === 'ORDER' ? 'orders' : 'tabs'}/${id}/receipt.pdf?paper_width=${paper}`}
      filename={`cupom-${scope === 'ORDER' ? 'pedido' : 'comanda'}-${id.slice(0, 8)}-${paper}mm.pdf`}
      toolbar={
        <label>
          Largura do papel
          <select
            aria-label="Largura do PDF"
            value={paper}
            onChange={(event) => setPaper(Number(event.target.value) as 58 | 80)}
          >
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
          </select>
        </label>
      }
      onClose={onClose}
    />
  );
}
