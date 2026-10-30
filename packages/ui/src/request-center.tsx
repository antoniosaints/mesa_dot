import { useEffect, useState } from 'react';
import { orderLocationLabel } from '../../shared/src/order-location.js';
import { Icon } from './appearance.js';
import { api, session, type Data } from './client.js';
import { Badge, Code, Empty, Modal, useAction, useRefresh } from './common.js';
import { OrderDetailHeading, OrderSummary } from './order-detail.js';
import { operationTime, shortId } from './operation-format.js';
import { normalizeOrderSearch } from './orders-view.js';
import { Pagination, paginate, TableLoading } from './pagination.js';
import { canDeliverTicket } from './ticket-state.js';

export function requestDeliveryLabel(ticket: Data) {
  return ticket.delivery_type === 'COUNTER_PICKUP' || ticket.service_mode === 'COUNTER'
    ? 'Retirada no balcão'
    : 'Entrega na mesa';
}
export function ClientRequestList({
  requests,
  loading = false,
  onChange,
  onDeliver,
  onOrder,
  onTicket,
  onTable,
}: {
  requests: Data[];
  loading?: boolean;
  onChange: () => Promise<void> | void;
  onDeliver?: (ticket: Data) => void;
  onOrder?: (ticket: Data) => void;
  onTicket?: (ticket: Data) => void;
  onTable?: (ticket: Data) => void;
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1),
    [size, setSize] = useState(10);
  const [now, setNow] = useState(Date.now());
  const { run, busy } = useAction();
  const staffId = session()?.actor?.id;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setPage(1), [search, filter]);
  const filtered = requests
    .filter((request) => {
      const ticket = request.ticket ?? {};
      return (
        (filter === 'ALL' ||
          (filter === 'OPEN' ? request.status === 'OPEN' : request.claimed_by === staffId)) &&
        normalizeOrderSearch(
          [
            ticket.table_number,
            ticket.area_name,
            ticket.tab_label,
            ticket.customer_name,
            ticket.product,
            ticket.notes,
            ticket.order_id,
            ticket.public_number,
            ...(ticket.modifiers ?? []),
          ].join(' '),
        ).includes(normalizeOrderSearch(search))
      );
    })
    .sort(
      (a, b) =>
        String(a.created_at_iso ?? a.created_at).localeCompare(
          String(b.created_at_iso ?? b.created_at),
        ) || a.id.localeCompare(b.id),
    );
  return (
    <div className="request-center">
      <div className="request-center-intro">
        <p>
          Confira o destino e o item. A solicitação permanece na lista até a entrega ou o
          cancelamento.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await onChange();
            })
          }
        >
          <Icon name="refresh" size={16} />
          Atualizar
        </button>
      </div>
      <div className="request-center-filters">
        <label className="request-center-search">
          <Icon name="search" size={17} />
          <input
            type="search"
            aria-label="Buscar solicitações"
            placeholder="Mesa, área, cliente, item ou pedido…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="request-center-status" role="group" aria-label="Filtrar solicitações">
          {[
            ['ALL', 'Todas', requests.length],
            ['OPEN', 'Aguardando', requests.filter((request) => request.status === 'OPEN').length],
            ['MINE', 'Minhas', requests.filter((request) => request.claimed_by === staffId).length],
          ].map(([value, label, count]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(String(value))}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <TableLoading label="Carregando solicitações…" />
      ) : !filtered.length ? (
        <Empty>
          {requests.length
            ? 'Nenhuma solicitação corresponde aos filtros.'
            : 'Nenhuma solicitação aguardando entrega.'}
        </Empty>
      ) : (
        <div className="request-center-list">
          {paginate(filtered, page, size).rows.map((request) => {
            const ticket = request.ticket ?? {},
              other = Boolean(request.claimed_by && request.claimed_by !== staffId);
            const instant = Date.parse(request.created_at_iso ?? request.created_at),
              waiting = Number.isFinite(instant)
                ? Math.max(0, Math.floor((now - instant) / 60000))
                : null;
            return (
              <article
                className={'client-request-card' + (other ? ' is-assigned' : '')}
                key={request.id}
                aria-label={`Solicitação ${ticket.product ?? 'de entrega'} · ${orderLocationLabel(ticket)}`}
              >
                <div className="client-request-card-heading">
                  <div className="client-request-destination">
                    <strong>
                      <Icon name="tables" size={18} />
                      {orderLocationLabel(ticket)}
                    </strong>
                    {ticket.area_name && <span>{ticket.area_name}</span>}
                  </div>
                  <span className="client-request-delivery">
                    <Icon name={ticket.service_mode === 'COUNTER' ? 'orders' : 'team'} size={15} />
                    {requestDeliveryLabel(ticket)}
                  </span>
                  <span
                    className={'badge ' + (request.status === 'OPEN' ? 'pending' : 'confirmed')}
                  >
                    {request.status === 'OPEN' ? 'Aguardando equipe' : 'Em atendimento'}
                  </span>
                </div>
                <div className="client-request-item">
                  <span className="client-request-unit">1×</span>
                  <div>
                    <h3>{ticket.product ?? 'Item indisponível'}</h3>
                    <p>
                      {ticket.tab_label ?? 'Sem comanda'}
                      {ticket.customer_name ? ' · ' + ticket.customer_name : ''}
                    </p>
                    {ticket.modifiers?.length > 0 && (
                      <p>Adicionais: {ticket.modifiers.join(' · ')}</p>
                    )}
                    {ticket.notes && (
                      <p className="client-request-notes">
                        <Icon name="info" size={15} />
                        <strong>Observação:</strong> {ticket.notes}
                      </p>
                    )}
                  </div>
                </div>
                <div className="client-request-references">
                  <span>
                    <Icon name="orders" size={14} />
                    Pedido {ticket.order_id ? shortId(ticket.order_id) : '—'}
                  </span>
                  <span>
                    <Icon name="ticket" size={14} />
                    Ficha {ticket.public_number ?? request.ticket_id?.slice(0, 6)}
                  </span>
                  <span title={operationTime(request.created_at_iso ?? request.created_at)}>
                    <Icon name="clock" size={14} />
                    {waiting === null
                      ? 'Horário indisponível'
                      : waiting < 1
                        ? 'Agora'
                        : `Há ${waiting} min`}
                  </span>
                </div>
                {request.claimed_by && (
                  <p className="client-request-assignee">
                    <Icon name="team" size={14} />
                    {other
                      ? `Em atendimento por ${request.claimed_by_name ?? 'outro funcionário'}. A entrega deve ser concluída por ele.`
                      : 'Você assumiu esta solicitação.'}
                  </p>
                )}
                <div className="client-request-actions">
                  <div>
                    {onOrder && ticket.order_id && (
                      <button onClick={() => onOrder(ticket)}>
                        <Icon name="orders" size={16} />
                        Ver pedido
                      </button>
                    )}
                    {onTicket && ticket.id && (
                      <button onClick={() => onTicket(ticket)}>
                        <Icon name="ticket" size={16} />
                        Ver item / ficha
                      </button>
                    )}
                    {onTable && ticket.table_id && (
                      <button onClick={() => onTable(ticket)}>
                        <Icon name="tables" size={16} />
                        Abrir mesa
                      </button>
                    )}
                  </div>
                  <div>
                    {onDeliver && request.status === 'OPEN' && (
                      <button
                        disabled={busy || !navigator.onLine}
                        onClick={() =>
                          void run(async () => {
                            await api(`/service-requests/${request.id}/claim`, {});
                            await onChange();
                          }, 'Solicitação assumida.')
                        }
                      >
                        <Icon name="team" size={16} />
                        Assumir
                      </button>
                    )}
                    {onDeliver && (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          !navigator.onLine ||
                          !ticket.id ||
                          !canDeliverTicket(ticket, staffId)
                        }
                        onClick={() => onDeliver(ticket)}
                      >
                        <Icon name="ready" size={17} />
                        Entregar
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <Pagination
          total={filtered.length}
          page={page}
          pageSize={size}
          label="solicitações de clientes"
          onPageChange={setPage}
          onPageSizeChange={setSize}
        />
      )}
    </div>
  );
}

export function RequestDocumentDialog({
  selection,
  onSelection,
  onClose,
  onDeliver,
}: {
  selection: { orderId: string; ticketId?: string };
  onSelection: (selection: { orderId: string; ticketId?: string }) => void;
  onClose: () => void;
  onDeliver?: (ticket: Data) => void;
}) {
  const [document, setDocument] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const { refresh } = useAction();
  async function load() {
    await refresh(async () => {
      try {
        setDocument(
          await api(
            selection.ticketId ? '/tickets/' + selection.ticketId : '/orders/' + selection.orderId,
          ),
        );
        setError('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    });
  }
  useRefresh(load, [selection.orderId, selection.ticketId]);
  const isTicket = Boolean(selection.ticketId);
  return (
    <Modal
      title={isTicket ? 'Item e ficha solicitados' : 'Pedido solicitado'}
      className={isTicket ? 'request-ticket-modal' : 'order-detail-modal'}
      heading={!isTicket && document ? <OrderDetailHeading order={document} /> : undefined}
      onClose={onClose}
      focusClose
    >
      {loading ? (
        <TableLoading label="Conferindo o documento…" />
      ) : error ? (
        <div className="stack">
          <p role="alert">{error}</p>
          <button onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Tentar novamente
          </button>
        </div>
      ) : (
        document &&
        (isTicket ? (
          <div className="request-ticket-document">
            <h3>{document.product}</h3>
            <p>
              {orderLocationLabel(document)} ·{' '}
              {document.area_name ?? requestDeliveryLabel(document)}
            </p>
            <p className="muted small">
              {document.tab_label} · Pedido {shortId(document.order_id)} · Ficha{' '}
              {document.public_number}
            </p>
            <Badge status={document.status} />
            {document.notes && <p className="client-request-notes">{document.notes}</p>}
            <div className="ticket-document">
              <Code value={document.token} />
              <Code value={document.token} barcode />
            </div>
            <div className="modal-footer">
              <button onClick={() => onSelection({ orderId: selection.orderId })}>
                <Icon name="orders" size={16} />
                Ver pedido
              </button>
              {onDeliver && (
                <button
                  className="primary"
                  disabled={!canDeliverTicket(document, session()?.actor?.id) || !navigator.onLine}
                  onClick={() => onDeliver(document)}
                >
                  <Icon name="ready" size={17} />
                  Entregar
                </button>
              )}
            </div>
          </div>
        ) : (
          <OrderSummary
            order={document}
            onUpdate={setDocument}
            onDeliver={onDeliver}
            onTicket={(ticket) => onSelection({ orderId: selection.orderId, ticketId: ticket.id })}
          />
        ))
      )}
    </Modal>
  );
}
