import { useEffect, useState } from 'react';
import { api, session, type Data } from './client.js';
import { Modal, ModalCloseButton, Badge, useAction } from './common.js';
import { Icon } from './appearance.js';
import { canDeliverTicket } from './ticket-state.js';
import { orderLocationLabel } from '../../shared/src/order-location.js';
function DeliveryDialog({
  id,
  onClose,
  onDelivered,
}: {
  id: string;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const [ticket, setTicket] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const { run, busy } = useAction();
  useEffect(() => {
    let active = true;
    setLoading(true);
    void run(async () => {
      const value = await api('/tickets/' + id);
      if (active) setTicket(value);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id, reload]);
  return (
    <Modal title="Confirmar entrega da ficha" onClose={onClose} closeDisabled={busy}>
      {loading ? (
        <p role="status">Conferindo a ficha e o responsável pelo atendimento…</p>
      ) : ticket ? (
        <div className="stack">
          <h3>{ticket.product}</h3>
          <p>
            {orderLocationLabel(ticket)}
            {ticket.area_name ? ' · ' + ticket.area_name : ''} · {ticket.tab_label}
          </p>
          <p className="delivery-service-type">
            <Icon name={ticket.service_mode === 'COUNTER' ? 'orders' : 'team'} size={17} />
            {ticket.service_mode === 'COUNTER' ? 'Retirada no balcão' : 'Entrega na mesa'} · 1
            unidade
          </p>
          {ticket.modifiers?.length > 0 && (
            <p className="muted small">Adicionais: {ticket.modifiers.join(' · ')}</p>
          )}
          {ticket.notes && (
            <p className="client-request-notes">
              <Icon name="info" size={16} />
              {ticket.notes}
            </p>
          )}
          <p className="muted small">
            Pedido #{ticket.order_id.slice(0, 6).toUpperCase()} · Ficha {ticket.public_number} · 1
            unidade
          </p>
          <Badge status={ticket.status} />
          <div className="flow-note">
            <Icon name="info" />
            <p>
              {ticket.status === 'REDEEMED'
                ? 'Esta ficha já foi entregue.'
                : ticket.request_claimed_by && ticket.request_claimed_by !== session()?.actor?.id
                  ? 'Outro garçom assumiu esta solicitação. A entrega deve ser concluída por ele.'
                  : canDeliverTicket(ticket, session()?.actor?.id)
                    ? 'Confirme somente depois de entregar o produto ao cliente. A ficha será marcada como entregue e a solicitação será concluída.'
                    : 'A ficha ainda não está disponível para entrega. Aguarde o preparo ou confira a situação do pedido.'}
            </p>
          </div>
          <div className="modal-footer">
            <ModalCloseButton disabled={busy}>Voltar</ModalCloseButton>
            <button
              className="primary"
              disabled={
                busy || !navigator.onLine || !canDeliverTicket(ticket, session()?.actor?.id)
              }
              onClick={() =>
                void (async () => {
                  const result = await run(
                    () => api('/tickets/' + id + '/redeem', { token: ticket.token }),
                    'Entrega confirmada. Ficha utilizada uma única vez.',
                  );
                  if (result) {
                    onClose();
                    onDelivered();
                  }
                })()
              }
            >
              <Icon name="ready" size={17} />
              {busy ? 'Confirmando…' : 'Confirmar entrega ao cliente'}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p>Não foi possível consultar a ficha. Confira sua conexão e o acesso ao pedido.</p>
          <button onClick={() => setReload(reload + 1)}>
            <Icon name="refresh" size={17} />
            Tentar novamente
          </button>
        </div>
      )}
    </Modal>
  );
}
export function useTicketDelivery(onDelivered: () => void) {
  const [id, setId] = useState<string | null>(null);
  return {
    deliver: (ticket: Data) => setId(ticket.id),
    dialog: id ? (
      <DeliveryDialog key={id} id={id} onClose={() => setId(null)} onDelivered={onDelivered} />
    ) : null,
  };
}
