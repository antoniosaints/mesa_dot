import { PushDeviceButton } from './push-device.js';
import { orderLocationLabel } from '../../shared/src/order-location.js';
import { companySelectionRequested } from './common.js';
import { useTicketDelivery } from './delivery.js';
import { GroupedTickets } from './ticket-groups.js';
import { ClientRequestBanner, useClientRequestAlerts } from './request-alerts.js';
import { ClientRequestList, RequestDocumentDialog } from './request-center.js';
import { canDeliverTicket } from './ticket-state.js';
import { createTicketFrameReader } from './ticket-frame-reader.js';
import { cameraErrorMessage, normalizeTicketScan } from './ticket-scan-code.js';
import { usePageRoute, RouteNotFound } from './routing.js';
import { AppHeader, Icon } from './appearance.js';
import { useEffect, useRef, useState } from 'react';
import { api, useStorageKey, type Data } from './client.js';
import {
  Badge,
  Connectivity,
  Login,
  Modal,
  PageTitle,
  useAction,
  useRefresh,
  useStaff,
} from './common.js';
import { Floor, TablePanel } from './pos.js';
export function WaiterApp() {
  useStorageKey('bar-staff');
  const { current, setCurrent, signOut } = useStaff();
  const { page, setPage, location, navigate } = usePageRoute(
    { tables: '/mesas', calls: '/chamados', deliveries: '/entregas', scanner: '/conferir-ficha' },
    'tables',
    Boolean(current),
    { tables: /^\/mesas\/[^/]+$/ },
  );
  const scopeKey = current
    ? current.actor.tenantId + ':' + current.actor.establishmentId + ':' + current.actor.id
    : '';
  const [requestDocument, setRequestDocument] = useState<{
    scope: string;
    orderId: string;
    ticketId?: string;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    tables: Data[];
    products: Data[];
    calls: Data[];
    tickets: Data[];
  }>({ scope: '', tables: [], products: [], calls: [], tickets: [] });
  const { tables, products, calls, tickets } =
    snapshot.scope === scopeKey ? snapshot : { tables: [], products: [], calls: [], tickets: [] };
  useEffect(() => {
    if (!current) setSnapshot({ scope: '', tables: [], products: [], calls: [], tickets: [] });
  }, [Boolean(current)]);
  const selected = tables.find((table) => location.pathname === `/mesas/${table.id}`) ?? null;
  const setSelected = (table: Data | null) =>
    void navigate(table ? `/mesas/${table.id}` : '/mesas');
  const [token, setToken] = useState('');
  const [ticket, setTicket] = useState<Data | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraGeneration = useRef(0),
    cameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    cameraStarting = useRef(false),
    cameraMounted = useRef(true);
  const [cameraState, setCameraState] = useState<'off' | 'starting' | 'active'>('off');
  const [cameraError, setCameraError] = useState('');
  const { run, refresh, busy, feedback } = useAction();
  async function load() {
    if (!current) return;
    await refresh(async () => {
      const [t, p, c, issued] = await Promise.all([
        api('/tables'),
        api('/products/operational'),
        api('/service-requests'),
        api('/tickets'),
      ]);
      setSnapshot({
        scope: scopeKey,
        tables: t,
        products: p,
        calls: c,
        tickets: issued.filter(
          (ticket: Data) =>
            ticket.session_status !== 'CLOSED' &&
            !['REDEEMED', 'CANCELLED'].includes(ticket.status),
        ),
      });
    });
  }
  const delivery = useTicketDelivery(() => {
    void load();
  });
  useClientRequestAlerts(
    current
      ? current.actor.tenantId + ':' + current.actor.establishmentId + ':' + current.actor.id
      : '',
    calls,
  );
  useRefresh(load, [Boolean(current)]);
  function releaseCamera() {
    cameraGeneration.current++;
    cameraStarting.current = false;
    clearTimeout(cameraTimer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
    }
  }
  useEffect(() => {
    cameraMounted.current = true;
    return () => {
      cameraMounted.current = false;
      releaseCamera();
    };
  }, []);
  useEffect(() => {
    releaseCamera();
    setCameraState('off');
    setCameraError('');
    setToken('');
    setTicket(null);
    return releaseCamera;
  }, [page, scopeKey]);
  function stopCamera() {
    releaseCamera();
    if (cameraMounted.current) setCameraState('off');
  }
  async function startCamera() {
    if (cameraStarting.current) return;
    releaseCamera();
    setCameraError('');
    setTicket(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('off');
      setCameraError(
        'A câmera exige HTTPS ou localhost. Abra o sistema por um endereço seguro ou use um leitor físico.',
      );
      return;
    }
    const generation = cameraGeneration.current;
    cameraStarting.current = true;
    setCameraState('starting');
    try {
      const decodeFrame = await createTicketFrameReader();
      if (!cameraMounted.current || generation !== cameraGeneration.current) return;
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (!cameraMounted.current || generation !== cameraGeneration.current || !video.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const preview = video.current;
      preview.srcObject = media;
      await preview.play();
      if (!cameraMounted.current || generation !== cameraGeneration.current) return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Leitura de imagem indisponível.');
      const fail = (problem: unknown) => {
        if (cameraMounted.current && generation === cameraGeneration.current) {
          stopCamera();
          setCameraError(cameraErrorMessage(problem));
        }
      };
      const loop = () => {
        if (!cameraMounted.current || generation !== cameraGeneration.current) return;
        try {
          if (preview.readyState >= 2 && preview.videoWidth) {
            const width = Math.min(1280, preview.videoWidth),
              height = Math.max(1, Math.round((width * preview.videoHeight) / preview.videoWidth));
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }
            context.drawImage(preview, 0, 0, width, height);
            const value = decodeFrame(canvas, context.getImageData(0, 0, width, height));
            if (value) {
              setToken(normalizeTicketScan(value));
              setTicket(null);
              stopCamera();
              return;
            }
          }
          cameraTimer.current = setTimeout(loop, 200);
        } catch (problem) {
          fail(problem);
        }
      };
      setCameraState('active');
      loop();
    } catch (problem) {
      if (cameraMounted.current && generation === cameraGeneration.current) {
        stopCamera();
        setCameraError(cameraErrorMessage(problem));
      }
    } finally {
      if (generation === cameraGeneration.current) cameraStarting.current = false;
    }
  }
  if (!current || companySelectionRequested())
    return <Login onLogin={setCurrent} app="Atendimento e entrega" surface="waiter" />;
  return (
    <div className="waiter-app">
      <AppHeader onLogout={() => void signOut()}>
        <PushDeviceButton surface="waiter" />
      </AppHeader>
      <main className="waiter-content">
        <Connectivity />
        <PageTitle
          eyebrow="ATENDIMENTO"
          title={
            page === 'tables'
              ? 'Vamos cuidar do salão.'
              : page === 'calls'
                ? 'A casa está chamando.'
                : page === 'deliveries'
                  ? 'Entregas por mesa e comanda.'
                  : 'Conferir e entregar.'
          }
        />
        <ClientRequestBanner tables={tables} onOpen={() => setPage('calls')} />
        <div className="customer-nav system-tabs">
          <button
            className={page === 'tables' ? 'active' : ''}
            onClick={() => {
              setPage('tables');
              void stopCamera();
            }}
          >
            <Icon name="tables" size={17} /> Mesas
          </button>
          <button
            className={page === 'calls' ? 'active' : ''}
            onClick={() => {
              setPage('calls');
              void stopCamera();
            }}
          >
            <Icon name="bell" size={17} /> Chamados ({calls.length})
          </button>
          <button
            className={page === 'deliveries' ? 'active' : ''}
            onClick={() => {
              setPage('deliveries');
              void stopCamera();
            }}
          >
            <Icon name="ticket" size={17} />
            Entregas
          </button>
          <button className={page === 'scanner' ? 'active' : ''} onClick={() => setPage('scanner')}>
            <Icon name="scan" size={17} /> Conferir ficha
          </button>
        </div>
        {feedback}
        {page === 'notfound' && <RouteNotFound onHome={() => setPage('tables')} />}
        {page === 'tables' && <Floor tables={tables} onSelect={setSelected} />}
        {page === 'deliveries' && (
          <section className="panel">
            <h2>Fichas aguardando entrega</h2>
            <p className="muted small">
              Abra a mesa e a comanda. O botão de entrega aparece ao lado do produto quando a ficha
              está disponível.
            </p>
            <GroupedTickets
              tickets={tickets}
              autoExpand="requests"
              onDeliver={
                current.actor.permissions.includes('ticket.redeem') ? delivery.deliver : undefined
              }
            />
          </section>
        )}
        {page === 'calls' && (
          <section className="panel waiter-request-panel">
            <h2>Solicitações de clientes</h2>
            <ClientRequestList
              requests={calls}
              onChange={load}
              onDeliver={
                current.actor.permissions.includes('ticket.redeem') ? delivery.deliver : undefined
              }
              onOrder={
                current.actor.permissions.includes('table.view')
                  ? (ticket) => setRequestDocument({ scope: scopeKey, orderId: ticket.order_id })
                  : undefined
              }
              onTicket={
                current.actor.permissions.includes('ticket.view')
                  ? (ticket) =>
                      setRequestDocument({
                        scope: scopeKey,
                        orderId: ticket.order_id,
                        ticketId: ticket.id,
                      })
                  : undefined
              }
              onTable={(ticket) => setSelected({ id: ticket.table_id })}
            />
          </section>
        )}
        {page === 'scanner' && (
          <section className="panel scanner-panel">
            <h2>Leia a ficha do cliente</h2>
            <p className="muted">
              Use a câmera, um leitor USB ou cole o código. A leitura apenas consulta a ficha.
            </p>
            <video
              ref={video}
              playsInline
              muted
              className="scanner-video"
              aria-label="Prévia da câmera"
            />
            <p className="muted small" role="status">
              {cameraState === 'starting'
                ? 'Abrindo câmera…'
                : cameraState === 'active'
                  ? 'Enquadre o QR Code ou o código de barras da ficha.'
                  : token
                    ? 'Código preenchido. Consulte a ficha antes de confirmar a entrega.'
                    : 'Use a câmera, um leitor físico ou digite o código abaixo.'}
            </p>
            {cameraError && (
              <div className="alert error" role="alert">
                {cameraError}
              </div>
            )}
            <div className="button-row">
              <button disabled={busy || cameraState !== 'off'} onClick={() => void startCamera()}>
                <Icon name="camera" size={16} />
                {cameraState === 'starting' ? 'Abrindo câmera…' : 'Abrir câmera'}
              </button>
              <button disabled={cameraState === 'off'} onClick={stopCamera}>
                <Icon name="close" size={16} />
                Parar câmera
              </button>
            </div>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                stopCamera();
                const generation = cameraGeneration.current;
                void run(async () => {
                  const resolved = await api('/tickets/resolve', {
                    token: normalizeTicketScan(token),
                  });
                  if (cameraMounted.current && generation === cameraGeneration.current)
                    setTicket(resolved);
                });
              }}
            >
              <label>
                Código da ficha
                <input
                  value={token}
                  disabled={busy}
                  onChange={(e) => {
                    if (cameraState !== 'off') stopCamera();
                    setToken(e.target.value);
                    setTicket(null);
                  }}
                  autoComplete="off"
                  autoFocus
                  placeholder="Escaneie ou cole o código"
                />
              </label>
              <button disabled={busy || !navigator.onLine}>
                <Icon name="search" size={17} />
                Consultar ficha
              </button>
            </form>
            {ticket && (
              <div className="resolved-ticket">
                <h2>{ticket.product}</h2>
                <p>
                  {orderLocationLabel(ticket)} · {ticket.tab_label} · Pedido #
                  {ticket.order_id?.slice(0, 6).toUpperCase()} · Ficha {ticket.public_number}
                </p>
                <Badge status={ticket.status} />
                <p className="muted">Confirme somente após entregar o produto.</p>
                <button
                  className="primary full"
                  disabled={
                    busy || !canDeliverTicket(ticket, current.actor.id) || !navigator.onLine
                  }
                  onClick={() =>
                    void run(async () => {
                      await api(`/tickets/${ticket.id}/redeem`, { token: ticket.token });
                      setTicket(null);
                      setToken('');
                      await load();
                    }, 'Entrega confirmada. Ficha utilizada uma única vez.')
                  }
                >
                  <Icon name="ready" size={17} />
                  Confirmar entrega ao cliente
                </button>
              </div>
            )}
          </section>
        )}
      </main>
      {requestDocument?.scope === scopeKey && (
        <RequestDocumentDialog
          key={scopeKey + requestDocument.orderId + (requestDocument.ticketId ?? '')}
          selection={requestDocument}
          onSelection={(selection) => setRequestDocument({ ...selection, scope: scopeKey })}
          onClose={() => setRequestDocument(null)}
          onDeliver={
            current.actor.permissions.includes('ticket.redeem') ? delivery.deliver : undefined
          }
        />
      )}
      {delivery.dialog}
      {selected && (
        <Modal
          routeBound
          className="table-management-modal"
          title={`Mesa ${selected.number}`}
          heading={
            <>
              <span className="table-modal-symbol">
                <Icon name="tables" size={26} />
              </span>
              <span>
                Gerenciar pedidos — Mesa {selected.number}
                <small>Pedidos, comandas e atendimento</small>
              </span>
            </>
          }
          onClose={() => setSelected(null)}
        >
          <TablePanel
            key={selected.id}
            source="WAITER"
            table={selected}
            menu={products}
            onChange={() => void load()}
            onFinalized={() => setSelected(null)}
          />
        </Modal>
      )}
    </div>
  );
}
