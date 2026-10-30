import { useEffect, useRef, useState } from 'react';
import { tableCodeFromQr } from '../../shared/src/table-qr.js';
import { api } from './client.js';
import { Modal, ModalCloseButton } from './common.js';
import { Icon } from './appearance.js';
import { cameraErrorMessage } from './ticket-scan-code.js';

export function TableQrReader({
  slug,
  onRead,
  onClose,
}: {
  slug: string;
  onRead: (code: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(''),
    [error, setError] = useState('');
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off'),
    [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  const generation = useRef(0),
    alive = useRef(true),
    processing = useRef(false),
    last = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const readRef = useRef<(text: string) => Promise<void>>(async () => {});
  function stop() {
    generation.current++;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
    };
  }, []);
  async function read(text: string) {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    setError('');
    try {
      const code = tableCodeFromQr(text);
      await api(`/public/${slug}/tables/resolve`, { table_code: code });
      if (!alive.current) return;
      stop();
      onRead(code);
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : 'Não foi possível ler a mesa.');
    } finally {
      processing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  readRef.current = read;
  async function start() {
    stop();
    setError('');
    setCamera('starting');
    last.current = '';
    const version = generation.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('A câmera exige HTTPS ou localhost. Você também pode colar o link da mesa abaixo.');
      setCamera('off');
      return;
    }
    try {
      const { default: jsQR } = await import('jsqr');
      if (!alive.current || version !== generation.current) return;
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      });
      if (!alive.current || version !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const preview = video.current!;
      preview.srcObject = media;
      await preview.play();
      if (!alive.current || version !== generation.current) return;
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Leitura de imagem indisponível.');
      setCamera('on');
      const frame = () => {
        if (!alive.current || version !== generation.current) return;
        if (!processing.current && preview.readyState >= 2 && preview.videoWidth) {
          canvas.width = Math.min(1280, preview.videoWidth);
          canvas.height = Math.round((canvas.width * preview.videoHeight) / preview.videoWidth);
          context.drawImage(preview, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(pixels.data, canvas.width, canvas.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (result && result.data !== last.current) {
            last.current = result.data;
            void readRef.current(result.data);
          }
        }
        timer.current = setTimeout(frame, 200);
      };
      frame();
    } catch (reason) {
      if (alive.current && version === generation.current) {
        stop();
        setCamera('off');
        setError(cameraErrorMessage(reason));
      }
    }
  }
  return (
    <Modal
      title="Ler QR Code da mesa"
      className="table-qr-modal"
      onClose={onClose}
      closeDisabled={busy}
    >
      <p className="modal-description">
        Aponte a câmera para o QR Code da mesa deste estabelecimento ou cole o link para continuar.
      </p>
      <div className="table-qr-camera">
        <video
          ref={video}
          playsInline
          muted
          aria-label="Câmera para leitura do QR Code da mesa"
          hidden={camera === 'off'}
        />
        {camera === 'off' && <Icon name="scan" size={52} />}
        <p role="status">
          {busy
            ? 'Conferindo a mesa…'
            : camera === 'starting'
              ? 'Iniciando câmera…'
              : camera === 'on'
                ? 'Enquadre o QR Code da mesa.'
                : 'Câmera desligada'}
        </p>
        <button
          type="button"
          disabled={busy || camera === 'starting'}
          onClick={() => {
            if (camera === 'on') {
              stop();
              setCamera('off');
            } else void start();
          }}
        >
          <Icon name={camera === 'on' ? 'close' : 'camera'} size={17} />
          {camera === 'on' ? 'Parar câmera' : 'Ativar câmera'}
        </button>
      </div>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void read(value);
        }}
      >
        <label>
          Link ou código da mesa
          <input
            aria-label="Link ou código da mesa"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            placeholder="Cole o link do QR Code da mesa"
            maxLength={2048}
            required
            disabled={busy}
          />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy}>Cancelar</ModalCloseButton>
          <button className="primary" disabled={busy || !value.trim()}>
            <Icon name="tables" size={17} />
            Usar esta mesa
          </button>
        </div>
      </form>
    </Modal>
  );
}
