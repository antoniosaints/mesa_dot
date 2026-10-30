import { OrderBulkDelivery } from './order-bulk-delivery.js';
import { orderLocationLabel } from '../../shared/src/order-location.js';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './appearance.js';
import { Badge, Code, Empty, ModalHeaderActions, useRefresh } from './common.js';
import { api, brl, session, type Data } from './client.js';
import { SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import { ReceiptButton } from './receipt-button.js';
import { TicketList } from './ticket-list.js';
import { canDeliverTicket } from './ticket-state.js';
import { orderDelivery, orderSourceLabel, normalizeOrderSearch } from './orders-view.js';
import { shortId, operationTime } from './operation-format.js';

export function OrderDetailHeading({ order }: { order: Data }) {
  return (
    <>
      <span className="order-modal-symbol">
        <Icon name="orders" size={23} />
      </span>
      <span>
        Pedido {shortId(order.id)}
        <small>{orderLocationLabel(order)} · Detalhes e fichas de consumo</small>
      </span>
    </>
  );
}
function firstTicket(order: Data) {
  if (order.status !== 'CONFIRMED') return '';
  const tickets: Data[] = order.tickets ?? [];
  return (
    (
      tickets.find((t) => !['CANCELLED', 'REDEEMED'].includes(t.status)) ??
      tickets.find((t) => t.status !== 'CANCELLED')
    )?.id ?? ''
  );
}
export function OrderSummary({
  order,
  onTicket,
  onDeliver,
  onUpdate,
}: {
  order: Data;
  onTicket?: (ticket: Data) => void;
  onDeliver?: (ticket: Data) => void;
  onUpdate?: (order: Data) => void;
}) {
  const [selected, setSelected] = useState(() => firstTicket(order)),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState('');
  const preview = useRef<HTMLElement>(null),
    headingId = useId();
  const alive = useRef(true);
  const [refreshError, setRefreshError] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useRefresh(async () => {
    if (!onUpdate) return;
    try {
      const value = await api('/orders/' + order.id);
      if (alive.current) {
        onUpdate(value);
        setRefreshError('');
      }
    } catch {
      if (alive.current)
        setRefreshError(
          'Não foi possível atualizar o pedido. Os últimos dados carregados estão sendo exibidos; uma nova tentativa será feita automaticamente.',
        );
    }
  }, [order.id]);
  const canView = Boolean(session()?.actor?.permissions?.includes('ticket.view'));
  const tickets: Data[] = order.tickets ?? [],
    flow = orderDelivery(order, tickets);
  const units = (order.items ?? []).reduce((sum: number, i: Data) => sum + Number(i.quantity), 0);
  const selectedTicket = tickets.find((t) => t.id === selected);
  useEffect(() => {
    setSelected(firstTicket(order));
    setFilter('all');
    setSearch('');
  }, [order.id]);
  const visible = tickets.filter(
    (t) =>
      (filter === 'all' ||
        (filter === 'delivered'
          ? t.status === 'REDEEMED'
          : !['REDEEMED', 'CANCELLED'].includes(t.status))) &&
      normalizeOrderSearch([t.product, t.public_number, t.tab_label, t.notes].join(' ')).includes(
        normalizeOrderSearch(search),
      ),
  );
  function select(ticket: Data) {
    setSelected(ticket.id);
    if (window.matchMedia('(max-width: 850px)').matches)
      requestAnimationFrame(() => {
        preview.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        preview.current?.focus({ preventScroll: true });
      });
  }
  return (
    <div className="order-detail-content">
      {refreshError && (
        <p className="order-detail-refresh-error" role="status">
          <Icon name="info" size={16} />
          {refreshError}
        </p>
      )}
      <ModalHeaderActions>
        <ReceiptButton scope="ORDER" id={order.id} label="Cupom do pedido" />
        {order.tab_id && <ReceiptButton scope="TAB" id={order.tab_id} label="Cupom da comanda" />}
      </ModalHeaderActions>
      <div className="order-detail-meta">
        <div>
          <Badge status={order.status} />
          <span>
            <Icon name="clock" size={14} />
            {operationTime(order.created_at_iso ?? order.created_at)}
          </span>
          <span>
            <Icon
              name={
                order.source === 'CUSTOMER' ? 'scan' : order.source === 'WAITER' ? 'team' : 'cash'
              }
              size={14}
            />
            {orderSourceLabel(order.source, order.service_mode)}
          </span>
        </div>
        <strong>
          <Icon name="receipt" size={15} />
          {order.tab_label || 'Comanda a definir'}
        </strong>
      </div>
      {order.cash_session_id && session()?.actor?.kind === 'STAFF' && (
        <p className="order-cash-reference">
          <Icon name="cash" size={16} />
          Caixa: {order.cash_register_name ?? 'Turno vinculado'} · Turno{' '}
          {shortId(order.cash_session_id)}
        </p>
      )}
      <section className="order-detail-metrics" aria-label="Resumo do pedido">
        <div>
          <span>
            <Icon name="payments" size={16} />
            {order.status === 'CANCELLED' ? 'Valor original' : 'Total do pedido'}
          </span>
          <strong>{brl(order.total)}</strong>
          <small>
            {order.payment_policy_snapshot === 'IMMEDIATE'
              ? 'Pago no ato · balcão'
              : order.payment_policy_snapshot === 'IMMEDIATE'
                ? 'Pedido avulso pago no balcão. Acompanhe o preparo e a entrega de cada unidade pelas fichas.'
                : order.payment_policy_snapshot === 'POSTPAID'
                  ? 'Pagamento na comanda'
                  : 'Pedido pré-pago'}
          </small>
        </div>
        <div>
          <span>
            <Icon name="menu" size={16} />
            Itens pedidos
          </span>
          <strong>
            {units}
            <small> unidade(s)</small>
          </strong>
          <small>{order.items?.length ?? 0} produto(s) no pedido</small>
        </div>
        <div className="is-delivered">
          <span>
            <Icon name="ready" size={16} />
            Entregues
          </span>
          <strong>{canView ? flow.delivered : '—'}</strong>
          <small>{canView ? 'Entrega confirmada por ficha' : 'Consulta de fichas restrita'}</small>
        </div>
        <div className="is-pending">
          <span>
            <Icon name="clock" size={16} />A entregar
          </span>
          <strong>{canView ? flow.pending : '—'}</strong>
          <small>
            {canView
              ? flow.preparing
                ? `${flow.preparing} em preparo`
                : flow.requested
                  ? `${flow.requested} solicitação(ões) do cliente`
                  : 'Acompanhe as fichas abaixo'
              : 'Consulta de fichas restrita'}
          </small>
        </div>
      </section>
      <div className="order-detail-workspace">
        <div className="order-detail-main">
          <section className="order-detail-section">
            <div className="order-detail-section-heading">
              <h3>
                <Icon name="menu" size={17} />
                Itens do pedido
              </h3>
              <span>{units} unidade(s)</span>
            </div>
            <div className="order-detail-items">
              {order.items?.map((item: Data) => (
                <article key={item.id}>
                  <span className="order-item-quantity">{item.quantity}×</span>
                  <div>
                    <strong>{item.name_snapshot}</strong>
                    <small>{brl(item.unit_price)} por unidade</small>
                    {item.notes && (
                      <p>
                        <Icon name="info" size={13} />
                        {item.notes}
                      </p>
                    )}
                  </div>
                  <strong>{brl(item.total)}</strong>
                </article>
              ))}
            </div>
          </section>
          <section className="order-detail-section">
            <div className="order-detail-section-heading">
              <div>
                <h3>
                  <Icon name="ticket" size={17} />
                  Fichas deste pedido
                </h3>
                <p>Selecione uma ficha para consultar seu código e acompanhar a entrega.</p>
              </div>
              <div className="order-ticket-heading-actions">
                <span>{tickets.length} ficha(s)</span>
                {canView && <OrderBulkDelivery key={order.id} order={order} onUpdate={onUpdate} />}
              </div>
            </div>
            {canView ? (
              <>
                <div className="order-ticket-filters">
                  <div
                    className="order-ticket-groups"
                    role="group"
                    aria-label="Filtrar fichas do pedido"
                  >
                    {[
                      ['all', 'Todas'],
                      ['pending', 'A entregar'],
                      ['delivered', 'Entregues'],
                    ].map(([id, label]) => (
                      <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {tickets.length > 5 && (
                    <label className="order-ticket-search">
                      <Icon name="search" size={15} />
                      <input
                        type="search"
                        aria-label="Buscar ficha neste pedido"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Produto ou número da ficha…"
                      />
                    </label>
                  )}
                </div>
                {visible.length ? (
                  <TicketList
                    compact
                    tickets={visible}
                    selectedId={selected}
                    onSelect={select}
                    onDeliver={onDeliver}
                  />
                ) : (
                  <Empty>
                    {tickets.length
                      ? 'Nenhuma ficha corresponde a este filtro.'
                      : order.status === 'CANCELLED'
                        ? 'Pedido cancelado. As fichas não estão disponíveis para consumo.'
                        : 'As fichas são emitidas após a confirmação do pedido e, no pré-pago, a aprovação do pagamento.'}
                  </Empty>
                )}
              </>
            ) : (
              <div className="order-detail-notice">
                <Icon name="info" size={18} />
                Seu perfil não possui acesso às fichas deste pedido.
              </div>
            )}
          </section>
        </div>
        <aside
          className="order-detail-side"
          ref={preview}
          tabIndex={-1}
          aria-labelledby={headingId}
        >
          <section className="order-detail-section order-ticket-preview">
            <div className="order-detail-section-heading">
              <h3 id={headingId}>
                <Icon name="eye" size={17} />
                Visualização da ficha
              </h3>
            </div>
            {canView &&
              tickets.some((t) => t.status !== 'CANCELLED') &&
              order.status === 'CONFIRMED' && (
                <div className="order-ticket-selector">
                  <label>
                    Ficha em visualização
                    <SearchSelect
                      label="Ficha em visualização"
                      value={selected}
                      onChange={(id) => select(tickets.find((t) => t.id === id)!)}
                      allowClear={false}
                      options={tickets
                        .filter((t) => t.status !== 'CANCELLED')
                        .map((t) => ({
                          id: t.id,
                          name: t.product + ' · ' + t.public_number.slice(-6),
                        }))}
                    />
                  </label>
                </div>
              )}
            {selectedTicket && canView ? (
              <OrderTicketPreview
                key={order.id + selectedTicket.id}
                ticket={selectedTicket}
                onDeliver={onDeliver}
                onOpen={onTicket}
              />
            ) : (
              <div className="order-ticket-placeholder">
                <Icon name="ticket" size={36} />
                <strong>Veja a ficha aqui</strong>
                <p>
                  Use “Ver ficha” na lista para exibir o QR Code ou o código de barras, sem sair
                  deste pedido.
                </p>
              </div>
            )}
          </section>
          <div className="order-detail-notice">
            <Icon name="info" size={18} />
            <p>
              {order.status === 'DRAFT'
                ? 'Pedido ainda não confirmado. Confirme para lançar o consumo e emitir as fichas.'
                : order.status === 'PENDING_PAYMENT'
                  ? 'Aguardando aprovação do pagamento. As fichas serão liberadas após a confirmação do provedor.'
                  : order.status === 'CANCELLED'
                    ? 'Pedido cancelado. Os valores originais e os itens são preservados para consulta do histórico.'
                    : order.payment_policy_snapshot === 'IMMEDIATE'
                      ? 'Pedido avulso pago no balcão. Acompanhe o preparo e a entrega de cada unidade pelas fichas.'
                      : order.payment_policy_snapshot === 'POSTPAID'
                        ? 'O pedido registra o consumo. Pagamentos e descontos são conferidos na comanda; cada ficha acompanha a entrega de uma unidade.'
                        : 'Pedido pré-pago. A liberação das fichas depende da aprovação do pagamento. Cada ficha representa uma unidade.'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
function OrderTicketPreview({
  ticket,
  onDeliver,
  onOpen,
}: {
  ticket: Data;
  onDeliver?: (ticket: Data) => void;
  onOpen?: (ticket: Data) => void;
}) {
  const [document, setDocument] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [format, setFormat] = useState('qr');
  const forms = useFormDialog();
  const permission = (value: string) => Boolean(session()?.actor?.permissions?.includes(value));
  useEffect(() => {
    let live = true;
    setLoading(true);
    setDocument(null);
    setError('');
    void api('/tickets/' + ticket.id)
      .then((value) => {
        if (live) setDocument(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    ticket.id,
    ticket.status,
    ticket.service_request_status,
    ticket.request_claimed_by,
    revision,
  ]);
  const inactive = document && ['REDEEMED', 'CANCELLED'].includes(document.status);
  function reprint() {
    forms.open({
      title: 'Solicitar segunda via',
      description: 'A segunda via mantém o mesmo código e não cria outro direito de consumo.',
      fields: [
        {
          key: 'reason',
          label: 'Motivo da segunda via',
          type: 'textarea',
          required: true,
          minLength: 3,
          maxLength: 255,
        },
      ],
      submitLabel: 'Solicitar segunda via',
      successMessage: 'Segunda via adicionada à fila.',
      onSubmit: (values) => api('/tickets/' + ticket.id + '/reprint', values),
    });
  }
  return (
    <div className="order-ticket-document" role="region" aria-label="Ficha selecionada">
      <div className="order-ticket-document-title">
        <strong>{ticket.product}</strong>
        <button
          className="icon-button"
          aria-label="Atualizar ficha"
          onClick={() => setRevision((v) => v + 1)}
          disabled={loading}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      {loading ? (
        <div className="order-ticket-loading" role="status">
          <Icon name="refresh" size={20} />
          Carregando a ficha…
        </div>
      ) : error ? (
        <div className="stack">
          <p className="error-text" role="alert">
            {error}
          </p>
          <button onClick={() => setRevision((v) => v + 1)}>Tentar novamente</button>
        </div>
      ) : (
        document && (
          <>
            <div className="order-ticket-identity">
              <Badge status={document.status} />
              <span>1 unidade</span>
            </div>
            {inactive ? (
              <div className="order-ticket-inactive">
                <Icon name="ready" size={23} />
                <strong>
                  {document.status === 'REDEEMED'
                    ? 'Esta ficha já foi entregue'
                    : 'Ficha cancelada'}
                </strong>
                <p>
                  {document.status === 'REDEEMED'
                    ? 'O código não pode ser utilizado novamente.'
                    : 'Esta ficha não permite resgate.'}
                </p>
              </div>
            ) : (
              <>
                <div
                  className="order-ticket-code-options"
                  role="group"
                  aria-label="Formato do código da ficha"
                >
                  <button aria-pressed={format === 'qr'} onClick={() => setFormat('qr')}>
                    <Icon name="scan" size={15} />
                    QR Code
                  </button>
                  <button aria-pressed={format === 'barcode'} onClick={() => setFormat('barcode')}>
                    Código de barras
                  </button>
                </div>
                <div className="order-ticket-code">
                  {format === 'qr' ? (
                    <Code value={document.token} />
                  ) : (
                    <Code value={document.token} barcode />
                  )}
                </div>
                <p className="field-hint">
                  Código de consumo de uma única unidade. A entrega só é registrada após a
                  confirmação.
                </p>
              </>
            )}
            <dl>
              <div>
                <dt>Ficha</dt>
                <dd>{document.public_number}</dd>
              </div>
              <div>
                <dt>Mesa / comanda</dt>
                <dd>
                  {orderLocationLabel(document)} · {document.tab_label}
                </dd>
              </div>
              {document.notes && (
                <div>
                  <dt>Observação</dt>
                  <dd>{document.notes}</dd>
                </div>
              )}
            </dl>
            {onDeliver && !inactive && (
              <button
                className="primary"
                disabled={!canDeliverTicket(document, session()?.actor?.id)}
                onClick={() => onDeliver(document)}
              >
                <Icon name="ready" size={16} />
                {canDeliverTicket(document, session()?.actor?.id)
                  ? 'Marcar como entregue'
                  : 'Aguardando liberação'}
              </button>
            )}
            {document.request_claimed_by &&
              document.request_claimed_by !== session()?.actor?.id && (
                <p className="field-hint">Outro garçom assumiu esta solicitação.</p>
              )}
            {permission('ticket.reprint') && !inactive && (
              <button onClick={reprint}>
                <Icon name="printing" size={16} />
                Solicitar segunda via
              </button>
            )}
            {onOpen && (
              <button onClick={() => onOpen(document)}>
                <Icon name="next" size={15} />
                Abrir ficha na tela de pedidos
              </button>
            )}
          </>
        )
      )}
      {forms.dialog}
    </div>
  );
}
