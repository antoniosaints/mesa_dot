import { Pagination, TableLoading } from './pagination.js';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  LockKeyhole,
  Wallet,
  CircleDollarSign,
  Store,
} from 'lucide-react';
import { api, brl, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Empty, Modal, ModalCloseButton, useRefresh } from './common.js';
import { Tabs, Tab, SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import { useToasts } from './toasts.js';
import { operationTime, shortId } from './operation-format.js';
import {
  cashMovementLabels,
  cashTypeLabel,
  cashText,
  cashLocalDay,
  filterCashSessions,
  cashPage,
} from './cash-view.js';

function CashStatus({ status }: { status: string }) {
  return (
    <span
      className={
        'cash-status ' +
        (status === 'OPEN' ? 'is-open' : status === 'AVAILABLE' ? 'is-available' : 'is-closed')
      }
    >
      <i />
      {status === 'OPEN' ? 'Aberto' : status === 'AVAILABLE' ? 'Disponível' : 'Encerrado'}
    </span>
  );
}
function Difference({ value }: { value: unknown }) {
  const n = Number(value);
  return (
    <span className={'cash-difference ' + (n === 0 ? 'is-balanced' : 'has-difference')}>
      {n === 0 ? 'Conferido · ' + brl(0) : brl(n)}
    </span>
  );
}
function MovementTable({
  records,
  sessions,
  registers,
  scoped = false,
}: {
  records: Data[];
  sessions: Data[];
  registers: Data[];
  scoped?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [register, setRegister] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10);
  const rows = records
    .map<Data>((m) => ({
      ...m,
      register_id: sessions.find((s) => s.id === m.cash_session_id)?.register_id,
      register_name:
        sessions.find((s) => s.id === m.cash_session_id)?.register_name ?? 'Caixa indisponível',
    }))
    .filter(
      (m) =>
        (!type || m.type === type) &&
        (!register || m.register_id === register) &&
        (!from || cashLocalDay(m.created_at) >= from) &&
        (!to || cashLocalDay(m.created_at) <= to) &&
        cashText(
          [m.reason, m.id, m.cash_session_id, m.register_name, cashTypeLabel(m.type)].join(' '),
        ).includes(cashText(search).trim()),
    )
    .sort(
      (a, b) =>
        (sort === 'oldest'
          ? String(a.created_at).localeCompare(b.created_at)
          : sort === 'amount'
            ? Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))
            : String(b.created_at).localeCompare(a.created_at)) || String(a.id).localeCompare(b.id),
    );
  const paged = cashPage(rows, page, size);
  return (
    <div className="cash-movements">
      <div className="cash-filter-grid">
        <label className="cash-search">
          <Icon name="search" size={17} />
          <input
            type="search"
            aria-label="Buscar movimentações de caixa"
            placeholder="Buscar motivo, caixa ou referência…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Tipo
          <select
            aria-label="Tipo de movimentação"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os tipos</option>
            {Object.entries(cashMovementLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!scoped && (
          <label>
            Caixa
            <SearchSelect
              label="Filtrar movimentações por caixa"
              value={register}
              onChange={(v) => {
                setRegister(v);
                setPage(1);
              }}
              options={registers.map((r) => ({ id: r.id, name: r.name }))}
              placeholder="Todos os caixas"
            />
          </label>
        )}
      </div>
      <div className="cash-filter-dates">
        <label>
          Data inicial
          <input
            type="date"
            aria-label="Data inicial das movimentações"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Data final
          <input
            type="date"
            aria-label="Data final das movimentações"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Ordenar
          <select
            aria-label="Ordenar movimentações"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
            <option value="amount">Maior valor</option>
          </select>
        </label>
        {(search || type || register || from || to) && (
          <button
            onClick={() => {
              setSearch('');
              setType('');
              setRegister('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            <Icon name="close" size={15} />
            Limpar filtros
          </button>
        )}
      </div>
      {!paged.total ? (
        <Empty>Nenhuma movimentação encontrada para estes filtros.</Empty>
      ) : (
        <div className="cash-table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'Data e hora',
                  ...(!scoped ? ['Caixa / turno'] : []),
                  'Tipo',
                  'Motivo',
                  'Valor',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((m) => (
                <tr key={m.id}>
                  <td data-label="Data e hora">{operationTime(m.created_at)}</td>
                  {!scoped && (
                    <td data-label="Caixa / turno">
                      <strong>{m.register_name}</strong>
                      <small>Turno {shortId(m.cash_session_id)}</small>
                    </td>
                  )}
                  <td data-label="Tipo">
                    <span
                      className={
                        'cash-movement-type ' + (Number(m.amount) < 0 ? 'is-out' : 'is-in')
                      }
                    >
                      <Icon name={Number(m.amount) < 0 ? 'sort-down' : 'sort-up'} size={14} />
                      {cashTypeLabel(m.type)}
                    </span>
                  </td>
                  <td data-label="Motivo">{m.reason}</td>
                  <td
                    data-label="Valor"
                    className={Number(m.amount) < 0 ? 'cash-negative' : 'cash-positive'}
                  >
                    {Number(m.amount) > 0 ? '+ ' : ''}
                    {brl(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        label="Movimentações de caixa"
        total={paged.total}
        page={page}
        pageSize={size}
        onPageChange={setPage}
        onPageSizeChange={setSize}
      />
    </div>
  );
}
function CashBreakdown({ item }: { item: Data }) {
  return (
    <div className="cash-breakdown">
      <dl>
        {[
          ['Fundo de abertura', item.opening_amount],
          ['Vendas em dinheiro', item.cash_sales],
          ['Suprimentos', item.supplies],
          ['Sangrias', item.withdrawals],
          ['Estornos em dinheiro', item.refunds],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{brl(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="cash-digital">
        <span>
          <Icon name="payments" size={16} />
          Cartão<strong>{brl(item.card_sales)}</strong>
        </span>
        <span>
          <Icon name="receipt" size={16} />
          Pix<strong>{brl(item.pix_sales)}</strong>
        </span>
        {Number(item.other_receipts) !== 0 && (
          <span>
            Outras formas<strong>{brl(item.other_receipts)}</strong>
          </span>
        )}
      </div>
      <p className="field-hint">
        Pix e cartão registrados neste turno não compõem o dinheiro físico.
      </p>
    </div>
  );
}
export function CashWorkspace() {
  const [data, setData] = useState<{
      registers: Data[];
      sessions: Data[];
      movements: Data[];
    } | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const version = useRef(0),
    alive = useRef(true);
  const forms = useFormDialog(),
    toast = useToasts();
  const [selected, setSelected] = useState(''),
    [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState(''),
    [register, setRegister] = useState(''),
    [status, setStatus] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [registerSearch, setRegisterSearch] = useState(''),
    [registerPage, setRegisterPage] = useState(1),
    [registerSize, setRegisterSize] = useState(10);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
    };
  }, []);
  async function load() {
    const request = ++version.current;
    setLoading(true);
    try {
      const [registers, sessions, movements] = await Promise.all([
        api('/cash-registers'),
        api('/cash/sessions'),
        api('/cash/movements'),
      ]);
      if (alive.current && request === version.current) {
        setData({ registers, sessions, movements });
        setError('');
      }
    } catch (e) {
      if (alive.current && request === version.current) {
        setError((e as Error).message);
        setData(null);
      }
    } finally {
      if (alive.current && request === version.current) setLoading(false);
    }
  }
  useRefresh(load, []);
  const open = data?.sessions.filter((s) => s.status === 'OPEN') ?? [],
    available = data?.registers.filter((r) => !open.some((s) => s.register_id === r.id)) ?? [];
  const current = open.find((s) => s.id === selected) ?? open[0],
    detail = data?.sessions.find((s) => s.id === detailId);
  function openTurn(registerId?: string) {
    forms.open({
      title: 'Abrir turno de caixa',
      description: 'Informe o dinheiro físico disponível no início do turno.',
      fields: [
        {
          key: 'register_id',
          label: 'Caixa',
          type: 'select',
          required: true,
          initial: registerId ?? available[0]?.id,
          options: available.map((r) => ({ id: r.id, name: r.name })),
        },
        {
          key: 'opening_amount',
          type: 'currency',
          label: 'Fundo de abertura',
          required: true,
          initial: '0.00',
          hint: 'Pix e cartão não entram no fundo de abertura.',
        },
      ],
      successMessage: 'Turno de caixa aberto.',
      onSubmit: async (values) => {
        const result = await api('/cash/sessions', values);
        setSelected(result.id);
        await load();
        return result;
      },
    });
  }
  function movement(item: Data, type: 'WITHDRAWAL' | 'SUPPLY') {
    forms.open({
      title: type === 'WITHDRAWAL' ? 'Registrar sangria' : 'Registrar suprimento',
      description: `${item.register_name} · Turno ${shortId(item.id)} · Dinheiro esperado ${brl(item.expected_amount)}`,
      fields: [
        {
          key: 'amount',
          type: 'currency',
          label: type === 'WITHDRAWAL' ? 'Valor da sangria' : 'Valor do suprimento',
          required: true,
          placeholder: '50,00',
        },
        {
          key: 'reason',
          label: 'Motivo',
          type: 'textarea',
          required: true,
          minLength: 3,
          maxLength: 255,
        },
      ],
      successMessage: type === 'WITHDRAWAL' ? 'Sangria registrada.' : 'Suprimento registrado.',
      onSubmit: async (values) => {
        await api('/cash/movements', { cash_session_id: item.id, type, ...values });
        await load();
      },
    });
  }
  function closeTurn(item: Data) {
    forms.open({
      title: 'Encerrar turno de caixa',
      description: `${item.register_name} · Esperado em dinheiro: ${brl(item.expected_amount)}. Conte o dinheiro físico e confirme para encerrar este turno.`,
      fields: [
        {
          key: 'counted_amount',
          type: 'currency',
          label: 'Dinheiro contado no fechamento',
          required: true,
          placeholder: '100,00',
        },
      ],
      submitLabel: 'Encerrar turno',
      successMessage: 'Turno de caixa encerrado.',
      onSubmit: async (values) => {
        const result = await api(`/cash/sessions/${item.id}/close`, values);
        await load();
        return result;
      },
      onSuccess: (result) =>
        toast.info('Esperado: ' + brl(result.expected) + '. Diferença: ' + brl(result.difference)),
    });
  }
  function editRegister(item?: Data) {
    forms.open({
      title: item ? 'Editar caixa' : 'Novo caixa',
      description: 'Identifique o ponto de recebimento. O nome será usado nos turnos e extratos.',
      fields: [
        {
          key: 'name',
          label: 'Nome do caixa',
          required: true,
          initial: item?.name ?? '',
          minLength: 2,
          maxLength: 100,
          placeholder: 'Ex.: Caixa balcão',
        },
      ],
      successMessage: item ? 'Caixa atualizado.' : 'Caixa cadastrado.',
      onSubmit: async (values) => {
        await api(
          '/cash-registers' + (item ? '/' + item.id : ''),
          { name: values.name.trim() },
          item ? 'PATCH' : 'POST',
        );
        await load();
      },
    });
  }
  const history = cashPage(
    filterCashSessions(data?.sessions ?? [], { search, register, status, from, to, sort }),
    page,
    size,
  );
  const listedRegisters = cashPage(
    (data?.registers ?? []).filter((r) =>
      cashText(r.name).includes(cashText(registerSearch).trim()),
    ),
    registerPage,
    registerSize,
  );
  const totalExpected = open.reduce((sum, s) => sum + Number(s.expected_amount), 0),
    differences =
      data?.sessions.filter((s) => s.status === 'CLOSED' && Number(s.difference_amount) !== 0)
        .length ?? 0;
  const operations = (item: Data) => (
    <div className="cash-action-row">
      <button onClick={() => movement(item, 'WITHDRAWAL')}>
        <ArrowDownToLine size={16} />
        Sangria
      </button>
      <button onClick={() => movement(item, 'SUPPLY')}>
        <ArrowUpFromLine size={16} />
        Suprimento
      </button>
      <button className="primary" onClick={() => closeTurn(item)}>
        <LockKeyhole size={16} />
        Encerrar turno
      </button>
    </div>
  );
  return (
    <div className="cash-workspace">
      <div className="cash-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO FINANCEIRA</span>
          <h1>Caixas</h1>
          <p className="muted">
            Controle os turnos, acompanhe movimentações e confira o dinheiro no fechamento.
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => void load()} disabled={loading} aria-label="Atualizar caixas">
            <Icon name="refresh" size={16} />
          </button>
          <button onClick={() => editRegister()} disabled={!data}>
            <Icon name="plus" size={16} />
            Novo caixa
          </button>
          <button className="primary" disabled={!available.length} onClick={() => openTurn()}>
            <Icon name="plus" size={17} />
            Abrir turno
          </button>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => void load()} disabled={loading}>
            Tentar novamente
          </button>
        </div>
      )}
      {!data ? (
        loading && <TableLoading label="Carregando caixas e movimentações…" />
      ) : (
        <>
          <div className="cash-kpis">
            {[
              [
                Store,
                'Caixas cadastrados',
                String(data.registers.length),
                `${available.length} disponível(is) para abrir`,
              ],
              [LockKeyhole, 'Turnos abertos', String(open.length), 'Na unidade atual'],
              [Wallet, 'Dinheiro esperado', brl(totalExpected), 'Soma dos turnos abertos'],
              [
                CircleDollarSign,
                'Fechamentos com diferença',
                String(differences),
                'Histórico desta unidade',
              ],
            ].map(([Symbol, label, value, hint]) => {
              const Component = Symbol as typeof Store;
              return (
                <StatCard
                  className="panel cash-kpi"
                  key={String(label)}
                  iconClassName="cash-kpi-icon"
                  label={String(label)}
                  value={String(value)}
                  detail={String(hint)}
                  icon={<Component size={22} />}
                />
              );
            })}
          </div>
          <Tabs label="Caixa">
            <Tab id="cash-0" label="Turnos" icon="clock">
              <div className="cash-operating-grid">
                <section className="panel cash-active">
                  <div className="cash-section-heading">
                    <h2>
                      <Icon name="cash" size={19} />
                      Caixa em operação
                    </h2>
                    {current ? (
                      <CashStatus status="OPEN" />
                    ) : (
                      <span className="cash-status is-closed">Sem turno aberto</span>
                    )}
                  </div>
                  {current ? (
                    <>
                      <label className="cash-active-selector">
                        Turno em atendimento
                        <SearchSelect
                          label="Selecionar turno aberto"
                          allowClear={false}
                          options={open.map((s) => ({
                            id: s.id,
                            name: s.register_name + ' · ' + operationTime(s.created_at),
                          }))}
                          value={current.id}
                          onChange={setSelected}
                        />
                      </label>
                      <div className="cash-active-meta">
                        <span>
                          <Icon name="team" size={15} />
                          {current.opened_by_name ?? 'Usuário indisponível'}
                        </span>
                        <span>
                          <Icon name="clock" size={15} />
                          Aberto {operationTime(current.created_at)}
                        </span>
                        <code>{shortId(current.id)}</code>
                      </div>
                      <div className="cash-expected">
                        <span>Dinheiro esperado no caixa</span>
                        <strong>{brl(current.expected_amount)}</strong>
                        <small>
                          Fundo + vendas em dinheiro + suprimentos − sangrias − estornos
                        </small>
                      </div>
                      <CashBreakdown item={current} />
                      {operations(current)}
                    </>
                  ) : (
                    <div className="cash-no-open">
                      <Wallet size={38} />
                      <h3>Comece um novo turno</h3>
                      <p>
                        Abra um caixa com o fundo inicial para registrar os recebimentos e
                        acompanhar o dinheiro.
                      </p>
                      {available.length ? (
                        <button className="primary" onClick={() => openTurn()}>
                          <Icon name="plus" size={17} />
                          Abrir primeiro turno disponível
                        </button>
                      ) : !data.registers.length ? (
                        <button className="primary" onClick={() => editRegister()}>
                          Cadastrar primeiro caixa
                        </button>
                      ) : null}
                    </div>
                  )}
                </section>
                <section className="panel cash-recent">
                  <div className="cash-section-heading">
                    <h2>
                      <Icon name="receipt" size={18} />
                      Últimas movimentações
                    </h2>
                    {current && (
                      <button onClick={() => setDetailId(current.id)}>
                        <Icon name="eye" size={15} />
                        Extrato
                      </button>
                    )}
                  </div>
                  <p className="field-hint">
                    {current
                      ? current.register_name + ' · turno selecionado'
                      : 'Registros mais recentes da unidade'}
                  </p>
                  {data.movements
                    .filter((m) => !current || m.cash_session_id === current.id)
                    .slice(0, 5).length ? (
                    <ul>
                      {data.movements
                        .filter((m) => !current || m.cash_session_id === current.id)
                        .slice(0, 5)
                        .map((m) => (
                          <li key={m.id}>
                            <span
                              className={
                                'cash-recent-icon ' + (Number(m.amount) < 0 ? 'is-out' : 'is-in')
                              }
                            >
                              <Icon
                                name={Number(m.amount) < 0 ? 'sort-down' : 'sort-up'}
                                size={17}
                              />
                            </span>
                            <div>
                              <strong>{cashTypeLabel(m.type)}</strong>
                              <small>{m.reason}</small>
                              <small>{operationTime(m.created_at)}</small>
                            </div>
                            <b className={Number(m.amount) < 0 ? 'cash-negative' : 'cash-positive'}>
                              {Number(m.amount) > 0 ? '+ ' : ''}
                              {brl(m.amount)}
                            </b>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <Empty>
                      Nenhuma movimentação registrada {current ? 'neste turno' : 'na unidade'}.
                    </Empty>
                  )}
                  <div className="cash-operating-note">
                    <Icon name="info" size={17} />
                    <p>
                      Confira o dinheiro físico antes de encerrar. O sistema mantém os movimentos e
                      registra a diferença entre o esperado e o contado.
                    </p>
                  </div>
                </section>
              </div>
              <section className="panel cash-history">
                <div className="cash-section-heading">
                  <div>
                    <h2>Histórico de turnos</h2>
                    <p className="field-hint">
                      Consulte aberturas, responsáveis e conferências da unidade atual.
                    </p>
                  </div>
                  <span className="cash-count">{data.sessions.length} turno(s)</span>
                </div>
                <div className="cash-filter-grid">
                  <label className="cash-search">
                    <Icon name="search" size={17} />
                    <input
                      type="search"
                      aria-label="Buscar turnos de caixa"
                      placeholder="Buscar caixa, responsável ou turno…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <label>
                    Caixa
                    <SearchSelect
                      label="Filtrar turnos por caixa"
                      value={register}
                      onChange={(v) => {
                        setRegister(v);
                        setPage(1);
                      }}
                      options={data.registers.map((r) => ({ id: r.id, name: r.name }))}
                      placeholder="Todos os caixas"
                    />
                  </label>
                  <label>
                    Situação
                    <select
                      aria-label="Situação do turno"
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">Todos</option>
                      <option value="OPEN">Abertos</option>
                      <option value="CLOSED">Encerrados</option>
                    </select>
                  </label>
                </div>
                <div className="cash-filter-dates">
                  <label>
                    Abertura a partir de
                    <input
                      type="date"
                      aria-label="Abertura inicial"
                      value={from}
                      max={to || undefined}
                      onChange={(e) => {
                        setFrom(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <label>
                    Abertura até
                    <input
                      type="date"
                      aria-label="Abertura final"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => {
                        setTo(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <label>
                    Ordenar
                    <select
                      aria-label="Ordenar turnos"
                      value={sort}
                      onChange={(e) => {
                        setSort(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="newest">Mais recentes</option>
                      <option value="oldest">Mais antigos</option>
                      <option value="amount">Maior dinheiro esperado</option>
                      <option value="difference">Maior diferença</option>
                    </select>
                  </label>
                  {(search || register || status || from || to) && (
                    <button
                      onClick={() => {
                        setSearch('');
                        setRegister('');
                        setStatus('');
                        setFrom('');
                        setTo('');
                        setPage(1);
                      }}
                    >
                      <Icon name="close" size={15} />
                      Limpar filtros
                    </button>
                  )}
                </div>
                {history.total ? (
                  <div className="cash-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {[
                            'Caixa / turno',
                            'Situação',
                            'Abertura / responsável',
                            'Dinheiro esperado',
                            'Contado',
                            'Diferença',
                            'Ações',
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.rows.map((s) => (
                          <tr key={s.id}>
                            <td data-label="Caixa / turno">
                              <strong>{s.register_name}</strong>
                              <small>{shortId(s.id)}</small>
                            </td>
                            <td data-label="Situação">
                              <CashStatus status={s.status} />
                            </td>
                            <td data-label="Abertura / responsável">
                              <span>{operationTime(s.created_at)}</span>
                              <small>{s.opened_by_name ?? 'Usuário indisponível'}</small>
                            </td>
                            <td data-label="Dinheiro esperado">{brl(s.expected_amount)}</td>
                            <td data-label="Contado">
                              {s.status === 'CLOSED' ? brl(s.counted_amount) : '—'}
                            </td>
                            <td data-label="Diferença">
                              {s.status === 'CLOSED' ? (
                                <Difference value={s.difference_amount} />
                              ) : (
                                <span className="muted">A conferir</span>
                              )}
                            </td>
                            <td data-label="Ações">
                              <button
                                aria-label={'Ver extrato do turno ' + shortId(s.id)}
                                onClick={() => setDetailId(s.id)}
                              >
                                <Icon name="eye" size={15} />
                                Extrato
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>Nenhum turno encontrado para estes filtros.</Empty>
                )}
                <Pagination
                  label="Histórico de caixas"
                  total={history.total}
                  page={page}
                  pageSize={size}
                  onPageChange={setPage}
                  onPageSizeChange={setSize}
                  loading={loading}
                />
              </section>
            </Tab>
            <Tab id="cash-2" label="Movimentações" icon="cash" count={data.movements.length}>
              <section className="panel">
                <div className="cash-section-heading">
                  <div>
                    <h2>Movimentações de caixa</h2>
                    <p className="field-hint">
                      Recebimentos, estornos, suprimentos e sangrias, com referência ao turno.
                    </p>
                  </div>
                </div>
                <MovementTable
                  records={data.movements}
                  sessions={data.sessions}
                  registers={data.registers}
                />
              </section>
            </Tab>
            <Tab id="cash-1" label="Caixas" icon="payments" count={data.registers.length}>
              <section className="panel cash-registers">
                <div className="cash-section-heading">
                  <div>
                    <h2>Caixas cadastrados</h2>
                    <p className="field-hint">Cada caixa pode ter um turno aberto por vez.</p>
                  </div>
                  <button onClick={() => editRegister()}>
                    <Icon name="plus" size={16} />
                    Cadastrar caixa
                  </button>
                </div>
                <label className="cash-search">
                  <Icon name="search" size={17} />
                  <input
                    type="search"
                    aria-label="Buscar caixas cadastrados"
                    placeholder="Buscar nome do caixa…"
                    value={registerSearch}
                    onChange={(e) => {
                      setRegisterSearch(e.target.value);
                      setRegisterPage(1);
                    }}
                  />
                </label>
                <div className="cash-register-grid">
                  {listedRegisters.rows.map((r) => {
                    const active = open.find((s) => s.register_id === r.id);
                    return (
                      <article key={r.id}>
                        <div className="cash-section-heading">
                          <Store size={23} />
                          <CashStatus status={active ? 'OPEN' : 'AVAILABLE'} />
                        </div>
                        <h3>{r.name}</h3>
                        <p>
                          {active
                            ? 'Em operação com ' + (active.opened_by_name ?? 'operador')
                            : 'Disponível para abrir um novo turno'}
                        </p>
                        <div className="cash-register-amount">
                          <span>{active ? 'Dinheiro esperado' : 'Sem turno aberto'}</span>
                          <strong>{active ? brl(active.expected_amount) : '—'}</strong>
                        </div>
                        <div className="cash-action-row">
                          <button
                            aria-label={'Editar caixa ' + r.name}
                            onClick={() => editRegister(r)}
                          >
                            <Icon name="edit" size={15} />
                            Editar
                          </button>
                          {active ? (
                            <button onClick={() => setDetailId(active.id)}>
                              <Icon name="eye" size={15} />
                              Ver turno
                            </button>
                          ) : (
                            <button className="primary" onClick={() => openTurn(r.id)}>
                              <Icon name="plus" size={15} />
                              Abrir turno neste caixa
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {!listedRegisters.total && <Empty>Nenhum caixa encontrado.</Empty>}
                <Pagination
                  label="Caixas cadastrados"
                  total={listedRegisters.total}
                  page={registerPage}
                  pageSize={registerSize}
                  onPageChange={setRegisterPage}
                  onPageSizeChange={setRegisterSize}
                  loading={loading}
                />
              </section>
            </Tab>
          </Tabs>
        </>
      )}
      {detail && (
        <Modal
          className="cash-detail-modal"
          title={'Extrato · ' + detail.register_name + ' · ' + shortId(detail.id)}
          onClose={() => setDetailId(null)}
        >
          <div className="cash-detail-heading">
            <CashStatus status={detail.status} />
            <span>
              Aberto por {detail.opened_by_name ?? 'Usuário indisponível'} ·{' '}
              {operationTime(detail.created_at)}
            </span>
            {detail.status === 'CLOSED' && (
              <span>
                Encerrado por {detail.closed_by_name ?? 'Usuário indisponível'} ·{' '}
                {operationTime(detail.closed_at)}
              </span>
            )}
          </div>
          <div className="cash-detail-totals">
            <div>
              <span>Dinheiro esperado</span>
              <strong>{brl(detail.expected_amount)}</strong>
            </div>
            <div>
              <span>Dinheiro contado</span>
              <strong>
                {detail.status === 'CLOSED' ? brl(detail.counted_amount) : 'A conferir'}
              </strong>
            </div>
            <div>
              <span>Diferença</span>
              {detail.status === 'CLOSED' ? (
                <Difference value={detail.difference_amount} />
              ) : (
                <strong>—</strong>
              )}
            </div>
          </div>
          <CashBreakdown item={detail} />
          <h3 className="cash-detail-title">Movimentações deste turno</h3>
          <MovementTable
            key={detail.id}
            records={data?.movements.filter((m) => m.cash_session_id === detail.id) ?? []}
            sessions={data?.sessions ?? []}
            registers={data?.registers ?? []}
            scoped
          />
          <div className="modal-footer cash-detail-footer">
            <ModalCloseButton>Fechar consulta</ModalCloseButton>
            {detail.status === 'OPEN' && operations(detail)}
          </div>
        </Modal>
      )}
      {forms.dialog}
    </div>
  );
}
import { StatCard } from './data-display.js';
