import { RemotePrintHint } from './print-stations.js';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Printer, Copy, FileText } from 'lucide-react';
import { api, type Data } from './client.js';
import { Modal, ModalCloseButton } from './common.js';
import { PdfPreviewModal } from './pdf-preview.js';
import { SearchSelect } from './controls.js';
import { copyText } from './clipboard.js';
import { useToasts } from './toasts.js';
import {
  tableQrHtml,
  type TableQrDocument,
  type TableQrFormat,
} from '../../shared/src/table-qr-print.js';
export function TableQrButton({ table }: { table: Data }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <QrCode size={17} />
        QR Code da mesa
      </button>
      {open && <TableQrDialog table={table} onClose={() => setOpen(false)} />}
    </>
  );
}
function TableQrDialog({ table, onClose }: { table: Data; onClose: () => void }) {
  const [document, setDocument] = useState<TableQrDocument | null>(null),
    [qr, setQr] = useState(''),
    [error, setError] = useState(''),
    [format, setFormat] = useState<TableQrFormat>('A4'),
    [preview, setPreview] = useState(false);
  const [printers, setPrinters] = useState<Data[]>([]),
    [printer, setPrinter] = useState(''),
    [paper, setPaper] = useState<58 | 80>(80),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<Data | null>(null),
    [revision, setRevision] = useState(0);
  const locked = useRef(false),
    active = useRef(true),
    key = useRef(crypto.randomUUID()),
    toast = useToasts();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setDocument(null);
    setQr('');
    setError('');
    void api(`/tables/${table.id}/qr?format=${format}`)
      .then(async (value: TableQrDocument) => {
        const image = await QRCode.toDataURL(value.url, {
          width: 700,
          margin: 4,
          errorCorrectionLevel: 'M',
        });
        if (live) {
          setDocument(value);
          setQr(image);
        }
      })
      .catch((reason) => {
        if (live) setError(reason.message);
      });
    return () => {
      live = false;
    };
  }, [table.id, format, revision]);
  useEffect(() => {
    let live = true;
    void api('/receipts/printers')
      .then((devices) => {
        if (live) {
          setPrinters(devices);
          setPrinter(devices[0]?.id ?? '');
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!job?.id || ['COMPLETED', 'CANCELLED'].includes(job.status) || job.attempts >= 5) return;
    let live = true,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void api('/tables/qr/jobs/' + job.id)
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
  const queued =
    job &&
    (['PENDING', 'PROCESSING'].includes(job.status) ||
      (job.status === 'FAILED' && job.attempts < 5));
  async function thermal() {
    if (locked.current || !printer) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api(
        `/tables/${table.id}/qr/print`,
        { printer_id: printer, paper_width: paper },
        'POST',
        key.current,
      );
      if (active.current) setJob(result);
      key.current = crypto.randomUUID();
      toast.success('QR da mesa enviado à fila de impressão.');
    } catch (reason) {
      if (active.current) setError((reason as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function printBrowser() {
    if (!document || !qr) return;
    const popup = window.open('', '_blank', 'popup,width=720,height=820');
    if (!popup) {
      setError('Permita a abertura da janela de impressão no navegador.');
      return;
    }
    popup.document.write(tableQrHtml(document, qr));
    popup.document.close();
    const image = popup.document.querySelector('img');
    void (image ? image.decode() : Promise.resolve())
      .then(() => {
        popup.focus();
        popup.print();
      })
      .catch(() => setError('Não foi possível carregar o QR para imprimir. Tente novamente.'));
  }
  return (
    <Modal
      title={'QR Code da mesa ' + table.number}
      className="table-qr-print-modal"
      onClose={onClose}
      closeDisabled={busy}
    >
      <div className="table-qr-print-body">
        <p className="modal-description">
          Reimprima o QR para substituir a etiqueta da mesa. O código continua vinculado à mesma
          mesa e não altera os pedidos.
        </p>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button onClick={() => setRevision((v) => v + 1)}>Tentar novamente</button>
          </div>
        )}
        <div className="table-qr-print-card" aria-label="QR Code para os clientes">
          {document && qr ? (
            <>
              <strong>{document.establishment_name}</strong>
              <h3>Mesa {document.table_number}</h3>
              <img src={qr} alt={'QR Code da mesa ' + document.table_number} />
              <p>
                Escaneie para acessar o cardápio
                <br />e fazer seu pedido.
              </p>
            </>
          ) : (
            <p role="status">Preparando QR Code…</p>
          )}
        </div>
        <div className="table-qr-link">
          <label>
            Link da mesa
            <input
              aria-label="Link da mesa"
              readOnly
              value={document?.url ?? ''}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button
            disabled={!document}
            onClick={() =>
              void copyText(document!.url)
                .then(() => toast.success('Link da mesa copiado.'))
                .catch((reason) => setError(reason.message))
            }
          >
            <Copy size={16} />
            Copiar link
          </button>
        </div>
        <label>
          Formato para PDF e navegador
          <select
            aria-label="Formato do QR para impressão"
            value={format}
            disabled={busy}
            onChange={(event) => setFormat(event.target.value as TableQrFormat)}
          >
            <option value="A4">Folha A4 · etiqueta para recortar</option>
            <option value="LABEL">Etiqueta · 80 × 100 mm</option>
            <option value="80">Térmica · 80 mm</option>
            <option value="58">Térmica · 58 mm</option>
          </select>
        </label>
        <section className="table-qr-thermal">
          <h3>
            <Printer size={18} />
            Imprimir direto na térmica
          </h3>
          <p className="field-hint">
            Envie para uma impressora vinculada ao computador da unidade. Você pode solicitar pelo
            celular, inclusive fora do local.
          </p>
          <RemotePrintHint printer={printer} />
          {printers.length ? (
            <>
              <div className="table-qr-printer-fields">
                <label>
                  Impressora
                  <SearchSelect
                    label="Impressora do QR da mesa"
                    value={printer}
                    onChange={(value) => {
                      setPrinter(value);
                      key.current = crypto.randomUUID();
                    }}
                    options={printers.map((device) => ({
                      id: device.id,
                      name: device.name + ' · ' + device.sector,
                    }))}
                    allowClear={false}
                    disabled={busy || Boolean(queued)}
                  />
                </label>
                <label>
                  Papel térmico
                  <select
                    aria-label="Papel térmico do QR"
                    value={paper}
                    disabled={busy || Boolean(queued)}
                    onChange={(event) => {
                      setPaper(Number(event.target.value) as 58 | 80);
                      key.current = crypto.randomUUID();
                    }}
                  >
                    <option value="80">80 mm</option>
                    <option value="58">58 mm</option>
                  </select>
                </label>
              </div>
              <button
                disabled={!document || !printer || busy || Boolean(queued) || !navigator.onLine}
                onClick={() => void thermal()}
              >
                <Printer size={16} />
                {queued ? 'Aguardando impressão…' : 'Imprimir na térmica'}
              </button>
            </>
          ) : (
            <p className="small muted">
              Cadastre uma impressora para o envio direto. A impressão pelo navegador continua
              disponível.
            </p>
          )}
          {job && (
            <p role="status" className="field-hint">
              {job.status === 'COMPLETED'
                ? 'Envio ao dispositivo concluído.'
                : job.status === 'CANCELLED'
                  ? 'Impressão cancelada.'
                  : job.status === 'FAILED'
                    ? 'Falha no envio: ' + (job.last_error ?? 'Confira a estação e a impressora.')
                    : 'QR na fila. Aguardando a estação de impressão.'}
            </p>
          )}
        </section>
      </div>
      <div className="modal-footer">
        <ModalCloseButton disabled={busy}>Fechar QR</ModalCloseButton>
        <button disabled={!document || busy} onClick={() => setPreview(true)}>
          <FileText size={16} />
          Visualizar PDF
        </button>
        <button className="primary" disabled={!document || !qr || busy} onClick={printBrowser}>
          <Printer size={16} />
          Imprimir no navegador
        </button>
      </div>
      {preview && (
        <PdfPreviewModal
          title={'PDF do QR · Mesa ' + table.number}
          source={`/tables/${table.id}/qr.pdf?format=${format}`}
          filename={`qr-mesa-${table.number}-${format}.pdf`}
          onClose={() => setPreview(false)}
        />
      )}
    </Modal>
  );
}
