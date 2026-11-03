import { DeleteTableButton } from './delete-table.js';
import { ComplementsWorkspace } from './complements-workspace.js';
import { AiAssistantProvider } from './ai-assistant.js';
import { PushSettings } from './push-settings.js';
import { PushDeviceButton } from './push-device.js';
import { finishBranchTransition } from './branch-transition.js';
import { ManagementShortcutProvider, ManagementShortcutBar } from './management-shortcuts.js';
import { BranchSwitcher } from './branch-switcher.js';
import { DashboardOverview } from './dashboard-overview.js';
import { OperationControl } from './operation-control.js';
import { useSidebarPreference } from './sidebar-preference.js';
import { CounterSaleModal } from './counter-sale.js';
import { flushSync } from 'react-dom';
import { orderLocationLabel } from '../../shared/src/order-location.js';
import { recordColorField } from './record-tags.js';
import { companySelectionRequested } from './common.js';
import { BusinessSettings } from './business-settings.js';
import { PrintQueue } from './print-queue.js';
import { TeamWorkspace } from './team-workspace.js';
import { PrintBridgeProvider, PrintBridgePanel, PrintBridgeIndicator } from './printbridge.js';
import { ProductionWorkspace } from './production-workspace.js';
import { PaymentsWorkspace } from './payments-workspace.js';
import { CashWorkspace } from './cash-workspace.js';
import { FinanceWorkspace } from './finance-workspace.js';
import { CatalogAddons } from './catalog-addons.js';
import { InventoryOverview } from './inventory-overview.js';
import { OrderCancellationDialog } from './order-cancellation.js';
import { useTicketDelivery } from './delivery.js';
import { ClientRequestBanner, useClientRequestAlerts } from './request-alerts.js';
import { ClientRequestList } from './request-center.js';
import { canDeliverTicket } from './ticket-state.js';
import { OrdersWorkspace, OrderSummary, OrderDetailHeading, shortId } from './operations.js';
import { adminPaths, usePageRoute, RouteNotFound } from './routing.js';
import { Tab, Tabs } from './controls.js';
import { useFormDialog } from './forms.js';
import { AppearanceSettings } from './appearance-settings.js';
import { OperationSettings } from './operation-settings.js';
import { Clock, Icon, ThemeToggle, type IconName } from './appearance.js';
import { useEffect, useLayoutEffect, useState } from 'react';
import { api, useStorageKey, session, saveSession, type Data } from './client.js';
import {
  Badge,
  Login,
  Modal,
  PageTitle,
  useAction,
  useRefresh,
  useStaff,
  Code,
  Connectivity,
} from './common.js';
import { TablePanel, FloorEditor, FloorOverview } from './pos.js';
import { Resource } from './resource.js';
import { ProductsWorkspace } from './products-workspace.js';
const nav = [
  ['overview', 'dashboard', 'Visão geral'],
  ['floor', 'tables', 'Salão e mesas'],
  ['orders', 'orders', 'Pedidos'],
  ['menu', 'menu', 'Cardápio'],
  ['finance', 'finance', 'Painel financeiro'],
  ['payments', 'payments', 'Pagamentos'],
  ['cash', 'cash', 'Caixa'],
  ['inventory', 'inventory', 'Estoque'],
  ['production', 'production', 'Produção'],
  ['printing', 'printing', 'Impressão'],
  ['team', 'team', 'Equipe'],
  ['settings', 'settings', 'Configurações'],
  ['complements', 'complements', 'Complementos'],
];
export function AdminApp() {
  useStorageKey('bar-staff');
  const { current, setCurrent, signOut } = useStaff();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);

  const can = (permission: string) => Boolean(current?.actor?.permissions.includes(permission));
  const pagePermissions: Record<string, string> = {
    overview: 'reports.view',
    floor: 'table.view',
    orders: 'table.view',
    menu: 'catalog.manage',
    payments: 'payment.receive',
    cash: 'cash.manage',
    inventory: 'inventory.view',
    production: 'production.manage',
    printing: 'print.manage',
    team: 'staff.manage',
    settings: 'settings.update',
  };
  const visibleNav = nav.filter(([key]) =>
    ['finance', 'complements'].includes(key)
      ? Boolean(current?.actor?.isAccountAdmin)
      : can(pagePermissions[key]),
  );
  useEffect(() => {
    if (!current) return;
    let active = true;
    const identity =
      current.actor.id + ':' + current.actor.tenantId + ':' + current.actor.establishmentId;
    void api('/me')
      .then((actor) => {
        const stored = session();
        if (
          active &&
          stored &&
          identity ===
            stored.actor.id + ':' + stored.actor.tenantId + ':' + stored.actor.establishmentId
        ) {
          const next = { ...stored, actor };
          saveSession(next);
          setCurrent(next);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [current?.actor?.id, current?.actor?.tenantId, current?.actor?.establishmentId]);
  const {
    page: requestedPage,
    setPage,
    location,
    navigate,
  } = usePageRoute(adminPaths, visibleNav[0]?.[0] ?? 'overview', Boolean(current), {
    floor: /^\/salao\/atendimento\/[^/]+$/,
    orders: /^\/pedidos\/[^/]+(?:\/fichas\/[^/]+)?$/,
  });
  const page = visibleNav.some(([key]) => key === requestedPage) ? requestedPage : 'notfound';
  const segments = location.pathname.split('/').filter(Boolean);
  const tableId = segments[0] === 'salao' && segments[1] === 'atendimento' ? segments[2] : null;
  const orderId = segments[0] === 'pedidos' ? segments[1] : null;
  const ticketId = segments[2] === 'fichas' ? segments[3] : null;
  const scopeKey = current
    ? current.actor.tenantId + ':' + current.actor.establishmentId + ':' + current.actor.id
    : '';
  const [requestCenterScope, setRequestCenterScope] = useState<string | null>(null);
  const sidebar = useSidebarPreference(scopeKey);
  const [cachedData, setData] = useState<Data>({});
  const [bootSettled, setBootSettled] = useState('');
  useLayoutEffect(() => {
    if (!current || (bootSettled === scopeKey && !['/', '/entrar'].includes(location.pathname)))
      finishBranchTransition();
  }, [Boolean(current), bootSettled, scopeKey, location.pathname]);
  const data = cachedData._scope === scopeKey ? cachedData : {};
  useEffect(() => {
    if (!current) setData({});
  }, [Boolean(current)]);
  const selected =
    page === 'floor'
      ? ((data.tables ?? []).find((table: Data) => table.id === tableId) ?? null)
      : null;
  const setSelected = (table: Data | null) =>
    void navigate(table ? `/salao/atendimento/${table.id}` : '/salao');
  const [loadedDocument, setDocument] = useState<Data | null>(null);
  const document =
    page === 'orders' && loadedDocument?.id === (ticketId ?? orderId) ? loadedDocument : null;
  const [documentLoading, setDocumentLoading] = useState(Boolean(orderId));
  const [documentRequest, retryDocument] = useState(0);
  const [cancellingOrder, setCancellingOrder] = useState<Data | null>(null);
  useEffect(() => {
    setCancellingOrder(null);
  }, [orderId]);
  const { run, refresh, busy, feedback } = useAction();
  const forms = useFormDialog();
  const paths = [
    'dashboard',
    'tables',
    'products',
    'categories',
    'orders',
    'tickets',
    'service-requests',
    'payments',
    'inventory/balances',
    'inventory/catalog',
    'inventory/movements',
    'stock-locations',
    'cash-registers',
    'cash/sessions',
    'cash/movements',
    'printers',
    'print/jobs',
    'roles',
    'staff',
    'production/jobs',
    'settings',
    'areas',
    'product-variants',
    'modifier-groups',
    'modifiers',
    'product-modifiers',
    'recipes',
    'recipe-items',
  ];
  async function load() {
    if (!current) return;
    await refresh(async () => {
      const relevant = new Set([
        'dashboard',
        'tables',
        'products',
        'categories',
        'settings',
        'orders',
        'service-requests',
        ...((
          {
            floor: ['areas'],
            orders: ['tickets'],
            menu: [
              'product-variants',
              'modifier-groups',
              'modifiers',
              'product-modifiers',
              'inventory/balances',
            ],
            payments: ['payments'],
            inventory: [
              'inventory/catalog',
              'inventory/balances',
              'inventory/movements',
              'stock-locations',
              'recipes',
              'recipe-items',
            ],
            cash: ['cash-registers', 'cash/sessions', 'cash/movements'],
            printing: ['printers', 'print/jobs'],
            team: ['roles', 'staff'],
            production: ['production/jobs'],
          } as Record<string, string[]>
        )[page] ?? []),
      ]);
      if (
        page === 'finance' ||
        page === 'cash' ||
        page === 'payments' ||
        page === 'production' ||
        page === 'complements' ||
        page === 'team'
      )
        for (const path of relevant) if (path !== 'settings') relevant.delete(path);
      if (page === 'overview')
        for (const path of relevant)
          if (!['dashboard', 'tables', 'service-requests'].includes(path)) relevant.delete(path);
      if (page === 'menu')
        for (const unused of ['dashboard', 'orders', 'product-variants', 'product-modifiers'])
          relevant.delete(unused);
      if (page === 'inventory')
        for (const unused of [
          'dashboard',
          'orders',
          'products',
          'categories',
          'stock-locations',
          'recipes',
          'recipe-items',
          'inventory/movements',
        ])
          relevant.delete(unused);
      const entries = await Promise.all(
        paths
          .filter((p) => {
            const permission: Record<string, string> = {
              dashboard: 'reports.view',
              tables: 'table.view',
              products: can('catalog.manage') ? 'catalog.manage' : 'order.create',
              categories: 'catalog.manage',
              settings: 'settings.update',
              orders: 'table.view',
              tickets: 'ticket.view',
              'service-requests': 'ticket.redeem',
              payments: 'payment.receive',
              'inventory/balances': 'inventory.view',
              'inventory/catalog': 'inventory.view',
              'inventory/movements': 'inventory.view',
              'stock-locations': 'inventory.adjust',
              'cash-registers': 'cash.manage',
              'cash/sessions': 'cash.manage',
              'cash/movements': 'cash.manage',
              printers: 'print.manage',
              'print/jobs': 'print.manage',
              roles: 'staff.manage',
              staff: 'staff.manage',
              'production/jobs': 'production.manage',
              areas: 'table.manage',
              recipes: 'catalog.manage',
              'recipe-items': 'catalog.manage',
            };
            return relevant.has(p) && can(permission[p] ?? 'catalog.manage');
          })
          .map(async (p) => [
            p,
            await api(
              `/${p === 'products' && !can('catalog.manage') ? 'products/operational' : p}`,
            ),
          ]),
      );
      setData((previous) => ({
        ...(previous._scope === scopeKey ? previous : {}),
        _scope: scopeKey,
        ...Object.fromEntries(entries),
      }));
    });
    setBootSettled(scopeKey);
  }
  const delivery = useTicketDelivery(() => {
    void load();
    retryDocument((value) => value + 1);
  });
  useClientRequestAlerts(
    current
      ? current.actor.tenantId + ':' + current.actor.establishmentId + ':' + current.actor.id
      : '',
    data['service-requests'] ?? [],
  );
  useRefresh(load, [Boolean(current), page]);
  useEffect(() => {
    setDocument(null);
    if (!current || !orderId || page !== 'orders') return;
    setDocumentLoading(true);
    let active = true;
    void run(async () => {
      const value = await api(ticketId ? `/tickets/${ticketId}` : `/orders/${orderId}`);
      if (active) setDocument(value);
    }).finally(() => {
      if (active) setDocumentLoading(false);
    });
    return () => {
      active = false;
    };
  }, [Boolean(current), page, orderId, ticketId, documentRequest]);
  if (!current || companySelectionRequested())
    return (
      <Login
        onLogin={(value) => {
          setCurrent(value);
        }}
      />
    );
  const list = (p: string): Data[] => data[p] ?? [];
  const opts = (p: string) =>
    list(p).map((x) => ({ id: x.id, name: x.name ?? x.number ?? x.id.slice(0, 8) }));
  const currentPage = nav.find((n) => n[0] === page) ?? ['notfound', 'help', 'Tela não encontrada'];
  return (
    <AiAssistantProvider allowed={Boolean(current?.actor?.isAccountAdmin)} scopeKey={scopeKey}>
      <ManagementShortcutProvider
        key={scopeKey}
        destinations={visibleNav.map(([id, icon, label]) => ({
          id,
          icon: icon as IconName,
          label,
          path: adminPaths[id],
        }))}
        canRead={can('ticket.view') && can('ticket.redeem')}
        onNavigate={(path) => {
          setSidebarOpen(false);
          void navigate(path);
        }}
        onDelivered={load}
        onCounter={
          can('order.create') && can('payment.receive') ? () => setCounterOpen(true) : undefined
        }
      >
        <PrintBridgeProvider key={scopeKey} scope={scopeKey} allowed={can('print.manage')}>
          <div
            className={`admin-layout ${sidebarOpen ? 'sidebar-open' : ''} ${sidebar.compact ? 'sidebar-collapsed' : ''}`}
          >
            {sidebarOpen && (
              <button
                className="sidebar-backdrop"
                aria-label="Fechar menu"
                onClick={() => setSidebarOpen(false)}
              />
            )}
            <aside id="admin-sidebar" className="sidebar" aria-label="Menu lateral">
              <div className="sidebar-brand">
                <BranchSwitcher />
                <button
                  className="icon-button mobile-menu-close"
                  aria-label="Fechar menu"
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon name="close" />
                </button>
              </div>
              <nav aria-label="Navegação principal">
                {visibleNav.filter(([key]) => key === 'overview').map(renderNavItem)}
                {[
                  { label: 'Operação', icon: 'tables', pages: ['floor', 'orders', 'production'] },
                  {
                    label: 'Gerenciamento',
                    icon: 'folder',
                    pages: ['menu', 'inventory', 'printing'],
                  },
                  { label: 'Financeiro', icon: 'payments', pages: ['finance', 'payments', 'cash'] },
                ].map((group) => {
                  const entries = visibleNav.filter(([key]) => group.pages.includes(key));
                  if (!entries.length) return null;
                  const closed = !sidebar.compact && collapsed.includes(group.label);
                  return (
                    <div
                      className="nav-group"
                      key={group.label}
                      role="group"
                      aria-label={group.label}
                    >
                      <button
                        className="nav-group-toggle"
                        aria-expanded={!closed}
                        onClick={() =>
                          setCollapsed(
                            closed
                              ? collapsed.filter((name) => name !== group.label)
                              : [...collapsed, group.label],
                          )
                        }
                      >
                        <Icon name={group.icon as IconName} />
                        <span>{group.label}</span>
                        <Icon name="chevron" size={16} />
                      </button>
                      {!closed && (
                        <div className="nav-group-items">{entries.map(renderNavItem)}</div>
                      )}
                    </div>
                  );
                })}
                {visibleNav
                  .filter(([key]) => ['team', 'complements', 'settings'].includes(key))
                  .map(renderNavItem)}
              </nav>
              <div className="sidebar-bottom">
                <div className="sidebar-user">
                  <strong>{current.name ?? 'Administrador'}</strong>
                  <span>
                    {current.slug ?? 'Estabelecimento'}
                    <Clock />
                  </span>
                </div>
                <button
                  className="logout-button"
                  aria-label="Sair"
                  title="Sair"
                  onClick={() => void signOut()}
                >
                  <Icon name="logout" size={18} />
                  <span className="sidebar-logout-label">Sair</span>
                </button>
              </div>
            </aside>
            <main className="admin-main">
              <header className="topbar">
                <div className="topbar-heading">
                  <button
                    className="icon-button desktop-menu-button"
                    aria-label={
                      sidebar.collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'
                    }
                    title={sidebar.collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
                    aria-expanded={!sidebar.collapsed}
                    aria-controls="admin-sidebar"
                    onClick={sidebar.toggle}
                  >
                    <Icon name={sidebar.collapsed ? 'sidebar-open' : 'sidebar-close'} />
                  </button>
                  <button
                    className="icon-button mobile-menu-button"
                    aria-label="Abrir menu"
                    aria-controls="admin-sidebar"
                    aria-expanded={sidebarOpen}
                    onClick={() => setSidebarOpen(true)}
                  >
                    <Icon name="bars" />
                  </button>
                  <div>
                    <span className="topbar-label">MESA</span>
                    <span className="topbar-title">
                      {page === 'overview' ? 'Dashboard' : currentPage[2]}
                    </span>
                  </div>
                </div>
                <div className="header-actions">
                  {(can('settings.update') || can('cash.manage')) && (
                    <OperationControl key={scopeKey} scopeKey={scopeKey} onChange={load} />
                  )}
                  {can('print.manage') && (
                    <PrintBridgeIndicator
                      onOpen={() => void navigate('/impressao?aba=printbridge')}
                    />
                  )}
                  <PushDeviceButton key={scopeKey} surface="admin" />
                  <span className="topbar-venue">{data.settings?.name ?? current.slug}</span>
                  <div className="notifications">
                    <button
                      className="icon-button"
                      aria-label="Notificações"
                      aria-expanded={notificationsOpen}
                      onClick={() => setNotificationsOpen(!notificationsOpen)}
                    >
                      <Icon name="bell" />
                      {data.dashboard?.service_requests > 0 && <i className="notification-dot" />}
                    </button>
                    {notificationsOpen && (
                      <section
                        className="notification-panel"
                        role="region"
                        aria-label="Resumo de atendimento"
                      >
                        <h3>Resumo de atendimento</h3>
                        <p>
                          {data.dashboard?.service_requests ?? 0} chamado(s) aguardando atendimento.
                        </p>
                        <p>{data.dashboard?.pending_prints ?? 0} impressão(ões) pendente(s).</p>
                        {can('ticket.redeem') && (
                          <button
                            onClick={() => {
                              setRequestCenterScope(scopeKey);
                              setNotificationsOpen(false);
                            }}
                          >
                            <Icon name="bell" size={16} />
                            Ver solicitações
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setPage('floor');
                            setNotificationsOpen(false);
                          }}
                        >
                          Ver salão
                        </button>
                      </section>
                    )}
                  </div>
                  <ThemeToggle />
                </div>
              </header>
              <div className="page-content">
                <Connectivity />
                {page !== 'orders' &&
                  page !== 'menu' &&
                  page !== 'inventory' &&
                  page !== 'finance' &&
                  page !== 'cash' &&
                  page !== 'payments' &&
                  page !== 'production' &&
                  page !== 'team' &&
                  page !== 'complements' && (
                    <PageTitle
                      eyebrow={page === 'menu' || page === 'team' ? 'CADASTRO' : 'OPERAÇÃO'}
                      title={page === 'overview' ? 'Dashboard' : currentPage[2]}
                      subtitle={
                        page === 'overview'
                          ? 'Indicadores de mesas, pedidos, atendimento e operação.'
                          : (
                              {
                                floor:
                                  'Escolha a mesa para lançar pedidos, acompanhar comandas ou encerrar o atendimento.',
                                orders:
                                  'Pedidos e fichas organizados por mesa e comanda. Consulte os itens e acompanhe cada entrega.',
                                menu: 'Organize produtos, preços, variações e adicionais do cardápio.',
                                payments:
                                  'Confira recebimentos e estornos antes de encerrar as comandas.',
                                cash: 'Abra um turno, registre movimentações e confira o dinheiro no fechamento.',
                                inventory:
                                  'Acompanhe saldos e registre entradas, perdas e ajustes com motivo.',
                                settings:
                                  'Defina as políticas e a aparência deste estabelecimento.',
                                printing:
                                  'Configure os dispositivos e acompanhe a fila de impressão.',
                                production:
                                  'Inicie o preparo e sinalize os itens prontos para entrega.',
                                team: 'Cadastre pessoas e defina o que cada perfil pode acessar.',
                              } as Record<string, string>
                            )[page]
                      }
                      action={
                        page !== 'overview' && (
                          <button onClick={() => void load()} disabled={busy}>
                            <Icon name="refresh" size={16} /> Recarregar
                          </button>
                        )
                      }
                    />
                  )}
                {feedback}
                <ClientRequestBanner
                  tables={list('tables')}
                  onOpen={can('ticket.redeem') ? () => setRequestCenterScope(scopeKey) : undefined}
                />
                {page === 'notfound' && (
                  <RouteNotFound onHome={() => setPage(visibleNav[0]?.[0] ?? 'overview')} />
                )}
                {page === 'overview' && (
                  <DashboardOverview
                    key={scopeKey}
                    scopeKey={scopeKey}
                    onOpen={(path) => void navigate(path)}
                  />
                )}
                {page === 'floor' && tableId && data.tables && !selected && (
                  <RouteNotFound onHome={() => setPage('floor')} />
                )}
                {page === 'floor' && (
                  <Tabs label="Salão">
                    <Tab id="floor-0" label="Mapa do salão" icon="tables">
                      <FloorOverview
                        tables={list('tables')}
                        areas={list('areas')}
                        onSelect={setSelected}
                      />
                    </Tab>
                    {can('table.manage') && (
                      <Tab id="floor-layout" label="Posicionar mesas" icon="edit">
                        <FloorEditor
                          tables={list('tables')}
                          areas={list('areas')}
                          onChange={load}
                        />
                      </Tab>
                    )}
                    <Tab id="floor-1" label="Mesas" icon="tables">
                      <Resource
                        path="tables"
                        readOnly={!can('table.manage')}
                        title="Mesas do salão"
                        renderActions={(table) => (
                          <DeleteTableButton table={table} onChange={load} />
                        )}
                        loading={data.tables === undefined}
                        records={list('tables')}
                        onChange={load}
                        fields={[
                          { key: 'number', label: 'Número', required: true },
                          {
                            key: 'capacity',
                            label: 'Lugares',
                            type: 'number',
                            min: 1,
                            max: 100,
                            required: true,
                            initial: 4,
                          },
                          { key: 'area_id', label: 'Área', type: 'select', options: opts('areas') },
                          {
                            key: 'shape',
                            label: 'Formato',
                            type: 'select',
                            initial: 'square',
                            options: [
                              { id: 'square', name: 'Quadrada' },
                              { id: 'round', name: 'Redonda' },
                            ],
                          },
                          { key: 'enabled', label: 'Ativa', type: 'checkbox', initial: true },
                        ]}
                      />
                    </Tab>
                    <Tab id="floor-2" label="Áreas" icon="folder">
                      <Resource
                        path="areas"
                        readOnly={!can('table.manage')}
                        title="Áreas"
                        loading={data.areas === undefined}
                        records={list('areas')}
                        onChange={load}
                        fields={[{ key: 'name', label: 'Nome', required: true }]}
                      />
                    </Tab>
                  </Tabs>
                )}
                {page === 'orders' && (
                  <OrdersWorkspace
                    onNewCounter={
                      can('order.create') && can('payment.receive')
                        ? () => setCounterOpen(true)
                        : undefined
                    }
                    onReload={load}
                    loading={data.orders === undefined}
                    canViewTickets={can('ticket.view')}
                    orders={list('orders')}
                    onDeliver={can('ticket.redeem') ? delivery.deliver : undefined}
                    tickets={list('tickets')}
                    tables={list('tables')}
                    onOrder={(order) => void showOrder(order)}
                    onTicket={
                      can('ticket.view')
                        ? (ticket) =>
                            void navigate(`/pedidos/${ticket.order_id}/fichas/${ticket.id}`)
                        : undefined
                    }
                    onNew={
                      can('order.create')
                        ? () =>
                            forms.open({
                              title: 'Em qual mesa será o pedido?',
                              description:
                                'Selecione a mesa. Na próxima etapa você escolhe a comanda e monta o pedido.',
                              fields: [
                                {
                                  key: 'table_id',
                                  label: 'Mesa do pedido',
                                  type: 'select',
                                  required: true,
                                  options: list('tables')
                                    .filter(
                                      (table) =>
                                        table.enabled &&
                                        !['CLOSING', 'AWAITING_RELEASE'].includes(table.status),
                                    )
                                    .map((table) => ({
                                      id: table.id,
                                      name:
                                        'Mesa ' +
                                        table.number +
                                        ' · ' +
                                        (table.status === 'FREE' ? 'Livre' : 'Em atendimento'),
                                    })),
                                },
                              ],
                              submitLabel: 'Continuar para o pedido',
                              successMessage:
                                'Mesa selecionada. Monte o pedido e confira os itens antes de confirmar.',
                              onSubmit: async (values) => values,
                              onSuccess: (values) => setSelected({ id: values.table_id }),
                            })
                        : undefined
                    }
                  />
                )}
                {page === 'menu' && (
                  <section className="catalog-page">
                    <PageTitle
                      className="module-page-title"
                      eyebrow="CADASTRO / CARDÁPIO"
                      title="Cardápio"
                      subtitle="Gerencie produtos, categorias, variações e adicionais do cardápio."
                    />
                    <Tabs label="Cardápio">
                      <Tab id="menu-0" label="Produtos" icon="menu">
                        <ProductsWorkspace
                          loading={data.products === undefined}
                          products={list('products')}
                          categories={list('categories')}
                          balances={list('inventory/balances')}
                          canViewInventory={can('inventory.view')}
                          onChange={load}
                        />
                      </Tab>
                      <Tab id="menu-1" label="Categorias" icon="folder">
                        <Resource
                          path="categories"
                          title="Categorias"
                          loading={data.categories === undefined}
                          records={list('categories')}
                          onChange={load}
                          fields={[
                            { key: 'name', label: 'Nome', required: true },
                            {
                              key: 'sort_order',
                              label: 'Ordem',
                              type: 'number',
                              initial: 0,
                              min: -2147483648,
                              max: 2147483647,
                            },
                            recordColorField,
                          ]}
                        />
                      </Tab>
                      <Tab id="menu-2" label="Adicionais" icon="plus">
                        <CatalogAddons
                          groups={list('modifier-groups')}
                          modifiers={list('modifiers')}
                          onChange={load}
                        />
                      </Tab>
                    </Tabs>
                  </section>
                )}
                {page === 'inventory' && (
                  <InventoryOverview
                    loading={data['inventory/balances'] === undefined}
                    balances={list('inventory/balances')}
                    catalog={data['inventory/catalog'] ?? {}}
                    onChange={load}
                  />
                )}
                {page === 'payments' && <PaymentsWorkspace key={scopeKey} can={can} />}
                {page === 'finance' && <FinanceWorkspace can={can} />}
                {page === 'cash' && <CashWorkspace key={scopeKey} />}
                {page === 'production' && <ProductionWorkspace key={scopeKey} />}
                {page === 'printing' && (
                  <Tabs label="Impressão">
                    <Tab id="printbridge" label="PrintBridge" icon="printing">
                      <PrintBridgePanel printers={list('printers')} />
                    </Tab>
                    <Tab id="printing-0" label="Impressoras" icon="printing">
                      <Resource
                        path="printers"
                        title="Impressoras por setor"
                        loading={data.printers === undefined}
                        records={list('printers')}
                        onChange={load}
                        fields={[
                          { key: 'name', label: 'Nome', required: true },
                          { key: 'sector', label: 'Setor', required: true, initial: 'bar' },
                          { key: 'enabled', label: 'Ativa', type: 'checkbox', initial: true },
                        ]}
                      />
                    </Tab>
                    <Tab id="printing-2" label="Fila de impressão" icon="receipt">
                      <PrintQueue
                        jobs={list('print/jobs')}
                        printers={list('printers')}
                        loading={data['print/jobs'] === undefined}
                        onChange={load}
                        scopeKey={scopeKey}
                      />
                    </Tab>
                  </Tabs>
                )}
                {page === 'team' && <TeamWorkspace key={scopeKey} />}
                {page === 'complements' && <ComplementsWorkspace key={scopeKey} />}
                {page === 'settings' && data.settings && (
                  <Tabs label="Configurações">
                    <Tab id="general" label="Negócio e aplicativo" icon="settings">
                      <BusinessSettings key={scopeKey} settings={data.settings} onChange={load} />
                    </Tab>
                    <Tab id="operation" label="Funcionamento e cardápio" icon="clock">
                      <OperationSettings key={scopeKey} settings={data.settings} onChange={load} />
                    </Tab>
                    {current.actor.isAccountAdmin && (
                      <Tab id="push" label="Notificações push" icon="bell">
                        <PushSettings key={scopeKey} />
                      </Tab>
                    )}
                    <Tab id="appearance" label="Aparência" icon="settings">
                      <AppearanceSettings
                        primary={data.settings.primary_color}
                        sidebar={data.settings.sidebar_color}
                        onChange={load}
                      />
                    </Tab>
                  </Tabs>
                )}
              </div>
            </main>
            {counterOpen && (
              <CounterSaleModal
                onClose={() => setCounterOpen(false)}
                onSaved={(order) => {
                  flushSync(() => setCounterOpen(false));
                  void load();
                  void showOrder(order);
                }}
              />
            )}
            {selected && (
              <Modal
                routeBound
                className="table-management-modal"
                title={`Mesa ${selected.number}`}
                heading={
                  <>
                    <span className="table-modal-symbol">
                      <Icon name="tables" size={26} />
                    </span>
                    <span>
                      Gerenciar pedidos — Mesa {selected.number}
                      <small>Pedidos, comandas e atendimento</small>
                    </span>
                  </>
                }
                onClose={() => setSelected(null)}
              >
                <TablePanel
                  key={selected.id}
                  table={selected}
                  menu={list('products')}
                  onChange={load}
                  onFinalized={() => setSelected(null)}
                  onOrder={(id) => void showOrder({ id })}
                />
              </Modal>
            )}
            {page === 'orders' && orderId && !document && (
              <Modal
                routeBound
                title={ticketId ? 'Ficha' : 'Pedido'}
                onClose={() => void navigate('/pedidos')}
              >
                {documentLoading ? (
                  <p role="status">Abrindo o documento…</p>
                ) : (
                  <div className="stack">
                    <h3>Não foi possível abrir este documento</h3>
                    <p className="muted">
                      Confira o endereço e se seu perfil tem acesso ao pedido e às fichas nesta
                      unidade.
                    </p>
                    <button onClick={() => retryDocument((value) => value + 1)}>
                      <Icon name="refresh" size={17} />
                      Tentar novamente
                    </button>
                  </div>
                )}
              </Modal>
            )}
            {document && (
              <Modal
                routeBound
                className={document.public_number ? undefined : 'order-detail-modal'}
                focusClose={!document.public_number}
                heading={
                  document.public_number ? undefined : <OrderDetailHeading order={document} />
                }
                title={
                  document.public_number
                    ? `Ficha ${document.public_number}`
                    : `Pedido ${document.id.slice(0, 8)}`
                }
                onClose={() => void navigate(ticketId ? `/pedidos/${orderId}` : '/pedidos')}
              >
                {document.public_number ? (
                  <div className="ticket-document">
                    <h3>{document.product}</h3>
                    <p>
                      {orderLocationLabel(document)} · {document.tab_label} · Pedido{' '}
                      {shortId(document.order_id)}
                    </p>
                    <p className="muted small">
                      Ficha {document.public_number} · Uma unidade deste produto.
                    </p>
                    <Badge status={document.status} />
                    {can('ticket.redeem') &&
                      !['REDEEMED', 'CANCELLED'].includes(document.status) && (
                        <button
                          className="primary"
                          disabled={!canDeliverTicket(document, current.actor.id)}
                          onClick={() => delivery.deliver(document)}
                        >
                          <Icon name="ready" size={17} />
                          Marcar como entregue
                        </button>
                      )}
                    <Code value={document.token} />
                    <Code value={document.token} barcode />
                    <button
                      onClick={() =>
                        forms.open({
                          title: 'Solicitar segunda via',
                          description:
                            'A segunda via conserva a mesma ficha e o mesmo direito de consumo.',
                          fields: [
                            {
                              key: 'reason',
                              label: 'Motivo da segunda via',
                              type: 'textarea',
                              required: true,
                              minLength: 3,
                            },
                          ],
                          successMessage: 'Segunda via adicionada à fila.',
                          onSubmit: (values) => api('/tickets/' + document.id + '/reprint', values),
                        })
                      }
                    >
                      <Icon name="printing" size={17} /> Solicitar segunda via
                    </button>
                  </div>
                ) : (
                  <>
                    <OrderSummary
                      onUpdate={(value) =>
                        setDocument((current) => (current?.id === value.id ? value : current))
                      }
                      onDeliver={can('ticket.redeem') ? delivery.deliver : undefined}
                      order={document}
                      onTicket={
                        can('ticket.view')
                          ? (ticket) => void navigate(`/pedidos/${document.id}/fichas/${ticket.id}`)
                          : undefined
                      }
                    />
                    <div className="modal-footer">
                      {can('table.view') && (
                        <button
                          disabled={!document.table_id}
                          onClick={() => setSelected({ id: document.table_id })}
                        >
                          <Icon name="tables" size={17} />
                          Abrir atendimento atual da mesa
                        </button>
                      )}
                      {document.status === 'DRAFT' && can('order.create') && (
                        <button
                          onClick={() =>
                            void run(async () => {
                              await api(`/orders/${document.id}/confirm`, {});
                              void navigate('/pedidos');
                              await load();
                            })
                          }
                        >
                          <Icon name="check" size={17} />
                          Confirmar pedido
                        </button>
                      )}
                      {document.status !== 'CANCELLED' && can('order.cancel') && (
                        <button className="danger" onClick={() => setCancellingOrder(document)}>
                          <Icon name="close" size={17} />
                          Cancelar pedido
                        </button>
                      )}
                    </div>
                  </>
                )}
                {feedback}
              </Modal>
            )}
            {cancellingOrder && (
              <OrderCancellationDialog
                order={cancellingOrder}
                onClose={() => setCancellingOrder(null)}
                onCancelled={() => {
                  void load();
                  void navigate('/pedidos');
                }}
                onUpdated={() => void load()}
              />
            )}
            {forms.dialog}
            {requestCenterScope === scopeKey && can('ticket.redeem') && (
              <Modal
                title="Solicitações de clientes"
                className="request-center-modal"
                onClose={() => setRequestCenterScope(null)}
              >
                <ClientRequestList
                  requests={list('service-requests')}
                  loading={data['service-requests'] === undefined}
                  onChange={load}
                  onDeliver={delivery.deliver}
                  onOrder={
                    can('table.view')
                      ? (ticket) => {
                          setRequestCenterScope(null);
                          void showOrder({ id: ticket.order_id });
                        }
                      : undefined
                  }
                  onTicket={
                    can('ticket.view')
                      ? (ticket) => {
                          setRequestCenterScope(null);
                          void navigate(`/pedidos/${ticket.order_id}/fichas/${ticket.id}`);
                        }
                      : undefined
                  }
                  onTable={
                    can('table.view')
                      ? (ticket) => {
                          setRequestCenterScope(null);
                          setSelected({ id: ticket.table_id });
                        }
                      : undefined
                  }
                />
              </Modal>
            )}
            {delivery.dialog}
            <ManagementShortcutBar />
          </div>
        </PrintBridgeProvider>
      </ManagementShortcutProvider>
    </AiAssistantProvider>
  );
  function renderNavItem([key, icon, label]: string[]) {
    return (
      <button
        key={key}
        aria-current={page === key ? 'page' : undefined}
        className={page === key ? 'active' : ''}
        aria-label={label}
        title={
          key === 'floor'
            ? label + ' — F2'
            : key === 'menu'
              ? label + ' — F3'
              : sidebar.compact
                ? label
                : undefined
        }
        aria-keyshortcuts={key === 'floor' ? 'F2' : key === 'menu' ? 'F3' : undefined}
        onClick={() => {
          setPage(key);
          setSidebarOpen(false);
        }}
      >
        <Icon name={icon as IconName} size={19} />
        <span className="nav-item-label">{label}</span>
        {(key === 'floor' || key === 'menu') && (
          <kbd className="management-nav-key" aria-hidden="true">
            {key === 'floor' ? 'F2' : 'F3'}
          </kbd>
        )}
      </button>
    );
  }
  async function showOrder(o: Data) {
    void navigate(`/pedidos/${o.id}`);
  }
}
