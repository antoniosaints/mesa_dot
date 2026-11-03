import { useManagementShortcuts } from './management-shortcut-context.js';
import { orderLocationLabel } from '../../shared/src/order-location.js';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './common.js';
import { Icon } from './appearance.js';
import { api, session, type Data } from './client.js';
import { canDeliverTicket } from './ticket-state.js';
import { createTicketFrameReader } from './ticket-frame-reader.js';
import {
  cameraErrorMessage,
  isCompleteTicketScan,
  normalizeTicketScan,
} from './ticket-scan-code.js';
interface ScanResult {
  kind: 'success' | 'error' | 'info';
  message: string;
  ticket?: Data;
}
export function QuickScanDialog({
  table,
  onClose,
  onDelivered,
}: {
  table?: Data;
  onClose: () => void;
  onDelivered: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<'reader' | 'camera'>('reader');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [delivered, setDelivered] = useState<Data[]>([]);
  const [count, setCount] = useState(0);
  const [cameraState, setCameraState] = useState<'off' | 'starting' | 'active'>('off');
  const [cameraError, setCameraError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const active = useRef(true);
  const processing = useRef(false);
  const completed = useRef(new Set<string>());
  const cameraCode = useRef('');
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const submitRef = useRef<(value: string) => Promise<void>>(async () => {});
  function releaseCamera() {
    generation.current++;
    clearTimeout(cameraTimer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
    }
  }
  useEffect(() => {
    active.current = true;
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      active.current = false;
      releaseCamera();
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  async function read(value: string) {
    if (processing.current || !active.current) return;
    const token = normalizeTicketScan(value);
    if (!token) return;
    setCode('');
    if (!navigator.onLine) {
      setResult({
        kind: 'error',
        message: 'Sem conexão. A ficha não foi baixada. Reconecte antes de ler novamente.',
      });
      return;
    }
    if (!isCompleteTicketScan(token)) {
      setResult({
        kind: 'error',
        message:
          'Código inválido. Leia o QR Code ou o código de barras da ficha emitida pelo sistema.',
      });
      input.current?.focus();
      return;
    }
    if (completed.current.has(token)) {
      setResult({
        kind: 'info',
        message: 'Esta ficha já foi baixada nesta leitura. Apresente a próxima ficha.',
      });
      input.current?.focus();
      return;
    }
    processing.current = true;
    setBusy(true);
    setResult(null);
    let ticket: Data | undefined;
    try {
      ticket = (await api('/tickets/resolve', { token })) as Data;
      if (table && ticket.table_id !== table.id)
        throw new Error(
          `Ficha de ${orderLocationLabel(ticket)}. A leitura está limitada à Mesa ${table.number}. Nenhuma baixa realizada.`,
        );
      if (ticket.status === 'REDEEMED')
        throw new Error('Esta ficha já foi entregue. Nenhuma nova baixa foi realizada.');
      if (!canDeliverTicket(ticket, session()?.actor?.id))
        throw new Error(
          ticket.request_claimed_by && ticket.request_claimed_by !== session()?.actor?.id
            ? 'Solicitação atribuída a outro garçom. A entrega deve ser concluída por ele.'
            : 'Ficha indisponível para entrega. Confira o preparo e a situação do pedido.',
        );
      await api('/tickets/' + ticket.id + '/redeem', { token });
      completed.current.add(token);
      if (active.current) {
        setResult({
          kind: 'success',
          message: 'Entrega registrada. Ficha baixada automaticamente.',
          ticket,
        });
        // Tokens de resgate não são armazenados no histórico visual.
        const receipt = {
          id: ticket.id,
          public_number: ticket.public_number,
          product: ticket.product,
          table_number: ticket.table_number,
          service_mode: ticket.service_mode,
          tab_label: ticket.tab_label,
        };
        setDelivered((previous) => [receipt, ...previous].slice(0, 5));
        setCount((previous) => previous + 1);
      }
      try {
        await onDelivered();
      } catch {
        if (active.current)
          setResult({
            kind: 'success',
            message: 'Entrega registrada. A atualização da listagem está pendente; use Recarregar.',
            ticket,
          });
      }
    } catch (error) {
      if (active.current)
        setResult({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Não foi possível baixar a ficha. Confira a conexão e tente novamente.',
          ticket,
        });
    } finally {
      processing.current = false;
      if (active.current) {
        setBusy(false);
        if (currentMode.current === 'reader') requestAnimationFrame(() => input.current?.focus());
      }
    }
  }
  submitRef.current = read;
  async function startCamera() {
    releaseCamera();
    setMode('camera');
    setCameraError('');
    setCameraState('starting');
    cameraCode.current = '';
    const run = generation.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'A câmera exige HTTPS ou localhost. Abra o sistema por um endereço seguro ou use o leitor físico.',
      );
      setCameraState('off');
      return;
    }
    try {
      const decodeFrame = await createTicketFrameReader();
      if (!active.current || run !== generation.current) return;
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (!active.current || run !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const preview = video.current!;
      preview.srcObject = media;
      await preview.play();
      if (!active.current || run !== generation.current) return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Leitura de imagem indisponível.');
      const loop = () => {
        if (!active.current || run !== generation.current) return;
        if (!processing.current && preview.readyState >= 2 && preview.videoWidth) {
          const width = Math.min(1280, preview.videoWidth);
          const height = Math.round((width * preview.videoHeight) / preview.videoWidth);
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          context.drawImage(preview, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height);
          const value = decodeFrame(canvas, pixels);
          if (value && cameraCode.current !== value) {
            cameraCode.current = value;
            void submitRef.current(value);
          }
        }
        cameraTimer.current = setTimeout(loop, 200);
      };
      setCameraState('active');
      loop();
    } catch (error) {
      if (active.current && run === generation.current) {
        releaseCamera();
        setCameraState('off');
        setCameraError(cameraErrorMessage(error));
      }
    }
  }
  return (
    <Modal
      title="Leitura rápida de fichas"
      className="ticket-quick-scan-modal"
      onClose={onClose}
      closeDisabled={busy}
    >
      <div className="ticket-scan-context">
        <Icon name={table ? 'tables' : 'orders'} size={19} />
        <div>
          <strong>{table ? 'Mesa ' + table.number : 'Toda a unidade · mesas e balcão'}</strong>
          <p>Cada leitura válida registra a entrega de uma unidade, sem confirmação adicional.</p>
        </div>
        <span className="badge available">Baixa automática</span>
      </div>
      <div className="ticket-scan-modes" role="group" aria-label="Método de leitura">
        <button
          type="button"
          aria-pressed={mode === 'reader'}
          disabled={busy}
          onClick={() => {
            releaseCamera();
            setCameraState('off');
            setMode('reader');
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          <Icon name="scan" size={18} />
          Leitor / código
        </button>
        <button
          type="button"
          aria-pressed={mode === 'camera'}
          disabled={busy || cameraState === 'starting'}
          onClick={() => void startCamera()}
        >
          <Icon name="camera" size={18} />
          Câmera
        </button>
      </div>
      {!online && (
        <p className="flow-note" role="alert">
          Sem conexão. Nenhuma entrega será registrada offline.
        </p>
      )}
      <form
        hidden={mode !== 'reader'}
        className="ticket-scan-form"
        onSubmit={(event) => {
          event.preventDefault();
          void read(code);
        }}
      >
        <label>
          Código da ficha
          <input
            ref={input}
            data-modal-autofocus
            aria-label="Código da ficha"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Aponte o leitor ou cole o código da ficha…"
            readOnly={busy}
            disabled={!online}
            maxLength={200}
            value={code}
            onChange={(event) => {
              const next = event.target.value;
              setCode(next);
              if (isCompleteTicketScan(next)) void read(next);
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (isCompleteTicketScan(text)) {
                event.preventDefault();
                void read(text);
              }
            }}
          />
        </label>
        <button className="primary" disabled={busy || !online || !code.trim()}>
          <Icon name="ready" size={17} />
          Ler e baixar
        </button>
        <p className="field-hint">
          O leitor USB ou Bluetooth funciona como teclado. Códigos completos são processados ao
          terminar a leitura; Enter também envia.
        </p>
      </form>
      <div hidden={mode !== 'camera'} className="ticket-scan-camera">
        <video ref={video} playsInline muted aria-label="Prévia da câmera para leitura de fichas" />
        <div className="ticket-camera-caption" role="status">
          {cameraState === 'starting'
            ? 'Solicitando acesso à câmera…'
            : cameraState === 'active'
              ? 'Enquadre o QR Code ou Code 128. Após a baixa, apresente a próxima ficha.'
              : 'Câmera parada.'}
        </div>
        {cameraError && (
          <p className="field-error" role="alert">
            {cameraError}
          </p>
        )}
        <div className="button-row">
          <button
            type="button"
            disabled={busy || cameraState === 'starting'}
            onClick={() => void startCamera()}
          >
            <Icon name="refresh" size={16} />
            Reiniciar câmera
          </button>
          <button
            type="button"
            disabled={busy || cameraState === 'off'}
            onClick={() => {
              releaseCamera();
              setCameraState('off');
            }}
          >
            <Icon name="close" size={16} />
            Parar câmera
          </button>
        </div>
      </div>
      {busy && (
        <p className="ticket-scan-processing" role="status">
          <Icon name="refresh" size={17} />
          Conferindo e registrando entrega…
        </p>
      )}
      {result && (
        <div
          className={'ticket-scan-result ' + result.kind}
          role={result.kind === 'error' ? 'alert' : 'status'}
        >
          <Icon
            name={result.kind === 'success' ? 'ready' : result.kind === 'error' ? 'close' : 'info'}
            size={23}
          />
          <div>
            <strong>{result.message}</strong>
            {result.ticket && (
              <p>
                {result.ticket.product} · {orderLocationLabel(result.ticket)} ·{' '}
                {result.ticket.tab_label} · Ficha {result.ticket.public_number}
              </p>
            )}
          </div>
        </div>
      )}
      <section className="ticket-scan-history" aria-label="Entregas realizadas nesta leitura">
        <div className="section-head">
          <h3>Últimas entregas</h3>
          <span>{count} ficha(s) baixada(s)</span>
        </div>
        {!delivered.length ? (
          <p className="muted small">Aguardando a primeira leitura.</p>
        ) : (
          <ul>
            {delivered.map((ticket) => (
              <li key={ticket.id}>
                <Icon name="ready" size={17} />
                <div>
                  <strong>{ticket.product}</strong>
                  <small>
                    {orderLocationLabel(ticket)} · {ticket.tab_label}
                  </small>
                </div>
                <span>{ticket.public_number}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="modal-footer">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setCode('');
            setResult(null);
            cameraCode.current = '';
            if (mode === 'reader') input.current?.focus();
          }}
        >
          <Icon name="scan" size={17} />
          Nova leitura
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Concluir leitura
        </button>
      </div>
    </Modal>
  );
}
export function TicketQuickScanButton({
  table,
  onDelivered,
}: {
  table?: Data;
  onDelivered: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const shortcuts = useManagementShortcuts();
  const permissions: string[] = session()?.actor?.permissions ?? [];
  if (!permissions.includes('ticket.redeem') || !permissions.includes('ticket.view')) return null;
  return (
    <>
      <button
        type="button"
        className="ticket-quick-scan-button"
        aria-label="Ler ficha"
        title={'Ler ficha e registrar entrega automaticamente' + (shortcuts ? ' — F1' : '')}
        aria-keyshortcuts={shortcuts ? 'F1' : undefined}
        onClick={() => (shortcuts ? shortcuts.openReader({ table, onDelivered }) : setOpen(true))}
      >
        <Icon name="scan" size={18} />
        <span>Ler ficha</span>
        {shortcuts && (
          <kbd className="management-keycap" aria-hidden="true">
            F1
          </kbd>
        )}
      </button>
      {open && !shortcuts && (
        <QuickScanDialog table={table} onDelivered={onDelivered} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
