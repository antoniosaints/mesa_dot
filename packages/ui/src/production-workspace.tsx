import { orderLocationLabel } from '../../shared/src/order-location.js';
import { useEffect, useRef, useState } from 'react';
import {
  ChefHat,
  Clock3,
  CookingPot,
  CircleCheck,
  Play,
  SlidersHorizontal,
  PanelsTopLeft,
  StickyNote,
  ListOrdered,
} from 'lucide-react';
import { api, session, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Empty, useRefresh } from './common.js';
import { SearchSelect } from './controls.js';
import { useToasts } from './toasts.js';
import { operationTime, shortId } from './operation-format.js';
import {
  productionAge,
  productionAgeLabel,
  filterProduction,
  canAdvanceProduction,
  type ProductionFilters,
} from './production-view.js';
const initialFilters: ProductionFilters = {
  search: '',
  sector: '',
  table: '',
  status: '',
  sort: 'oldest',
};
export function ProductionWorkspace() {
  const allowed = Boolean(session()?.actor?.permissions?.includes('production.manage'));
  const [jobs, setJobs] = useState<Data[] | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [actionError, setActionError] = useState('');
  const [filters, setFilters] = useState<ProductionFilters>(initialFilters),
    [now, setNow] = useState(Date.now()),
    [pending, setPending] = useState<string[]>([]);
  const alive = useRef(true),
    version = useRef(0),
    locked = useRef(new Set<string>()),
    toast = useToasts();
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      alive.current = false;
      version.current++;
      clearInterval(timer);
    };
  }, []);
  async function load() {
    if (!allowed) {
      setLoading(false);
      return;
    }
    const request = ++version.current;
    setLoading(true);
    try {
      const data = await api('/production/jobs');
      if (alive.current && request === version.current) {
        setJobs(data);
        setError('');
        setNow(Date.now());
      }
    } catch (e) {
      if (alive.current && request === version.current) setError((e as Error).message);
    } finally {
      if (alive.current && request === version.current) setLoading(false);
    }
  }
  useRefresh(load, [allowed]);
  async function advance(job: Data) {
    if (locked.current.has(job.id) || !canAdvanceProduction(job) || !navigator.onLine) return;
    locked.current.add(job.id);
    setPending([...locked.current]);
    setActionError('');
    try {
      await api(`/production/jobs/${job.id}/status`, {
        status: job.status === 'PENDING' ? 'PREPARING' : 'READY',
      });
      toast.success(
        job.status === 'PENDING'
          ? 'Preparo iniciado.'
          : 'Item pronto. Ficha liberada para a entrega pelo garçom.',
      );
      await load();
    } catch (e) {
      if (alive.current) {
        setActionError((e as Error).message);
        toast.error((e as Error).message);
        await load();
      }
    } finally {
      locked.current.delete(job.id);
      if (alive.current) setPending([...locked.current]);
    }
  }
  const filtered = filterProduction(jobs ?? [], filters),
    waiting = filtered.filter((j) => j.status === 'PENDING'),
    preparing = filtered.filter((j) => j.status === 'PREPARING');
  const ages = filtered.map((j) => productionAge(j, now)).filter((n): n is number => n !== null),
    oldest = ages.length ? Math.max(...ages) : null;
  const tables = [
    ...new Map(
      (jobs ?? []).map((j) => [
        j.table_id ?? 'COUNTER',
        { id: j.table_id ?? 'COUNTER', name: orderLocationLabel(j) },
      ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  const sectors = [...new Set((jobs ?? []).map((j) => j.sector))].sort();
  const hasFilters = Boolean(filters.search || filters.sector || filters.table || filters.status);
  if (!allowed)
    return (
      <section className="panel">
        <h2>Acesso à produção restrito</h2>
        <p className="muted">Seu perfil não possui permissão para gerenciar a cozinha.</p>
      </section>
    );
  return (
    <div className="production-workspace">
      <div className="cash-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO / COZINHA E BAR</span>
          <h1>Produção</h1>
          <p className="muted">
            Acompanhe a fila, confira as observações e libere os itens prontos para entrega.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" size={16} />
          Recarregar
        </button>
      </div>
      {(error || actionError) && (
        <div className="alert error" role="alert">
          <Icon name="info" size={18} />
          <span>
            {actionError || error}
            {error && jobs ? ' Os últimos dados carregados estão sendo exibidos.' : ''}
          </span>
          <button onClick={() => void load()} disabled={loading}>
            Tentar novamente
          </button>
        </div>
      )}
      <div className="production-kpis" aria-label="Resumo da produção filtrada">
        {[
          {
            label: 'Na fila',
            value: String(waiting.length),
            hint: 'Unidades aguardando início',
            icon: ListOrdered,
            tone: 'amber',
          },
          {
            label: 'Em preparo',
            value: String(preparing.length),
            hint: 'Unidades sendo preparadas',
            icon: CookingPot,
            tone: 'blue',
          },
          {
            label: 'Mesas na produção',
            value: String(new Set(filtered.map((j) => j.table_id)).size),
            hint: 'Mesas com itens na seleção',
            icon: PanelsTopLeft,
            tone: 'teal',
          },
          {
            label: 'Entrada mais antiga',
            value: oldest === null ? '—' : productionAgeLabel(oldest),
            hint: filtered.length ? 'Tempo total desde a entrada' : 'Nenhum item na seleção',
            icon: Clock3,
            tone: 'neutral',
          },
        ].map((k) => (
          <StatCard
            key={k.label}
            className={'panel production-kpi ' + k.tone}
            iconClassName="production-kpi-icon"
            label={k.label}
            value={jobs ? k.value : '—'}
            detail={k.hint}
            icon={<k.icon size={21} />}
          />
        ))}
      </div>
      <section className="panel production-filter-panel">
        <div className="production-list-heading">
          <div>
            <h2>
              <SlidersHorizontal size={18} />
              Fila de produção
            </h2>
            <p>
              Cada cartão representa uma unidade e sua ficha. Use os filtros para focar no seu
              setor.
            </p>
          </div>
          <span className="production-live">
            <i />
            {loading ? 'Atualizando…' : 'Atualização automática'}
          </span>
        </div>
        <div className="production-filters">
          <label className="production-search">
            Buscar na produção
            <div className="production-search-control">
              <Icon name="search" size={17} />
              <input
                type="search"
                aria-label="Buscar na produção"
                placeholder="Produto, mesa, comanda, pedido ou ficha…"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              />
            </div>
          </label>
          <label>
            Setor
            <SearchSelect
              label="Setor da produção"
              value={filters.sector}
              onChange={(sector) => setFilters((f) => ({ ...f, sector }))}
              placeholder="Todos os setores"
              options={sectors.map((id) => ({ id, name: id }))}
            />
          </label>
          <label>
            Mesa
            <SearchSelect
              label="Mesa da produção"
              value={filters.table}
              onChange={(table) => setFilters((f) => ({ ...f, table }))}
              placeholder="Todas as mesas"
              options={tables}
            />
          </label>
        </div>
        <div className="production-filter-footer">
          <div className="production-status-filter" role="group" aria-label="Situação da produção">
            {[
              ['', 'Todos'],
              ['PENDING', 'Na fila'],
              ['PREPARING', 'Em preparo'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={filters.status === id}
                onClick={() => setFilters((f) => ({ ...f, status: id }))}
              >
                {label}
              </button>
            ))}
          </div>
          <div>
            {hasFilters && (
              <button className="production-clear" onClick={() => setFilters(initialFilters)}>
                Limpar filtros
              </button>
            )}
            <select
              aria-label="Ordenar produção"
              value={filters.sort}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
            >
              <option value="oldest">Mais antigos primeiro</option>
              <option value="newest">Mais recentes primeiro</option>
            </select>
          </div>
        </div>
      </section>
      <div className="production-results">
        <span>
          {filtered.length} unidade(s) em {new Set(filtered.map((j) => j.order_id)).size} pedido(s)
          {hasFilters ? ' · Filtros aplicados' : ''}
        </span>
        <span>
          <CircleCheck size={14} />
          Ao concluir, a ficha é liberada para o garçom. A entrega é uma etapa separada.
        </span>
      </div>
      {!jobs && loading ? (
        <div className="production-loading" role="status" aria-label="Carregando produção">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} />
          ))}
          <span className="sr-only">Carregando produção…</span>
        </div>
      ) : jobs && !jobs.length ? (
        <section className="panel">
          <Empty>
            A cozinha está em dia. Novos itens que exigem preparo aparecerão aqui após a confirmação
            do pedido.
          </Empty>
        </section>
      ) : !filtered.length ? (
        <section className="panel">
          <Empty>
            {error && !jobs
              ? 'Não foi possível carregar a fila. Tente novamente.'
              : 'Nenhum item corresponde aos filtros. Ajuste a busca ou limpe os filtros.'}
          </Empty>
        </section>
      ) : (
        <div className={'production-board ' + (filters.status ? 'is-single' : '')}>
          {[
            {
              status: 'PENDING',
              title: 'Na fila',
              hint: 'Confira os itens e inicie o preparo.',
              icon: Clock3,
              rows: waiting,
            },
            {
              status: 'PREPARING',
              title: 'Em preparo',
              hint: 'Conclua quando a unidade estiver pronta.',
              icon: ChefHat,
              rows: preparing,
            },
          ]
            .filter((c) => !filters.status || filters.status === c.status)
            .map((column) => (
              <section
                className={'production-column ' + column.status.toLowerCase()}
                key={column.status}
                aria-label={column.title}
              >
                <header>
                  <span className="production-column-icon">
                    <column.icon size={20} />
                  </span>
                  <div>
                    <h2>
                      {column.title}
                      <span>{column.rows.length}</span>
                    </h2>
                    <p>{column.hint}</p>
                  </div>
                </header>
                <div className="production-column-cards">
                  {!column.rows.length ? (
                    <div className="production-column-empty">
                      <CircleCheck size={25} />
                      <strong>
                        {column.status === 'PENDING'
                          ? 'Nenhuma unidade na fila'
                          : 'Nenhum preparo em andamento'}
                      </strong>
                      <p>
                        {column.status === 'PENDING'
                          ? 'Os novos pedidos aparecerão aqui.'
                          : 'Inicie um item da fila para acompanhar aqui.'}
                      </p>
                    </div>
                  ) : (
                    column.rows.map((job) => (
                      <article
                        className="production-job"
                        key={job.id}
                        aria-label={`Ficha ${job.public_number}`}
                      >
                        <div className="production-job-top">
                          <strong>
                            <PanelsTopLeft size={15} />
                            {orderLocationLabel(job)}
                          </strong>
                          <span className="production-sector">{job.sector}</span>
                        </div>
                        <div className="production-job-product">
                          <span>1×</span>
                          <h3>{job.product}</h3>
                        </div>
                        <p className="production-job-tab">{job.tab_label}</p>
                        {job.modifiers?.length > 0 && (
                          <ul className="production-modifiers" aria-label="Adicionais">
                            {job.modifiers.map((name: string, i: number) => (
                              <li key={i}>+ {name}</li>
                            ))}
                          </ul>
                        )}
                        {job.notes ? (
                          <div className="production-job-notes">
                            <StickyNote size={16} />
                            <div>
                              <strong>Observação do pedido</strong>
                              <p>{job.notes}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="production-no-notes">Sem observações</p>
                        )}
                        <div className="production-job-reference">
                          <span>Pedido {shortId(job.order_id)}</span>
                          <span>Ficha {job.public_number}</span>
                        </div>
                        <div className="production-job-time">
                          <span>
                            <Clock3 size={14} />
                            {productionAge(job, now) === 0
                              ? 'Entrada agora'
                              : productionAgeLabel(productionAge(job, now)) + ' desde a entrada'}
                          </span>
                          <time dateTime={job.created_at_iso}>
                            {operationTime(job.created_at_iso)}
                          </time>
                        </div>
                        <button
                          className={job.status === 'PENDING' ? 'primary' : 'production-ready'}
                          disabled={
                            pending.includes(job.id) ||
                            !navigator.onLine ||
                            !canAdvanceProduction(job)
                          }
                          onClick={() => void advance(job)}
                        >
                          {job.status === 'PENDING' ? (
                            <Play size={16} />
                          ) : (
                            <CircleCheck size={17} />
                          )}{' '}
                          {pending.includes(job.id)
                            ? 'Atualizando…'
                            : job.status === 'PENDING'
                              ? 'Iniciar preparo'
                              : 'Pronto para entregar'}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
import { StatCard } from './data-display.js';
