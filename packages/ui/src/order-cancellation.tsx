import { orderLocationLabel } from '../../shared/src/order-location.js';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, brl, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Modal, ModalCloseButton, Badge, useAction } from './common.js';
import { useFormDialog } from './forms.js';
import { shortId } from './operation-format.js';
const providerName = (provider: string) =>
  ({
    sandbox: 'Sandbox · pagamento de teste',
    CASH: 'Dinheiro',
    PIX_MANUAL: 'Pix conferido',
    CARD_MANUAL: 'Cartão conferido',
  })[provider] ?? provider;
export function OrderCancellationDialog({
  order,
  onClose,
  onCancelled,
  onUpdated,
}: {
  order: Data;
  onClose: () => void;
  onCancelled: () => void;
  onUpdated: () => void;
}) {
  const [context, setContext] = useState<Data | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [cancelKey] = useState(() => crypto.randomUUID());
  const confirmButton = useRef<HTMLButtonElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const { run, busy } = useAction();
  const refunds = useFormDialog();
  async function load() {
    const value = await api(`/orders/${order.id}/cancellation-context`);
    setContext(value);
    return value;
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    void run(async () => {
      const value = await api(`/orders/${order.id}/cancellation-context`);
      if (active) setContext(value);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [order.id, retry]);
  function openRefund(target: Data) {
    const refundKey = crypto.randomUUID();
    refunds.open({
      title: 'Estornar pagamento do pedido',
      description: `Pedido ${shortId(order.id)} · ${orderLocationLabel(context ?? order)} · ${providerName(target.provider)}. Disponível para estorno: ${brl(target.refundable_amount)}. O cancelamento será confirmado separadamente após o estorno.`,
      fields: [
        {
          key: 'amount',
          type: 'currency',
          label: 'Valor do estorno',
          required: true,
          initial: target.refundable_amount,
          hint: 'Informe o valor em reais. Confira o pagamento antes de confirmar o estorno.',
        },
        ...(target.provider === 'CASH'
          ? [
              {
                key: 'cash_session_id',
                label: 'Turno de caixa para o estorno',
                type: 'select' as const,
                required: true,
                initial: context?.cash_sessions[0]?.id,
                options:
                  context?.cash_sessions.map((cash: Data) => ({
                    id: cash.id,
                    name: cash.name + ' · ' + cash.id.slice(0, 8),
                  })) ?? [],
              },
            ]
          : []),
        {
          key: 'reason',
          label: 'Motivo do estorno',
          type: 'textarea',
          required: true,
          minLength: 3,
          maxLength: 255,
          initial: reason,
        },
      ],
      submitLabel: 'Confirmar estorno',
      successMessage:
        'Estorno registrado. Confira as condições e confirme o cancelamento do pedido.',
      onSubmit: async (values) => {
        const result = await api(
          `/payments/${target.payment_id}/refund`,
          {
            ...values,
            ...(target.tab_id ? { tab_id: target.tab_id } : {}),
          },
          'POST',
          refundKey,
        );
        try {
          await load();
        } catch {
          setContext(null);
        }
        onUpdated();
        return result;
      },
      onSuccess: (result) => {
        setReason((previous) => previous || result.reason);
        requestAnimationFrame(() => {
          if (confirmButton.current && !confirmButton.current.disabled)
            confirmButton.current.focus();
          else reasonField.current?.focus();
        });
      },
    });
  }
  const needsRefund = Number(context?.refund_required_amount ?? 0) > 0;
  return (
    <>
      <Modal
        title="Cancelar pedido"
        dirty={Boolean(reason)}
        closeDisabled={busy && !loading}
        onClose={onClose}
      >
        <form
          className="stack order-cancellation-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!context?.can_cancel) return;
            void (async () => {
              const result = await run(async () => {
                try {
                  return await api(`/orders/${order.id}/cancel`, { reason }, 'POST', cancelKey);
                } catch (error) {
                  try {
                    await load();
                  } catch {
                    /* preserve the reason even if refreshing fails */
                  }
                  throw error;
                }
              }, 'Pedido cancelado.');
              if (result) {
                flushSync(onClose);
                onCancelled();
              }
            })();
          }}
        >
          <p className="muted small">
            Pedido {shortId(order.id)} · {brl(order.total)}
            {context ? ' · ' + orderLocationLabel(context) : ''}
          </p>
          <label>
            Motivo do cancelamento<span className="sr-only">Obrigatório</span>
            <textarea
              ref={reasonField}
              aria-label="Motivo do cancelamento"
              required
              minLength={3}
              maxLength={255}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {loading ? (
            <p role="status">Conferindo pagamentos e condições do cancelamento…</p>
          ) : !context ? (
            <div className="flow-note">
              <p>Não foi possível conferir os pagamentos deste pedido.</p>
              <button type="button" onClick={() => setRetry(retry + 1)}>
                <Icon name="refresh" size={16} />
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              {context.cancellation_blockers.length > 0 && (
                <div className="flow-note cancellation-blockers">
                  <Icon name="info" />
                  <div>
                    <strong>Este pedido exige tratamento manual</strong>
                    <ul>
                      {context.cancellation_blockers.map((message: string) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                    {needsRefund && (
                      <p>
                        O estorno abaixo é uma operação financeira e não libera o cancelamento de
                        produtos já entregues, em preparo ou produzidos.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {needsRefund && (
                <section className="order-refund-section">
                  <div className="section-head">
                    <div>
                      <h3>Pagamento vinculado ao pedido</h3>
                      <p className="muted small">
                        Ainda é necessário estornar {brl(context.refund_required_amount)} antes de
                        cancelar.
                      </p>
                    </div>
                    <Icon name="payments" />
                  </div>
                  {!context.can_refund ? (
                    <p className="flow-note">
                      Seu perfil não possui permissão para estornar. Solicite a um responsável com
                      acesso a estornos.
                    </p>
                  ) : (
                    context.refund_targets
                      .filter((target: Data) => Number(target.refundable_amount) > 0)
                      .map((target: Data) => (
                        <article
                          className="refund-payment-card"
                          key={target.payment_id + ':' + target.tab_id}
                        >
                          <div>
                            <strong>{providerName(target.provider)}</strong>
                            <p className="muted small">
                              Pagamento {shortId(target.payment_id)}
                              {target.tab_label ? ' · ' + target.tab_label : ''}
                            </p>
                            <p className="muted small">
                              Recebido: {brl(target.payment_amount)} · Já estornado:{' '}
                              {brl(target.refunded_amount)}
                            </p>
                            <strong>Disponível: {brl(target.refundable_amount)}</strong>
                          </div>
                          <Badge status={target.status} />
                          <button
                            type="button"
                            className="primary"
                            title={target.blocked_reason ?? undefined}
                            disabled={
                              busy ||
                              Boolean(target.blocked_reason) ||
                              (target.provider === 'CASH' && !context.cash_sessions.length)
                            }
                            onClick={() => openRefund(target)}
                          >
                            <Icon name="payments" size={17} />
                            Estornar pagamento
                          </button>
                          {target.blocked_reason && (
                            <p className="field-hint refund-blocked-reason">
                              {target.blocked_reason}
                            </p>
                          )}
                          {target.provider === 'CASH' && !context.cash_sessions.length && (
                            <p className="field-hint refund-blocked-reason">
                              Abra um turno de caixa para registrar a saída do dinheiro.
                            </p>
                          )}
                        </article>
                      ))
                  )}
                </section>
              )}
              {!needsRefund && context.cancellation_blockers.length === 0 && (
                <div className="flow-note">
                  <Icon name="ready" />
                  <p>
                    Não há pagamento vinculado pendente de estorno. Confira o motivo e confirme o
                    cancelamento.
                  </p>
                </div>
              )}
            </>
          )}
          <div className="modal-footer">
            <ModalCloseButton disabled={busy && !loading}>Voltar</ModalCloseButton>
            <button
              ref={confirmButton}
              className="primary"
              disabled={busy || loading || !context?.can_cancel}
            >
              <Icon name="close" size={17} />
              {busy && !loading ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
          </div>
        </form>
      </Modal>
      {refunds.dialog}
    </>
  );
}
