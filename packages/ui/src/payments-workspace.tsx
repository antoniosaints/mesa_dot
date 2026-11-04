import { orderLocationLabel } from '../../shared/src/order-location.js';
import { Pagination, TableLoading } from './pagination.js';
import { useEffect, useRef, useState } from 'react';
import {
  Wallet,
  CircleDollarSign,
  Undo2,
  Download,
  AlertCircle,
  CreditCard,
  Banknote,
  QrCode,
  Eye,
  ArrowUpDown,
  CheckCircle2,
} from 'lucide-react';
import { api, brl, statusLabel, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Badge, Empty, Modal, ModalCloseButton, useRefresh } from './common.js';
import { SearchSelect } from './controls.js';
import { MoneyInput } from './money-input.js';
import { useToasts } from './toasts.js';
import { operationTime, shortId } from './operation-format.js';
import { cashPage } from './cash-view.js';
import { financeCsv } from './finance-format.js';
import { moneyCents as money, formatMoneyCents as formatDecimal } from './money.js';
import {
  filterPayments,
  paymentTotals,
  paymentReferences,
  paymentMethodLabel,
  type PaymentFilters,
} from './payments-view.js';
const initialFilters: PaymentFilters = {
  search: '',
  method: '',
  status: '',
  from: '',
  to: '',
  group: 'all',
  sort: 'newest',
};
function MethodIcon({ provider }: { provider: string }) {
  return provider === 'CASH' ? (
    <Banknote size={17} />
  ) : provider === 'PIX_MANUAL' ? (
    <QrCode size={17} />
  ) : (
    <CreditCard size={17} />
  );
}
function References({ payment }: { payment: Data }) {
  const refs = paymentReferences(payment);
  return (
    <div className="payment-references">
      {refs.length ? (
        refs.map((a: Data, i: number) => (
          <div key={a.tab_id ?? a.order_id ?? i}>
            <div className="payment-reference-title">
              <strong>{orderLocationLabel(a)}</strong>
              {a.tab_status === 'CLOSED' && (
                <span className="payment-tab-closed">Comanda encerrada</span>
              )}
            </div>
            <small>
              {a.tab_label ||
                (a.order_id ? 'Pedido ' + shortId(a.order_id) : 'Comanda ' + shortId(a.tab_id))}
            </small>
          </div>
        ))
      ) : (
        <span className="muted">Sem vínculo informado</span>
      )}
    </div>
  );
}
function Amounts({ payment: p }: { payment: Data }) {
  return (
    <div className="payment-amounts">
      <div>
        <span>Valor original</span>
        <strong>{brl(p.amount)}</strong>
      </div>
      <div>
        <span>Estornado</span>
        <strong className={Number(p.refunded_amount) ? 'error-text' : ''}>
          {brl(p.refunded_amount)}
        </strong>
      </div>
      <div>
        <span>Recebido líquido</span>
        <strong className="payment-net">{brl(p.net_amount)}</strong>
      </div>
    </div>
  );
}
export function PaymentsWorkspace({ can }: { can: (permission: string) => boolean }) {
  const [records, setRecords] = useState<Data[] | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [filters, setFilters] = useState<PaymentFilters>(initialFilters),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10);
  const [detailId, setDetailId] = useState(''),
    [refundId, setRefundId] = useState('');
  const active = useRef(true),
    fetching = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function load() {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const data = await api('/payments');
      if (active.current) {
        setRecords(data);
        setError('');
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      fetching.current = false;
      if (active.current) setLoading(false);
    }
  }
  useRefresh(load, []);
  const update = (patch: Partial<PaymentFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const rows = filterPayments(records ?? [], filters),
    totals = paymentTotals(rows),
    pagination = cashPage(rows, page, size);
  const methods = [...new Set((records ?? []).map((p) => p.provider))].sort();
  const groupCount = (group: string) => filterPayments(records ?? [], { ...filters, group }).length;
  const hasFilters = Boolean(
    filters.search ||
    filters.method ||
    filters.status ||
    filters.from ||
    filters.to ||
    filters.group !== 'all',
  );
  function exportCsv() {
    const text = financeCsv(
      [
        'Pagamento',
        'Data',
        'Mesa / comanda',
        'Forma',
        'Situação',
        'Valor original',
        'Estornado',
        'Recebido líquido',
        'Conciliação',
      ],
      rows.map((p) => [
        p.id,
        operationTime(p.confirmed_at || p.created_at),
        paymentReferences(p)
          .map(
            (a: Data) =>
              `${orderLocationLabel(a)} · ${a.tab_label ?? shortId(a.order_id ?? a.tab_id)}`,
          )
          .join(' / '),
        paymentMethodLabel(p.provider),
        statusLabel[p.status] ?? p.status,
        p.amount,
        p.refunded_amount,
        p.net_amount,
        p.review_reason,
      ]),
    );
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })),
      link = document.createElement('a');
    link.href = url;
    link.download = 'pagamentos.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const detail = (records ?? []).find((p) => p.id === detailId);
  return (
    <div className="payments-workspace">
      <div className="cash-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO / PAGAMENTOS</span>
          <h1>Pagamentos</h1>
          <p className="muted">Confira cada recebimento, sua comanda e o histórico de estornos.</p>
        </div>
        <div className="button-row">
          <button onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={16} />
            Recarregar
          </button>
          <button onClick={exportCsv} disabled={!rows.length || !records}>
            <Download size={16} />
            Exportar
          </button>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          <AlertCircle size={18} />
          <span>
            {error}
            {records && ' Os últimos dados carregados estão sendo exibidos.'}
          </span>
          <button onClick={() => void load()} disabled={loading}>
            Tentar novamente
          </button>
        </div>
      )}
      <div className="payments-kpis" aria-label="Resumo dos pagamentos filtrados">
        {[
          {
            label: 'Recebido bruto',
            value: brl(totals.gross),
            hint: `${totals.count} recebimento(s) aprovado(s)`,
            icon: CircleDollarSign,
            tone: 'green',
          },
          {
            label: 'Total estornado',
            value: brl(totals.refunded),
            hint: 'Estornos aprovados dos pagamentos listados',
            icon: Undo2,
            tone: 'red',
          },
          {
            label: 'Recebido líquido',
            value: brl(totals.net),
            hint: 'Recebido bruto menos estornos',
            icon: Wallet,
            tone: 'blue',
          },
          {
            label: 'A conciliar',
            value: String(totals.review),
            hint: 'Recebimentos com alerta para revisão',
            icon: AlertCircle,
            tone: 'amber',
          },
        ].map((k) => (
          <StatCard
            key={k.label}
            className={'panel payment-kpi ' + k.tone}
            iconClassName="payment-kpi-icon"
            label={k.label}
            value={records ? k.value : '—'}
            detail={k.hint}
            icon={<k.icon size={21} />}
          />
        ))}
      </div>
      <section className="panel payments-panel" aria-busy={loading}>
        <div className="payments-list-heading">
          <div>
            <h2>Recebimentos e estornos</h2>
            <p className="field-hint">
              Valores dos pagamentos selecionados. O período considera a data do recebimento, não a
              data do estorno.
            </p>
          </div>
          <span className="payments-live">
            <i />
            {loading ? 'Atualizando…' : 'Atualização automática'}
          </span>
        </div>
        <div
          className="payments-group-tabs system-tabs"
          role="tablist"
          aria-label="Grupos de pagamentos"
        >
          {(
            [
              ['all', 'Todos', 'payments'],
              ['received', 'Recebidos', 'check'],
              ['refunded', 'Com estorno', 'back'],
              ['review', 'A conciliar', 'clock'],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              id={'payment-tab-' + id}
              type="button"
              role="tab"
              aria-selected={filters.group === id}
              aria-controls="payments-results"
              onKeyDown={(e) => {
                const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                const buttons = Array.from(
                  e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  ),
                );
                const current = buttons.indexOf(e.currentTarget);
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? buttons.length - 1
                      : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next].focus();
                buttons[next].click();
              }}
              onClick={() => update({ group: id })}
            >
              <Icon name={icon} size={16} />
              {label}
              <span className="system-tab-count">{records ? groupCount(id) : '—'}</span>
            </button>
          ))}
        </div>
        <div className="payments-filters">
          <label className="payment-search">
            Buscar recebimento
            <div className="search-input">
              <Icon name="search" size={17} />
              <input
                type="search"
                aria-label="Buscar pagamentos"
                placeholder="Mesa, comanda, pedido ou referência…"
                value={filters.search}
                onChange={(e) => update({ search: e.target.value })}
              />
            </div>
          </label>
          <label>
            Forma de pagamento
            <SearchSelect
              label="Forma de pagamento"
              value={filters.method}
              onChange={(method) => update({ method })}
              placeholder="Todas as formas"
              options={methods.map((id) => ({ id, name: paymentMethodLabel(id) }))}
            />
          </label>
          <label>
            Situação
            <SearchSelect
              label="Situação do pagamento"
              value={filters.status}
              onChange={(status) => update({ status })}
              placeholder="Todas as situações"
              options={[
                'APPROVED',
                'PARTIALLY_REFUNDED',
                'REFUNDED',
                'PENDING',
                'PROCESSING',
                'FAILED',
              ].map((id) => ({ id, name: statusLabel[id] }))}
            />
          </label>
          <label>
            De
            <input
              type="date"
              aria-label="Recebimentos de"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => update({ from: e.target.value })}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              aria-label="Recebimentos até"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => update({ to: e.target.value })}
            />
          </label>
        </div>
        <div className="payments-results-bar">
          <span>
            {rows.length} pagamento(s) encontrado(s)
            {hasFilters ? ' com os filtros aplicados' : ' · Todo o período'}
          </span>
          <div>
            {hasFilters && (
              <button
                className="payment-clear"
                onClick={() => {
                  setFilters(initialFilters);
                  setPage(1);
                }}
              >
                Limpar filtros
              </button>
            )}
            <select
              aria-label="Ordenar pagamentos"
              value={filters.sort}
              onChange={(e) => update({ sort: e.target.value })}
            >
              <option value="newest">Mais recentes primeiro</option>
              <option value="oldest">Mais antigos primeiro</option>
              <option value="amount">Maior valor original</option>
              <option value="net">Maior recebido líquido</option>
            </select>
          </div>
        </div>
        <div id="payments-results" role="tabpanel" aria-labelledby={'payment-tab-' + filters.group}>
          {!records && loading ? (
            <TableLoading label="Carregando pagamentos…" />
          ) : !rows.length ? (
            <Empty>
              {records?.length
                ? 'Nenhum pagamento corresponde aos filtros. Ajuste a busca ou limpe os filtros.'
                : error
                  ? 'Não foi possível carregar os pagamentos. Tente novamente.'
                  : 'Nenhum recebimento registrado. Os pagamentos das comandas aparecerão aqui.'}
            </Empty>
          ) : (
            <div className="payments-table-wrap">
              <table className="payments-table compact-table" aria-label="Lista de pagamentos">
                <thead>
                  <tr>
                    <th
                      aria-sort={
                        filters.sort === 'newest'
                          ? 'descending'
                          : filters.sort === 'oldest'
                            ? 'ascending'
                            : 'none'
                      }
                    >
                      <button
                        onClick={() =>
                          update({ sort: filters.sort === 'newest' ? 'oldest' : 'newest' })
                        }
                      >
                        Recebimento <ArrowUpDown size={13} />
                      </button>
                    </th>
                    <th>Mesa / comanda</th>
                    <th>Forma</th>
                    <th>Situação</th>
                    <th
                      className="numeric"
                      aria-sort={filters.sort === 'amount' ? 'descending' : 'none'}
                    >
                      <button onClick={() => update({ sort: 'amount' })}>
                        Valor original <ArrowUpDown size={13} />
                      </button>
                    </th>
                    <th
                      className="numeric"
                      aria-sort={filters.sort === 'net' ? 'descending' : 'none'}
                    >
                      <button onClick={() => update({ sort: 'net' })}>
                        Líquido <ArrowUpDown size={13} />
                      </button>
                    </th>
                    <th className="payment-actions-heading">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.rows.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Recebimento">
                        <strong>{shortId(p.id)}</strong>
                        <small>{operationTime(p.confirmed_at || p.created_at)}</small>
                      </td>
                      <td data-label="Mesa / comanda">
                        <References payment={p} />
                      </td>
                      <td data-label="Forma">
                        <span className="payment-method">
                          <MethodIcon provider={p.provider} />
                          {paymentMethodLabel(p.provider)}
                        </span>
                      </td>
                      <td data-label="Situação">
                        <Badge status={p.status} />
                        {p.review_reason && (
                          <span className="payment-review">
                            <AlertCircle size={13} />A conciliar
                          </span>
                        )}
                      </td>
                      <td data-label="Valor original" className="numeric">
                        <strong>{brl(p.amount)}</strong>
                        {Number(p.refunded_amount) > 0 && (
                          <small className="error-text">− {brl(p.refunded_amount)} estornado</small>
                        )}
                      </td>
                      <td data-label="Líquido" className="numeric">
                        <strong className="payment-net">{brl(p.net_amount)}</strong>
                      </td>
                      <td data-label="Ações">
                        <div className="payment-row-actions">
                          <button
                            onClick={() => setDetailId(p.id)}
                            aria-label={'Ver pagamento ' + shortId(p.id)}
                          >
                            <Eye size={15} />
                            Detalhes
                          </button>
                          {can('payment.refund') &&
                            ['APPROVED', 'PARTIALLY_REFUNDED'].includes(p.status) && (
                              <button
                                className="payment-refund-button"
                                disabled={Number(p.refundable_amount) <= 0 || loading}
                                title={
                                  Number(p.refundable_amount) <= 0
                                    ? 'Sem saldo estornável em comandas abertas. Consulte os detalhes.'
                                    : undefined
                                }
                                onClick={() => setRefundId(p.id)}
                                aria-label={'Estornar pagamento ' + shortId(p.id)}
                              >
                                <Undo2 size={15} />
                                Estornar
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Pagination
          label="Pagamentos"
          total={pagination.total}
          page={page}
          pageSize={size}
          onPageChange={setPage}
          onPageSizeChange={setSize}
          loading={loading}
          pageSizeOptions={[10, 25, 50]}
          previousLabel="Página anterior de pagamentos"
          nextLabel="Próxima página de pagamentos"
        />
      </section>
      {detail && (
        <Modal
          className="payment-detail-modal"
          title={'Pagamento ' + shortId(detail.id)}
          onClose={() => setDetailId('')}
        >
          <div className="payment-detail-body">
            <div className="payment-detail-title">
              <span className="payment-method">
                <MethodIcon provider={detail.provider} />
                {paymentMethodLabel(detail.provider)}
              </span>
              <Badge status={detail.status} />
            </div>
            <Amounts payment={detail} />
            {detail.review_reason && (
              <div className="alert warning">
                <AlertCircle size={18} />
                <span>Revisão necessária: {detail.review_reason}</span>
              </div>
            )}
            <section>
              <h3>Destino do recebimento</h3>
              <References payment={detail} />
              {detail.allocations.map((a: Data) => (
                <div className="payment-allocation" key={a.id}>
                  <div>
                    <strong>{a.tab_label}</strong>
                    <small>
                      {a.tab_status === 'CLOSED' ? 'Comanda encerrada' : 'Comanda em atendimento'}
                    </small>
                  </div>
                  <div>
                    <strong>{brl(a.amount)}</strong>
                    <small>{brl(a.refundable_amount)} disponível para estorno</small>
                  </div>
                </div>
              ))}
            </section>
            <section>
              <h3>
                Histórico de estornos <span className="muted">({detail.refunds.length})</span>
              </h3>
              {detail.refunds.length ? (
                detail.refunds.map((r: Data) => (
                  <article className="payment-history-item" key={r.id}>
                    <Undo2 size={17} />
                    <div>
                      <strong>
                        {brl(r.amount)} · {statusLabel[r.status] ?? r.status}
                      </strong>
                      <p>{r.reason}</p>
                      <small>
                        {operationTime(r.created_at)}
                        {r.tab_id
                          ? ' · ' +
                            (detail.allocations.find((a: Data) => a.tab_id === r.tab_id)
                              ?.tab_label ?? shortId(r.tab_id))
                          : ''}
                      </small>
                    </div>
                  </article>
                ))
              ) : (
                <p className="field-hint">Nenhum estorno registrado neste recebimento.</p>
              )}
            </section>
            <dl className="payment-identifiers">
              <div>
                <dt>Recebido em</dt>
                <dd>{operationTime(detail.confirmed_at || detail.created_at)}</dd>
              </div>
              <div>
                <dt>Identificador</dt>
                <dd>{detail.id}</dd>
              </div>
              <div>
                <dt>Referência do provedor</dt>
                <dd>{detail.provider_reference}</dd>
              </div>
            </dl>
            {Number(detail.refundable_amount) <= 0 &&
              ['APPROVED', 'PARTIALLY_REFUNDED'].includes(detail.status) && (
                <p className="field-hint">
                  Sem saldo disponível para estorno em comandas abertas. Comandas encerradas exigem
                  um fluxo administrativo específico.
                </p>
              )}
          </div>
          <div className="modal-footer">
            <ModalCloseButton>Fechar detalhes</ModalCloseButton>
            {can('payment.refund') && Number(detail.refundable_amount) > 0 && (
              <button className="danger" onClick={() => setRefundId(detail.id)}>
                <Undo2 size={16} />
                Estornar pagamento
              </button>
            )}
          </div>
        </Modal>
      )}
      {refundId && <RefundDialog id={refundId} onClose={() => setRefundId('')} onDone={load} />}
    </div>
  );
}
function RefundDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [payment, setPayment] = useState<Data | null>(null),
    [cash, setCash] = useState<Data[]>([]),
    [tab, setTab] = useState(''),
    [cashId, setCashId] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const toast = useToasts();
  const initialSelection = useRef({ tab: '', cash: '' });
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const p = await api('/payments/' + id),
          turns = p.provider === 'CASH' ? await api('/cash/active') : [];
        if (live) {
          setPayment(p);
          setCash(turns);
          const first = p.allocations.find((a: Data) => Number(a.refundable_amount) > 0);
          initialSelection.current = { tab: first?.tab_id ?? '', cash: turns[0]?.id ?? '' };
          setTab(first?.tab_id ?? '');
          setAmount(first?.refundable_amount ?? p.refundable_amount);
          setCashId(turns[0]?.id ?? '');
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);
  const allocation = payment?.allocations.find((a: Data) => a.tab_id === tab),
    max = allocation?.refundable_amount ?? payment?.refundable_amount ?? '0.00';
  return (
    <Modal
      className="payment-refund-modal"
      title="Estornar pagamento"
      onClose={onClose}
      closeDisabled={busy}
      dirty={Boolean(
        reason ||
        (!loading &&
          (amount !== max ||
            tab !== initialSelection.current.tab ||
            cashId !== initialSelection.current.cash)),
      )}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setError('');
            try {
              const value = money(amount);
              if (value <= 0n || value > money(max))
                throw new Error('Informe um valor maior que zero e até ' + brl(max) + '.');
              if (reason.trim().length < 3)
                throw new Error('Descreva o motivo do estorno com pelo menos 3 caracteres.');
              setBusy(true);
              await api('/payments/' + id + '/refund', {
                amount: formatDecimal(value),
                reason: reason.trim(),
                ...(payment?.allocations.length ? { tab_id: tab } : {}),
                ...(payment?.provider === 'CASH' ? { cash_session_id: cashId } : {}),
              });
              toast.success('Estorno registrado. O saldo da comanda foi atualizado.');
              onClose();
              await onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <fieldset className="payment-detail-body" disabled={busy}>
          {loading ? (
            <p role="status">Conferindo o recebimento…</p>
          ) : (
            payment && (
              <>
                <div className="payment-refund-context">
                  <Undo2 size={21} />
                  <div>
                    <strong>
                      {shortId(payment.id)} · {paymentMethodLabel(payment.provider)}
                    </strong>
                    <p>Disponível para estorno: {brl(max)}</p>
                  </div>
                </div>
                <p className="field-hint">
                  O estorno reduz o recebido e reabre o saldo correspondente da comanda. Confira o
                  valor antes de confirmar.
                </p>
                {payment.allocations.length > 0 && (
                  <label>
                    Comanda do estorno
                    <SearchSelect
                      label="Comanda do estorno"
                      required
                      allowClear={false}
                      value={tab}
                      onChange={(value) => {
                        setTab(value);
                        setAmount(
                          payment.allocations.find((a: Data) => a.tab_id === value)
                            ?.refundable_amount ?? '',
                        );
                      }}
                      options={payment.allocations
                        .filter((a: Data) => Number(a.refundable_amount) > 0)
                        .map((a: Data) => ({
                          id: a.tab_id,
                          name: `${orderLocationLabel(a)} · ${a.tab_label} · ${brl(a.refundable_amount)} disponível`,
                        }))}
                      disabled={busy}
                    />
                  </label>
                )}
                <label>
                  Valor do estorno
                  <MoneyInput
                    label="Valor do estorno"
                    required
                    value={amount}
                    onChange={setAmount}
                  />
                </label>
                {payment.provider === 'CASH' && (
                  <>
                    <label>
                      Turno de caixa
                      <SearchSelect
                        label="Turno de caixa"
                        value={cashId}
                        onChange={setCashId}
                        required
                        allowClear={false}
                        disabled={busy}
                        options={cash.map((c) => ({ id: c.id, name: 'Turno ' + shortId(c.id) }))}
                      />
                    </label>
                    {!cash.length && (
                      <div className="alert warning">
                        Abra um turno de caixa para registrar o estorno em dinheiro.
                      </div>
                    )}
                  </>
                )}
                <label>
                  Motivo do estorno
                  <textarea
                    required
                    minLength={3}
                    maxLength={255}
                    value={reason}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explique por que este valor será devolvido…"
                    rows={3}
                  />
                </label>
              </>
            )
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
        </fieldset>
        <div className="modal-footer">
          <ModalCloseButton disabled={busy}>Voltar</ModalCloseButton>
          <button
            className="danger"
            disabled={
              loading ||
              busy ||
              !payment ||
              Number(max) <= 0 ||
              (payment.provider === 'CASH' && !cashId)
            }
          >
            <CheckCircle2 size={16} />
            {busy ? 'Registrando…' : 'Confirmar estorno'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
import { StatCard } from './data-display.js';
