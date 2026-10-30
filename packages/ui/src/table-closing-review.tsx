import { flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Icon, type IconName } from './appearance.js';
import { Badge, Modal, ModalCloseButton, useRefresh } from './common.js';
import { operationTime, shortId } from './operation-format.js';
import { useToasts } from './toasts.js';

export function TableClosingReview({
  table,
  revision,
  hasDraft,
  onClose,
  onReceive,
  onDeliveries,
  onOrder,
  onDraft,
  onUpdated,
  onFinalized,
}: {
  table: Data;
  revision: unknown;
  hasDraft: boolean;
  onClose: () => void;
  onReceive: (tab: Data) => void;
  onDeliveries: () => void;
  onOrder: (id: string) => void;
  onDraft: () => void;
  onUpdated: () => Promise<void>;
  onFinalized: () => void;
}) {
  const [review, setReview] = useState<Data | null>(null),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const version = useRef(0),
    mutating = useRef(false),
    alive = useRef(true);
  const toast = useToasts();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
    };
  }, []);
  async function load() {
    if (mutating.current) return;
    const request = ++version.current;
    setLoading(true);
    try {
      const result = await api(`/tables/${table.id}/closing-review`);
      if (request === version.current && alive.current) {
        setReview(result);
        setError('');
      }
    } catch (e) {
      if (request === version.current && alive.current) {
        setReview(null);
        setError((e as Error).message);
      }
    } finally {
      if (request === version.current && alive.current) setLoading(false);
    }
  }
  useRefresh(load, [table.id, revision]);
  async function act(action: 'finalize' | 'reopen') {
    if (!review?.session_id || mutating.current) return;
    mutating.current = true;
    version.current++;
    setBusy(true);
    setError('');
    try {
      await api(
        `/tables/${table.id}/${action}`,
        action === 'finalize' ? { session_id: review.session_id } : {},
      );
      toast.success(
        action === 'finalize' ? 'Mesa finalizada e liberada.' : 'Atendimento reaberto.',
      );
      await onUpdated();
      flushSync(() => {
        setBusy(false);
        onClose();
      });
      if (action === 'finalize') onFinalized();
    } catch (e) {
      const message = (e as Error).message;
      mutating.current = false;
      await load();
      if (alive.current) setError(message);
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const ready = Boolean(review?.session_id && !review.issues.length && !hasDraft);
  const balances = (review?.tabs ?? []).filter((t: Data) => Number(t.financial.balance) !== 0);
  const checks: [string, IconName, number, string][] = [
    [
      'Comandas e pagamentos',
      'payments',
      balances.length,
      'Todas as comandas estão com saldo zerado.',
    ],
    [
      'Fichas e entregas',
      'ticket',
      review?.tickets?.length ?? 0,
      'Todas as fichas estão entregues ou canceladas.',
    ],
    [
      'Pedidos',
      'orders',
      review?.unfinished_orders?.length ?? 0,
      'Nenhum pedido está em rascunho ou aguardando pagamento.',
    ],
    [
      'Conciliação de pagamentos',
      'receipt',
      review?.pending_payments?.length ?? 0,
      'Nenhum pagamento está em processamento ou revisão.',
    ],
  ];
  return (
    <Modal
      className="table-closing-modal"
      title={'Revisão de fechamento · Mesa ' + table.number}
      closeDisabled={busy}
      onClose={onClose}
    >
      <div className="table-closing-body" aria-busy={loading || busy}>
        {error && (
          <div className="alert error" role="alert">
            {error}
            {!review && (
              <button onClick={() => void load()} disabled={loading}>
                Tentar novamente
              </button>
            )}
          </div>
        )}
        {!review ? (
          loading && (
            <p className="closing-loading" role="status">
              <Icon name="refresh" />
              Conferindo comandas, pedidos, pagamentos e fichas…
            </p>
          )
        ) : !review.session_id ? (
          <div className="closing-verdict ready">
            <Icon name="ready" size={28} />
            <div>
              <h3>Esta mesa já está livre</h3>
              <p>Não há atendimento aberto para finalizar.</p>
            </div>
          </div>
        ) : (
          <>
            <div className={`closing-verdict ${ready ? 'ready' : 'pending'}`} role="status">
              <Icon name={ready ? 'ready' : 'info'} size={30} />
              <div>
                <h3>
                  {ready ? 'Tudo certo para finalizar' : 'Resolva as pendências antes de finalizar'}
                </h3>
                <p>
                  {ready
                    ? 'Pagamentos e entregas conferidos. Confirme abaixo para encerrar as comandas e deixar a mesa livre.'
                    : 'A mesa permanece em atendimento até que os itens abaixo sejam resolvidos.'}
                </p>
              </div>
            </div>
            <div className="closing-totals">
              {[
                ['Total da mesa', review.totals.total],
                ['Pago', review.totals.paid],
                ['Saldo a resolver', review.totals.balance],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{brl(value)}</strong>
                </div>
              ))}
            </div>
            {hasDraft && (
              <div className="closing-local-draft">
                <Icon name="orders" />
                <div>
                  <strong>Há um pedido em montagem nesta tela</strong>
                  <p>Confirme ou remova os itens antes de finalizar a mesa.</p>
                </div>
                <button onClick={onDraft}>Voltar ao pedido</button>
              </div>
            )}
            <div className="closing-checks">
              {checks.map(([label, icon, count, success]) => (
                <section key={label} className={count ? 'has-pending' : 'is-clear'}>
                  <div className="closing-check-heading">
                    <Icon name={count ? icon : 'ready'} size={19} />
                    <h3>{label}</h3>
                    <span>{count ? `${count} pendência(s)` : 'Tudo certo'}</span>
                  </div>
                  {!count ? (
                    <p>{success}</p>
                  ) : label === 'Comandas e pagamentos' ? (
                    <ul>
                      {balances.map((t: Data) => (
                        <li key={t.id}>
                          <span>
                            <strong>{t.label}</strong>
                            <small>Saldo {brl(t.financial.balance)}</small>
                          </span>
                          {Number(t.financial.balance) > 0 && review.can_receive ? (
                            <button onClick={() => onReceive(t)} disabled={busy || loading}>
                              <Icon name="payments" size={15} />
                              Receber saldo
                            </button>
                          ) : (
                            <span className="small muted">
                              {Number(t.financial.balance) > 0
                                ? 'Peça o recebimento ao caixa'
                                : 'Regularize o crédito na comanda'}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : label === 'Fichas e entregas' ? (
                    <>
                      <p>{count} ficha(s) ainda precisam ser entregues ou canceladas.</p>
                      <div className="closing-ticket-list">
                        {review.tickets.slice(0, 5).map((t: Data) => (
                          <span key={t.id}>
                            Ficha {t.public_number} · {t.product_name}
                            <Badge status={t.status} />
                          </span>
                        ))}
                        {count > 5 && <small>Mais {count - 5} ficha(s) na aba Entregas.</small>}
                      </div>
                      {review.can_view_tickets && (
                        <button onClick={onDeliveries}>
                          <Icon name="ticket" size={15} />
                          Resolver entregas
                        </button>
                      )}
                    </>
                  ) : label === 'Pedidos' ? (
                    <ul>
                      {review.unfinished_orders.map((o: Data) => (
                        <li key={o.id}>
                          <span>
                            <strong>{shortId(o.id)}</strong>
                            <Badge status={o.status} />
                          </span>
                          <button onClick={() => onOrder(o.id)}>
                            <Icon name="eye" size={15} />
                            Ver pedido
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul>
                      {review.pending_payments.map((p: Data) => (
                        <li key={p.id}>
                          <span>
                            {p.needs_review
                              ? 'Pagamento precisa de conciliação'
                              : 'Pagamento em processamento'}{' '}
                            · {shortId(p.order_id)}
                          </span>
                          <button onClick={() => onOrder(p.order_id)}>Ver pedido</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
            {!review.can_finalize && (
              <p className="field-hint">
                Seu perfil pode consultar a revisão. A finalização exige permissão para liberar a
                mesa e, quando necessário, conferir o fechamento.
              </p>
            )}
            <div className="closing-review-meta">
              <span>Conferido às {operationTime(review.checked_at)}</span>
              {review.can_reopen && (
                <button onClick={() => void act('reopen')} disabled={busy || loading}>
                  <Icon name="back" size={15} />
                  Reabrir atendimento
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <div className="modal-footer closing-footer">
        <ModalCloseButton disabled={busy}>Voltar à mesa</ModalCloseButton>
        <button onClick={() => void load()} disabled={busy || loading}>
          <Icon name="refresh" size={16} />
          Atualizar revisão
        </button>
        {ready && review?.can_finalize && (
          <button
            className="primary"
            disabled={busy || loading}
            onClick={() => void act('finalize')}
          >
            <Icon name="ready" size={18} />
            {busy ? 'Finalizando…' : 'Finalizar e liberar mesa'}
          </button>
        )}
      </div>
    </Modal>
  );
}
