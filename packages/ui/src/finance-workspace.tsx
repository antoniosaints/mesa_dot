import { orderLocationLabel } from '../../shared/src/order-location.js';
import { Pagination, TableLoading } from './pagination.js';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  CalendarDays,
  Download,
  TrendingUp,
  Wallet,
  CircleDollarSign,
  LockKeyhole,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react';
import { api, brl, type Data } from './client.js';
import { Icon, type IconName } from './appearance.js';
import { Badge, Empty, Modal, useRefresh } from './common.js';
import { SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import { operationTime, shortId } from './operation-format.js';
import { financeDay, financeCsv, financeChange } from './finance-format.js';
import { AiSummaryButton } from './ai-assistant.js';

const tabs = [
  ['overview', 'Visão geral', 'dashboard'],
  ['sales', 'Vendas', 'orders'],
  ['payments', 'Pagamentos', 'payments'],
  ['receivables', 'Contas a receber', 'receipt'],
  ['cash', 'Caixa', 'cash'],
  ['flow', 'Fluxo de recebimentos', 'finance'],
  ['closures', 'Fechamentos', 'check'],
] as const;
const methodNames: Record<string, string> = {
  PIX: 'Pix',
  CASH: 'Dinheiro',
  PIX_MANUAL: 'Pix',
  CARD_MANUAL: 'Cartão',
  CARD: 'Cartão',
  sandbox: 'Gateway de teste',
  mercadopago: 'Mercado Pago',
  REFUND: 'Estorno',
  WITHDRAWAL: 'Sangria',
  SUPPLY: 'Suprimento',
};
const methodName = (v: string) => methodNames[v] ?? v;
const recordTitles: Record<string, string> = {
  sales: 'Pedidos do período',
  payments: 'Pagamentos do período',
  receivables: 'Comandas com saldo a receber',
  movements: 'Movimentações de caixa',
  closures: 'Turnos encerrados no período',
};
const columns: Record<string, string[]> = {
  sales: ['Pedido / horário', 'Mesa / comanda', 'Origem', 'Itens', 'Total', 'Situação', 'Ações'],
  payments: [
    'Pagamento / horário',
    'Comandas',
    'Forma',
    'Valor registrado',
    'Estornado até agora',
    'Líquido atual',
    'Situação',
  ],
  receivables: [
    'Comanda',
    'Mesa / cliente',
    'Consumo líquido',
    'Recebido líquido',
    'Saldo atual',
    'Situação',
  ],
  movements: ['Horário', 'Caixa', 'Tipo', 'Motivo', 'Valor'],
  closures: ['Fechamento', 'Caixa', 'Responsável', 'Esperado em dinheiro', 'Contado', 'Diferença'],
};
function CardTitle({
  icon,
  title,
  extra,
}: {
  icon: IconName;
  title: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="finance-card-title">
      <h2>
        <Icon name={icon} size={18} />
        {title}
      </h2>
      {extra}
    </div>
  );
}
function Donut({
  parts,
  value,
  label,
}: {
  parts: { label: string; value: number; color: string; detail: string }[];
  value: string;
  label: string;
}) {
  const positive = parts.filter((p) => p.value > 0),
    sum = positive.reduce((a, p) => a + p.value, 0);
  let cursor = 0;
  const stops = positive.map((p) => {
    const from = cursor;
    cursor += (p.value / (sum || 1)) * 100;
    return `${p.color} ${from}% ${cursor}%`;
  });
  return (
    <div className="finance-donut-content">
      <div
        className="finance-donut"
        role="img"
        aria-label={`${label}: ${value}`}
        style={
          {
            '--donut': sum ? `conic-gradient(${stops.join(',')})` : 'var(--border)',
          } as CSSProperties
        }
      >
        <div>
          <strong>{value}</strong>
          <small>{label}</small>
        </div>
      </div>
      <ul className="finance-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <strong>{p.detail}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function FinanceWorkspace({ can }: { can: (permission: string) => boolean }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const active = params.get('aba') ?? 'overview',
    tab = tabs.some(([id]) => id === active) ? active : 'overview';
  const today = financeDay();
  const [dates, setDates] = useState({ start: today, end: today });
  const [draftDates, setDraftDates] = useState(dates);
  const [periodPreset, setPeriodPreset] = useState('today');
  const summaryRequest = useRef(0);
  useEffect(
    () => () => {
      summaryRequest.current++;
    },
    [],
  );
  const [units, setUnits] = useState<Data[]>([]);
  const [unit, setUnit] = useState('');
  const [contextError, setContextError] = useState('');
  const [contextAttempt, setContextAttempt] = useState(0);
  const [summary, setSummary] = useState<Data | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [records, setRecords] = useState<Data | null>(null);
  const [recordError, setRecordError] = useState('');
  const [recordLoading, setRecordLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [cashId, setCashId] = useState('');
  const [detail, setDetail] = useState<Data | null>(null);
  const forms = useFormDialog();
  const kind = tab === 'overview' ? 'sales' : tab === 'cash' || tab === 'flow' ? 'movements' : tab;
  const key = JSON.stringify({ unit, ...dates });
  const query = new URLSearchParams({
    ...dates,
    ...(unit ? { establishment_id: unit } : {}),
  }).toString();
  useEffect(() => {
    let active = true;
    void api('/finance/context')
      .then((value) => {
        if (active) {
          setUnits(value.establishments);
          setContextError('');
        }
      })
      .catch((e) => {
        if (active) setContextError(e.message);
      });
    return () => {
      active = false;
    };
  }, [contextAttempt]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useLayoutEffect(() => {
    setSearch('');
    setDebounced('');
    setStatus('');
    setMethod('');
    setPage(1);
    setRecords(null);
  }, [tab]);
  async function load() {
    const request = ++summaryRequest.current;
    setLoading(true);
    try {
      const value = await api('/finance/dashboard?' + query);
      if (request !== summaryRequest.current) return;
      setSummary({ ...value, _key: key });
      setSummaryError('');
      setTick((v) => v + 1);
    } catch (e) {
      if (request !== summaryRequest.current) return;
      setSummary(null);
      setSummaryError((e as Error).message);
    } finally {
      if (request === summaryRequest.current) setLoading(false);
    }
  }
  function retryPanel() {
    setContextAttempt((v) => v + 1);
    void load();
  }
  useRefresh(load, [key]);
  const visibleSummary = summary?._key === key ? summary : null;
  // Switching tabs clears the rows even when both views share the same record kind.
  const filterKey = JSON.stringify({ key, tab, kind, debounced, status, method, size, sort });
  const recordKey = JSON.stringify({ filterKey, page });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRecordLoading(true);
    setRecordError('');
    const q = new URLSearchParams(query);
    Object.entries({
      kind,
      sort,
      search: debounced,
      status,
      method,
      page: String(page),
      page_size: String(size),
    }).forEach(([k, v]) => q.set(k, v));
    void api(
      '/finance/records?' + q.toString(),
      undefined,
      undefined,
      undefined,
      'json',
      controller.signal,
    )
      .then((value) => {
        if (active) {
          setRecords({ ...value, _key: recordKey, _filterKey: filterKey });
          if (value.page !== page) setPage(value.page);
        }
      })
      .catch((e) => {
        if (active) {
          setRecords(null);
          setRecordError(e.message);
        }
      })
      .finally(() => {
        if (active) setRecordLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [recordKey, tick]);
  const data = records?._key === recordKey ? records : null;
  const pageMetadata = records?._filterKey === filterKey ? records : null;
  const recordBusy = recordLoading || search !== debounced || (!data && !recordError);
  const s = visibleSummary,
    totals = s?.totals ?? {},
    previous = s?.comparison ?? {},
    current = s?.current ?? {};
  const cash = (s?.cash ?? []).find((c: Data) => c.id === cashId) ?? s?.cash?.[0];
  function selectTab(id: string) {
    const next = new URLSearchParams(params);
    next.set('aba', id);
    setParams(next);
  }
  function preset(value: string) {
    setPeriodPreset(value);
    if (value === 'custom') return;
    const end = financeDay(value === 'yesterday' ? -1 : 0);
    const start =
      value === '7'
        ? financeDay(-6)
        : value === '30'
          ? financeDay(-29)
          : value === 'month'
            ? today.slice(0, 7) + '-01'
            : end;
    setDates({ start, end });
    setDraftDates({ start, end });
    setPage(1);
  }
  useEffect(() => {
    document
      .getElementById('finance-tab-' + tab)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  const canCash = can('cash.manage') && (!unit || unit === s?.actor_unit_id);
  // Operations are always bound to the authenticated unit, never a report's alternate unit.
  function cashMovement(type: 'WITHDRAWAL' | 'SUPPLY') {
    if (!cash) return;
    forms.open({
      title: type === 'WITHDRAWAL' ? 'Registrar sangria' : 'Registrar suprimento',
      description: `${cash.register_name} · dinheiro esperado ${brl(cash.expected)}`,
      fields: [
        { key: 'amount', type: 'currency', label: 'Valor', required: true },
        {
          key: 'reason',
          label: 'Motivo',
          type: 'textarea',
          required: true,
          minLength: 3,
          maxLength: 255,
        },
      ],
      successMessage: 'Movimentação registrada.',
      onSubmit: async (values) => {
        await api('/cash/movements', { cash_session_id: cash.id, type, ...values });
        await load();
      },
    });
  }
  function closeCash() {
    if (!cash) return;
    forms.open({
      title: 'Fechar caixa',
      description: `${cash.register_name} · esperado em dinheiro ${brl(cash.expected)}. Conte o dinheiro físico antes de confirmar.`,
      fields: [
        { key: 'counted_amount', type: 'currency', label: 'Dinheiro contado', required: true },
      ],
      submitLabel: 'Confirmar fechamento',
      successMessage: 'Caixa encerrado.',
      onSubmit: async (values) => {
        await api(`/cash/sessions/${cash.id}/close`, values);
        await load();
      },
    });
  }
  function openCash() {
    const available = (s?.registers ?? []).filter(
      (r: Data) => !s?.cash.some((c: Data) => c.register_id === r.id),
    );
    forms.open({
      title: 'Abrir caixa',
      fields: [
        {
          key: 'register_id',
          type: 'select',
          label: 'Caixa',
          required: true,
          options: available.map((r: Data) => ({ id: r.id, name: r.name })),
          initial: available[0]?.id,
        },
        {
          key: 'opening_amount',
          type: 'currency',
          label: 'Fundo de abertura',
          required: true,
          initial: '0.00',
        },
      ],
      successMessage: 'Caixa aberto.',
      onSubmit: async (values) => {
        await api('/cash/sessions', values);
        await load();
      },
    });
  }
  function exportPage() {
    if (!data?.rows.length) return;
    const headers = columns[kind].filter((v) => v !== 'Ações');
    const values = data.rows.map((r: Data) => rowValues(r));
    const url = URL.createObjectURL(
      new Blob([financeCsv(headers, values)], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro-${kind}-${dates.start}-${dates.end}-pagina-${data.page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function rowValues(r: Data): string[] {
    if (kind === 'sales')
      return [
        `${shortId(r.id)} · ${operationTime(r.occurred_at)}`,
        `${orderLocationLabel(r)} · ${r.tab_name ?? 'Sem comanda'}`,
        r.source === 'POS' ? 'Caixa / PDV' : r.source === 'WAITER' ? 'Garçom' : 'Cliente',
        String(r.items),
        brl(r.amount),
        r.status,
      ];
    if (kind === 'payments')
      return [
        `${shortId(r.id)} · ${operationTime(r.occurred_at)}`,
        r.tab_name || 'Sem alocação',
        methodName(r.provider),
        brl(r.amount),
        brl(r.refunded),
        brl(r.net),
        r.status,
      ];
    if (kind === 'receivables')
      return [
        r.tab_name,
        `${orderLocationLabel(r)} · ${r.customer_name ?? 'Compartilhada'}`,
        brl(Number(r.charges) - Number(r.credits) - Number(r.discounts)),
        brl(r.paid),
        brl(r.balance),
        r.status,
      ];
    if (kind === 'movements')
      return [
        operationTime(r.occurred_at),
        r.register_name,
        methodName(r.status),
        r.reason,
        brl(r.amount),
      ];
    return [
      operationTime(r.occurred_at),
      r.register_name,
      r.closed_by_name ?? '—',
      brl(r.expected),
      brl(r.amount),
      brl(r.difference),
    ];
  }
  const kpis: [string, string, string, IconName, string][] = [
    [
      'Faturamento líquido',
      brl(totals.revenue),
      financeChange(totals.revenue ?? 0, previous.revenue ?? 0),
      'cash',
      'green',
    ],
    [
      'Recebido líquido',
      brl(totals.received),
      'Após estornos ocorridos no período',
      'payments',
      'blue',
    ],
    [
      'Em aberto agora',
      brl(current.outstanding),
      `${current.outstanding_tabs ?? 0} comanda(s) com saldo atual`,
      'clock',
      'amber',
    ],
    [
      'Ticket médio',
      brl(totals.average),
      'Faturamento líquido por pedido lançado',
      'dashboard',
      'purple',
    ],
    [
      'Mesas atendidas',
      String(totals.attendances ?? 0),
      'Atendimentos iniciados no período',
      'team',
      'teal',
    ],
  ];
  const maxHour = Math.max(1, ...(s?.hourly ?? []).map((h: Data) => Math.abs(Number(h.amount))));
  const cashPanel = (
    <aside className="finance-side">
      <section className="panel finance-cash">
        <CardTitle
          icon="cash"
          title="Caixa atual"
          extra={
            <span className={`finance-state ${cash ? 'is-open' : ''}`}>
              {cash ? 'Aberto' : 'Sem turno aberto'}
            </span>
          }
        />
        {s?.cash?.length > 1 && (
          <SearchSelect
            label="Turno de caixa"
            options={s!.cash.map((c: Data) => ({ id: c.id, name: c.register_name }))}
            value={cash?.id ?? ''}
            onChange={setCashId}
            allowClear={false}
          />
        )}
        {cash ? (
          <>
            <p className="small muted">
              Aberto por <strong>{cash.opened_by_name}</strong>
              <br />
              {cash.register_name} · {operationTime(cash.created_at)}
            </p>
            <dl className="finance-money-list">
              {[
                ['Fundo de abertura', cash.opening_amount],
                ['Vendas em dinheiro', cash.cash_sales],
                ['Estornos em dinheiro', cash.refunds],
                ['Sangrias', cash.withdrawals],
                ['Suprimentos', cash.supplies],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{brl(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="finance-cash-total">
              <span>Dinheiro esperado</span>
              <strong>{brl(cash.expected)}</strong>
            </div>
            <p className="field-hint">
              Cartão e Pix entram nos recebimentos, sem compor o dinheiro físico.
            </p>
            {canCash && (
              <>
                <div className="finance-cash-buttons">
                  <button onClick={() => cashMovement('WITHDRAWAL')}>
                    <ArrowDownToLine size={16} />
                    Sangria
                  </button>
                  <button onClick={() => cashMovement('SUPPLY')}>
                    <ArrowUpFromLine size={16} />
                    Suprimento
                  </button>
                </div>
                <button className="primary" onClick={closeCash}>
                  <LockKeyhole size={17} />
                  Fechar caixa
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <Empty>Nenhum caixa aberto nesta unidade.</Empty>
            {canCash &&
              s?.registers.some((r: Data) => !s.cash.some((c: Data) => c.register_id === r.id)) && (
                <button className="primary" onClick={openCash}>
                  <Icon name="plus" size={16} />
                  Abrir caixa
                </button>
              )}
          </>
        )}
        {!canCash && unit && unit !== s?.actor_unit_id && (
          <p className="field-hint">Para movimentar este caixa, entre na unidade correspondente.</p>
        )}
      </section>
      <section className="panel finance-quick">
        <CardTitle icon="receipt" title="Acesso rápido" />
        {[
          ['receivables', 'cash', 'Recebimentos pendentes'],
          ['payments', 'payments', 'Consultar pagamentos'],
          ['flow', 'dashboard', 'Fluxo de recebimentos'],
          ['closures', 'receipt', 'Conferir fechamentos'],
        ].map(([id, icon, label]) => (
          <button key={id} onClick={() => selectTab(id)}>
            <Icon name={icon as IconName} size={18} />
            {label}
            <Icon name="next" size={16} />
          </button>
        ))}
      </section>
      <p className="small muted">
        <LockKeyhole size={12} /> Exclusivo do administrador geral
        <br />
        Valores da unidade selecionada · horário de Brasília.
      </p>
    </aside>
  );
  return (
    <div className="finance-workspace">
      <div className="finance-heading">
        <div>
          <span className="eyebrow">GESTÃO DA CONTA</span>
          <h1>Financeiro</h1>
          <p className="muted">Acompanhe faturamento, recebimentos e saldos em um só lugar.</p>
        </div>
        <div className="button-row">
          <AiSummaryButton
            focus="finance"
            period={dates}
            disabled={Boolean(unit && unit !== s?.actor_unit_id)}
            title={
              unit && unit !== s?.actor_unit_id
                ? 'Acesse a filial selecionada para gerar o resumo com a conexão de IA dela.'
                : 'Resumo da filial atual no período aplicado.'
            }
          >
            Resumir período com IA
          </AiSummaryButton>
          <button onClick={retryPanel} disabled={loading}>
            <Icon name="refresh" size={16} />
            Atualizar painel
          </button>
        </div>
      </div>
      <div className="finance-period panel">
        <label>
          <span>Período</span>
          <select
            aria-label="Atalho de período"
            value={periodPreset}
            onChange={(e) => preset(e.target.value)}
          >
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="month">Este mês</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPeriodPreset('custom');
            setDates(draftDates);
            setPage(1);
          }}
        >
          <label>
            De
            <input
              aria-label="Data inicial"
              type="date"
              min="2020-01-01"
              max={draftDates.end}
              value={draftDates.start}
              required
              onChange={(e) => setDraftDates({ ...draftDates, start: e.target.value })}
            />
          </label>
          <label>
            Até
            <input
              aria-label="Data final"
              type="date"
              min={draftDates.start}
              max="2099-12-31"
              value={draftDates.end}
              required
              onChange={(e) => setDraftDates({ ...draftDates, end: e.target.value })}
            />
          </label>
          <button type="submit">
            <CalendarDays size={16} />
            Aplicar
          </button>
        </form>
        <label className="finance-unit">
          <span>Unidade</span>
          <SearchSelect
            label="Unidade financeira"
            options={[
              { id: '', name: 'Unidade atual' },
              ...units.map((u) => ({ id: u.id, name: u.name })),
            ]}
            value={unit}
            onChange={(v) => {
              setUnit(v);
              setPage(1);
            }}
            placeholder="Unidade atual"
            allowClear={false}
          />
        </label>
      </div>
      <div
        className="finance-tabs system-tabs"
        role="tablist"
        aria-label="Financeiro"
        onKeyDown={(e) => {
          const index = tabs.findIndex(([id]) => id === tab);
          const next =
            e.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : e.key === 'ArrowLeft'
                ? (index + tabs.length - 1) % tabs.length
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? tabs.length - 1
                    : -1;
          if (next >= 0) {
            e.preventDefault();
            selectTab(tabs[next][0]);
            document.getElementById('finance-tab-' + tabs[next][0])?.focus();
          }
        }}
      >
        {tabs.map(([id, label, icon]) => (
          <button
            key={id}
            id={'finance-tab-' + id}
            role="tab"
            aria-selected={tab === id}
            aria-controls="finance-content"
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'active' : ''}
            onClick={() => selectTab(id)}
          >
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </div>
      {(contextError || summaryError) && (
        <div className="alert error" role="alert">
          {contextError || summaryError}
          <button onClick={retryPanel}>Tentar novamente</button>
        </div>
      )}
      <div
        id="finance-content"
        role="tabpanel"
        aria-labelledby={'finance-tab-' + tab}
        aria-busy={loading}
      >
        {!s && !summaryError ? (
          <div className="finance-skeleton" role="status">
            Carregando indicadores financeiros…
          </div>
        ) : (
          s && (
            <>
              <div className="finance-kpis">
                {kpis.map(([label, value, hint, icon, tone]) => (
                  <section key={label} className="panel finance-kpi">
                    <span className={`finance-kpi-icon ${tone}`}>
                      <Icon name={icon} size={23} />
                    </span>
                    <div>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{hint}</small>
                    </div>
                  </section>
                ))}
              </div>
              <div className="finance-reconciliation panel" aria-label="Composição do faturamento">
                {[
                  ['Consumo lançado', totals.gross],
                  ['Cancelamentos', totals.cancellations],
                  ['Descontos', totals.discounts],
                  ['Faturamento líquido', totals.revenue],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{brl(value)}</strong>
                  </div>
                ))}
              </div>
              <div className="finance-layout">
                <div className="finance-main">
                  {tab === 'overview' && (
                    <div className="finance-charts">
                      <section className="panel finance-hourly">
                        <CardTitle icon="dashboard" title="Vendas por horário" />
                        <p className="field-hint">
                          Faturamento líquido por hora · soma dos dias selecionados
                        </p>
                        <div
                          className="finance-bars"
                          role="img"
                          aria-label="Faturamento líquido por hora, no horário de Brasília"
                        >
                          {Array.from({ length: 24 }, (_, hour) => {
                            const amount =
                              s.hourly.find((h: Data) => Number(h.hour) === hour)?.amount ?? '0.00';
                            return (
                              <div
                                key={hour}
                                className="finance-bar-column"
                                title={`${String(hour).padStart(2, '0')}h · ${brl(amount)}`}
                              >
                                <span
                                  className={Number(amount) < 0 ? 'negative' : ''}
                                  style={{
                                    height: `${(Math.abs(Number(amount)) / maxHour) * 100}%`,
                                  }}
                                />
                                <small>{hour % 3 === 0 ? `${hour}h` : ''}</small>
                              </div>
                            );
                          })}
                        </div>
                        <div className="finance-chart-axis">
                          <span>{brl(0)}</span>
                          <span>
                            Pico de valor absoluto:{' '}
                            {brl(maxHour === 1 && !s.hourly.length ? 0 : maxHour)}
                          </span>
                        </div>
                      </section>
                      <section className="panel">
                        <CardTitle icon="payments" title="Recebimentos por forma" />
                        <p className="field-hint">
                          Valores brutos recebidos; estornos discriminados abaixo.
                        </p>
                        <Donut
                          value={brl(totals.received_gross)}
                          label="Recebido bruto"
                          parts={s.methods.map((m: Data) => ({
                            label: methodName(m.provider),
                            value: Number(m.gross),
                            color: `var(--finance-chart-${m.provider === 'CASH' ? 3 : m.provider.includes('PIX') ? 0 : m.provider.includes('CARD') ? 1 : 4})`,
                            detail: brl(m.gross),
                          }))}
                        />
                        <div className="finance-mini-total">
                          <span>Estornos no período</span>
                          <strong>{brl(totals.refunds)}</strong>
                        </div>
                      </section>
                      <section className="panel">
                        <CardTitle icon="receipt" title="Comandas atuais" />
                        <Donut
                          value={String(current.tabs ?? 0)}
                          label="Em atendimento"
                          parts={[
                            {
                              label: 'Sem saldo pendente',
                              value: Number(current.settled_tabs ?? 0),
                              color: 'var(--success)',
                              detail: String(current.settled_tabs ?? 0),
                            },
                            {
                              label: 'Com saldo a receber',
                              value: Number(current.outstanding_tabs ?? 0),
                              color: 'var(--warning)',
                              detail: String(current.outstanding_tabs ?? 0),
                            },
                          ]}
                        />
                        <p className="field-hint">
                          Situação atual das comandas não encerradas, independente do período.
                        </p>
                      </section>
                    </div>
                  )}
                  {tab === 'flow' && (
                    <section className="panel finance-flow">
                      <CardTitle icon="dashboard" title="Fluxo diário de recebimentos" />
                      <p className="muted small">
                        Entradas de pagamentos menos estornos na data em que ocorreram. Sangrias e
                        suprimentos são movimentações internas de dinheiro.
                      </p>
                      <div className="finance-flow-summary">
                        <span>
                          <TrendingUp size={18} />
                          Recebido bruto<strong>{brl(totals.received_gross)}</strong>
                        </span>
                        <span>
                          <Wallet size={18} />
                          Estornos<strong>{brl(totals.refunds)}</strong>
                        </span>
                        <span>
                          <CircleDollarSign size={18} />
                          Recebido líquido<strong>{brl(totals.received)}</strong>
                        </span>
                      </div>
                      {s.flow.length ? (
                        <div className="finance-flow-days">
                          {s.flow.map((d: Data) => (
                            <div key={d.day}>
                              <span>{d.day.split('-').reverse().join('/')}</span>
                              <div>
                                <i
                                  style={{
                                    width: `${Math.max(1, (Number(d.received) / Math.max(1, ...s.flow.map((v: Data) => Number(v.received)))) * 100)}%`,
                                  }}
                                />
                              </div>
                              <strong>{brl(d.net)}</strong>
                              <small>
                                Entrada {brl(d.received)} · estorno {brl(d.refunded)}
                              </small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty>Nenhum recebimento ou estorno no período.</Empty>
                      )}
                    </section>
                  )}
                  <section className="panel finance-records">
                    <CardTitle
                      icon={
                        kind === 'sales' ? 'orders' : kind === 'payments' ? 'payments' : 'receipt'
                      }
                      title={recordTitles[kind]}
                      extra={
                        <button onClick={exportPage} disabled={!data?.rows.length || recordBusy}>
                          <Download size={16} />
                          Exportar página
                        </button>
                      }
                    />
                    <p className="field-hint">
                      {kind === 'receivables'
                        ? 'Saldo atual de todas as comandas com débito, inclusive de períodos anteriores.'
                        : kind === 'payments'
                          ? 'Pagamentos pela data de confirmação. Estornos e líquido nas linhas mostram a posição atual de cada pagamento.'
                          : 'Registros da unidade e período selecionados.'}
                    </p>
                    <div className="finance-list-filters">
                      <select
                        aria-label="Ordenar registros financeiros"
                        value={sort}
                        onChange={(e) => {
                          setSort(e.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="date_desc">Mais recentes</option>
                        <option value="date_asc">Mais antigos</option>
                        <option value="amount_desc">Maior valor</option>
                        <option value="amount_asc">Menor valor</option>
                      </select>
                      <label className="finance-search">
                        <Icon name="search" size={17} />
                        <input
                          type="search"
                          aria-label="Buscar no financeiro"
                          placeholder="Buscar pedido, mesa, comanda ou referência…"
                          value={search}
                          onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                          }}
                        />
                      </label>
                      {(kind === 'sales' || kind === 'payments') && (
                        <select
                          aria-label="Situação financeira"
                          value={status}
                          onChange={(e) => {
                            setStatus(e.target.value);
                            setPage(1);
                          }}
                        >
                          <option value="">Todas as situações</option>
                          {(kind === 'sales'
                            ? [
                                ['CONFIRMED', 'Confirmado'],
                                ['CANCELLED', 'Cancelado'],
                                ['PENDING_PAYMENT', 'Aguardando pagamento'],
                                ['DRAFT', 'Rascunho'],
                              ]
                            : [
                                ['APPROVED', 'Aprovado'],
                                ['PARTIALLY_REFUNDED', 'Estorno parcial'],
                                ['REFUNDED', 'Estornado'],
                                ['PENDING', 'Pendente'],
                                ['FAILED', 'Falhou'],
                              ]
                          ).map(([v, l]) => (
                            <option value={v} key={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      )}
                      {(kind === 'payments' || kind === 'movements') && (
                        <select
                          aria-label="Forma ou tipo financeiro"
                          value={method}
                          onChange={(e) => {
                            setMethod(e.target.value);
                            setPage(1);
                          }}
                        >
                          <option value="">Todas as formas / tipos</option>
                          {Object.entries(methodNames)
                            .filter(
                              ([id]) =>
                                kind === 'movements' ||
                                !['REFUND', 'WITHDRAWAL', 'SUPPLY'].includes(id),
                            )
                            .map(([v, l]) => (
                              <option value={v} key={v}>
                                {l}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                    {recordError ? (
                      <div className="alert error" role="alert">
                        {recordError}
                      </div>
                    ) : recordBusy && !data ? (
                      <TableLoading label="Carregando registros financeiros…" />
                    ) : !data?.rows.length ? (
                      <Empty>Nenhum registro encontrado para estes filtros.</Empty>
                    ) : (
                      <>
                        <div className="finance-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                {columns[kind].map((col) => (
                                  <th key={col}>{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {data.rows.map((r: Data) => (
                                <tr key={r.id}>
                                  {rowValues(r).map((v, i) => (
                                    <td key={i} data-label={columns[kind][i]}>
                                      {columns[kind][i] === 'Situação' ? (
                                        <Badge status={v} />
                                      ) : (
                                        <span className={i === 0 ? 'finance-primary-cell' : ''}>
                                          {v}
                                        </span>
                                      )}
                                    </td>
                                  ))}
                                  {kind === 'sales' && (
                                    <td data-label="Ações">
                                      <button
                                        className="small"
                                        aria-label={'Detalhes do pedido ' + shortId(r.id)}
                                        onClick={() => setDetail(r)}
                                      >
                                        <Icon name="eye" size={15} />
                                        Detalhes
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {!recordError && (
                      <Pagination
                        label="Registros financeiros"
                        total={data?.total ?? pageMetadata?.total ?? 0}
                        page={data?.page ?? page}
                        pageSize={size}
                        onPageChange={setPage}
                        onPageSizeChange={setSize}
                        loading={recordBusy}
                        pageSizeOptions={[10, 25, 50]}
                        previousLabel="Página financeira anterior"
                        nextLabel="Próxima página financeira"
                      />
                    )}
                  </section>
                  <p className="finance-accounting-note small muted">
                    <Icon name="info" size={15} />
                    Faturamento = consumo lançado − cancelamentos − descontos, pela data de cada
                    lançamento. Recebimento = pagamentos confirmados − estornos no período. Em
                    aberto é o saldo atual das comandas. Atualizado {operationTime(s.generated_at)}.
                  </p>
                </div>
                {cashPanel}
              </div>
            </>
          )
        )}
      </div>
      {detail && (
        <Modal title={'Pedido ' + shortId(detail.id)} onClose={() => setDetail(null)}>
          <div className="finance-detail">
            <Badge status={detail.status} />
            <dl className="finance-money-list">
              {[
                ['Atendimento', orderLocationLabel(detail)],
                ['Comanda', detail.tab_name ?? 'Sem comanda'],
                ['Horário', operationTime(detail.occurred_at)],
                ['Itens', String(detail.items)],
                ['Total', brl(detail.amount)],
                [
                  'Política',
                  detail.payment_policy_snapshot === 'PREPAID'
                    ? 'Pré-pago'
                    : 'Pagamento no fechamento',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {can('table.view') && (!unit || unit === s?.actor_unit_id) && (
              <button className="primary" onClick={() => void navigate('/pedidos/' + detail.id)}>
                <Icon name="eye" size={16} />
                Abrir pedido completo
              </button>
            )}
          </div>
        </Modal>
      )}
      {forms.dialog}
    </div>
  );
}
