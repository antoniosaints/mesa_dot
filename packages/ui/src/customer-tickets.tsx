import { orderLocationLabel } from '../../shared/src/order-location.js';
import { Icon } from './appearance.js';
import { Badge, Empty } from './common.js';
import type { Data } from './client.js';
import { pendingCustomerTickets, type CustomerTicketGroup } from './customer-contexts.js';

export function CustomerTickets({
  groups,
  loading,
  busy,
  onView,
  onRequest,
}: {
  groups: CustomerTicketGroup[];
  loading: boolean;
  busy: boolean;
  onView: (ticket: Data) => void;
  onRequest: (code: string, ticket: Data) => void;
}) {
  const pending = groups
    .map((group) => ({ ...group, tickets: pendingCustomerTickets(group.tickets) }))
    .filter((group) => group.tickets.length || group.error);
  const history = (status: string) =>
    groups
      .map((group) => ({
        ...group,
        tickets: group.tickets.filter((ticket) => ticket.status === status),
      }))
      .filter((group) => group.tickets.length);
  const delivered = history('REDEEMED');
  const cancelled = history('CANCELLED');
  const count = (items: CustomerTicketGroup[]) =>
    items.reduce((sum, group) => sum + group.tickets.length, 0);
  function renderGroups(items: CustomerTicketGroup[], kind: 'pending' | 'delivered' | 'cancelled') {
    return items.map((group) => (
      <section
        className="customer-ticket-group"
        key={group.code}
        aria-label={`${kind === 'pending' ? 'Fichas' : kind === 'delivered' ? 'Fichas entregues' : 'Fichas canceladas'} · ${group.label}`}
      >
        <div className="customer-ticket-group-heading">
          <h3>
            <Icon name={group.code ? 'tables' : 'orders'} size={18} />
            {group.label}
          </h3>
          <span>
            {group.tickets.length} ficha(s){kind === 'pending' && !group.error && ' a receber'}
          </span>
        </div>
        {group.error && kind === 'pending' && (
          <div className="alert error" role="alert">
            {group.error}
          </div>
        )}
        {group.tickets.map((ticket) => (
          <section key={ticket.id} className="panel mini-ticket">
            <div className="section-head">
              <span className="customer-ticket-symbol">
                <Icon name="ticket" size={20} />
              </span>
              <span className="eyebrow">Ficha {ticket.public_number.slice(-6)}</span>
              <Badge status={ticket.status} />
            </div>
            <h2>{ticket.product}</h2>
            <p className="muted small">
              {orderLocationLabel(ticket)} · {ticket.tab_label} · Pedido #
              {ticket.order_id?.slice(0, 6).toUpperCase()}
            </p>
            <p className="customer-ticket-guidance">
              {['PENDING', 'PREPARING'].includes(ticket.status)
                ? 'Seu item está na cozinha. Avisaremos por aqui quando estiver pronto.'
                : ticket.status === 'REDEEMED'
                  ? ticket.service_mode === 'COUNTER'
                    ? 'Retirada concluída. Bom apetite!'
                    : 'Item entregue. Bom apetite!'
                  : ['REQUESTED', 'ASSIGNED'].includes(ticket.status)
                    ? 'Entrega solicitada. A equipe está cuidando do seu pedido.'
                    : ticket.status === 'CANCELLED'
                      ? 'Esta ficha foi cancelada.'
                      : ticket.service_mode === 'COUNTER'
                        ? 'Pronto para retirar. Mostre sua ficha no balcão.'
                        : 'Seu item está disponível. Solicite a entrega quando desejar.'}
            </p>
            {kind === 'pending' && (
              <div className="button-row">
                <button
                  className="customer-ticket-code"
                  disabled={Boolean(group.error)}
                  onClick={() => onView(ticket)}
                >
                  <Icon name="scan" size={17} />
                  Exibir QR e código de barras
                </button>
                {ticket.service_mode !== 'COUNTER' && (
                  <button
                    className="primary"
                    disabled={
                      Boolean(group.error) ||
                      busy ||
                      ticket.status !== 'AVAILABLE' ||
                      !navigator.onLine
                    }
                    onClick={() => onRequest(group.code, ticket)}
                  >
                    <Icon name="bell" size={17} />
                    Pedir para trazer
                  </button>
                )}
              </div>
            )}
          </section>
        ))}
      </section>
    ));
  }
  if (!pending.length && !delivered.length && !cancelled.length)
    return loading ? null : <Empty>Suas fichas aparecem após a confirmação do pagamento.</Empty>;
  return (
    <>
      {renderGroups(pending, 'pending')}
      {delivered.length > 0 && (
        <details className="customer-ticket-history customer-delivered-tickets">
          <summary>
            <Icon name="chevron" size={18} />
            <Icon name="ready" size={18} />
            <strong>Entregues</strong>
            <span>{count(delivered)}</span>
          </summary>
          <div>{renderGroups(delivered, 'delivered')}</div>
        </details>
      )}
      {cancelled.length > 0 && (
        <details className="customer-ticket-history customer-cancelled-tickets">
          <summary>
            <Icon name="chevron" size={18} />
            <Icon name="close" size={18} />
            <strong>Canceladas</strong>
            <span>{count(cancelled)}</span>
          </summary>
          <div>{renderGroups(cancelled, 'cancelled')}</div>
        </details>
      )}
    </>
  );
}
