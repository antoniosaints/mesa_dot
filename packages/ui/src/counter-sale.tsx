import {
  StockHint,
  productHasStock,
  remainingStock,
  stockIssue,
  validateSaleStock,
  stockFailure,
} from './sale-stock.js';
import { useToasts } from './toasts.js';
import { useEffect, useRef, useState } from 'react';
import { api, brl, session, type Data } from './client.js';
import { Empty, Modal, ModalCloseButton, useAction, useRefresh } from './common.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { RecordTag } from './record-tags.js';
import { ProductPicker } from './pos.js';
import { mergeDraftLine, MAX_DRAFT_QUANTITY, type DraftLine } from './draft-cart.js';
import { normalizeOrderSearch } from './orders-view.js';
import { productLabel, productSearchText } from './product-label.js';
import { TableLoading } from './pagination.js';
export function CounterSaleModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (order: Data) => void;
}) {
  const toast = useToasts();
  const canDeliver = Boolean(session()?.actor.permissions.includes('ticket.redeem'));
  const [catalog, setCatalog] = useState<Data | null>(null),
    [cash, setCash] = useState<Data[]>([]),
    [cart, setCart] = useState<DraftLine[]>([]),
    [picker, setPicker] = useState<Data | null>(null),
    [customer, setCustomer] = useState(''),
    [method, setMethod] = useState('PIX_MANUAL'),
    [cashId, setCashId] = useState(''),
    [deliver, setDeliver] = useState(canDeliver),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState('');
  const { run, busy } = useAction(),
    alive = useRef(true),
    attempt = useRef({ signature: '', key: crypto.randomUUID() });
  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const [menu, registers] = await Promise.all([
        api('/catalog/operational'),
        api('/orders/counter/cash-sessions'),
      ]);
      if (!alive.current) return;
      setCatalog(menu);
      setCash(registers);
      if (registers.length === 1) setCashId(registers[0].id);
      setCart((current) =>
        current.map((line) => {
          const product = menu.products.find((p: Data) => p.id === line.product_id),
            variant = menu.variants.find((v: Data) => v.id === line.variant_id);
          if (!product) return line;
          return {
            ...line,
            name: productLabel(product, variant?.name),
            price:
              Number(variant?.price ?? product.price) +
              line.modifiers.reduce(
                (sum, id) =>
                  sum + Number(menu.modifiers.find((m: Data) => m.id === id)?.price ?? 0),
                0,
              ),
          };
        }),
      );
    } catch (error) {
      if (alive.current) setLoadError((error as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useRefresh(load);
  const issue = stockIssue(catalog, cart);
  const cents = cart.reduce(
      (sum, line) => sum + BigInt(Math.round(line.price * 100)) * BigInt(line.quantity),
      0n,
    ),
    total = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  function add(line: DraftLine) {
    if (line.quantity > remainingStock(catalog, cart, line.product_id, line.variant_id)) {
      toast.error('Estoque insuficiente para adicionar este item.');
      return;
    }
    if (mergeDraftLine(cart, line).limitReached) {
      toast.error('Limite de 100 unidades por item.');
      return;
    }
    setCart((current) => mergeDraftLine(current, line).lines);
    setPicker(null);
  }
  const products: Data[] = (catalog?.products ?? []).filter(
    (p: Data) =>
      (!category || p.category_id === category) &&
      normalizeOrderSearch(productSearchText(p, catalog?.variants)).includes(
        normalizeOrderSearch(search),
      ),
  );
  return (
    <Modal
      title="Novo pedido avulso"
      className="counter-sale-modal"
      dirty={Boolean(cart.length || customer)}
      closeDisabled={busy}
      onClose={onClose}
    >
      <p className="modal-description">
        Venda no balcão, sem mesa. Monte o pedido, confira o pagamento recebido e conclua a venda.
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!cart.length || loading) return;
          const body = {
            items: cart.map(({ product_id, variant_id, quantity, modifiers, notes }) => ({
              product_id,
              ...(variant_id ? { variant_id } : {}),
              quantity,
              modifiers,
              ...(notes ? { notes } : {}),
            })),
            expected_total: total,
            method,
            ...(cashId ? { cash_session_id: cashId } : {}),
            ...(customer.trim() ? { customer_name: customer.trim() } : {}),
            deliver_available: deliver,
          };
          const signature = JSON.stringify(body);
          if (attempt.current.signature !== signature)
            attempt.current = { signature, key: crypto.randomUUID() };
          void run(async () => {
            await validateSaleStock('/catalog/operational', cart, setCatalog);
            try {
              const result = await api('/orders/counter', body, 'POST', attempt.current.key);
              onSaved(result.order);
            } catch (error) {
              if (stockFailure(error)) await load();
              throw error;
            }
          }, 'Pedido avulso pago e registrado.');
        }}
      >
        <fieldset disabled={busy} className="counter-sale-fields">
          <div className="counter-sale-workspace">
            <section className="counter-catalog">
              <div className="section-head">
                <h3>1. Escolha os produtos</h3>
                <button type="button" disabled={loading} onClick={() => void load()}>
                  <Icon name="refresh" size={15} />
                  Atualizar cardápio
                </button>
              </div>
              <div className="product-config-filters">
                <label className="input-icon">
                  <Icon name="search" size={16} />
                  <input
                    type="search"
                    aria-label="Buscar produto avulso"
                    placeholder="Buscar produto…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  Categoria
                  <SearchSelect
                    label="Categoria do pedido avulso"
                    value={category}
                    onChange={setCategory}
                    placeholder="Todas as categorias"
                    options={(catalog?.categories ?? []).map((c: Data) => ({
                      id: c.id,
                      name: c.name,
                      color: c.color,
                    }))}
                  />
                </label>
              </div>
              {loadError ? (
                <p role="alert" className="error-text">
                  {loadError}
                </p>
              ) : loading ? (
                <TableLoading label="Carregando cardápio…" />
              ) : products.length ? (
                <div className="counter-product-list">
                  {products.map((product) => (
                    <button
                      type="button"
                      key={product.id}
                      className="counter-product"
                      aria-label={'Adicionar ' + productLabel(product)}
                      aria-disabled={!productHasStock(catalog, cart, product.id)}
                      onClick={() => {
                        if (!productHasStock(catalog, cart, product.id)) {
                          toast.error('Sem estoque disponível para ' + productLabel(product) + '.');
                          return;
                        }
                        if (
                          catalog!.variants.some((v: Data) => v.product_id === product.id) ||
                          catalog!.product_modifiers.some((l: Data) => l.product_id === product.id)
                        )
                          setPicker(product);
                        else
                          add({
                            key: crypto.randomUUID(),
                            product_id: product.id,
                            quantity: 1,
                            modifiers: [],
                            notes: '',
                            name: productLabel(product),
                            price: Number(product.price),
                          });
                      }}
                    >
                      <span>
                        <strong>{productLabel(product)}</strong>
                        <small>
                          {product.requires_production || product.stock_policy === 'ON_PRODUCTION'
                            ? 'Requer preparo'
                            : 'Sem preparo'}
                        </small>
                        <StockHint
                          catalog={catalog}
                          cart={cart}
                          productId={product.id}
                          allowVariants
                        />
                        <RecordTag
                          color={
                            catalog!.categories.find((c: Data) => c.id === product.category_id)
                              ?.color
                          }
                        >
                          {catalog!.categories.find((c: Data) => c.id === product.category_id)
                            ?.name ?? 'Sem categoria'}
                        </RecordTag>
                      </span>
                      <span>
                        <b>{brl(product.price)}</b>
                        <Icon name="plus" size={17} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty>Nenhum produto encontrado.</Empty>
              )}
            </section>
            <section className="counter-checkout">
              <h3>2. Confira o pedido</h3>
              {!cart.length ? (
                <Empty>Adicione os produtos do cliente.</Empty>
              ) : (
                <div className="counter-cart">
                  {cart.map((line) => (
                    <article key={line.key}>
                      <div className="section-head">
                        <strong>{line.name}</strong>
                        <b>{brl(line.price * line.quantity)}</b>
                      </div>
                      <div className="counter-cart-actions">
                        <div className="quantity-stepper">
                          <button
                            type="button"
                            aria-label={'Diminuir ' + line.name}
                            disabled={line.quantity <= 1}
                            onClick={() =>
                              setCart((items) =>
                                items.map((i) =>
                                  i.key === line.key ? { ...i, quantity: i.quantity - 1 } : i,
                                ),
                              )
                            }
                          >
                            <Icon name="minus" size={14} />
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            type="button"
                            aria-label={'Aumentar ' + line.name}
                            disabled={
                              line.quantity >= MAX_DRAFT_QUANTITY ||
                              remainingStock(catalog, cart, line.product_id, line.variant_id) < 1
                            }
                            title="Respeita o saldo disponível do estoque"
                            onClick={() =>
                              setCart((items) =>
                                items.map((i) =>
                                  i.key === line.key ? { ...i, quantity: i.quantity + 1 } : i,
                                ),
                              )
                            }
                          >
                            <Icon name="plus" size={14} />
                          </button>
                        </div>
                        <small>{brl(line.price)} / un</small>
                        <button
                          type="button"
                          aria-label={'Remover ' + line.name}
                          onClick={() =>
                            setCart((items) => items.filter((i) => i.key !== line.key))
                          }
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                      <label>
                        Observação
                        <input
                          aria-label={'Observação de ' + line.name}
                          maxLength={500}
                          value={line.notes}
                          onChange={(e) =>
                            setCart((items) =>
                              items.map((i) =>
                                i.key === line.key ? { ...i, notes: e.target.value } : i,
                              ),
                            )
                          }
                        />
                      </label>
                    </article>
                  ))}
                </div>
              )}
              {issue && (
                <p role="alert" className="sale-stock-warning">
                  {issue}
                </p>
              )}
              <h3>3. Receba o pagamento</h3>
              <label>
                Cliente (opcional)
                <input
                  aria-label="Cliente do pedido avulso"
                  maxLength={80}
                  placeholder="Nome para identificar a retirada"
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                />
              </label>
              <label>
                Forma de pagamento
                <SearchSelect
                  label="Pagamento do pedido avulso"
                  allowClear={false}
                  value={method}
                  onChange={setMethod}
                  options={[
                    { id: 'PIX_MANUAL', name: 'Pix recebido' },
                    { id: 'CARD_MANUAL', name: 'Cartão recebido' },
                    { id: 'CASH', name: 'Dinheiro' },
                  ]}
                />
              </label>
              {(method === 'CASH' || cash.length > 0) && (
                <label>
                  Caixa{method === 'CASH' ? ' *' : ' (opcional)'}
                  <SearchSelect
                    label="Caixa do pedido avulso"
                    required={method === 'CASH'}
                    value={cashId}
                    onChange={setCashId}
                    options={cash.map((c) => ({ id: c.id, name: c.name }))}
                    placeholder="Selecione um caixa aberto"
                  />
                </label>
              )}
              {method === 'CASH' && !cash.length && (
                <p className="error-text">Abra um caixa antes de receber em dinheiro.</p>
              )}
              {canDeliver && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={deliver}
                    onChange={(e) => setDeliver(e.target.checked)}
                  />
                  Marcar itens sem preparo como entregues
                </label>
              )}
              <p className="field-hint">
                Confirme somente após receber. Itens que exigem preparo aguardam a cozinha e são
                entregues pelas fichas.
              </p>
              <div className="order-total">
                <span>Total a receber</span>
                <strong>{brl(total)}</strong>
              </div>
            </section>
          </div>
        </fieldset>
        <div className="modal-footer">
          <ModalCloseButton disabled={busy} />
          <button
            className="primary"
            disabled={
              busy ||
              loading ||
              !cart.length ||
              Boolean(loadError) ||
              Boolean(issue) ||
              (method === 'CASH' && !cashId)
            }
          >
            <Icon name="payments" size={16} />
            {busy ? 'Concluindo…' : 'Confirmar recebimento e pedido'}
          </button>
        </div>
      </form>
      {picker && catalog && (
        <ProductPicker
          product={picker}
          catalog={catalog}
          cart={cart}
          onAdd={add}
          onClose={() => setPicker(null)}
        />
      )}
    </Modal>
  );
}
