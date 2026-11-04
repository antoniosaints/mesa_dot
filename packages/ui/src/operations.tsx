import { orderLocationLabel } from '../../shared/src/order-location.js';
import { Pagination, TableLoading, pageInfo } from './pagination.js';
import { useId, useState } from 'react';
import { TicketQuickScanButton } from './ticket-quick-scan.js';
import {
  filterOrdersView,
  indexOrderTickets,
  isPendingDelivery,
  orderDelivery,
  orderSourceLabel,
  sortOrdersView,
  type OrderSort,
  type OrderSortKey,
} from './orders-view.js';
import { Icon } from './appearance.js';
import { Badge, Empty } from './common.js';
import { SearchSelect, Tabs, Tab } from './controls.js';
import { brl, type Data } from './client.js';
import { shortId, operationTime } from './operation-format.js';
export { shortId, operationTime } from './operation-format.js';
export { TicketList } from './ticket-list.js';
import { GroupedTickets } from './ticket-groups.js';
import { ReceiptMenuButton } from './receipt-menu.js';
const sourceLabel = orderSourceLabel;
export function OrderList({
  orders,
  onSelect,
  tickets,
  sort,
  onSort,
}: {
  orders: Data[];
  onSelect: (order: Data) => void;
  tickets?: Data[];
  sort?: OrderSort;
  onSort?: (key: OrderSortKey) => void;
}) {
  const byOrder = indexOrderTickets(tickets ?? []);
  const sortable = (label: string, key: OrderSortKey) => (
    <th
      scope="col"
      aria-sort={
        sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
      }
    >
      {onSort ? (
        <button
          className="order-sort"
          aria-label={'Ordenar por ' + label.toLocaleLowerCase('pt-BR')}
          onClick={() => onSort(key)}
        >
          {label}
          <Icon
            name={sort?.key === key ? (sort.direction === 'asc' ? 'sort-up' : 'sort-down') : 'sort'}
            size={14}
          />
        </button>
      ) : (
        label
      )}
    </th>
  );
  if (!orders.length)
    return (
      <Empty>
        Nenhum pedido encontrado. Escolha uma mesa para iniciar um atendimento ou ajuste os filtros.
      </Empty>
    );
  return (
    <div className="data-table order-list-table">
      <table className="orders-table" aria-label="Lista de pedidos">
        <thead>
          <tr>
            {sortable('Pedido e horário', 'created')}
            {sortable('Mesa / comanda', 'table')}
            <th scope="col">Itens do pedido</th>
            {sortable('Situação', 'status')}
            {tickets && sortable('Entregas', 'delivery')}
            {sortable('Total', 'total')}
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const flow = orderDelivery(order, byOrder.get(order.id));
            return (
              <tr key={order.id}>
                <td data-label="Pedido" className="order-id-cell">
                  <div className="order-id">
                    <span className="order-reference">
                      <Icon name="orders" size={14} />
                      <strong>{shortId(order.id)}</strong>
                    </span>
                    <time dateTime={order.created_at_iso ?? order.created_at}>
                      {operationTime(order.created_at_iso ?? order.created_at)}
                    </time>
                    <span className="order-source">
                      <Icon
                        name={
                          order.source === 'CUSTOMER'
                            ? 'scan'
                            : order.source === 'WAITER'
                              ? 'team'
                              : 'cash'
                        }
                        size={12}
                      />
                      {sourceLabel(order.source, order.service_mode)}
                    </span>
                  </div>
                </td>
                <td data-label="Mesa / comanda" className="order-table-cell">
                  <strong>
                    <Icon name="tables" size={14} />
                    {orderLocationLabel(order)}
                  </strong>
                  <small title={order.tab_label}>
                    {order.tab_label || 'Comanda não vinculada'}
                  </small>
                </td>
                <td data-label="Itens" className="order-items-cell">
                  <span className="order-items-preview" title={order.items_summary}>
                    {order.items_summary || 'Consulte os itens do pedido'}
                  </span>
                  <small>
                    {order.item_count ?? 0} unidade(s) · {order.ticket_count ?? 0} ficha(s)
                  </small>
                </td>
                <td data-label="Situação" className="order-state-cell">
                  <Badge status={order.status} />
                  <small>
                    {order.payment_policy_snapshot === 'IMMEDIATE'
                      ? 'Pago no ato'
                      : order.payment_policy_snapshot === 'POSTPAID'
                        ? 'Pagar no fechamento'
                        : 'Pré-pago'}
                  </small>
                </td>
                {tickets && (
                  <td data-label="Entregas" className="order-delivery-cell">
                    <span className={'order-delivery-badge ' + flow.tone}>
                      <Icon
                        name={flow.requested ? 'bell' : flow.tone === 'success' ? 'ready' : 'clock'}
                        size={12}
                      />
                      {flow.label}
                    </span>
                    <small>
                      {order.status !== 'CANCELLED' && flow.total > 0
                        ? `${flow.delivered}/${flow.total} entregues`
                        : order.status === 'CANCELLED'
                          ? 'Fora da operação'
                          : 'Sem fichas liberadas'}
                    </small>
                    {flow.pending > 0 && (
                      <span className="order-delivery-pending">{flow.pending} a entregar</span>
                    )}
                  </td>
                )}
                <td data-label="Total" className="order-value-cell">
                  <strong>{brl(order.total)}</strong>
                </td>
                <td className="order-action-cell">
                  <div className="order-row-actions">
                    <ReceiptMenuButton scope="ORDER" id={order.id} />
                    <button onClick={() => onSelect(order)}>
                      <Icon name="eye" size={16} />
                      Ver pedido
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export { OrderSummary, OrderDetailHeading } from './order-detail.js';
export function OrdersWorkspace({
  orders,
  tickets,
  tables,
  onOrder,
  onTicket,
  onNew,
  onNewCounter,
  onDeliver,
  onReload,
  loading = false,
  canViewTickets = true,
}: {
  orders: Data[];
  tickets: Data[];
  tables: Data[];
  onOrder: (order: Data) => void;
  onTicket?: (ticket: Data) => void;
  onNew?: () => void;
  onNewCounter?: () => void;
  onDeliver?: (ticket: Data) => void;
  onReload?: () => Promise<void>;
  loading?: boolean;
  canViewTickets?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [tableId, setTableId] = useState('');
  const [status, setStatus] = useState('ALL');
  const [source, setSource] = useState('ALL');
  const [deliveryFilter, setDeliveryFilter] = useState('ALL');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<OrderSort>({ key: 'created', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [refreshing, setRefreshing] = useState(false);
  const filterId = useId();
  const filtered = filterOrdersView(orders, tickets, {
    search,
    tableId,
    status,
    source,
    delivery: deliveryFilter,
  });
  const sorted = sortOrdersView(filtered.orders, sort, indexOrderTickets(tickets));
  const { start, end } = pageInfo(sorted.length, page, size);
  const activeFilters = [
    Boolean(search.trim()),
    Boolean(tableId),
    status !== 'ALL',
    source !== 'ALL',
    deliveryFilter !== 'ALL',
  ].filter(Boolean).length;
  const pending = tickets.filter(isPendingDelivery);
  const requested = pending.filter((ticket) =>
    ['OPEN', 'CLAIMED'].includes(ticket.service_request_status),
  ).length;
  const metrics = canViewTickets
    ? [
        {
          label: 'Pedidos registrados',
          value: orders.length,
          detail: 'Histórico da unidade',
          icon: 'orders',
          tone: 'info',
        },
        {
          label: 'A entregar',
          value: pending.length,
          detail: 'Unidades em atendimentos abertos',
          icon: 'ticket',
          tone: 'warning',
        },
        {
          label: 'Em preparo',
          value: pending.filter((ticket) => ['PENDING', 'PREPARING'].includes(ticket.status))
            .length,
          detail: 'Unidades em produção ou na fila',
          icon: 'production',
          tone: 'info',
        },
        {
          label: 'Solicitações de clientes',
          value: requested,
          detail: 'Aguardando atendimento da equipe',
          icon: 'bell',
          tone: requested ? 'warning' : 'success',
        },
      ]
    : [
        {
          label: 'Pedidos registrados',
          value: orders.length,
          detail: 'Histórico da unidade',
          icon: 'orders',
          tone: 'info',
        },
        {
          label: 'Confirmados',
          value: orders.filter((order) => order.status === 'CONFIRMED').length,
          detail: 'Pedidos lançados no atendimento',
          icon: 'ready',
          tone: 'success',
        },
        {
          label: 'Aguardando pagamento',
          value: orders.filter((order) => order.status === 'PENDING_PAYMENT').length,
          detail: 'Pré-pagos ainda não aprovados',
          icon: 'payments',
          tone: 'warning',
        },
        {
          label: 'Rascunhos',
          value: orders.filter((order) => order.status === 'DRAFT').length,
          detail: 'Pedidos ainda não confirmados',
          icon: 'edit',
          tone: 'neutral',
        },
      ];
  function clearFilters() {
    setSearch('');
    setTableId('');
    setStatus('ALL');
    setSource('ALL');
    setDeliveryFilter('ALL');
    setPage(1);
  }
  function sortBy(key: OrderSortKey) {
    setSort({ key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' });
    setPage(1);
  }
  async function reload() {
    if (!onReload) return;
    setRefreshing(true);
    try {
      await onReload();
    } finally {
      setRefreshing(false);
    }
  }
  const filterChange = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  return (
    <div className="orders-workspace">
      <header className="orders-page-heading">
        <div>
          <span className="orders-breadcrumb">
            <Icon name="orders" size={14} />
            Operação<span>/</span>Pedidos
          </span>
          <h1>Pedidos</h1>
          <p>Acompanhe pedidos de mesas e vendas avulsas no balcão, do recebimento à entrega.</p>
        </div>
        <div className="orders-heading-actions">
          {onDeliver && canViewTickets && (
            <TicketQuickScanButton onDelivered={() => onReload?.()} />
          )}
          {onReload && (
            <button disabled={refreshing} onClick={() => void reload()}>
              <Icon name="refresh" size={17} />
              {refreshing ? 'Atualizando…' : 'Recarregar'}
            </button>
          )}
          {onNewCounter && (
            <button onClick={onNewCounter} disabled={loading}>
              <Icon name="cash" size={16} />
              Pedido avulso
            </button>
          )}
          {onNew && (
            <button className="primary" disabled={loading} onClick={onNew}>
              <Icon name="plus" size={18} />
              Novo pedido
            </button>
          )}
        </div>
      </header>
      <div className="orders-metrics" aria-label="Indicadores dos pedidos">
        {metrics.map((metric) => (
          <StatCard
            as="article"
            className={'orders-metric ' + metric.tone}
            key={metric.label}
            iconClassName="orders-metric-icon"
            label={metric.label}
            value={loading ? '—' : metric.value}
            detail={metric.detail}
            icon={<Icon name={metric.icon as 'orders'} size={20} />}
          />
        ))}
      </div>
      <section className="orders-panel">
        <div className="orders-panel-heading">
          <div>
            <h2>Pedidos e fichas</h2>
            <p>
              {orders.length} pedido(s) · {tickets.length} ficha(s) na unidade
            </p>
          </div>
          <div className="orders-panel-controls">
            <span className="orders-auto-update">
              <span />
              Atualização automática
            </span>
            {activeFilters > 0 && (
              <button className="orders-clear-filters" onClick={clearFilters}>
                <Icon name="close" size={15} />
                Limpar filtros
              </button>
            )}
          </div>
        </div>
        <div className="orders-filter-area">
          <div className="orders-search-row">
            <label className="input-icon">
              <span className="sr-only">Buscar pedidos e fichas</span>
              <Icon name="search" size={18} />
              <input
                type="search"
                aria-label="Buscar pedidos e fichas"
                placeholder="Buscar pedido, mesa, comanda, produto ou ficha…"
                value={search}
                onChange={(event) => filterChange(setSearch)(event.target.value)}
              />
            </label>
            <button
              className="orders-mobile-filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls={filterId}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <Icon name="filters" size={17} />
              Filtros{activeFilters > 0 && <span>{activeFilters}</span>}
            </button>
          </div>
          <div id={filterId} className={'orders-filter-grid' + (filtersOpen ? ' is-open' : '')}>
            <label>
              Mesa
              <SearchSelect
                label="Filtrar por mesa"
                value={tableId}
                onChange={filterChange(setTableId)}
                options={[
                  { id: 'COUNTER', name: 'Balcão · Pedidos avulsos' },
                  ...tables.map((table) => ({ id: table.id, name: 'Mesa ' + table.number })),
                ]}
                placeholder="Todas as mesas"
              />
            </label>
            <label>
              Situação do pedido
              <SearchSelect
                label="Situação do pedido"
                value={status}
                onChange={filterChange(setStatus)}
                allowClear={false}
                options={[
                  { id: 'ALL', name: 'Todos' },
                  { id: 'DRAFT', name: 'Rascunhos' },
                  { id: 'PENDING_PAYMENT', name: 'Aguardando pagamento' },
                  { id: 'CONFIRMED', name: 'Confirmados' },
                  { id: 'CANCELLED', name: 'Cancelados' },
                ]}
              />
            </label>
            <label>
              Origem
              <SearchSelect
                label="Origem do pedido"
                value={source}
                onChange={filterChange(setSource)}
                allowClear={false}
                options={[
                  { id: 'ALL', name: 'Todas as origens' },
                  { id: 'CUSTOMER', name: 'Cliente · QR da mesa / Online' },
                  { id: 'WAITER', name: 'Garçom' },
                  { id: 'POS', name: 'Caixa / PDV' },
                ]}
              />
            </label>
            {canViewTickets && (
              <label>
                Entrega
                <SearchSelect
                  label="Situação da entrega"
                  value={deliveryFilter}
                  onChange={filterChange(setDeliveryFilter)}
                  allowClear={false}
                  options={[
                    { id: 'ALL', name: 'Todas as entregas' },
                    { id: 'PENDING', name: 'A entregar' },
                    { id: 'PREPARING', name: 'Em preparo' },
                    { id: 'REQUESTED', name: 'Solicitadas pelo cliente' },
                    { id: 'DELIVERED', name: 'Entregues' },
                  ]}
                />
              </label>
            )}
          </div>
        </div>
        {loading ? (
          <TableLoading label="Carregando pedidos…" />
        ) : (
          <div className="orders-results" aria-busy={refreshing}>
            <Tabs label="Pedidos e fichas">
              <Tab id="orders" label="Pedidos" icon="orders" count={filtered.orders.length}>
                <div className="orders-results-meta" aria-live="polite">
                  <span>
                    {sorted.length}{' '}
                    {sorted.length === 1 ? 'pedido encontrado' : 'pedidos encontrados'}
                    {activeFilters ? ' com os filtros aplicados' : ''}
                  </span>
                  <span className="orders-sort-hint">Ordene pelas colunas da tabela</span>
                  <div className="orders-mobile-sort">
                    <SearchSelect
                      label="Ordenar pedidos"
                      value={sort.key + ':' + sort.direction}
                      allowClear={false}
                      onChange={(value) => {
                        const [key, direction] = value.split(':');
                        setSort({
                          key: key as OrderSortKey,
                          direction: direction as 'asc' | 'desc',
                        });
                        setPage(1);
                      }}
                      options={[
                        { id: 'created:desc', name: 'Mais recentes primeiro' },
                        { id: 'created:asc', name: 'Mais antigos primeiro' },
                        { id: 'total:desc', name: 'Maior valor primeiro' },
                        { id: 'total:asc', name: 'Menor valor primeiro' },
                        { id: 'table:asc', name: 'Mesa: menor número primeiro' },
                        { id: 'table:desc', name: 'Mesa: maior número primeiro' },
                        { id: 'status:asc', name: 'Situação: rascunhos primeiro' },
                        { id: 'status:desc', name: 'Situação: cancelados primeiro' },
                        ...(canViewTickets
                          ? [
                              { id: 'delivery:desc', name: 'Mais pendências de entrega' },
                              { id: 'delivery:asc', name: 'Menos pendências de entrega' },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                </div>
                {sorted.length ? (
                  <OrderList
                    orders={sorted.slice(start - 1, end)}
                    tickets={canViewTickets ? tickets : undefined}
                    onSelect={onOrder}
                    sort={sort}
                    onSort={sortBy}
                  />
                ) : (
                  <div className="orders-empty">
                    <Icon name="search" size={30} />
                    <h3>Nenhum pedido encontrado</h3>
                    <p>
                      {activeFilters
                        ? 'Tente outra busca ou limpe os filtros para ver todos os pedidos.'
                        : onNew
                          ? 'Use “Novo pedido” para selecionar uma mesa e começar o atendimento.'
                          : 'Os pedidos aparecerão aqui quando forem registrados.'}
                    </p>
                  </div>
                )}
                <Pagination
                  label="Pedidos"
                  total={sorted.length}
                  page={page}
                  pageSize={size}
                  onPageChange={setPage}
                  onPageSizeChange={setSize}
                  loading={loading || refreshing}
                  searchableSize
                  pageSizeOptions={[10, 25, 50]}
                  previousLabel="Página anterior de pedidos"
                  nextLabel="Próxima página de pedidos"
                />
              </Tab>
              {canViewTickets && (
                <Tab id="tickets" label="Fichas" icon="ticket" count={filtered.tickets.length}>
                  <div className="orders-ticket-intro">
                    <Icon name="ticket" size={18} />
                    <p>Fichas organizadas por mesa, atendimento, comanda e pedido.</p>
                  </div>
                  <GroupedTickets
                    tickets={filtered.tickets}
                    onSelect={onTicket}
                    onDeliver={onDeliver}
                    onOrder={(id) => onOrder({ id })}
                  />
                </Tab>
              )}
            </Tabs>
          </div>
        )}
      </section>
      <details className="orders-workflow-help">
        <summary>
          <Icon name="help" size={16} />
          Como funciona o atendimento
        </summary>
        <ol>
          <li>
            <strong>Mesa e comanda</strong>
            <span>Escolha o atendimento e quem receberá o consumo.</span>
          </li>
          <li>
            <strong>Pedido</strong>
            <span>Revise produtos, quantidades e observações antes de confirmar.</span>
          </li>
          <li>
            <strong>Fichas e entrega</strong>
            <span>Acompanhe cada unidade até a entrega ao cliente.</span>
          </li>
        </ol>
      </details>
    </div>
  );
}
import { StatCard } from './data-display.js';
