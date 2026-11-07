import { TableQrButton } from './table-qr-print.js';
import { ProductPhotoImage } from './product-photo.js';
import { productLabel, productSearchText } from './product-label.js';
import { normalizeOrderSearch } from './orders-view.js';
import {
  StockHint,
  productHasStock,
  remainingStock,
  stockIssue,
  validateSaleStock,
  stockFailure,
} from './sale-stock.js';
import { NumericInput } from './numeric-input.js';
import { normalizeInteger } from './numeric.js';
import { ColorDot } from './record-tags.js';
import { ReceiptButton } from './receipt-button.js';
import { TableClosingReview } from './table-closing-review.js';
import { mergeDraftLine, MAX_DRAFT_QUANTITY, type DraftLine } from './draft-cart.js';
import { useToasts } from './toasts.js';
import { TicketQuickScanButton } from './ticket-quick-scan.js';
import { AttendanceTotals, AttendanceOverview } from './attendance-overview.js';
import { attendanceSummary } from './attendance-summary.js';
import { OrderCancellationDialog } from './order-cancellation.js';
import { useTicketDelivery } from './delivery.js';
import { GroupedTickets } from './ticket-groups.js';
import { SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import {
  Modal,
  ModalHeaderActions,
  ModalCloseButton,
  useModalDirty,
  Badge,
  Empty,
  useAction,
  useRefresh,
} from './common.js';
import { Icon } from './appearance.js';
import { OrderSummary, OrderDetailHeading, shortId } from './operations.js';
import { useLayoutEffect, useState, useRef } from 'react';
import { api, brl, session, type Data } from './client.js';
export function ProductPicker({
  product,
  catalog,
  cart = [],
  onAdd,
  onClose,
}: {
  product: Data;
  catalog: Data;
  cart?: DraftLine[];
  onAdd: (line: DraftLine) => void;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const [variant, setVariant] = useState('');
  const available = remainingStock(catalog, cart, product.id, variant);
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const groups = catalog.product_modifiers
    .filter((link: Data) => link.product_id === product.id)
    .map((link: Data) => catalog.modifier_groups.find((group: Data) => group.id === link.group_id));
  const valid = groups.every((group: Data) => {
    const count = catalog.modifiers.filter(
      (item: Data) => item.group_id === group.id && modifiers.includes(item.id),
    ).length;
    return count >= group.min_choices && count <= group.max_choices;
  });
  const selected = catalog.variants.find((item: Data) => item.id === variant);
  const price =
    Number(selected?.price ?? product.price) +
    modifiers.reduce(
      (sum, id) => sum + Number(catalog.modifiers.find((item: Data) => item.id === id)?.price ?? 0),
      0,
    );
  return (
    <Modal
      title={'Adicionar · ' + productLabel(product, selected?.name)}
      dirty={quantity !== '1' || Boolean(variant || modifiers.length || notes)}
      onClose={onClose}
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || Number(quantity) > available) return;
          onAdd({
            key: crypto.randomUUID(),
            product_id: product.id,
            quantity: normalizeInteger(quantity, { min: 1, max: 100, signed: false }),
            variant_id: variant || undefined,
            modifiers,
            notes,
            name: productLabel(product, selected?.name),
            price,
          });
        }}
      >
        <p className="muted">
          {product.description || 'Confira as opções antes de adicionar ao pedido.'}
        </p>
        {product.default_variant_name &&
          product.default_variant_name !== 'Padrão' &&
          !catalog.variants.some((item: Data) => item.product_id === product.id) && (
            <p className="field-hint">Variação: {product.default_variant_name}</p>
          )}
        {catalog.variants.some((item: Data) => item.product_id === product.id) && (
          <label>
            Variação
            <SearchSelect
              label="Variação do produto"
              value={variant}
              onChange={setVariant}
              allowClear={false}
              options={[
                {
                  id: '',
                  name: productLabel(product) + ' · ' + brl(product.price),
                  disabled: remainingStock(catalog, cart, product.id) < 1,
                },
                ...catalog.variants
                  .filter((item: Data) => item.product_id === product.id)
                  .map((item: Data) => ({
                    id: item.id,
                    name:
                      productLabel(product, item.name) +
                      ' · ' +
                      brl(item.price) +
                      (remainingStock(catalog, cart, product.id, item.id) < 1
                        ? ' · Sem estoque'
                        : ''),
                    disabled: remainingStock(catalog, cart, product.id, item.id) < 1,
                  })),
              ]}
            />
          </label>
        )}
        {groups.map((group: Data) => (
          <fieldset className="stack compact" key={group.id}>
            <legend>
              {group.name} · escolha de {group.min_choices} a {group.max_choices}
            </legend>
            {catalog.modifiers
              .filter((item: Data) => item.group_id === group.id)
              .map((item: Data) => (
                <label className="checkbox-label" key={item.id}>
                  <input
                    type="checkbox"
                    checked={modifiers.includes(item.id)}
                    onChange={(event) =>
                      setModifiers(
                        event.target.checked
                          ? [...modifiers, item.id]
                          : modifiers.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.name} · {brl(item.price)}
                </label>
              ))}
          </fieldset>
        ))}
        <StockHint catalog={catalog} cart={cart} productId={product.id} variantId={variant} />
        <label>
          Quantidade
          <NumericInput
            label="Quantidade do produto"
            precision={0}
            maxIntegerDigits={3}
            required
            min={1}
            max={Math.max(1, Math.min(100, available))}
            value={quantity}
            onChange={setQuantity}
          />
        </label>
        <label>
          Observações para preparo
          <input
            value={notes}
            maxLength={500}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: sem gelo, ponto da carne…"
          />
        </label>
        <div className="order-total">
          <span>Total deste item</span>
          <strong>{brl(price * Number(quantity || 0))}</strong>
        </div>
        {!valid && (
          <p className="field-hint">
            Selecione os adicionais na quantidade indicada para continuar.
          </p>
        )}
        <div className="modal-footer">
          <ModalCloseButton />
          <button
            className="primary"
            disabled={
              !valid ||
              !quantity ||
              Number(quantity) < 1 ||
              Number(quantity) > Math.min(100, available)
            }
          >
            <Icon name="plus" size={17} />
            Adicionar ao pedido
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function TablePanel({
  table,
  menu,
  onChange,
  onOrder,
  onFinalized,
  source = 'POS',
}: {
  table: Data;
  menu: Data[];
  onChange: () => void;
  onOrder?: (id: string) => void;
  onFinalized?: () => void;
  source?: 'POS' | 'WAITER';
}) {
  const [details, setDetails] = useState<Data | null>(null);
  const [catalog, setCatalog] = useState<Data>({
    products: menu,
    categories: [],
    variants: [],
    modifier_groups: [],
    modifiers: [],
    product_modifiers: [],
  });
  const [tab, setTab] = useState('');
  const [consumption, setConsumption] = useState<Data | null>(null);
  const [phase, setPhase] = useState(table.status === 'FREE' ? 'order' : 'overview');
  const showPhase = (next: string, panel = next === 'order' ? 'catalog' : 'operation') => {
    setPhase(next);
    setMobilePanel(panel);
  };
  const [tabContents, setTabContents] = useState<Data[]>([]);
  const attendanceNav = useRef<HTMLDivElement>(null);
  const previousPhase = useRef(phase);
  const [mobilePanel, setMobilePanel] = useState(table.status === 'FREE' ? 'catalog' : 'operation');
  const attendanceLoaded = details !== null;
  useLayoutEffect(() => {
    const nav = attendanceNav.current;
    if (!nav?.getClientRects().length) return;
    if (previousPhase.current !== phase) {
      previousPhase.current = phase;
      nav.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    }
    // External shortcuts select a tab without focusing it. Reveal that tab inside
    // its scrollable bar, including when a hidden mobile panel becomes visible.
    const revealSelected = () => {
      if (!nav.getClientRects().length) return;
      nav
        .querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    };
    revealSelected();
    window.addEventListener('resize', revealSelected);
    return () => window.removeEventListener('resize', revealSelected);
  }, [phase, mobilePanel, attendanceLoaded]);
  const [attendanceOrders, setAttendanceOrders] = useState<Data[]>([]);
  const [cancellingOrder, setCancellingOrder] = useState<Data | null>(null);
  const [attendanceTickets, setAttendanceTickets] = useState<Data[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState<DraftLine[]>([]);
  const toast = useToasts();
  function addCartLine(line: DraftLine) {
    if (line.quantity > remainingStock(catalog, cart, line.product_id, line.variant_id)) {
      toast.error('Estoque insuficiente para adicionar este item.');
      return false;
    }
    if (mergeDraftLine(cart, line).limitReached) {
      toast.error(
        `O limite é de ${MAX_DRAFT_QUANTITY} unidades por item. Ajuste a quantidade antes de continuar.`,
      );
      return false;
    }
    setCart((previous) => mergeDraftLine(previous, line).lines);
    return true;
  }
  const [product, setProduct] = useState<Data | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Data | null>(null);
  const [viewOrder, setViewOrder] = useState<Data | null>(null);
  const [transfer, setTransfer] = useState<Data | null>(null);
  const [transferIds, setTransferIds] = useState<string[]>([]);
  const [targetTab, setTargetTab] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [closingReview, setClosingReview] = useState<Data | null>(null);
  const request = useRef(0);
  const { run, refresh, busy, feedback } = useAction();
  const forms = useFormDialog();
  const permissions: string[] = session()?.actor?.permissions ?? [];
  const can = (permission: string) => permissions.includes(permission);
  useModalDirty(cart.length > 0 || Boolean(draft));
  async function load() {
    const version = ++request.current;
    const [result, products, tickets, orders, closing] = await Promise.all([
      api(`/tables/${table.id}/session`),
      can('order.create') ? api('/catalog/operational') : Promise.resolve(catalog),
      can('ticket.view') ? api('/tickets') : Promise.resolve([]),
      api('/orders'),
      api(`/tables/${table.id}/closing-review`).catch(() => null),
    ]);
    const nextTab = result.tabs.some((item: Data) => item.id === tab)
      ? tab
      : (result.tabs[0]?.id ?? '');
    const allContents = await Promise.all(result.tabs.map((item: Data) => api(`/tabs/${item.id}`)));
    const contents = allContents.find((item: Data) => item.id === nextTab) ?? null;
    if (version !== request.current) return;
    setDetails(result);
    setClosingReview(closing);
    setCatalog(products);
    setTab(nextTab);
    setConsumption(contents);
    setTabContents(allContents);
    const tabIds = new Set(result.tabs.map((item: Data) => item.id));
    const orderIds = new Set(
      allContents.flatMap((item: Data) => item.items.map((line: Data) => line.order_id)),
    );
    setAttendanceOrders(
      orders.filter((order: Data) => tabIds.has(order.tab_id) || orderIds.has(order.id)),
    );
    setAttendanceTickets(
      tickets.filter(
        (ticket: Data) => ticket.table_id === table.id && ticket.session_id === result.session?.id,
      ),
    );
  }
  const delivery = useTicketDelivery(() => {
    void load();
    if (viewOrder) void api('/orders/' + viewOrder.id).then(setViewOrder);
    onChange();
  });
  useRefresh(async () => {
    await refresh(load);
  }, [table.id, tab]);
  const change = async () => {
    await load();
    onChange();
  };
  if (!details)
    return (
      <div className="table-management-loading">
        <p>
          <Icon name="refresh" size={18} />
          Carregando o atendimento da mesa…
        </p>
        <div className="table-loading-columns" aria-hidden="true">
          {[0, 1, 2].map((column) => (
            <div key={column}>
              {[0, 1, 2, 3].map((row) => (
                <span key={row} />
              ))}
            </div>
          ))}
        </div>
        <button onClick={() => void run(load)}>
          <Icon name="refresh" size={16} />
          Recarregar atendimento
        </button>
      </div>
    );
  const readyToClose = Boolean(
    details.session &&
    closingReview?.session_id === details.session.id &&
    closingReview?.can_finalize &&
    closingReview?.issues?.length === 0 &&
    !cart.length &&
    !draft &&
    !busy,
  );
  const selectedTab = details.tabs.find((item: Data) => item.id === tab);
  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const postpaid =
    can('order.create') && can('order.postpaid') && catalog.payment_mode !== 'PREPAID_ONLY';
  const items = consumption?.items ?? [];
  const receive = (receivingTab = selectedTab) =>
    void run(async () => {
      const cash = await api('/cash/active');
      forms.open({
        title: 'Registrar recebimento',
        description:
          'Mesa ' +
          table.number +
          ' · ' +
          receivingTab.label +
          ' · Saldo ' +
          brl(receivingTab.financial.balance),
        fields: [
          {
            key: 'amount',
            type: 'currency',
            label: 'Valor a receber',
            required: true,
            initial: receivingTab.financial.balance,
          },
          {
            key: 'method',
            label: 'Forma de recebimento',
            type: 'select',
            required: true,
            initial: 'PIX_MANUAL',
            options: [
              { id: 'PIX_MANUAL', name: 'Pix conferido' },
              { id: 'CARD_MANUAL', name: 'Cartão conferido' },
              { id: 'CASH', name: 'Dinheiro' },
            ],
          },
          {
            key: 'cash_session_id',
            label: 'Turno de caixa',
            type: 'select',
            initial: cash[0]?.id,
            options: cash.map((item: Data) => ({
              id: item.id,
              name: (item.register_name || 'Caixa') + ' · Turno ' + item.id.slice(0, 8),
            })),
            hint: 'Vincula dinheiro, Pix e cartão ao turno. Sem seleção, será usado o caixa operacional aberto.',
          },
        ],
        successMessage: 'Recebimento registrado pelo operador.',
        onSubmit: async (values) => {
          await api('/payments/manual', {
            method: values.method,
            ...(values.cash_session_id ? { cash_session_id: values.cash_session_id } : {}),
            allocations: [{ tab_id: receivingTab.id, amount: values.amount }],
          });
          await change();
        },
      });
    });
  const openNewTab = () =>
    forms.open({
      title: 'Nova comanda',
      description:
        'Mesa ' +
        table.number +
        ' · Separe o consumo por pessoa ou mantenha uma conta para o grupo.',
      fields: [
        {
          key: 'label',
          label: 'Nome da comanda',
          required: true,
          placeholder: 'Ex.: João ou Mesa compartilhada',
        },
        {
          key: 'mode',
          label: 'Tipo de comanda',
          type: 'select',
          required: true,
          initial: 'INDIVIDUAL',
          options: [
            { id: 'SHARED', name: 'Compartilhada · conta do grupo' },
            { id: 'INDIVIDUAL', name: 'Individual · conta por pessoa' },
          ],
        },
      ],
      successMessage: 'Comanda criada.',
      onSubmit: async (values) => {
        const result = await api('/tabs', {
          session_id: details.session.id,
          ...values,
        });
        await change();
        return result;
      },
      onSuccess: (result) => {
        setTab(result.id);
        showPhase('order');
      },
    });
  const isOpen = !details.session || details.session.status === 'OPEN';
  const summary = attendanceSummary(details.tabs, attendanceTickets);
  const openOrder = (id: string) => void run(async () => setViewOrder(await api('/orders/' + id)));
  return (
    <div
      className="stack table-attendance table-management-workspace"
      data-mobile-panel={mobilePanel}
    >
      {feedback}
      <ModalHeaderActions>
        <TableQrButton table={table} />
        {can('ticket.redeem') && can('ticket.view') && (
          <TicketQuickScanButton table={table} onDelivered={change} />
        )}
      </ModalHeaderActions>
      <div className="section-head attendance-heading">
        <div className="button-row">
          <Badge status={details.session?.status ?? 'FREE'} />
          <span className="muted small">
            {details.session
              ? 'Atendimento atual · ' + details.tabs.length + ' comanda(s)'
              : 'Pronta para iniciar um atendimento'}
          </span>
        </div>
        {details.tabs.length > 0 && (
          <div className="attendance-tab-selector">
            <label>
              Comanda em atendimento
              <SearchSelect
                label="Comanda"
                disabled={busy || cart.length > 0 || Boolean(draft)}
                value={tab}
                onChange={setTab}
                allowClear={false}
                options={details.tabs.map((item: Data) => ({
                  id: item.id,
                  name:
                    item.label +
                    ' · ' +
                    (item.mode === 'SHARED' ? 'Compartilhada' : 'Individual') +
                    ' · Saldo ' +
                    brl(item.financial?.balance),
                }))}
              />
              <small className="field-hint">
                {cart.length
                  ? 'O pedido em montagem está vinculado a esta comanda. Confirme ou remova os itens antes de trocar.'
                  : 'Escolha quem receberá o consumo antes de adicionar produtos.'}
              </small>
            </label>
          </div>
        )}
        <button
          className="attendance-refresh"
          aria-label="Atualizar mesa"
          title="Atualizar mesa"
          disabled={busy}
          onClick={() => void run(load)}
        >
          <Icon name="refresh" size={16} /> Atualizar mesa
        </button>
      </div>
      <AttendanceTotals
        tabs={details.tabs}
        tickets={attendanceTickets}
        showTickets={can('ticket.view')}
        showMoney={false}
      />
      {summary.requested > 0 && (
        <div className="flow-note attendance-request">
          <Icon name="bell" />
          <p>
            <strong>O cliente está aguardando {summary.requested} entrega(s).</strong> Confira os
            itens e confirme após entregar ao cliente.
          </p>
          <button onClick={() => showPhase('deliveries')}>Ver solicitações</button>
        </div>
      )}
      {!isOpen && phase !== 'overview' && (
        <div className="flow-note">
          <Icon name="info" />
          <p>
            <strong>Atendimento em fechamento.</strong> Use a revisão de fechamento para conferir
            pagamentos e entregas. Para adicionar pedidos ou abrir outra comanda, reabra o
            atendimento.
          </p>
          <button onClick={() => setReviewOpen(true)}>Revisar fechamento</button>
        </div>
      )}
      <button
        className="table-mobile-financial"
        aria-label="Ver valores da mesa"
        onClick={() => setMobilePanel('summary')}
      >
        <span>
          Total<strong>{brl(summary.total)}</strong>
        </span>
        <span>
          Pago<strong>{brl(summary.paid)}</strong>
        </span>
        <span>
          Pendente<strong>{brl(summary.balance)}</strong>
        </span>
      </button>
      <div
        className="table-mobile-navigation system-tabs"
        role="tablist"
        aria-label="Seções da gestão"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          );
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
                  buttons.length;
          event.preventDefault();
          buttons[next]?.focus();
          buttons[next]?.click();
        }}
      >
        {[
          ['catalog', 'Cardápio', 'menu'],
          ['operation', 'Atendimento', 'orders'],
          ['summary', 'Resumo e ações', 'receipt'],
        ].map(([id, label, icon]) => (
          <button
            role="tab"
            aria-selected={mobilePanel === id}
            key={id}
            onClick={() => setMobilePanel(id)}
          >
            <Icon name={icon as 'menu'} size={17} />
            {label}
            {id === 'operation' && cart.length > 0 && (
              <span className="client-request-count">
                {cart.reduce((sum, line) => sum + line.quantity, 0)}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="table-management-columns">
        <aside className="table-catalog-pane" aria-label="Cardápio da mesa">
          <div className="stack attendance-order-catalog">
            <div className="table-pane-heading">
              <Icon name="menu" size={20} />
              <div>
                <h3>Cardápio</h3>
                <p className="muted small">Escolha os itens do novo pedido.</p>
              </div>
            </div>
            <div className="catalog-categories" role="group" aria-label="Categorias do cardápio">
              <button aria-pressed={!category} onClick={() => setCategory('')}>
                Todos
              </button>
              {catalog.categories.map((item: Data) => (
                <button
                  key={item.id}
                  aria-pressed={category === item.id}
                  onClick={() => setCategory(item.id)}
                >
                  <ColorDot color={item.color} />
                  {item.name}
                </button>
              ))}
            </div>
            {!postpaid && (
              <div className="flow-note">
                <Icon name="info" />
                <p>
                  Seu perfil ou esta unidade não permite lançar pedidos pós-pagos. Oriente o cliente
                  a pedir pelo QR Code e pagar antes da liberação.
                </p>
              </div>
            )}
            <label className="input-icon">
              <Icon name="search" size={17} />
              <input
                aria-label="Buscar produto para o pedido"
                placeholder="Buscar produto pelo nome…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="pos-products">
              {catalog.products
                .filter(
                  (item: Data) =>
                    item.enabled &&
                    (!category || item.category_id === category) &&
                    normalizeOrderSearch(productSearchText(item, catalog.variants)).includes(
                      normalizeOrderSearch(search),
                    ),
                )
                .map((item: Data) => (
                  <button
                    className="pos-product"
                    key={item.id}
                    disabled={
                      busy ||
                      Boolean(draft) ||
                      !postpaid ||
                      Boolean(details.session && details.session.status !== 'OPEN')
                    }
                    aria-disabled={!productHasStock(catalog, cart, item.id)}
                    onClick={() => {
                      if (!productHasStock(catalog, cart, item.id)) {
                        toast.error('Sem estoque disponível para ' + productLabel(item) + '.');
                        return;
                      }
                      showPhase('order', 'operation');
                      if (
                        catalog.variants.some((variant: Data) => variant.product_id === item.id) ||
                        catalog.product_modifiers.some((link: Data) => link.product_id === item.id)
                      )
                        setProduct(item);
                      else
                        addCartLine({
                          key: crypto.randomUUID(),
                          product_id: item.id,
                          quantity: 1,
                          modifiers: [],
                          notes: '',
                          name: productLabel(item),
                          price: Number(item.price),
                        });
                    }}
                  >
                    <span className="catalog-product-symbol">
                      <ProductPhotoImage product={item} decorative />
                    </span>
                    <span className="catalog-product-name">{productLabel(item)}</span>
                    <StockHint catalog={catalog} cart={cart} productId={item.id} allowVariants />
                    <span className="catalog-product-description">
                      {item.description ||
                        catalog.categories.find((entry: Data) => entry.id === item.category_id)
                          ?.name ||
                        'Item do cardápio'}
                    </span>
                    <b>{brl(item.price)}</b>
                    <small className="catalog-add">
                      <Icon name="plus" size={13} />
                      Adicionar
                      {cart.some((line) => line.product_id === item.id)
                        ? ' · ' +
                          cart
                            .filter((line) => line.product_id === item.id)
                            .reduce((sum, line) => sum + line.quantity, 0) +
                          ' no pedido'
                        : ''}
                    </small>
                  </button>
                ))}
            </div>
            {!catalog.products.some(
              (item: Data) =>
                item.enabled &&
                (!category || item.category_id === category) &&
                normalizeOrderSearch(productSearchText(item, catalog.variants)).includes(
                  normalizeOrderSearch(search),
                ),
            ) && <Empty>Nenhum produto encontrado. Tente outro nome ou categoria.</Empty>}
          </div>
        </aside>
        <main className="table-operation-pane" aria-label="Gestão do atendimento">
          <div className="attendance-navigation">
            <div
              ref={attendanceNav}
              className="attendance-tabs system-tabs"
              role="tablist"
              aria-label="Atendimento da mesa"
            >
              {[
                ['overview', 'Resumo da mesa', 'tables'],
                ['order', 'Novo pedido', 'orders'],
                ['consumption', 'Comandas e consumo', 'receipt'],
                ['deliveries', 'Entregas', 'ticket'],
              ].map(([id, label, icon]) => (
                <button
                  role="tab"
                  aria-selected={phase === id}
                  key={id}
                  className={phase === id ? 'active' : ''}
                  onClick={() => showPhase(id)}
                >
                  <Icon name={icon as 'orders'} size={17} />
                  {label}
                  {id === 'deliveries' &&
                    attendanceTickets.some((ticket) =>
                      ['OPEN', 'CLAIMED'].includes(ticket.service_request_status),
                    ) && (
                      <span className="client-request-count">
                        {
                          attendanceTickets.filter((ticket) =>
                            ['OPEN', 'CLAIMED'].includes(ticket.service_request_status),
                          ).length
                        }
                      </span>
                    )}
                </button>
              ))}
            </div>
            <button
              className={'attendance-close-trigger' + (readyToClose ? ' is-ready' : '')}
              title={readyToClose ? 'Mesa sem pendências. Pronta para encerrar.' : undefined}
              aria-haspopup="dialog"
              disabled={!details.session}
              onClick={() => setReviewOpen(true)}
            >
              <Icon name="check" size={17} />
              Encerrar atendimento
            </button>
          </div>
          {phase === 'overview' && (
            <AttendanceOverview
              tabs={details.tabs}
              contents={tabContents}
              orders={attendanceOrders}
              tickets={attendanceTickets}
              canOrder={can('order.create') && isOpen && !cart.length && !draft}
              onOrder={openOrder}
              onCancel={can('order.cancel') ? setCancellingOrder : undefined}
              onNew={(id) => {
                setTab(id);
                showPhase('order');
              }}
              onReceive={
                can('payment.receive')
                  ? (id) => receive(details.tabs.find((item: Data) => item.id === id))
                  : undefined
              }
              onDeliveries={() => showPhase('deliveries')}
            />
          )}
          {phase === 'order' && (
            <section className="attendance-order-builder">
              <div className="table-pane-heading">
                <Icon name="orders" size={20} />
                <div>
                  <h3>Monte o pedido · {selectedTab?.label ?? 'Comanda compartilhada'}</h3>
                  <p className="muted small">Revise os itens e confirme o lançamento.</p>
                </div>
              </div>
              <div className="draft-summary">
                <h3>Resumo do pedido</h3>
                {!cart.length ? (
                  <p className="muted small">
                    Nenhum item adicionado. Escolha um produto no cardápio para começar.
                  </p>
                ) : (
                  cart.map((line) => (
                    <div className="draft-line" key={line.key}>
                      <div className="draft-line-info">
                        <strong>{line.name}</strong>
                        <span className="muted small">{brl(line.price)} por unidade</span>
                      </div>
                      <div className="quantity-controls">
                        <button
                          aria-label={'Diminuir quantidade de ' + line.name}
                          disabled={busy || Boolean(draft) || line.quantity <= 1}
                          onClick={() =>
                            setCart(
                              cart.map((item) =>
                                item.key === line.key
                                  ? { ...item, quantity: item.quantity - 1 }
                                  : item,
                              ),
                            )
                          }
                        >
                          <Icon name="minus" size={15} />
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          aria-label={'Aumentar quantidade de ' + line.name}
                          disabled={
                            busy ||
                            Boolean(draft) ||
                            line.quantity >= MAX_DRAFT_QUANTITY ||
                            remainingStock(catalog, cart, line.product_id, line.variant_id) < 1
                          }
                          title="Respeita o saldo disponível do estoque"
                          onClick={() =>
                            setCart(
                              cart.map((item) =>
                                item.key === line.key
                                  ? { ...item, quantity: item.quantity + 1 }
                                  : item,
                              ),
                            )
                          }
                        >
                          <Icon name="plus" size={15} />
                        </button>
                      </div>
                      <strong className="draft-line-total">
                        {brl(line.price * line.quantity)}
                      </strong>
                      <button
                        className="draft-line-remove"
                        aria-label="Remover"
                        title={'Remover ' + line.name}
                        disabled={busy || Boolean(draft)}
                        onClick={() => setCart(cart.filter((item) => item.key !== line.key))}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                      <label className="draft-line-note">
                        Observação
                        <input
                          aria-label={'Observação de ' + line.name}
                          placeholder="Adicionar observação…"
                          maxLength={500}
                          value={line.notes}
                          disabled={busy || Boolean(draft)}
                          onChange={(event) =>
                            setCart(
                              cart.map((item) =>
                                item.key === line.key
                                  ? { ...item, notes: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))
                )}
                {cart.length > 0 && (
                  <>
                    {stockIssue(catalog, cart) && (
                      <p role="alert" className="sale-stock-warning">
                        {stockIssue(catalog, cart)}
                      </p>
                    )}
                    <div className="order-total">
                      <span>
                        Total · {cart.reduce((sum, line) => sum + line.quantity, 0)} unidade(s)
                      </span>
                      <strong>{brl(total)}</strong>
                    </div>
                    <p className="muted small">
                      {selectedTab
                        ? 'Lançamento em ' + selectedTab.label
                        : 'Será criada a comanda compartilhada da mesa'}{' '}
                      · pagamento no fechamento. Os valores e a disponibilidade serão conferidos
                      pelo servidor.
                    </p>
                    {draft && (
                      <p className="flow-note">
                        Pedido {shortId(draft)} salvo como rascunho. A confirmação não terminou;
                        tente novamente aqui ou consulte o menu Pedidos. Não é necessário criar
                        outro pedido.
                      </p>
                    )}
                    <button
                      className="primary full"
                      disabled={busy || !postpaid || !isOpen || Boolean(stockIssue(catalog, cart))}
                      onClick={() =>
                        void run(async () => {
                          await validateSaleStock('/catalog/operational', cart, setCatalog);
                          let id = draft;
                          if (!id) {
                            const order = await api('/orders', {
                              table_id: table.id,
                              ...(tab ? { tab_id: tab } : {}),
                              source,
                              payment_policy: 'POSTPAID',
                              items: cart.map(
                                ({ product_id, quantity, variant_id, modifiers, notes }) => ({
                                  product_id,
                                  quantity,
                                  variant_id,
                                  modifiers,
                                  notes,
                                }),
                              ),
                            }).catch(async (error) => {
                              if (stockFailure(error)) await load();
                              throw error;
                            });
                            id = order.id;
                            setDraft(id);
                          }
                          let confirmed;
                          try {
                            confirmed = await api(`/orders/${id}/confirm`, {});
                          } catch (error) {
                            if (stockFailure(error)) await load();
                            throw error;
                          }
                          setDraft(null);
                          setCart([]);
                          setLastOrder(confirmed);
                          showPhase('consumption');
                          await change();
                        }, 'Pedido confirmado. Fichas geradas.')
                      }
                    >
                      <Icon name="send" size={17} />
                      {busy
                        ? 'Confirmando…'
                        : draft
                          ? 'Tentar confirmar pedido'
                          : 'Confirmar pedido pós-pago →'}
                    </button>
                  </>
                )}
              </div>
            </section>
          )}
          {phase === 'consumption' && (
            <section className="stack">
              {lastOrder && (
                <div className="flow-note">
                  <Icon name="ready" />
                  <p>
                    Pedido {shortId(lastOrder.id)} confirmado. O consumo foi lançado na comanda e as
                    fichas foram emitidas.
                  </p>
                </div>
              )}
              <div className="section-head">
                <div>
                  <h3>Comandas desta mesa</h3>
                  <p className="muted small">
                    Compartilhada reúne o consumo do grupo; individual separa a conta por pessoa.
                  </p>
                </div>
                <button
                  disabled={
                    cart.length > 0 ||
                    Boolean(draft) ||
                    !details.session ||
                    details.session.status !== 'OPEN' ||
                    !can('order.create')
                  }
                  onClick={() => openNewTab()}
                >
                  <Icon name="plus" size={17} />
                  Nova comanda
                </button>
              </div>
              {!details.session ? (
                <Empty>A comanda será criada ao confirmar o primeiro pedido desta mesa.</Empty>
              ) : (
                <>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={!isOpen || busy}
                      onClick={() => showPhase('order')}
                    >
                      <Icon name="plus" size={17} />
                      Lançar pedido nesta comanda
                    </button>
                    {can('payment.receive') && (
                      <button
                        disabled={busy || Number(selectedTab?.financial.balance) <= 0}
                        onClick={() => receive()}
                      >
                        <Icon name="payments" size={17} />
                        Registrar recebimento
                      </button>
                    )}
                    {can('tab.transfer') && (
                      <button
                        disabled={
                          busy ||
                          details.tabs.filter((item: Data) => item.status === 'OPEN').length < 2 ||
                          !items.length
                        }
                        onClick={() => {
                          setTransfer(consumption);
                          setTransferIds([]);
                          setTargetTab('');
                        }}
                      >
                        <Icon name="next" size={17} />
                        Transferir itens para outra comanda
                      </button>
                    )}
                  </div>
                  <AttendanceOverview
                    tabs={selectedTab ? [selectedTab] : []}
                    contents={tabContents}
                    orders={attendanceOrders}
                    tickets={attendanceTickets}
                    canOrder={false}
                    onOrder={(id) => (onOrder ? onOrder(id) : openOrder(id))}
                    onCancel={can('order.cancel') ? setCancellingOrder : undefined}
                    onNew={() => showPhase('order')}
                    onDeliveries={() => showPhase('deliveries')}
                  />
                </>
              )}
            </section>
          )}
          {phase === 'deliveries' && (
            <section className="stack">
              <div>
                <h3>Entregas desta mesa</h3>
                <p className="muted small">
                  Confira o produto e a comanda. Depois de entregar fisicamente ao cliente, use
                  “Entregar”. Não é necessário escanear a ficha para concluir por aqui.
                </p>
              </div>
              <GroupedTickets
                tickets={attendanceTickets}
                autoExpand="all"
                onDeliver={can('ticket.redeem') ? delivery.deliver : undefined}
              />
            </section>
          )}
        </main>
        <aside className="table-summary-pane" aria-label="Resumo e ações da mesa">
          <section className="table-sidebar-section">
            <h3>
              <Icon name="receipt" size={20} />
              Resumo da mesa
            </h3>
            <AttendanceTotals tabs={details.tabs} tickets={attendanceTickets} showTickets={false} />
          </section>
          <section className="table-sidebar-section table-payment-section">
            <h3>
              <Icon name="payments" size={20} />
              Pagamentos
            </h3>
            <div className="table-payment-line">
              <span>Pago · {selectedTab?.label ?? 'Atendimento'}</span>
              <strong>{brl(selectedTab?.financial.net_paid ?? summary.paid)}</strong>
            </div>
            <p className="muted small">
              Recebido na comanda selecionada, já descontados os estornos.
            </p>
            {can('payment.receive') && selectedTab && (
              <>
                <button
                  className="table-add-payment"
                  disabled={busy || Number(selectedTab.financial.balance) <= 0}
                  onClick={() => receive()}
                >
                  <Icon name="plus" size={17} />
                  Adicionar pagamento
                </button>
                <small className="muted">Destino: {selectedTab.label}</small>
              </>
            )}
          </section>
          <section className="table-sidebar-section">
            <h3>
              <Icon name="settings" size={20} />
              Ações da mesa
            </h3>
            {can('ticket.view') && (
              <button className="table-success-action" onClick={() => showPhase('deliveries')}>
                <Icon name="ready" size={18} />
                Conferir entregas{summary.pending > 0 ? ' · ' + summary.pending : ''}
              </button>
            )}
            <div className="button-row attendance-actions">
              {selectedTab && (
                <ReceiptButton
                  scope="TAB"
                  id={selectedTab.id}
                  label="Cupom da comanda selecionada"
                />
              )}
              {can('order.create') && (
                <button
                  className="primary"
                  disabled={busy || !isOpen}
                  onClick={() => showPhase('order')}
                >
                  <Icon name="plus" size={17} />{' '}
                  {cart.length
                    ? 'Continuar pedido · ' +
                      cart.reduce((sum, line) => sum + line.quantity, 0) +
                      ' item(s)'
                    : 'Adicionar pedido à mesa'}
                </button>
              )}
              {can('order.create') && (
                <button
                  disabled={
                    busy || cart.length > 0 || Boolean(draft) || !details.session || !isOpen
                  }
                  onClick={openNewTab}
                >
                  <Icon name="receipt" size={17} /> Abrir outra comanda
                </button>
              )}
              {details.session && (
                <button onClick={() => setReviewOpen(true)}>
                  <Icon name="check" size={17} /> Ir para fechamento
                </button>
              )}
            </div>
          </section>
          <section className="table-sidebar-section table-qr-section">
            <details>
              <summary>QR Code da mesa e identificação do cliente</summary>
              {details.session && (
                <p>
                  Código para participar: <strong>{details.session.join_code}</strong>
                </p>
              )}
              <p className="muted small">
                Identificar-se pelo QR não ocupa a mesa; a confirmação do pedido inicia o
                atendimento.
              </p>
            </details>
          </section>
        </aside>
      </div>
      {product && (
        <ProductPicker
          product={product}
          catalog={catalog}
          cart={cart}
          onClose={() => setProduct(null)}
          onAdd={(line) => {
            showPhase('order', 'operation');
            if (addCartLine(line)) setProduct(null);
          }}
        />
      )}
      {reviewOpen && (
        <TableClosingReview
          table={table}
          revision={details}
          hasDraft={cart.length > 0 || Boolean(draft)}
          onClose={() => setReviewOpen(false)}
          onReceive={(item) => {
            setTab(item.id);
            receive(item);
          }}
          onDeliveries={() => {
            setReviewOpen(false);
            showPhase('deliveries');
          }}
          onOrder={(id) => {
            setReviewOpen(false);
            openOrder(id);
          }}
          onDraft={() => {
            setReviewOpen(false);
            showPhase('order', 'operation');
          }}
          onUpdated={change}
          onFinalized={() => {
            setLastOrder(null);
            showPhase('overview');
            onFinalized?.();
          }}
        />
      )}
      {viewOrder && (
        <Modal
          className="order-detail-modal"
          focusClose
          title={'Pedido ' + shortId(viewOrder.id)}
          heading={<OrderDetailHeading order={viewOrder} />}
          onClose={() => setViewOrder(null)}
        >
          <OrderSummary
            order={viewOrder}
            onUpdate={(value) =>
              setViewOrder((current) => (current?.id === value.id ? value : current))
            }
            onDeliver={can('ticket.redeem') ? delivery.deliver : undefined}
          />
          <div className="modal-footer">
            <button onClick={() => setViewOrder(null)}>
              <Icon name="back" size={16} /> Voltar à mesa
            </button>
            {onOrder && (
              <button onClick={() => onOrder(viewOrder.id)}>
                <Icon name="next" size={16} /> Abrir tela do pedido
              </button>
            )}
            {can('order.cancel') && viewOrder.status !== 'CANCELLED' && (
              <button className="danger" onClick={() => setCancellingOrder(viewOrder)}>
                <Icon name="close" size={16} /> Cancelar pedido
              </button>
            )}
          </div>
        </Modal>
      )}
      {cancellingOrder && (
        <OrderCancellationDialog
          order={cancellingOrder}
          onClose={() => setCancellingOrder(null)}
          onUpdated={() => void change()}
          onCancelled={() => {
            setViewOrder(null);
            void change();
          }}
        />
      )}
      {transfer && (
        <Modal
          title="Transferir itens entre comandas"
          dirty={transferIds.length > 0 || Boolean(targetTab)}
          closeDisabled={busy}
          onClose={() => setTransfer(null)}
        >
          <div className="stack">
            <p className="muted small">
              Origem: {selectedTab?.label}. Selecione as linhas inteiras e a comanda que receberá o
              consumo. Pedidos e fichas conservam o histórico.
            </p>
            {transfer.items.map((item: Data) => (
              <label className="checkbox-label" key={item.id}>
                <input
                  type="checkbox"
                  checked={transferIds.includes(item.id)}
                  onChange={(event) =>
                    setTransferIds(
                      event.target.checked
                        ? [...transferIds, item.id]
                        : transferIds.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.quantity} × {item.name_snapshot} · {brl(item.total)}
              </label>
            ))}
            <label>
              Comanda de destino
              <SearchSelect
                label="Comanda de destino"
                value={targetTab}
                onChange={setTargetTab}
                options={details.tabs
                  .filter((item: Data) => item.id !== tab && item.status === 'OPEN')
                  .map((item: Data) => ({ id: item.id, name: item.label }))}
              />
            </label>
            <div className="modal-footer">
              <ModalCloseButton disabled={busy} />
              <button
                className="primary"
                disabled={busy || !targetTab || !transferIds.length}
                onClick={() =>
                  void run(async () => {
                    await api(`/tabs/${tab}/transfer-items`, {
                      item_ids: transferIds,
                      target_tab_id: targetTab,
                    });
                    setTransfer(null);
                    await change();
                  }, 'Itens transferidos com histórico preservado.')
                }
              >
                <Icon name="next" size={17} />
                Confirmar transferência
              </button>
            </div>
          </div>
        </Modal>
      )}
      {forms.dialog}
      {delivery.dialog}
    </div>
  );
}
export { Floor, FloorEditor, FloorOverview } from './floor-plan.js';
