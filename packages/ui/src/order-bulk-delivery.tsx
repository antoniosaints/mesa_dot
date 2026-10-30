import { useRef, useState } from 'react';
import { CheckCheck, ChefHat } from 'lucide-react';
import { api, session, type Data } from './client.js';
import { Modal, ModalCloseButton } from './common.js';
import { shortId } from './operation-format.js';
import { orderLocationLabel } from '../../shared/src/order-location.js';
import { useToasts } from './toasts.js';
export function OrderBulkDelivery({
  order,
  onUpdate,
}: {
  order: Data;
  onUpdate?: (order: Data) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef(crypto.randomUUID()),
    locked = useRef(false);
  const toast = useToasts();
  const grants: string[] = session()?.actor?.permissions ?? [];
  const pending: Data[] = (order.tickets ?? []).filter(
    (ticket: Data) => !['REDEEMED', 'CANCELLED'].includes(ticket.status),
  );
  const kitchen = pending.filter((ticket) =>
    ['PENDING', 'PREPARING'].includes(ticket.status),
  ).length;
  const blocked = kitchen > 0 && !grants.includes('production.manage');
  if (order.status !== 'CONFIRMED' || !pending.length || !grants.includes('ticket.redeem'))
    return null;
  async function confirm() {
    if (locked.current || blocked) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api(`/orders/${order.id}/deliver-tickets`, {}, 'POST', key.current);
      setOpen(false);
      toast.success(
        result.delivered_count
          ? `${result.delivered_count} ficha(s) marcada(s) como entregue(s).`
          : 'Todas as fichas deste pedido já foram resolvidas.',
      );
      try {
        onUpdate?.(await api('/orders/' + order.id));
      } catch {
        toast.error(
          'Entrega registrada. Não foi possível atualizar o pedido agora; aguarde a atualização automática.',
        );
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="primary"
        disabled={blocked || busy || !navigator.onLine}
        title={
          blocked
            ? 'Seu perfil precisa de permissão de produção para concluir fichas que ainda estão na cozinha.'
            : 'Concluir a entrega de todas as fichas pendentes deste pedido'
        }
        onClick={() => {
          key.current = crypto.randomUUID();
          setError('');
          setOpen(true);
        }}
      >
        <CheckCheck size={16} />
        Marcar todas como entregues
      </button>
      {open && (
        <Modal
          title="Entregar todas as fichas?"
          role="alertdialog"
          closeDisabled={busy}
          className="order-bulk-delivery-modal"
          onClose={() => setOpen(false)}
        >
          <p className="modal-description">
            Pedido {shortId(order.id)} · {orderLocationLabel(order)}
          </p>
          <div className="order-bulk-delivery-count">
            <CheckCheck size={25} />
            <div>
              <strong>{pending.length} ficha(s) a entregar</strong>
              <p>Fichas já entregues ou canceladas serão preservadas.</p>
            </div>
          </div>
          {kitchen > 0 && (
            <div className="flow-note">
              <ChefHat size={22} />
              <p>
                <strong>{kitchen} ficha(s) ainda na cozinha.</strong> O preparo será concluído e a
                entrega será registrada nesta mesma ação, com a baixa de estoque correspondente.
              </p>
            </div>
          )}
          <p className="small muted">
            Confirme somente após entregar os produtos ao cliente. Os chamados destas fichas serão
            concluídos; solicitações assumidas por outro garçom continuam protegidas.
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {blocked && (
            <p className="field-error" role="alert">
              Seu perfil não pode concluir o preparo das fichas de cozinha.
            </p>
          )}
          <div className="modal-footer">
            <ModalCloseButton disabled={busy}>Voltar</ModalCloseButton>
            <button
              className="primary"
              disabled={busy || blocked || !pending.length || !navigator.onLine}
              onClick={() => void confirm()}
            >
              <CheckCheck size={17} />
              {busy ? 'Registrando entregas…' : 'Confirmar entrega de todas'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
