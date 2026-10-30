import { orderLocationLabel } from '../../shared/src/order-location.js';
import { Icon } from './appearance.js';
import { Badge, Empty } from './common.js';
import { session, type Data } from './client.js';
import { shortId, operationTime } from './operation-format.js';
import { canDeliverTicket } from './ticket-state.js';
export function TicketList({
  tickets,
  onSelect,
  onOrder,
  onDeliver,
  selectedId,
  compact = false,
}: {
  tickets: Data[];
  onSelect?: (ticket: Data) => void;
  onOrder?: (id: string) => void;
  onDeliver?: (ticket: Data) => void;
  selectedId?: string;
  compact?: boolean;
}) {
  if (!tickets.length)
    return (
      <Empty>
        Sem fichas neste contexto. Elas são emitidas após a confirmação do pedido ou a aprovação do
        pagamento pré-pago.
      </Empty>
    );
  return (
    <div className="ticket-context-list">
      {tickets.map((ticket) => (
        <article
          className={'ticket-context-card' + (compact ? ' is-compact' : '')}
          key={ticket.id}
          aria-current={selectedId === ticket.id ? 'true' : undefined}
        >
          <span className="ticket-context-icon">
            <Icon name="ticket" />
          </span>
          <div className="ticket-context-main">
            {compact ? (
              <div className="ticket-context-title">
                <strong>{ticket.product}</strong>
                <Badge status={ticket.status} />
              </div>
            ) : (
              <strong>{ticket.product}</strong>
            )}
            <p>
              {orderLocationLabel(ticket)} · {ticket.tab_label}
            </p>
            <small>
              Ficha {ticket.public_number} · Pedido {shortId(ticket.order_id)} ·{' '}
              {operationTime(ticket.created_at_iso ?? ticket.created_at)}
            </small>
          </div>
          {!compact && <Badge status={ticket.status} />}
          <div className="button-row">
            {onDeliver && !['REDEEMED', 'CANCELLED'].includes(ticket.status) && (
              <div className="ticket-delivery-action">
                <button
                  className="primary"
                  disabled={!canDeliverTicket(ticket, session()?.actor?.id)}
                  onClick={() => onDeliver(ticket)}
                >
                  <Icon name="ready" size={16} />
                  {['PENDING', 'PREPARING'].includes(ticket.status)
                    ? 'Aguardando preparo'
                    : compact
                      ? 'Entregar'
                      : 'Marcar como entregue'}
                </button>
                {ticket.request_claimed_by &&
                  ticket.request_claimed_by !== session()?.actor?.id && (
                    <small className="muted">Outro garçom assumiu a solicitação.</small>
                  )}
              </div>
            )}

            {onOrder && (
              <button onClick={() => onOrder(ticket.order_id)}>
                <Icon name="orders" size={16} />
                Ver pedido
              </button>
            )}
            {onSelect && (
              <button
                aria-pressed={selectedId === undefined ? undefined : selectedId === ticket.id}
                disabled={ticket.status === 'CANCELLED' || ticket.order_status !== 'CONFIRMED'}
                onClick={() => onSelect(ticket)}
              >
                <Icon name="ticket" size={16} />
                Ver ficha
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
