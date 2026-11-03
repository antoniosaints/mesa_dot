import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Store,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { api, brl, session, type Data } from './client.js';
import { Icon, type IconName } from './appearance.js';
import { Badge, Empty, useRefresh } from './common.js';
import { TableLoading } from './pagination.js';
import { financeChange, financeDay } from './finance-format.js';
import { operationTime, shortId } from './operation-format.js';
import { CustomerLinkPanel } from './customer-link-panel.js';
import { AiSummaryButton } from './ai-assistant.js';
import './dashboard-overview.css';

function Kpi({
  label,
  value,
  detail,
  icon,
  tone = '',
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: IconName;
  tone?: string;
}) {
  return (
    <section className={'overview-kpi ' + tone}>
      <span className="overview-kpi-icon">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}
function Occupancy({ tables }: { tables: Data }) {
  const ratio = tables.total ? Math.round((tables.occupied / tables.total) * 100) : 0;
  return (
    <section className="panel overview-occupancy">
      <div className="section-head">
        <h2>Ocupação do salão</h2>
        <span className="overview-live">Agora</span>
      </div>
      <div
        className="overview-ring"
        role="img"
        aria-label={`${ratio}% de ocupação, ${tables.occupied} mesas ocupadas e ${tables.free} livres`}
        style={{ '--occupancy': ratio + '%' } as CSSProperties}
      >
        <div>
          <strong>{ratio}%</strong>
          <small>ocupado</small>
        </div>
      </div>
      <div className="overview-occupancy-legend">
        <span>
          <i className="is-occupied" />
          Em atendimento <b>{tables.occupied}</b>
        </span>
        <span>
          <i className="is-free" />
          Livres <b>{tables.free}</b>
        </span>
        <span>
          <Clock3 size={13} />
          Em fechamento <b>{tables.closing}</b>
        </span>
      </div>
    </section>
  );
}
function OrderChart({ data }: { data: Data }) {
  const series: { label: string; count: number }[] = [];
  const byKey = new Map<string, number>(
    data.orders.series.map((row: Data) => [row.bucket, Number(row.count)]),
  );
  if (data.period.bucket === 'hour') {
    for (let hour = 0; hour < 24; hour++)
      series.push({
        label: String(hour).padStart(2, '0') + 'h',
        count: byKey.get(`${data.period.start} ${String(hour).padStart(2, '0')}:00`) ?? 0,
      });
  } else {
    for (let day = 0; day < data.period.days; day++) {
      const date = new Date(Date.parse(data.period.start + 'T12:00:00Z') + day * 86400000)
        .toISOString()
        .slice(0, 10);
      series.push({ label: date.slice(8) + '/' + date.slice(5, 7), count: byKey.get(date) ?? 0 });
    }
  }
  const maximum = Math.max(1, ...series.map((row) => row.count));
  const [selected, setSelected] = useState<{ label: string; count: number } | null>(null);
  useEffect(() => setSelected(null), [data.period.start, data.period.end]);
  return (
    <section className="panel overview-orders-chart">
      <div className="section-head">
        <div>
          <h2>Ritmo dos pedidos</h2>
          <p className="muted small">
            Confirmados por {data.period.bucket === 'hour' ? 'hora' : 'dia'} · horário de Brasília
          </p>
        </div>
        <strong>
          {data.orders.confirmed} <small>pedidos</small>
        </strong>
      </div>
      {data.orders.confirmed ? (
        <>
          <div className="overview-chart-scroll">
            <div
              className="overview-bars"
              style={{ '--bar-count': series.length } as CSSProperties}
              role="group"
              aria-label="Gráfico de pedidos confirmados"
            >
              {series.map((row, index) => (
                <button
                  key={row.label}
                  type="button"
                  className={selected?.label === row.label ? 'selected' : ''}
                  aria-label={`${row.label}: ${row.count} pedidos`}
                  aria-pressed={selected?.label === row.label}
                  onClick={() => setSelected(row)}
                  onFocus={() => setSelected(row)}
                  title={`${row.label}: ${row.count} pedidos`}
                >
                  <span className="overview-bar-track">
                    <i style={{ height: (row.count / maximum) * 100 + '%' }} />
                  </span>
                  <small>{series.length <= 31 || index % 3 === 0 ? row.label : ''}</small>
                </button>
              ))}
            </div>
          </div>
          <p className="overview-chart-detail" aria-live="polite">
            {selected
              ? `${selected.label} · ${selected.count} pedido(s) confirmado(s)`
              : 'Toque ou navegue pelas barras para consultar cada horário.'}
          </p>
        </>
      ) : (
        <Empty>Nenhum pedido confirmado neste período.</Empty>
      )}
    </section>
  );
}
export function DashboardOverview({
  scopeKey,
  onOpen,
}: {
  scopeKey: string;
  onOpen: (path: string) => void;
}) {
  const today = financeDay();
  const [dates, setDates] = useState({ start: today, end: today });
  const [draft, setDraft] = useState(dates),
    [preset, setPreset] = useState('today');
  const [result, setResult] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [dateError, setDateError] = useState('');
  const sequence = useRef(0);
  const actor = session()?.actor;
  const key = JSON.stringify({
    scopeKey,
    permissions: actor?.permissions,
    admin: actor?.isAccountAdmin,
    dates,
  });
  const data = result?._key === key ? result : null;
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function load() {
    const attempt = ++sequence.current;
    setBusy(true);
    try {
      const value = await api('/dashboard/overview?' + new URLSearchParams(dates));
      const current = session()?.actor;
      if (
        attempt !== sequence.current ||
        current?.tenantId !== value.scope.tenant_id ||
        current?.establishmentId !== value.scope.establishment_id
      )
        return;
      setResult({ ...value, _key: key });
      setError('');
    } catch (problem) {
      if (attempt !== sequence.current) return;
      setResult(null);
      setError((problem as Error).message);
    } finally {
      if (attempt === sequence.current) setBusy(false);
    }
  }
  useRefresh(load, [key]);
  function choose(value: string) {
    setPreset(value);
    setDateError('');
    if (value === 'custom') {
      setDraft(dates);
      return;
    }
    const next = {
      start: financeDay(value === '7' ? -6 : value === '30' ? -29 : value === 'yesterday' ? -1 : 0),
      end: financeDay(value === 'yesterday' ? -1 : 0),
    };
    setDates(next);
    setDraft(next);
  }
  const deliveries = data?.deliveries;
  const pending = deliveries
    ? ['PENDING', 'PREPARING', 'AVAILABLE', 'REQUESTED', 'ASSIGNED'].reduce(
        (sum, status) => sum + (deliveries[status] ?? 0),
        0,
      )
    : 0;
  const ready = deliveries
    ? ['AVAILABLE', 'REQUESTED', 'ASSIGNED'].reduce(
        (sum, status) => sum + (deliveries[status] ?? 0),
        0,
      )
    : 0;
  const production = data?.production;
  const alerts = data
    ? [
        ...(Number(data.requests?.count)
          ? [
              {
                title: `${data.requests.count} solicitação(ões) aguardando atendimento`,
                detail: 'Clientes aguardando a equipe. Abra o salão para atender.',
                path: '/salao',
              },
            ]
          : []),
        ...(ready && data.access.tables
          ? [
              {
                title: `${ready} ficha(s) disponível(is) para entrega`,
                detail: 'Itens sem preparo ou já prontos para o cliente.',
                path: '/pedidos',
              },
            ]
          : []),
        ...(data.cash?.overdue
          ? [
              {
                title: `${data.cash.overdue} caixa(s) aberto(s) há mais de 24 horas`,
                detail: 'Confira o turno e faça o fechamento antes de abrir outro.',
                path: '/caixa',
              },
            ]
          : []),
        ...(data.printing?.FAILED
          ? [
              {
                title: `${data.printing.FAILED} impressão(ões) com falha`,
                detail: 'Confira a impressora e a fila de documentos.',
                path: '/impressao',
              },
            ]
          : []),
        ...(data.inventory?.unavailable_balances
          ? [
              {
                title: `${data.inventory.unavailable_balances} estoque(s) sem saldo disponível`,
                detail: 'Confira os locais e as variações para planejar a reposição.',
                path: '/estoque',
              },
            ]
          : []),
      ]
    : [];
  return (
    <div className="overview-workspace">
      <section className="panel overview-toolbar">
        <div>
          <span className="overview-scope-label">
            <ShieldCheck size={15} />
            Conta e filial selecionadas
          </span>
          <h2>
            <Store size={18} />
            {data?.scope.name ?? 'Carregando filial…'}
          </h2>
          {data && (
            <p className="muted small">{data.scope.account_name} · Dados exclusivos desta filial</p>
          )}
        </div>
        <div className="overview-period">
          <span>
            <CalendarDays size={15} />
            Período dos indicadores
          </span>
          <div className="overview-presets" role="group" aria-label="Período da visão geral">
            {[
              ['today', 'Hoje'],
              ['yesterday', 'Ontem'],
              ['7', '7 dias'],
              ['30', '30 dias'],
              ['custom', 'Personalizado'],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={preset === id}
                onClick={() => choose(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="overview-reload"
          disabled={busy}
          onClick={() => void load()}
          aria-label="Atualizar visão geral"
        >
          <RefreshCw size={16} />
          Atualizar
        </button>
        {preset === 'custom' && (
          <form
            className="overview-custom-period"
            onSubmit={(event) => {
              event.preventDefault();
              const days = (Date.parse(draft.end) - Date.parse(draft.start)) / 86400000 + 1;
              if (!Number.isFinite(days) || days < 1 || days > 90) {
                setDateError('Escolha um período válido de até 90 dias.');
                return;
              }
              setDateError('');
              setDates(draft);
            }}
          >
            <label>
              De
              <input
                type="date"
                required
                value={draft.start}
                onChange={(event) => setDraft({ ...draft, start: event.target.value })}
              />
            </label>
            <label>
              Até
              <input
                type="date"
                required
                value={draft.end}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })}
              />
            </label>
            <button type="submit" className="primary">
              Aplicar período
            </button>
            {dateError && (
              <p role="alert" className="error-text">
                {dateError}
              </p>
            )}
          </form>
        )}
      </section>
      {error && (
        <section className="panel overview-error" role="alert">
          <TriangleAlert size={22} />
          <div>
            <strong>Não foi possível carregar a visão geral</strong>
            <p>{error}</p>
          </div>
          <button onClick={() => void load()}>Tentar novamente</button>
        </section>
      )}
      {!data && !error && <TableLoading label="Carregando indicadores da filial…" />}
      {data && (
        <>
          <section className="overview-brief">
            <div>
              <h2>Resumo da operação</h2>
              <p>
                {data.orders && <>{data.orders.confirmed} pedido(s) confirmado(s) no período. </>}
                {data.tables && (
                  <>
                    {data.tables.occupied} mesa(s) em atendimento e {data.tables.free}{' '}
                    livre(s).{' '}
                  </>
                )}
                {data.deliveries && <>{pending} unidade(s) ainda a entregar. </>}
                {!data.orders &&
                  !data.tables &&
                  !data.deliveries &&
                  'Os indicadores abaixo seguem as permissões do seu perfil.'}
              </p>
            </div>
            <span className={'badge ' + (data.availability.is_open ? 'available' : 'closed')}>
              {data.availability.is_open
                ? 'Aberto para pedidos'
                : 'Pedidos pausados / fora do horário'}
            </span>
          </section>
          <div className="overview-updated">
            <span className="online-dot" />
            Atualização automática · {operationTime(data.generated_at)}
            <small>Pendências e ocupação mostram o momento atual.</small>
          </div>
          {data.financial && (
            <>
              <div className="overview-section-title">
                <h2>
                  <TrendingUp size={18} />
                  Resultado da filial
                </h2>
                <span>
                  <ShieldCheck size={14} />
                  Exclusivo do admin geral da conta
                </span>
                <AiSummaryButton period={dates} title="Resumo da filial atual no período aplicado.">
                  Resumir operação com IA
                </AiSummaryButton>
              </div>
              <div className="overview-kpis financial-kpis">
                <Kpi
                  label="Faturamento líquido"
                  value={brl(data.financial.totals.revenue)}
                  detail={financeChange(
                    data.financial.totals.revenue,
                    data.financial.comparison.revenue,
                  )}
                  icon="finance"
                  tone="success"
                />
                <Kpi
                  label="Recebido líquido"
                  value={brl(data.financial.totals.received)}
                  detail="Recebimentos menos estornos no período"
                  icon="payments"
                />
                <Kpi
                  label="Ticket médio"
                  value={brl(data.financial.totals.average)}
                  detail="Faturamento / pedidos com lançamento financeiro"
                  icon="receipt"
                />
                <Kpi
                  label="Saldo atual em aberto"
                  value={brl(data.financial.outstanding)}
                  detail={`${data.financial.open_tabs} comanda(s) aberta(s) · todos os períodos`}
                  icon="cash"
                  tone="warning"
                />
              </div>
            </>
          )}
          <div className="overview-kpis">
            {data.tables && (
              <Kpi
                label="Mesas em atendimento"
                value={`${data.tables.occupied} / ${data.tables.total}`}
                detail={`${data.tables.closing} em fechamento · agora`}
                icon="tables"
              />
            )}
            {data.orders && (
              <Kpi
                label="Pedidos confirmados"
                value={data.orders.confirmed}
                detail={`${data.orders.cancelled} cancelado(s) no período`}
                icon="orders"
              />
            )}
            {data.deliveries && (
              <Kpi
                label="Unidades a entregar"
                value={pending}
                detail={`${ready} disponível(is) · ${data.deliveries.REDEEMED ?? 0} entregue(s) no período`}
                icon="ticket"
                tone={pending ? 'warning' : 'success'}
              />
            )}
            {production && (
              <Kpi
                label="Fila de preparo"
                value={(production.PENDING ?? 0) + (production.PREPARING ?? 0)}
                detail={`${production.PREPARING ?? 0} em preparo · ${production.READY ?? 0} pronto(s)`}
                icon="production"
              />
            )}
          </div>
          {alerts.length ? (
            <section className="panel overview-alerts">
              <div className="section-head">
                <h2>
                  <TriangleAlert size={18} />O que precisa de atenção
                </h2>
                <span>{alerts.length} ponto(s)</span>
              </div>
              {alerts.map((alert) => (
                <button
                  type="button"
                  key={alert.path + alert.title}
                  onClick={() => onOpen(alert.path)}
                >
                  <span>
                    <strong>{alert.title}</strong>
                    <small>{alert.detail}</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </section>
          ) : (
            <div className="overview-clear">
              <CircleCheck size={18} />
              Nenhuma pendência de atenção nas áreas que seu perfil pode consultar.
            </div>
          )}
          {(data.orders || data.tables) && (
            <div className={'overview-charts ' + (!data.tables || !data.orders ? 'single' : '')}>
              {data.orders && <OrderChart data={data} />}
              {data.tables && <Occupancy tables={data.tables} />}
            </div>
          )}
          {data.orders && (
            <div className="overview-detail-grid">
              <section className="panel">
                <div className="section-head">
                  <div>
                    <h2>Mais pedidos no período</h2>
                    <p className="muted small">Unidades em pedidos confirmados</p>
                  </div>
                  <Icon name="menu" size={19} />
                </div>
                {data.orders.top.length ? (
                  <ol className="overview-top-products">
                    {data.orders.top.map((item: Data, index: number) => (
                      <li key={item.product_id}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{item.name}</strong>
                          <i
                            style={{
                              width: `${(Number(item.quantity) / Number(data.orders.top[0].quantity)) * 100}%`,
                            }}
                          />
                        </div>
                        <b>
                          {item.quantity} <small>un.</small>
                        </b>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty>Nenhum item vendido neste período.</Empty>
                )}
              </section>
              <section className="panel">
                <div className="section-head">
                  <h2>Origem dos pedidos</h2>
                  <span className="muted small">No período</span>
                </div>
                <div className="overview-sources">
                  {[
                    ['CUSTOMER', 'Cliente / cardápio', 'menu'],
                    ['WAITER', 'Garçom', 'team'],
                    ['POS', 'Caixa / PDV', 'cash'],
                  ].map(([source, label, icon]) => (
                    <div key={source}>
                      <Icon name={icon as IconName} size={19} />
                      <span>{label}</span>
                      <strong>
                        {data.orders.sources
                          .filter((row: Data) => row.source === source)
                          .reduce((sum: number, row: Data) => sum + Number(row.count), 0)}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="overview-service-split">
                  <span>
                    Mesa{' '}
                    <b>
                      {data.orders.sources
                        .filter((row: Data) => row.service_mode === 'TABLE')
                        .reduce((sum: number, row: Data) => sum + Number(row.count), 0)}
                    </b>
                  </span>
                  <span>
                    Balcão / retirada{' '}
                    <b>
                      {data.orders.sources
                        .filter((row: Data) => row.service_mode === 'COUNTER')
                        .reduce((sum: number, row: Data) => sum + Number(row.count), 0)}
                    </b>
                  </span>
                </div>
              </section>
            </div>
          )}
          {data.tables && (
            <section className="panel overview-attendances">
              <div className="section-head">
                <div>
                  <h2>Atendimentos em andamento</h2>
                  <p className="muted small">
                    Os 8 mais antigos · abra a mesa para continuar o atendimento.
                  </p>
                </div>
                <button type="button" onClick={() => onOpen('/salao')}>
                  <Icon name="tables" size={15} />
                  Abrir salão<kbd>F2</kbd>
                </button>
              </div>
              {data.tables.attendances.length ? (
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Mesa</th>
                        <th>Tempo de atendimento</th>
                        <th>Comandas abertas</th>
                        <th>Situação</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tables.attendances.map((item: Data) => {
                        const minutes = Math.max(
                          0,
                          Math.floor(
                            (Date.parse(data.generated_at) -
                              Date.parse(
                                item.opened_at.replace(' ', 'T') +
                                  (item.opened_at.includes('Z') ? '' : 'Z'),
                              )) /
                              60000,
                          ),
                        );
                        return (
                          <tr key={item.id}>
                            <td>
                              <strong>Mesa {item.number}</strong>
                            </td>
                            <td>
                              <Clock3 size={13} />{' '}
                              {minutes >= 60
                                ? `${Math.floor(minutes / 60)}h ${minutes % 60}min`
                                : `${minutes}min`}
                            </td>
                            <td>{item.tabs}</td>
                            <td>
                              <Badge status={item.status} />
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => onOpen('/salao/atendimento/' + item.table_id)}
                              >
                                Gerenciar mesa
                                <ArrowRight size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>Nenhuma mesa em atendimento neste momento.</Empty>
              )}
            </section>
          )}
          {data.orders && data.access.tables && (
            <section className="panel overview-recent">
              <div className="section-head">
                <h2>Últimos pedidos do período</h2>
                <button type="button" onClick={() => onOpen('/pedidos')}>
                  Ver pedidos
                  <ArrowRight size={15} />
                </button>
              </div>
              {data.orders.recent.length ? (
                <div className="overview-recent-list">
                  {data.orders.recent.map((order: Data) => (
                    <button
                      type="button"
                      key={order.id}
                      onClick={() => onOpen('/pedidos/' + order.id)}
                    >
                      <Icon name="orders" size={18} />
                      <span>
                        <strong>
                          {shortId(order.id)} ·{' '}
                          {order.service_mode === 'COUNTER'
                            ? 'Balcão / retirada'
                            : 'Mesa ' + order.table_number}
                        </strong>
                        <small>{operationTime(order.confirmed_at ?? order.created_at)}</small>
                      </span>
                      <Badge status={order.status} />
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty>Nenhum pedido neste período.</Empty>
              )}
            </section>
          )}
          <CustomerLinkPanel />
        </>
      )}
    </div>
  );
}
