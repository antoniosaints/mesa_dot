import { BusinessInformation } from './business-information.js';
import {
  customerTicketGroups,
  pendingCustomerTickets,
  requestCustomerTicket,
  type CustomerTicketGroup,
} from './customer-contexts.js';
import { ProductPhotoImage } from './product-photo.js';
import { productLabel, productSearchText } from './product-label.js';
import { OnlinePaymentDialog } from './online-payment.js';
import { CustomerConsumption } from './customer-consumption.js';
import { NumericInput } from './numeric-input.js';
import { normalizeOrderSearch } from './orders-view.js';
import {
  businessAvailability,
  readBusinessHours,
  weekdayNames,
  dayHoursLabel,
} from '../../shared/src/business-hours.js';
import { PhoneInput } from './phone-input.js';
import { CustomerTickets } from './customer-tickets.js';
import { TableQrReader } from './table-qr-reader.js';
import {
  StockHint,
  productHasStock,
  remainingStock,
  stockIssue,
  validateSaleStock,
  stockFailure,
} from './sale-stock.js';
import { useToasts } from './toasts.js';
import { ColorDot } from './record-tags.js';
import { InstallPwaButton } from './pwa-install.js';
import { pwaContext } from './pwa-context.js';
import { usePageRoute, RouteNotFound } from './routing.js';
import { SearchSelect } from './controls.js';
import { appearanceStore } from './preferences.js';
import { AppHeader, Icon } from './appearance.js';
import { useEffect, useRef, useState } from 'react';
import { api, brl, session, saveSession, useStorageKey, type Data } from './client.js';
import { Badge, Code, Connectivity, Empty, Modal, useAction, useRefresh } from './common.js';
export function CustomerApp() {
  const toast = useToasts();
  const {
    page,
    setPage,
    navigate,
    location: routeLocation,
  } = usePageRoute(
    { menu: '/cardapio', tickets: '/minhas-fichas', consumption: '/consumo' },
    'menu',
  );
  const params = new URLSearchParams(routeLocation.search);
  const slug = pwaContext()?.slug ?? params.get('bar') ?? 'boteco-da-esquina';
  const tableCode = params.get('table') ?? '';
  const customerScope = `bar-customer:${pwaContext()?.establishment_id ?? slug}`;
  const scopeKey = `${customerScope}:${tableCode}`;
  useStorageKey(scopeKey);
  const activeScope = useRef(scopeKey),
    previousScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const [visitor, setVisitor] = useState<Data | null>(session());
  const [identifying, setIdentifying] = useState(Boolean(tableCode) && !session());
  const [identifyMode, setIdentifyMode] = useState<'TABLE' | 'COUNTER'>(
    tableCode ? 'TABLE' : 'COUNTER',
  );
  const [readingTable, setReadingTable] = useState(false);
  const [scannedTable, setScannedTable] = useState<string | null>(null);
  const [contextChange, setContextChange] = useState<{
    code: string;
    destination: 'menu' | 'tickets';
  } | null>(null);
  const [identity, setIdentity] = useState({ name: '', phone: '', join_code: '' });
  const [menu, setMenu] = useState<Data | null>(null);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<Data | null>(null);
  const [variant, setVariant] = useState('');
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [productQuantity, setProductQuantity] = useState('1');
  const [cart, setCart] = useState<Data[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [tickets, setTickets] = useState<Data[]>([]);
  const [ticketSnapshot, setTicketSnapshot] = useState<{
    scope: string;
    groups: CustomerTicketGroup[];
  }>({ scope: '', groups: [] });
  const ticketSnapshotRef = useRef(ticketSnapshot);
  ticketSnapshotRef.current = ticketSnapshot;
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const ticketRead = useRef(0);
  const ticketGroups = ticketSnapshot.scope === customerScope ? ticketSnapshot.groups : [];
  const hasCustomer = Boolean(visitor || ticketGroups.length);
  const [tabs, setTabs] = useState<Data[]>([]);
  const [orders, setOrders] = useState<Data[]>([]);
  const [intent, setIntent] = useState<Data | null>(null);
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  const [chosenTab, setChosenTab] = useState('');
  const [activeTicket, setActiveTicket] = useState<Data | null>(null);
  const { run, refresh, busy, feedback } = useAction();
  const checkoutAttempt = useRef<{
    signature: string;
    key: string;
    intentKey: string;
    orderId?: string;
  }>({ signature: '', key: crypto.randomUUID(), intentKey: crypto.randomUUID() });
  const isCounter = Boolean(visitor && !visitor.table_id);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    const stored = session();
    const changed = previousScope.current !== scopeKey;
    previousScope.current = scopeKey;
    setVisitor(stored);
    setIdentifyMode(tableCode ? 'TABLE' : 'COUNTER');
    setIdentifying(!stored && (Boolean(tableCode) || changed));
    setTabs([]);
    setTickets([]);
    setOrders([]);
    setChosenTab('');
    setIntent(null);
    setPaymentCompleted(false);
    setCartOpen(false);
    setActiveTicket(null);
    setContextChange(null);
  }, [scopeKey]);
  function applyContext(code = '', destination: 'menu' | 'tickets' = 'menu') {
    setContextChange(null);
    setReadingTable(false);
    setProduct(null);
    if (code === tableCode) {
      setIdentifyMode(code ? 'TABLE' : 'COUNTER');
      if (!visitor) setIdentifying(true);
      else setPage(destination);
      return;
    }
    const query = new URLSearchParams(routeLocation.search);
    if (code) query.set('table', code);
    else query.delete('table');
    void navigate({
      pathname: destination === 'tickets' ? '/minhas-fichas' : '/cardapio',
      search: query.toString(),
    });
  }
  function selectContext(code = '', destination: 'menu' | 'tickets' = 'menu') {
    setReadingTable(false);
    if (visitor && code !== tableCode) {
      setContextChange({ code, destination });
      return;
    }
    applyContext(code, destination);
  }
  useEffect(() => {
    if (scannedTable === null || readingTable) return;
    // Navigate after the scanner unmounts and releases its in-flight navigation guard.
    selectContext(scannedTable);
    setScannedTable(null);
  }, [scannedTable, readingTable]);
  async function checkout(customer: Data | null = visitor) {
    if (!customer) {
      setCartOpen(false);
      setIdentifyMode(tableCode ? 'TABLE' : 'COUNTER');
      setIdentifying(true);
      return;
    }
    const items = cart.map(({ product_id, quantity, variant_id, modifiers, notes }) => ({
      product_id,
      quantity,
      ...(variant_id ? { variant_id } : {}),
      modifiers,
      notes,
    }));
    const counter = !customer.table_id;
    const body = counter
      ? { items }
      : {
          table_id: customer.table_id,
          ...(chosenTab ? { tab_id: chosenTab } : {}),
          source: 'CUSTOMER',
          payment_policy: 'PREPAID',
          items,
        };
    const signature = JSON.stringify([customer.visitor_id, body]);
    if (checkoutAttempt.current.signature !== signature)
      checkoutAttempt.current = {
        signature,
        key: crypto.randomUUID(),
        intentKey: crypto.randomUUID(),
      };
    const attempt = checkoutAttempt.current;
    try {
      if (!attempt.orderId) {
        await validateSaleStock(`/public/${slug}/menu`, cart, setMenu);
        const order = await api(
          counter ? '/public/counter/orders' : '/public/orders',
          body,
          'POST',
          attempt.key,
        );
        attempt.orderId = order.id;
      }
      const payment = await api(
        '/payments/intents',
        { order_id: attempt.orderId },
        'POST',
        attempt.intentKey,
      );
      setIntent(payment);
      setCartOpen(false);
      setCart([]);
      checkoutAttempt.current = {
        signature: '',
        key: crypto.randomUUID(),
        intentKey: crypto.randomUUID(),
      };
      await load();
    } catch (error) {
      if (stockFailure(error)) await load();
      throw error;
    }
  }
  async function load() {
    const requestScope = scopeKey;
    const read = ++ticketRead.current;
    setTicketsLoading(true);
    try {
      await refresh(async () => {
        const [catalogResult, groupsResult] = await Promise.allSettled([
          api(`/public/${slug}/menu`),
          customerTicketGroups(
            customerScope,
            ticketSnapshotRef.current.scope === customerScope
              ? ticketSnapshotRef.current.groups
              : [],
          ),
        ]);
        if (activeScope.current !== requestScope || read !== ticketRead.current) return;
        if (groupsResult.status === 'fulfilled') {
          setTicketSnapshot({ scope: customerScope, groups: groupsResult.value });
          setTickets(groupsResult.value.find((group) => group.code === tableCode)?.tickets ?? []);
          if (!session()) {
            setVisitor(null);
            setTabs([]);
            setOrders([]);
          }
        }
        if (catalogResult.status === 'rejected') throw catalogResult.reason;
        const catalog = catalogResult.value;
        setMenu(catalog);
        if (
          pwaContext() &&
          (pwaContext()!.slug !== catalog.establishment.slug ||
            pwaContext()!.name !== catalog.establishment.name)
        )
          window.dispatchEvent(new Event('mesa:pwa-refresh'));
        if (catalog.establishment.primary_color)
          appearanceStore.setPrimary(catalog.establishment.primary_color);
        const requestToken = session()?.token;
        if (requestToken) {
          try {
            const [b, o] = await Promise.all([api('/my-tabs'), api('/my-consumption')]);
            if (
              activeScope.current !== requestScope ||
              read !== ticketRead.current ||
              session()?.token !== requestToken
            )
              return;
            setTabs(b);
            setOrders(o);
          } catch (error) {
            if (
              activeScope.current === requestScope &&
              read === ticketRead.current &&
              session()?.token === requestToken &&
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'UNAUTHORIZED'
            ) {
              saveSession(null);
              setVisitor(null);
              setTickets([]);
              setTabs([]);
              setOrders([]);
            } else throw error;
          }
        }
      });
    } finally {
      if (activeScope.current === requestScope && read === ticketRead.current)
        setTicketsLoading(false);
    }
  }
  useRefresh(load, [scopeKey, visitor?.visitor_id]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [scopeKey]);
  useEffect(() => {
    if (!paymentCompleted) return;
    // Navigate after the payment modal unmounts and releases its in-flight navigation guard.
    setPaymentCompleted(false);
    setPage('tickets');
  }, [paymentCompleted]);
  const paymentReturn = params.get('payment_return');
  useEffect(() => {
    if (!paymentReturn || !visitor?.token || !/^[a-f0-9-]{36}$/i.test(paymentReturn)) return;
    let active = true;
    const next = new URLSearchParams(routeLocation.search);
    for (const key of [
      'payment_return',
      'payment_id',
      'status',
      'collection_id',
      'collection_status',
      'external_reference',
      'merchant_order_id',
      'payment_type',
      'preference_id',
      'processing_mode',
      'site_id',
    ])
      next.delete(key);
    void (async () => {
      try {
        const payment = await api('/payments/intents/' + paymentReturn);
        if (active) setIntent(payment);
      } catch {
        if (active)
          toast.error(
            'Não foi possível consultar o pagamento. Use o mesmo navegador e atendimento em que iniciou o pedido.',
          );
      } finally {
        if (active)
          void navigate(
            { pathname: routeLocation.pathname, search: next.toString() },
            { replace: true },
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [paymentReturn, visitor?.visitor_id, scopeKey]);
  const searchTerm = normalizeOrderSearch(search);
  const shownProducts: Data[] = (menu?.products ?? []).filter(
    (item: Data) =>
      (category === 'all' || item.category_id === category) &&
      normalizeOrderSearch(
        [
          productSearchText(item, menu?.variants),
          item.description,
          menu?.categories.find((entry: Data) => entry.id === item.category_id)?.name,
        ]
          .filter(Boolean)
          .join(' '),
      ).includes(searchTerm),
  );
  const productAvailable = product ? remainingStock(menu, cart, product.id, variant) : 0;
  const productMaximum = Math.min(100, productAvailable);
  const quantityNumber = Number(productQuantity);
  const quantityValid =
    /^\d{1,3}$/.test(productQuantity) && quantityNumber >= 1 && quantityNumber <= productMaximum;
  const productUnitPrice = product
    ? Number(menu?.variants.find((item: Data) => item.id === variant)?.price ?? product.price) +
      modifiers.reduce(
        (sum, id) => sum + Number(menu?.modifiers.find((item: Data) => item.id === id)?.price ?? 0),
        0,
      )
    : 0;
  const cartUnits = cart.reduce((sum, line) => sum + Number(line.quantity), 0);
  const openTickets = ticketGroups.flatMap((group) =>
    group.error ? [] : pendingCustomerTickets(group.tickets),
  );
  const ticketReadErrors = ticketGroups.some((group) => group.error);
  const currentOpenTickets = pendingCustomerTickets(tickets);
  const otherPendingGroups = ticketGroups.filter(
    (group) =>
      group.code !== tableCode && !group.error && pendingCustomerTickets(group.tickets).length > 0,
  );
  const viewedGroup = ticketGroups.find((group) =>
    group.tickets.some((ticket) => ticket.id === activeTicket?.id),
  );
  const viewedTicket = viewedGroup?.tickets.find((ticket) => ticket.id === activeTicket?.id);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [page, scopeKey]);
  const cartTotal = cart.reduce((v, line) => v + Number(line.display_price) * line.quantity, 0);
  const hours = readBusinessHours(menu?.establishment.opening_hours);
  const availability = businessAvailability(
    {
      is_open: menu?.establishment.accepting_orders ?? menu?.establishment.is_open,
      opening_hours: menu?.establishment.opening_hours,
    },
    now,
  );
  const acceptingOrders = availability.is_open;
  return (
    <div
      className={
        'customer-app' +
        (hasCustomer ? ' has-customer-nav' : '') +
        (cart.length ? ' has-customer-cart' : '')
      }
    >
      <AppHeader>
        <span className="venue-pill">
          {visitor ? (isCounter ? 'Retirada' : `Mesa ${visitor.table_number}`) : 'Cardápio online'}
        </span>
      </AppHeader>
      <main className="customer-content">
        <Connectivity />
        {feedback}
        {page === 'menu' || (!hasCustomer && page !== 'tickets') ? (
          <section className="customer-welcome">
            <div className="customer-welcome-tools">
              <span className="eyebrow">BEM-VINDO À CASA</span>
              <div className="customer-welcome-actions">
                <BusinessInformation
                  name={menu?.establishment.name ?? 'Estabelecimento'}
                  profile={menu?.establishment.business_profile}
                />
                <InstallPwaButton />
              </div>
            </div>
            <h1>{menu?.establishment.name ?? 'Preparando seu cardápio…'}</h1>
            <p>{acceptingOrders ? 'Seu próximo pedido começa aqui.' : availability.message}</p>
            <span className={'customer-open-state' + (acceptingOrders ? ' is-open' : '')}>
              <i />
              {!menu
                ? 'Carregando…'
                : acceptingOrders
                  ? 'Aberto para pedidos'
                  : 'Fechado no momento'}
            </span>
            {hours.enabled && (
              <details className="customer-opening-hours">
                <summary>
                  <Icon name="clock" size={15} />
                  Ver horários de funcionamento
                </summary>
                <span>Horário de Brasília</span>
                <dl>
                  {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                    <div key={weekday}>
                      <dt>{weekdayNames[weekday]}</dt>
                      <dd>{dayHoursLabel(hours.days.find((day) => day.weekday === weekday)!)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            <div className="welcome-art">
              <Icon name="menu" size={72} />
            </div>
          </section>
        ) : (
          <div className="customer-page-heading">
            <span className="eyebrow">SEU ATENDIMENTO</span>
            <h1>
              {page === 'tickets'
                ? 'Minhas fichas'
                : page === 'consumption'
                  ? 'Meu consumo'
                  : 'Seu atendimento'}
            </h1>
            <p>
              {page === 'tickets'
                ? 'Acompanhe seus itens e apresente o código na entrega.'
                : 'Veja seus pedidos, pagamentos e o saldo em um só lugar.'}
            </p>
          </div>
        )}
        <section className={'panel customer-service-choice' + (visitor ? ' is-identified' : '')}>
          <span className="customer-service-symbol">
            <Icon name={visitor && !isCounter ? 'tables' : 'orders'} size={21} />
          </span>
          <div>
            <h2>
              {visitor
                ? isCounter
                  ? 'Pedido para retirada'
                  : `Atendimento · Mesa ${visitor.table_number}`
                : 'Como você quer pedir?'}
            </h2>
            <p className="muted">
              {visitor
                ? isCounter
                  ? 'Acompanhe o preparo e apresente sua ficha no balcão para retirar.'
                  : 'Seus pedidos serão vinculados a esta mesa.'
                : 'Consulte o cardápio à vontade. Leia uma mesa ou faça um pedido avulso para retirar no balcão.'}
            </p>
          </div>
          <div className="button-row">
            <button type="button" disabled={busy} onClick={() => setReadingTable(true)}>
              <Icon name="scan" size={18} />
              {visitor && !isCounter ? 'Ler outra mesa' : 'Ler QR da mesa'}
            </button>
            {!visitor && tableCode && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setIdentifyMode('TABLE');
                  setIdentifying(true);
                }}
              >
                <Icon name="tables" size={18} />
                Usar mesa lida
              </button>
            )}
            {!isCounter && (
              <button
                type="button"
                className={!tableCode ? 'primary' : ''}
                disabled={busy}
                onClick={() => selectContext()}
              >
                <Icon name="orders" size={18} />
                Pedir para retirada
              </button>
            )}
          </div>
        </section>
        {page !== 'tickets' && otherPendingGroups.length > 0 && (
          <section
            className="customer-saved-contexts"
            aria-label="Fichas pendentes de outros atendimentos"
          >
            <div>
              <Icon name="ticket" size={18} />
              <span>
                <strong>Você tem fichas a concluir</strong>
                <small>
                  {otherPendingGroups
                    .map(
                      (group) => `${group.label}: ${pendingCustomerTickets(group.tickets).length}`,
                    )
                    .join(' · ')}
                </small>
              </span>
            </div>
            <div className="button-row">
              <button
                type="button"
                onClick={() => {
                  setPage('tickets');
                  void load();
                }}
              >
                <Icon name="ticket" size={16} />
                Ver todas as minhas fichas
              </button>
            </div>
          </section>
        )}
        {hasCustomer && (
          <nav
            className="customer-nav customer-bottom-nav system-tabs"
            aria-label="Navegação do cliente"
          >
            <button
              className={page === 'menu' ? 'active' : ''}
              aria-current={page === 'menu' ? 'page' : undefined}
              onClick={() => setPage('menu')}
            >
              <Icon name="menu" size={17} />
              Cardápio
            </button>
            <button
              className={page === 'tickets' ? 'active' : ''}
              aria-current={page === 'tickets' ? 'page' : undefined}
              onClick={() => {
                setPage('tickets');
                void load();
              }}
            >
              <Icon name="ticket" size={17} />
              Minhas fichas <span>{ticketReadErrors ? '!' : openTickets.length}</span>
            </button>
            <button
              className={page === 'consumption' ? 'active' : ''}
              aria-current={page === 'consumption' ? 'page' : undefined}
              disabled={!visitor}
              onClick={() => setPage('consumption')}
            >
              <Icon name="receipt" size={17} />
              Consumo
            </button>
          </nav>
        )}
        {visitor && page === 'notfound' && <RouteNotFound onHome={() => setPage('menu')} />}
        {(page === 'menu' || (!hasCustomer && page !== 'tickets')) && (
          <>
            <div className="customer-menu-filters">
              <div className="customer-menu-search" role="search" aria-label="Buscar no cardápio">
                <Icon name="search" size={18} />
                <input
                  className="search-input"
                  type="search"
                  placeholder="Buscar no cardápio…"
                  aria-label="Buscar produto"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Limpar busca"
                    onClick={() => setSearch('')}
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>
              <div className="category-pills" aria-label="Categorias do cardápio">
                <button
                  className={category === 'all' ? 'active' : ''}
                  onClick={() => setCategory('all')}
                >
                  Tudo da casa
                </button>
                {menu?.categories.map((c: Data) => (
                  <button
                    key={c.id}
                    className={category === c.id ? 'active' : ''}
                    onClick={() => setCategory(c.id)}
                  >
                    <ColorDot color={c.color} />
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="customer-section-heading">
              <h2>
                {search
                  ? 'Resultado da busca'
                  : category === 'all'
                    ? 'Nosso cardápio'
                    : (menu?.categories.find((item: Data) => item.id === category)?.name ??
                      'Cardápio')}
              </h2>
              <span>{shownProducts.length} opções</span>
            </div>
            {!menu && (
              <p className="customer-loading" role="status">
                Carregando cardápio…
              </p>
            )}
            {menu && !shownProducts.length && (
              <Empty>
                {menu.products.length
                  ? 'Nenhum produto encontrado.'
                  : 'Nenhum produto disponível no momento. Volte em instantes.'}
                {menu.products.length > 0 && (
                  <button
                    onClick={() => {
                      setSearch('');
                      setCategory('all');
                    }}
                  >
                    Limpar filtros
                  </button>
                )}
              </Empty>
            )}
            <div className="menu-grid">
              {shownProducts.map((p: Data) => (
                <button
                  className="menu-card"
                  aria-label={productLabel(p)}
                  disabled={busy}
                  key={p.id}
                  aria-disabled={!productHasStock(menu, cart, p.id)}
                  onClick={() => {
                    if (!productHasStock(menu, cart, p.id)) {
                      toast.error('Sem estoque disponível para ' + productLabel(p) + '.');
                      return;
                    }
                    setProduct(p);
                    setVariant('');
                    setModifiers([]);
                    setNotes('');
                    setProductQuantity('1');
                  }}
                >
                  <div className={`menu-art ${p.sector === 'cozinha' ? 'food' : 'drink'}`}>
                    <ProductPhotoImage product={p} decorative />
                  </div>
                  <div>
                    <h3>{productLabel(p)}</h3>
                    <p>{p.description}</p>
                    <StockHint catalog={menu} cart={cart} productId={p.id} allowVariants />
                    <div className="section-head">
                      <b>{brl(p.price)}</b>
                      <span className="add-circle">+</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {page === 'tickets' && (
          <div className="customer-ticket-list">
            <div className="customer-section-heading">
              <h2>Suas fichas de consumo</h2>
              <span>
                {ticketReadErrors ? 'Atualização pendente' : `${openTickets.length} a concluir`}
              </span>
              <button type="button" disabled={ticketsLoading} onClick={() => void load()}>
                <Icon name="refresh" size={16} />
                {ticketsLoading ? 'Atualizando…' : 'Atualizar fichas'}
              </button>
            </div>
            {ticketsLoading && !ticketGroups.length && (
              <p className="muted" role="status">
                Carregando suas fichas…
              </p>
            )}
            <CustomerTickets
              groups={ticketGroups}
              loading={ticketsLoading}
              busy={busy}
              onView={setActiveTicket}
              onRequest={(code, ticket) =>
                void run(async () => {
                  try {
                    await requestCustomerTicket(customerScope, code, ticket.id);
                  } finally {
                    await load();
                  }
                }, 'Seu pedido de entrega foi enviado à equipe.')
              }
            />
          </div>
        )}
        {visitor && page === 'consumption' && (
          <CustomerConsumption
            tabs={tabs}
            orders={orders}
            tickets={tickets}
            onViewTickets={() => setPage('tickets')}
            onContinuePayment={(order) =>
              void run(async () =>
                setIntent(await api('/payments/intents', { order_id: order.id })),
              )
            }
          />
        )}
      </main>
      {cart.length > 0 && (
        <div className="customer-cart-dock">
          <button
            className="primary"
            onClick={() => setCartOpen(true)}
            aria-label="Ver meu pedido"
            aria-describedby="customer-cart-summary"
            aria-haspopup="dialog"
            aria-expanded={cartOpen}
          >
            <span className="customer-cart-symbol">
              <Icon name="cart" size={24} />
              <span className="customer-cart-count">{cartUnits}</span>
            </span>
            <span id="customer-cart-summary" aria-live="polite">
              Ver meu pedido
              <small>
                {cartUnits} {cartUnits === 1 ? 'item' : 'itens'} · Revisar e continuar
              </small>
            </span>
            <strong>{brl(cartTotal)}</strong>
            <Icon name="next" size={20} />
          </button>
        </div>
      )}
      {cartOpen && (
        <Modal
          title="Seu carrinho"
          heading={
            <span className="customer-cart-title">
              <Icon name="cart" size={22} />
              Seu carrinho
            </span>
          }
          className="customer-cart-modal"
          closeDisabled={busy}
          onClose={() => setCartOpen(false)}
          focusClose
        >
          <div className="customer-cart-body">
            {cart.length ? (
              <>
                <p className="customer-cart-intro">
                  Confira os itens antes de continuar com o pedido.
                </p>
                <div className="customer-cart-items" aria-label="Itens do carrinho">
                  {cart.map((line, i) => (
                    <div className="customer-cart-line" key={i}>
                      <span className="customer-cart-line-quantity">{line.quantity}×</span>
                      <div>
                        <strong>{line.name}</strong>
                        {line.modifiers.length > 0 && (
                          <small>
                            {line.modifiers
                              .map(
                                (id: string) =>
                                  menu?.modifiers.find((item: Data) => item.id === id)?.name,
                              )
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        )}
                        {line.notes && <small>{line.notes}</small>}
                        <small>{brl(line.display_price)} por unidade</small>
                      </div>
                      <b>{brl(Number(line.display_price) * line.quantity)}</b>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Remover ${line.name}`}
                        onClick={() => setCart(cart.filter((_, j) => j !== i))}
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    </div>
                  ))}
                </div>
                {tabs.length > 0 && (
                  <label>
                    Comanda
                    <SearchSelect
                      label="Comanda"
                      options={[
                        { id: '', name: 'Nova comanda individual' },
                        ...tabs
                          .filter((tab) => tab.status === 'OPEN')
                          .map((tab) => ({ id: String(tab.id), name: String(tab.label) })),
                      ]}
                      value={String(chosenTab ?? '')}
                      onChange={setChosenTab}
                      allowClear={false}
                    />
                  </label>
                )}
                {stockIssue(menu, cart) && (
                  <p role="alert" className="sale-stock-warning">
                    {stockIssue(menu, cart)}
                  </p>
                )}
                {!acceptingOrders && (
                  <p role="alert" className="sale-stock-warning">
                    {availability.message}
                  </p>
                )}
              </>
            ) : (
              <div className="customer-cart-empty">
                <Icon name="cart" size={38} />
                <h3>Seu carrinho está vazio</h3>
                <p>Escolha algo no cardápio para começar seu pedido.</p>
              </div>
            )}
          </div>
          <div className="modal-footer customer-cart-footer">
            {cart.length > 0 && (
              <>
                <div className="customer-cart-total">
                  <span>
                    Total estimado
                    <small>
                      {cartUnits} {cartUnits === 1 ? 'item' : 'itens'}
                    </small>
                  </span>
                  <strong>{brl(cartTotal)}</strong>
                </div>
                <button
                  className="primary"
                  disabled={
                    busy || !navigator.onLine || !acceptingOrders || Boolean(stockIssue(menu, cart))
                  }
                  onClick={() => void run(() => checkout())}
                >
                  {visitor ? 'Ir para pagamento' : 'Identificar e continuar'}
                  <Icon name="next" size={18} />
                </button>
                <p className="customer-cart-next-step">
                  {visitor
                    ? 'Confira o pagamento para confirmar seu pedido.'
                    : 'No próximo passo, informe seu nome e telefone.'}
                </p>
              </>
            )}
            <button disabled={busy} onClick={() => setCartOpen(false)}>
              Continuar escolhendo
            </button>
          </div>
        </Modal>
      )}
      {identifying && (
        <Modal
          className="customer-identity-modal"
          title={identifyMode === 'COUNTER' ? 'Identificar pedido para retirada' : 'Entrar na mesa'}
          dirty={Object.values(identity).some(Boolean)}
          closeDisabled={busy}
          onClose={() => {
            setIdentifying(false);
            setIdentity({ name: '', phone: '', join_code: '' });
            if (cart.length) setCartOpen(true);
          }}
        >
          {' '}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const counter = identifyMode === 'COUNTER';
                const data = await api(
                  `/public/${slug}/${counter ? 'counter-sessions' : 'visitor-sessions'}`,
                  {
                    ...(!counter ? { table_code: tableCode } : {}),
                    name: f.get('name'),
                    phone: String(f.get('phone') ?? '').replace(/\D/g, ''),
                    ...(!counter && f.get('join_code') ? { join_code: f.get('join_code') } : {}),
                  },
                );
                saveSession(data);
                setVisitor(data);
                setIdentifying(false);
                setIdentity({ name: '', phone: '', join_code: '' });
                if (cart.length) await checkout(data);
              });
            }}
          >
            <label>
              Seu nome
              <input
                name="name"
                required
                minLength={2}
                maxLength={identifyMode === 'COUNTER' ? 80 : 160}
                autoComplete="given-name"
                value={identity.name}
                onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
              />
            </label>
            <label>
              Telefone
              <PhoneInput
                required
                value={identity.phone}
                onChange={(phone) => setIdentity((current) => ({ ...current, phone }))}
              />
            </label>
            {identifyMode === 'TABLE' && (
              <label>
                Código de participação, se a mesa estiver ocupada
                <input
                  name="join_code"
                  autoComplete="off"
                  value={identity.join_code}
                  onChange={(event) => setIdentity({ ...identity, join_code: event.target.value })}
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {identifyMode === 'COUNTER' ? 'Continuar para retirada →' : 'Entrar na mesa →'}
            </button>
          </form>
        </Modal>
      )}
      {contextChange && (
        <Modal title="Trocar atendimento?" onClose={() => setContextChange(null)}>
          <div className="stack customer-context-confirmation">
            <p>
              {currentOpenTickets.length > 0
                ? `Você tem ${currentOpenTickets.length} ${currentOpenTickets.length === 1 ? 'ficha pendente' : 'fichas pendentes'} ${isCounter ? 'na retirada' : `na Mesa ${visitor?.table_number}`}.`
                : 'Seus pedidos e fichas pertencem ao atendimento atual.'}
            </p>
            <p className="muted">
              Ao mudar para {contextChange.code ? 'outra mesa' : 'retirada'}, suas fichas continuam
              vinculadas ao atendimento original. A aba “Minhas fichas” reúne as fichas de todas as
              mesas e retiradas identificadas neste dispositivo.
            </p>
            <div className="button-row">
              <button
                className="primary"
                onClick={() => {
                  setContextChange(null);
                  setPage('tickets');
                }}
              >
                <Icon name="ticket" size={17} />
                Manter e ver minhas fichas
              </button>
              <button onClick={() => applyContext(contextChange.code, contextChange.destination)}>
                <Icon name="next" size={17} />
                {contextChange.code ? 'Mudar de mesa' : 'Mudar para retirada'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {readingTable && (
        <TableQrReader
          slug={slug}
          onClose={() => setReadingTable(false)}
          onRead={(code) => {
            setReadingTable(false);
            setScannedTable(code);
          }}
        />
      )}
      <footer className="customer-footer">
        Feito para bons momentos. <strong>mesa.</strong>
      </footer>
      {product && (
        <Modal
          title={productLabel(
            product,
            menu?.variants.find((item: Data) => item.id === variant)?.name,
          )}
          className="customer-product-modal"
          dirty={Boolean(variant || modifiers.length || notes || productQuantity !== '1')}
          onClose={() => setProduct(null)}
        >
          <form
            id="customer-product-form"
            className="stack customer-product-details"
            onSubmit={(event) => {
              event.preventDefault();
              if (!quantityValid) {
                toast.error(
                  productAvailable < 1
                    ? 'Sem estoque disponível para este item.'
                    : `Escolha uma quantidade entre 1 e ${productMaximum}.`,
                );
                return;
              }
              setCart([
                ...cart,
                {
                  product_id: product.id,
                  name: productLabel(
                    product,
                    menu?.variants.find((item: Data) => item.id === variant)?.name,
                  ),
                  quantity: quantityNumber,
                  variant_id: variant,
                  modifiers,
                  notes,
                  display_price: productUnitPrice,
                },
              ]);
              setProduct(null);
            }}
          >
            {product.photo_revision && (
              <div className="customer-product-photo">
                <ProductPhotoImage product={product} full />
              </div>
            )}
            <p className="muted">{product.description}</p>
            {product.default_variant_name &&
              product.default_variant_name !== 'Padrão' &&
              !menu?.variants.some((item: Data) => item.product_id === product.id) && (
                <p className="field-hint">Variação: {product.default_variant_name}</p>
              )}
            <strong>
              {brl(productUnitPrice)} <small className="muted">por unidade</small>
            </strong>
            {menu?.variants.filter((v: Data) => v.product_id === product.id).length > 0 && (
              <label>
                Variação
                <SearchSelect
                  label={'Variação'}
                  options={[
                    {
                      id: String(''),
                      name: productLabel(product) + ' · ' + String(brl(product.price)),
                      disabled: remainingStock(menu, cart, product.id) < 1,
                    },
                    ...(menu?.variants
                      .filter((v: Data) => v.product_id === product.id)
                      .map((v: Data) => ({
                        id: String(v.id),
                        name:
                          productLabel(product, v.name) +
                          ' · ' +
                          String(brl(v.price)) +
                          (remainingStock(menu, cart, product.id, v.id) < 1
                            ? ' · Sem estoque'
                            : ''),
                        disabled: remainingStock(menu, cart, product.id, v.id) < 1,
                      })) ?? []),
                  ]}
                  value={String(variant ?? '')}
                  onChange={(nextValue: string) => setVariant(nextValue)}
                  allowClear={false}
                />
              </label>
            )}
            {menu?.product_modifiers
              .filter((l: Data) => l.product_id === product.id)
              .map((link: Data) => {
                const group = menu.modifier_groups.find((g: Data) => g.id === link.group_id);
                return (
                  <fieldset key={link.id}>
                    <legend>
                      {group.name} (de {group.min_choices} a {group.max_choices})
                    </legend>
                    {menu.modifiers
                      .filter((m: Data) => m.group_id === group.id)
                      .map((m: Data) => (
                        <label className="checkbox-label" key={m.id}>
                          {m.name} · {brl(m.price)}
                          <input
                            type="checkbox"
                            checked={modifiers.includes(m.id)}
                            onChange={(e) =>
                              setModifiers(
                                e.target.checked
                                  ? [...modifiers, m.id]
                                  : modifiers.filter((id) => id !== m.id),
                              )
                            }
                          />
                        </label>
                      ))}
                  </fieldset>
                );
              })}
            <StockHint catalog={menu} cart={cart} productId={product.id} variantId={variant} />
            <div className="customer-product-quantity">
              <span id="customer-product-quantity-label">Quantidade</span>
              <div
                className="customer-quantity-stepper"
                role="group"
                aria-labelledby="customer-product-quantity-label"
              >
                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  disabled={quantityNumber <= 1}
                  onClick={() => setProductQuantity(String(Math.max(1, quantityNumber - 1)))}
                >
                  <Icon name="minus" size={19} />
                </button>
                <NumericInput
                  label="Quantidade do produto"
                  precision={0}
                  maxIntegerDigits={3}
                  required
                  min={1}
                  max={Math.max(1, productMaximum)}
                  value={productQuantity}
                  onChange={setProductQuantity}
                />
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  disabled={quantityNumber >= productMaximum || productMaximum < 1}
                  onClick={() =>
                    setProductQuantity(String(Math.min(productMaximum, quantityNumber + 1)))
                  }
                >
                  <Icon name="plus" size={19} />
                </button>
              </div>
              <small className="field-hint">
                {productAvailable < 100
                  ? `Até ${productMaximum} unidade(s) disponíveis para adicionar.`
                  : 'Até 100 unidades por item.'}
              </small>
              {quantityNumber > productMaximum && (
                <p role="alert" className="sale-stock-warning">
                  {productMaximum < 1
                    ? 'Este item está sem estoque.'
                    : `A quantidade excede o saldo disponível. Escolha até ${productMaximum} unidade(s).`}
                </p>
              )}
            </div>
            <label>
              Alguma observação?
              <input
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: bem gelada"
              />
            </label>
          </form>
          <div className="modal-footer">
            <div className="customer-product-subtotal">
              <span>
                Total deste item<small>{quantityNumber || 0} unidade(s)</small>
              </span>
              <strong>{brl(productUnitPrice * (quantityNumber || 0))}</strong>
            </div>
            <button
              className="primary"
              type="submit"
              form="customer-product-form"
              disabled={!quantityValid}
            >
              Adicionar ao pedido →
            </button>
          </div>
        </Modal>
      )}
      {intent && intent.provider === 'mercadopago' && (
        <OnlinePaymentDialog
          intent={intent}
          onClose={() => setIntent(null)}
          onApproved={async () => {
            setIntent(null);
            setPaymentCompleted(true);
            await load();
          }}
        />
      )}
      {intent && intent.provider !== 'mercadopago' && (
        <Modal title="Pagamento do pedido" onClose={() => setIntent(null)}>
          <div className="stack">
            <span className="eyebrow">AMBIENTE SANDBOX</span>
            <h2>{brl(intent.amount)}</h2>
            <p>
              Este ambiente permite testar o fluxo de aprovação. Nenhum valor real será cobrado.
            </p>
            <Badge status={intent.status} />
            <button
              className="primary"
              disabled={busy || !navigator.onLine}
              onClick={() =>
                void run(async () => {
                  const result = await api('/sandbox/pay', { intent_id: intent.id });
                  if (result.requires_review)
                    throw new Error(`Pagamento preservado para análise: ${result.requires_review}`);
                  setIntent(null);
                  setPage('tickets');
                  await load();
                }, 'Pagamento sandbox aprovado. Suas fichas estão prontas.')
              }
            >
              Simular aprovação do pagamento
            </button>
            {feedback}
          </div>
        </Modal>
      )}
      {viewedTicket && (
        <Modal
          className="customer-ticket-modal"
          title={viewedTicket.product}
          onClose={() => setActiveTicket(null)}
        >
          <div className="ticket-document">
            <Badge status={viewedTicket.status} />
            {viewedGroup?.error ? (
              <p role="alert">
                Atualize suas fichas para verificar a situação antes de exibir o código.
              </p>
            ) : ['REDEEMED', 'CANCELLED'].includes(viewedTicket.status) ? (
              <p>Esta ficha já foi utilizada ou cancelada. Confira a situação em Minhas fichas.</p>
            ) : (
              <>
                <Code value={viewedTicket.token} />
                <Code value={viewedTicket.token} barcode />
              </>
            )}
            {!viewedGroup?.error && !['REDEEMED', 'CANCELLED'].includes(viewedTicket.status) && (
              <p className="small muted">Mostre à equipe. A entrega será confirmada no sistema.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
