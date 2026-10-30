import { useEffect, useRef, useState } from 'react';
import { WalletCards, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, brl, type Data } from './client.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
export function OnlinePaymentDialog({
  intent,
  onClose,
  onApproved,
}: {
  intent: Data;
  onClose: () => void;
  onApproved: () => Promise<void>;
}) {
  const [status, setStatus] = useState(intent),
    [error, setError] = useState('');
  const approved = useRef(onApproved),
    completed = useRef(false);
  approved.current = onApproved;
  const { run, busy } = useAction();
  useEffect(() => {
    let active = true,
      checking = false;
    async function check() {
      if (checking || completed.current || !navigator.onLine) return;
      checking = true;
      try {
        const fresh = await api('/payments/intents/' + intent.id);
        if (!active) return;
        setStatus(fresh);
        setError('');
        if (fresh.status === 'APPROVED' && !fresh.requires_review) {
          completed.current = true;
          await approved.current();
        }
      } catch (error) {
        if (active) setError((error as Error).message);
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [intent.id]);
  const expired =
    new Date(
      String(status.expires_at).replace(' ', 'T') +
        (/[zZ]|[+-]\d\d:\d\d$/.test(String(status.expires_at)) ? '' : 'Z'),
    ).getTime() <= Date.now();
  const received = status.status === 'APPROVED';
  let url: URL | null = null;
  try {
    url = new URL(status.checkout_url);
    if (
      url.protocol !== 'https:' ||
      !/(^|\.)mercadopago\.com\.br$/.test(url.hostname) ||
      url.username ||
      url.password
    )
      url = null;
  } catch {
    /* An invalid destination must never become a payment link. */
  }
  return (
    <Modal
      title="Pagamento do pedido"
      className="online-payment-modal"
      closeDisabled={busy}
      onClose={onClose}
    >
      <div className="online-payment-heading">
        <WalletCards size={26} />
        <div>
          <span>Mercado Pago</span>
          <strong>{brl(status.amount)}</strong>
        </div>
      </div>
      {received ? (
        <div className="alert" role="status">
          <strong>Pagamento recebido</strong>
          <p>
            {status.requires_review
              ? 'O estabelecimento precisa revisar este pagamento antes de liberar o pedido. Aguarde o atendimento e evite pagar novamente.'
              : 'Preparando suas fichas…'}
          </p>
        </div>
      ) : expired ? (
        <div className="alert" role="status">
          <strong>Prazo deste checkout encerrado</strong>
          <p>
            Verifique se houve pagamento antes de iniciar outro pedido. Se já pagou, aguarde a
            confirmação ou fale com o estabelecimento.
          </p>
        </div>
      ) : (
        <p>
          Conclua o pagamento no ambiente do Mercado Pago. A confirmação será verificada pelo Mesa
          antes de liberar suas fichas.
        </p>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {!received && !expired && url && (
        <a className="online-payment-link" href={url.href} rel="noreferrer">
          <ExternalLink size={17} />
          Pagar com Mercado Pago
        </a>
      )}
      <button
        disabled={busy || !navigator.onLine}
        onClick={() =>
          void run(async () => {
            const result = await api('/payments/intents/' + intent.id + '/sync', {});
            setStatus({ ...status, ...result });
            if (result.status === 'APPROVED' && !result.requires_review && !completed.current) {
              completed.current = true;
              await approved.current();
            }
          }, 'Situação do pagamento atualizada.')
        }
      >
        <RefreshCw size={16} />
        {busy ? 'Verificando pagamento…' : 'Verificar pagamento'}
      </button>
      <div className="complement-admin-note">
        <ShieldCheck size={17} />
        <span>
          O valor e a conta recebedora são conferidos no servidor. Suas fichas aparecem após a
          confirmação.
        </span>
      </div>
      <div className="modal-footer">
        <ModalCloseButton disabled={busy}>Fechar pagamento</ModalCloseButton>
      </div>
    </Modal>
  );
}
