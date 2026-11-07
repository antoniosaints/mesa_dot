import { recordColorField, RecordTag } from './record-tags.js';
import { ProductInitialStockModal } from './product-initial-stock.js';
import { Pagination, TableLoading, useClientPagination } from './pagination.js';
import { ProductHelp, ProductToggle } from './product-ui.js';
import { ProductPhotoEditor } from './product-photo.js';
import { AiDraftActions } from './ai-draft-action.js';
import { measurementUnits, measurementUnit } from '../../shared/src/measurement-units.js';
import { useEffect, useId, useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { api, brl, session, type Data } from './client.js';
import { Modal, ModalCloseButton, Empty, useAction } from './common.js';
import { Icon } from './appearance.js';
import {
  FormFields,
  formValuesChanged,
  serializeFormValues,
  useFormDialog,
  type Field,
} from './forms.js';
import { Resource } from './resource.js';
import {
  ProductStock,
  ProductMovements,
  ProductRecipe,
  ProductAddons,
} from './product-configuration.js';
import { CatalogAddons } from './catalog-addons.js';
const policies = {
  NO_CONTROL: 'Sem controle',
  ON_CONFIRMATION: 'Na confirmação',
  ON_DELIVERY: 'Na entrega',
  ON_PRODUCTION: 'Na produção',
  RECIPE: 'Ficha técnica',
};
const policyDescriptions: Record<string, string> = {
  NO_CONTROL: 'Permite vender sem verificar ou baixar um saldo de estoque.',
  ON_CONFIRMATION: 'Reserva o saldo e registra a baixa quando o pedido é confirmado.',
  ON_DELIVERY: 'Reserva o saldo ao confirmar o pedido e registra a baixa na entrega da ficha.',
  ON_PRODUCTION:
    'Reserva o saldo ao confirmar o pedido e registra a baixa quando o preparo fica pronto.',
  RECIPE:
    'Consome os ingredientes da ficha técnica, usando a origem de estoque de cada ingrediente.',
};
export function ProductManagementModal({
  record,
  categories = [],
  onClose,
  onChange,
  initialTab,
}: {
  record: Data;
  categories?: Data[];
  onClose: () => void;
  onChange: () => Promise<void>;
  initialTab?: string;
}) {
  const permissions: string[] = session()?.actor?.permissions ?? [];
  const canCatalog = permissions.includes('catalog.manage'),
    canStock = permissions.includes('inventory.view'),
    canAdjust = permissions.includes('inventory.adjust') && canStock;
  const [stockPrompt, setStockPrompt] = useState<{ product: Data; closeAfter: boolean } | null>(
    null,
  );
  const [productId, setProductId] = useState<string | null>(record.id ?? null);
  const [photoProduct, setPhotoProduct] = useState(record);
  const [photoPreparing, setPhotoPreparing] = useState(false);
  const [context, setContext] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState(initialTab ?? (canCatalog ? 'general' : 'balances'));
  const [movementBalance, setMovementBalance] = useState('');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [variantSearch, setVariantSearch] = useState('');
  const variantPage = useClientPagination<Data>(
    (context?.variants ?? []).filter((variant: Data) =>
      variant.name.toLocaleLowerCase('pt-BR').includes(variantSearch.toLocaleLowerCase('pt-BR')),
    ),
    JSON.stringify({ productId, variantSearch }),
  );
  const allCategories = context?.categories ?? categories;
  const locations = context?.locations ?? [];
  const fields: Field[] = [
    { key: 'name', label: 'Nome', required: true, maxLength: 160 },
    {
      key: 'unit_code',
      label: 'Unidade de medida',
      type: 'select',
      required: true,
      initial: 'UN',
      options: measurementUnits.map((unit) => ({
        id: unit.code,
        name: `${unit.name} (${unit.symbol})`,
      })),
      hint: 'Medida usada no estoque e na ficha técnica.',
    },
    {
      key: 'category_id',
      label: 'Categoria',
      type: 'select',
      options: allCategories.map((c: Data) => ({ id: c.id, name: c.name, color: c.color })),
    },
    { key: 'description', label: 'Descrição', type: 'textarea', maxLength: 2000 },
    { key: 'enabled', label: 'Disponível', type: 'checkbox', initial: true },
    { key: 'price', label: 'Preço', type: 'currency', required: true },
    {
      key: 'default_variant_name',
      label: 'Nome da variação padrão',
      required: true,
      initial: 'Padrão',
      maxLength: 100,
    },
    {
      key: 'stock_policy',
      label: 'Baixa de estoque',
      type: 'select',
      required: true,
      initial: 'NO_CONTROL',
      options: Object.entries(policies).map(([id, name]) => ({ id, name })),
    },
    { key: 'requires_production', label: 'Exige produção', type: 'checkbox' },
    { key: 'sector', label: 'Setor', required: true, initial: 'bar', maxLength: 40 },
    {
      key: 'stock_location_id',
      label: 'Local de baixa do produto',
      hint: 'Origem dos próximos pedidos. Para mudar o depósito de um saldo existente, use Alterar local em Estoques e locais.',
      type: 'select',
      initial: '',
      options: [
        { id: '', name: 'Local padrão da unidade' },
        ...locations.map((l: Data) => ({ id: l.id, name: l.name, color: l.color })),
      ],
    },
  ];
  const initialFor = (data: Data) =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        f.type === 'checkbox'
          ? Boolean(data[f.key] ?? f.initial ?? false)
          : (data[f.key] ?? f.initial ?? ''),
      ]),
    );
  const initialized = useRef(Boolean(record.price) || !record.id);
  const invalidPanel = useRef<string | null>(null);
  const [initial, setInitial] = useState(() => initialFor(record));
  const [values, setValues] = useState(initial);
  const { run, busy } = useAction();
  const forms = useFormDialog();
  const formId = useId();
  const tabsId = useId();
  useEffect(() => {
    document
      .getElementById(`${tabsId}-${tab}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab, tabsId]);
  const dirty =
    canCatalog && (formValuesChanged(values, initial) || values.photo_base64 !== undefined);
  async function reload() {
    if (!productId) return;
    const data = await api('/products/' + productId + '/management');
    setContext(data);
    setPhotoProduct(data.product);
    const source = data.product.stock_location_id ?? '';
    setValues((current) =>
      current.stock_location_id === initial.stock_location_id
        ? { ...current, stock_location_id: source }
        : current,
    );
    setInitial((current) => ({ ...current, stock_location_id: source }));
    await onChange();
  }
  useEffect(() => {
    if (!productId) return;
    let active = true;
    setLoading(true);
    setError('');
    void api('/products/' + productId + '/management')
      .then((data) => {
        if (active) {
          setContext(data);
          setPhotoProduct(data.product);
          if (!initialized.current && canCatalog) {
            const start = initialFor(data.product);
            setInitial(start);
            setValues(start);
            initialized.current = true;
          }
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId, refreshKey]);
  const tabs = [
    ...(canCatalog
      ? [
          { id: 'general', name: 'Geral', icon: 'menu' as const },
          { id: 'prices', name: 'Preços e variações', icon: 'payments' as const },
          { id: 'policy', name: 'Estoque e produção', icon: 'settings' as const },
        ]
      : []),
    ...(canStock
      ? [
          { id: 'balances', name: 'Estoques e locais', icon: 'inventory' as const },
          { id: 'movements', name: 'Movimentações', icon: 'clock' as const },
        ]
      : []),
    ...(canCatalog
      ? [
          { id: 'recipe', name: 'Ficha técnica', icon: 'receipt' as const },
          { id: 'addons', name: 'Adicionais', icon: 'plus' as const },
        ]
      : []),
  ];
  function editVariant(variant: Data = {}) {
    forms.open({
      title: variant.id ? 'Editar variação' : 'Nova variação',
      description:
        'Compartilhado é o padrão. Estoque próprio mantém saldo e reservas separados por variação e local; trocar o modo não transfere saldos existentes.',
      fields: [
        { key: 'name', label: 'Nome da variação', required: true, maxLength: 100 },
        { key: 'price', label: 'Preço da variação', type: 'currency', required: true },
        { key: 'enabled', label: 'Ativa', type: 'checkbox', initial: true },
        {
          key: 'stock_mode',
          label: 'Estoque da variação',
          type: 'select',
          initial: 'SHARED',
          required: true,
          options: [
            { id: 'SHARED', name: 'Compartilhado com o produto' },
            { id: 'OWN', name: 'Saldo próprio por variação' },
          ],
        },
        ...(canStock
          ? [
              {
                key: 'stock_location_id',
                label: 'Local de baixa da variação',
                hint: 'Origem dos próximos pedidos. Para corrigir o depósito do saldo existente, use Alterar local em Estoques e locais.',
                type: 'select' as const,
                options: [
                  { id: '', name: 'Usar origem do produto' },
                  ...locations.map((l: Data) => ({ id: l.id, name: l.name, color: l.color })),
                ],
              },
            ]
          : []),
      ],
      initial: variant,
      onSubmit: async (data) => {
        await api(
          '/product-variants' + (variant.id ? '/' + variant.id : ''),
          {
            ...data,
            product_id: productId,
            ...(canStock
              ? {
                  stock_location_id:
                    data.stock_mode === 'SHARED' ? null : data.stock_location_id || null,
                }
              : {}),
          },
          variant.id ? 'PATCH' : 'POST',
        );
        await reload();
      },
    });
  }
  function removeVariant(variant: Data) {
    forms.open({
      title: 'Remover variação',
      description: `Remover “${variant.name}” das novas vendas? Pedidos e movimentações anteriores serão preservados. A variação padrão continuará disponível.`,
      fields: [],
      submitLabel: 'Remover variação',
      submitVariant: 'danger',
      successMessage: 'Variação removida.',
      onSubmit: async () => {
        await api('/product-variants/' + variant.id, undefined, 'DELETE');
        await reload();
      },
    });
  }
  const needsSaved = !productId && ['balances', 'movements', 'recipe', 'addons'].includes(tab);
  return (
    <Modal
      title={productId ? 'Editar · Produtos' : 'Adicionar · Produtos'}
      heading={
        <span>
          <span className="product-heading-symbol">
            <Icon name="menu" size={23} />
          </span>
          <span>
            {values.name || record.name || 'Novo produto'}
            <small>Gestão do produto · cadastro, variações e estoques</small>
          </span>
        </span>
      }
      className="product-management-modal"
      dirty={dirty}
      closeDisabled={busy || photoPreparing}
      onClose={() => {
        onClose();
        void onChange();
      }}
    >
      <div className="product-management-top">
        <span className={'badge ' + (values.enabled ? 'available' : 'cancelled')}>
          {values.enabled ? 'Ativo' : 'Inativo'}
        </span>
        <RecordTag color={allCategories.find((c: Data) => c.id === values.category_id)?.color}>
          {allCategories.find((c: Data) => c.id === values.category_id)?.name ?? 'Sem categoria'}
        </RecordTag>
        <span>{productId ? 'Cód. ' + productId.slice(0, 8).toUpperCase() : 'Novo cadastro'}</span>
        {context && (
          <span>
            {1 + context.variants.length} variação(ões) · {context.balances.length} estoque(s)
          </span>
        )}
        {dirty && <span className="product-unsaved">Alterações não salvas</span>}
        {productId && (
          <button type="button" disabled={busy || loading} onClick={() => void run(reload)}>
            <Icon name="refresh" size={15} />
            Atualizar dados
          </button>
        )}
      </div>
      <div className="product-overview" aria-label="Resumo do produto">
        {canCatalog && (
          <div>
            <Icon name="payments" size={18} />
            <span>
              Preço padrão<strong>{values.price ? brl(values.price) : 'A definir'}</strong>
            </span>
          </div>
        )}
        <div>
          <Icon name="inventory" size={18} />
          <span>
            Controle de estoque
            <strong>
              {policies[
                (canCatalog
                  ? values.stock_policy
                  : context?.product.stock_policy) as keyof typeof policies
              ] ?? 'Carregando…'}
            </strong>
          </span>
        </div>
        {canCatalog && (
          <div>
            <Icon name="production" size={18} />
            <span>
              Preparo
              <strong>
                {values.requires_production || values.stock_policy === 'ON_PRODUCTION'
                  ? 'Produção · ' + values.sector
                  : 'Entrega sem preparo'}
              </strong>
            </span>
          </div>
        )}
      </div>
      <div
        className="product-management-tabs system-tabs"
        role="tablist"
        aria-label="Dados do produto"
      >
        {tabs.map((t, index) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            id={`${tabsId}-${t.id}`}
            aria-controls={`${tabsId}-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next].id);
              document.getElementById(`${tabsId}-${tabs[next].id}`)?.focus();
            }}
          >
            <Icon name={t.icon} size={16} />
            {t.name}
          </button>
        ))}
      </div>
      {loading && <TableLoading label="Carregando configurações do produto…" compact />}
      {error && (
        <div role="alert" className="flow-note">
          {error}
          <button type="button" onClick={() => setRefreshKey((k) => k + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      <form
        id={formId}
        onInvalidCapture={(event) => {
          const field = (event.target as HTMLElement)
            .closest('[data-product-panel]')
            ?.getAttribute('data-product-panel');
          if (field && !invalidPanel.current) {
            invalidPanel.current = field;
            if (field !== tab) flushSync(() => setTab(field));
            queueMicrotask(() => {
              invalidPanel.current = null;
            });
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const keep =
            (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-continue') === 'true';
          void run(async () => {
            if (photoPreparing) throw new Error('Aguarde a preparação da foto.');
            const data = serializeFormValues(fields, values);
            if (values.photo_base64 !== undefined) data.photo_base64 = values.photo_base64;
            data.category_id = values.category_id || null;
            data.stock_location_id = values.stock_location_id || null;
            const saved = await api(
              '/products' + (productId ? '/' + productId : ''),
              data,
              productId ? 'PATCH' : 'POST',
            );
            const created = !productId;
            const clean = { ...values };
            delete clean.photo_base64;
            setInitial(clean);
            setValues(clean);
            setPhotoProduct(saved);
            setProductId(saved.id);
            if (created && canAdjust) {
              setStockPrompt({ product: saved, closeAfter: !keep });
            } else if (!keep) onClose();
            else if (!created) await reload();
            await onChange();
          }, 'Produto salvo.');
        }}
      >
        <fieldset
          disabled={busy || photoPreparing || (loading && !initialized.current)}
          className="product-management-content"
        >
          {canCatalog && (
            <section
              hidden={tab !== 'general'}
              role="tabpanel"
              id={`${tabsId}-panel-general`}
              aria-labelledby={`${tabsId}-general`}
              data-product-panel="general"
            >
              <div className="section-head">
                <div>
                  <h3>Dados do produto</h3>
                  <p className="muted small">Identificação e disponibilidade no cardápio.</p>
                </div>
                <button type="button" onClick={() => setCategoriesOpen(true)}>
                  <Icon name="folder" size={16} />
                  Categorias
                </button>
              </div>
              <div className="product-general-layout">
                <div className="product-editor-card">
                  <div className="product-main-fields">
                    <ProductPhotoEditor
                      product={{ ...photoProduct, name: values.name || 'Novo produto' }}
                      value={values.photo_base64}
                      onChange={(photo_base64) =>
                        setValues((current) => ({ ...current, photo_base64 }))
                      }
                      onPreparingChange={setPhotoPreparing}
                    />
                    <FormFields
                      fields={fields.filter((f) =>
                        ['name', 'category_id', 'description'].includes(f.key),
                      )}
                      values={values}
                      onChange={setValues}
                    />
                    <AiDraftActions
                      context={{
                        kind: 'product',
                        name: values.name,
                        description: values.description,
                        category: allCategories.find((c: Data) => c.id === values.category_id)
                          ?.name,
                      }}
                      onApply={(description) =>
                        setValues((current) => ({ ...current, description }))
                      }
                      images
                    />
                  </div>
                  <div className="product-measure-settings">
                    <FormFields
                      fields={fields.filter((field) => field.key === 'unit_code')}
                      values={values}
                      onChange={setValues}
                    />
                    <ProductToggle
                      label="Disponível"
                      description="Exibe o produto no cardápio. A disponibilidade para pedir também respeita o estoque e as regras do estabelecimento."
                      checked={Boolean(values.enabled)}
                      onChange={(enabled) => setValues({ ...values, enabled })}
                    />
                  </div>
                  {productId && values.unit_code !== initial.unit_code && (
                    <ProductHelp>
                      Alterar a unidade não converte saldos, reservas ou receitas automaticamente.
                      Confira as quantidades antes de salvar. Movimentações e reposições já
                      registradas mantêm a unidade original.
                    </ProductHelp>
                  )}
                </div>
                <aside className="product-context-card">
                  <h4>
                    <Icon name="eye" size={17} />
                    No cardápio
                  </h4>
                  <strong className="product-context-name">
                    {values.name || 'Nome do produto'}
                  </strong>
                  <RecordTag
                    color={allCategories.find((c: Data) => c.id === values.category_id)?.color}
                  >
                    {allCategories.find((c: Data) => c.id === values.category_id)?.name ??
                      'Sem categoria'}
                  </RecordTag>
                  <p>
                    {values.description ||
                      'Adicione uma descrição para ajudar o cliente a escolher.'}
                  </p>
                  <b>{values.price ? brl(values.price) : 'Defina o preço na próxima aba'}</b>
                  <small>
                    Medida: {measurementUnit(values.unit_code).name} (
                    {measurementUnit(values.unit_code).symbol})
                  </small>
                  <small>Prévia dos dados preenchidos, antes de salvar.</small>
                  <button type="button" onClick={() => setTab('prices')}>
                    <Icon name="next" size={15} />
                    Configurar preços
                  </button>
                </aside>
              </div>
            </section>
          )}
          {canCatalog && (
            <section
              hidden={tab !== 'prices'}
              role="tabpanel"
              id={`${tabsId}-panel-prices`}
              aria-labelledby={`${tabsId}-prices`}
              data-product-panel="prices"
            >
              <div className="product-config-section">
                <div className="product-price-card">
                  <div>
                    <h3>
                      Variação padrão <span className="badge available">Obrigatória</span>
                    </h3>
                    <p>
                      Personalize o nome e o preço desta opção. Ela usa o estoque base do produto e
                      garante ao menos uma variação.
                    </p>
                  </div>
                  <div className="product-base-price">
                    <FormFields
                      fields={['default_variant_name', 'price'].map((key) =>
                        fields.find((field) => field.key === key)!,
                      )}
                      values={values}
                      onChange={setValues}
                    />
                  </div>
                </div>
                <div className="section-head">
                  <div>
                    <h3>Variações ({1 + (context?.variants.length ?? 0)})</h3>
                    <p className="muted small">
                      Inclui a padrão obrigatória. As adicionais têm nome, preço e estoque próprios
                      e são salvas em seus formulários.
                    </p>
                  </div>
                  {productId && (
                    <button type="button" className="primary" onClick={() => editVariant()}>
                      <Icon name="plus" size={16} />
                      Nova variação
                    </button>
                  )}
                </div>
                {productId && Boolean(context?.variants.length) && (
                  <label className="product-inline-search">
                    <Icon name="search" size={16} />
                    <input
                      type="search"
                      aria-label="Buscar variação"
                      placeholder="Buscar variação pelo nome…"
                      value={variantSearch}
                      onChange={(event) => setVariantSearch(event.target.value)}
                    />
                  </label>
                )}
                {!productId ? (
                  <p className="product-management-note">
                    A variação padrão será salva com o produto. Salve e continue para adicionar
                    outras opções.
                  </p>
                ) : context?.variants.length ? (
                  <div className="product-config-list">
                    {variantPage.rows.length === 0 && (
                      <Empty>Nenhuma variação corresponde à busca.</Empty>
                    )}
                    {variantPage.rows.map((v: Data) => (
                      <article key={v.id}>
                        <div>
                          <strong>{v.name}</strong>
                          <span className={'badge ' + (v.enabled ? 'available' : 'cancelled')}>
                            {v.enabled ? 'Ativa' : 'Inativa'}
                          </span>
                          <small>
                            {v.stock_mode === 'OWN' ? 'Saldo próprio' : 'Estoque compartilhado'}
                            {v.stock_mode === 'OWN'
                              ? ' · ' +
                                (locations.find((l: Data) => l.id === v.stock_location_id)?.name ??
                                  'Origem do produto')
                              : ''}
                          </small>
                        </div>
                        <b>{brl(v.price)}</b>
                        <div className="button-row product-variant-actions">
                          <button
                            type="button"
                            aria-label={'Editar variação ' + v.name}
                            onClick={() => editVariant(v)}
                          >
                            <Icon name="edit" size={16} />
                            Editar
                          </button>
                          <button
                            type="button"
                            className="danger"
                            aria-label={'Remover variação ' + v.name}
                            onClick={() => removeVariant(v)}
                            disabled={busy || loading}
                          >
                            <Icon name="trash" size={16} />
                            Remover
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty>
                    Este produto possui a variação padrão acima. Para acrescentar outro tamanho ou
                    volume, clique em Nova variação.
                  </Empty>
                )}
                {Boolean(context?.variants.length) && (
                  <Pagination
                    label="Variações adicionais do produto"
                    total={variantPage.total}
                    page={variantPage.page}
                    pageSize={variantPage.pageSize}
                    onPageChange={variantPage.onPageChange}
                    onPageSizeChange={variantPage.onPageSizeChange}
                  />
                )}
              </div>
            </section>
          )}
          {canCatalog && (
            <section
              hidden={tab !== 'policy'}
              role="tabpanel"
              id={`${tabsId}-panel-policy`}
              aria-labelledby={`${tabsId}-policy`}
              data-product-panel="policy"
            >
              <div className="product-config-section">
                <h3>Regras de baixa e produção</h3>
                <ProductHelp>
                  Essas regras valem para novos pedidos. Reservas de pedidos já lançados continuam
                  vinculadas ao estoque original.
                </ProductHelp>
                <div className="product-policy-layout">
                  <div className="product-editor-card">
                    <h4>
                      <Icon name="inventory" size={17} />
                      Controle de estoque
                    </h4>
                    <div className="product-main-fields">
                      <FormFields
                        fields={fields.filter((f) =>
                          ['stock_policy', ...(canStock ? ['stock_location_id'] : [])].includes(
                            f.key,
                          ),
                        )}
                        values={values}
                        onChange={setValues}
                      />
                    </div>
                    <ProductHelp>{policyDescriptions[values.stock_policy]}</ProductHelp>
                    {canStock && (
                      <button type="button" onClick={() => setTab('balances')}>
                        <Icon name="inventory" size={15} />
                        Ver estoques e locais
                      </button>
                    )}
                    {values.stock_policy === 'RECIPE' && (
                      <button type="button" onClick={() => setTab('recipe')}>
                        <Icon name="receipt" size={15} />
                        Configurar ficha técnica
                      </button>
                    )}
                  </div>
                  <div className="product-editor-card">
                    <h4>
                      <Icon name="production" size={17} />
                      Preparo e destino
                    </h4>
                    <ProductToggle
                      label="Exige produção"
                      description="Encaminha as fichas para a fila de preparo antes da entrega."
                      checked={Boolean(values.requires_production)}
                      onChange={(requires_production) =>
                        setValues({ ...values, requires_production })
                      }
                    />
                    <FormFields
                      fields={fields.filter((f) => f.key === 'sector')}
                      values={values}
                      onChange={setValues}
                    />
                    <p className="field-hint">
                      Identifica o setor responsável pelas fichas, como bar ou cozinha. Mantenha o
                      nome usado pela sua operação.
                    </p>
                    {values.stock_policy === 'ON_PRODUCTION' && (
                      <ProductHelp>
                        A baixa Na produção exige preparo, mesmo com a opção Exige produção
                        desligada.
                      </ProductHelp>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </fieldset>
      </form>
      {needsSaved ? (
        <div className="product-save-first">
          <Icon name="info" />
          <h3>Salve o cadastro para configurar esta etapa</h3>
          <p>
            Preencha nome e preço. Depois de salvar, estoques, fichas técnicas e adicionais ficam
            disponíveis aqui.
          </p>
          <button type="submit" form={formId} data-continue="true" className="primary">
            Salvar e continuar
          </button>
        </div>
      ) : (
        context && (
          <>
            {canStock && (
              <section
                hidden={tab !== 'balances'}
                role="tabpanel"
                id={`${tabsId}-panel-balances`}
                aria-labelledby={`${tabsId}-balances`}
              >
                <ProductStock
                  context={context}
                  refresh={reload}
                  canAdjust={canAdjust}
                  onMovements={(id) => {
                    setMovementBalance(id);
                    setTab('movements');
                  }}
                />
              </section>
            )}
            {canStock && (
              <section
                hidden={tab !== 'movements'}
                role="tabpanel"
                id={`${tabsId}-panel-movements`}
                aria-labelledby={`${tabsId}-movements`}
              >
                <ProductMovements
                  key={movementBalance}
                  context={context}
                  initialBalance={movementBalance}
                />
              </section>
            )}
            {canCatalog && (
              <section
                hidden={tab !== 'recipe'}
                role="tabpanel"
                id={`${tabsId}-panel-recipe`}
                aria-labelledby={`${tabsId}-recipe`}
              >
                <ProductRecipe context={context} refresh={reload} />
              </section>
            )}
            {canCatalog && (
              <section
                hidden={tab !== 'addons'}
                role="tabpanel"
                id={`${tabsId}-panel-addons`}
                aria-labelledby={`${tabsId}-addons`}
              >
                <ProductAddons
                  context={context}
                  refresh={reload}
                  onManageGroups={() => setGroupsOpen(true)}
                />
              </section>
            )}
          </>
        )
      )}
      <div className="modal-footer product-management-footer">
        <span className="muted small">
          {dirty
            ? 'Dados, foto, preço padrão e regras aguardam Salvar. Demais ações são gravadas na própria operação.'
            : 'Cadastro pronto. Variações, estoques, ficha e adicionais são gravados em cada operação.'}
        </span>
        <ModalCloseButton disabled={busy || photoPreparing} />
        {canCatalog && (
          <>
            <button
              type="submit"
              form={formId}
              data-continue="true"
              disabled={busy || photoPreparing}
            >
              Salvar e continuar
            </button>
            <button
              type="submit"
              form={formId}
              className="primary"
              disabled={busy || photoPreparing}
            >
              <Icon name="check" size={16} />
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          </>
        )}
      </div>
      {stockPrompt && (
        <ProductInitialStockModal
          product={stockPrompt.product}
          onDone={(created, sourceLocation) => {
            const closeAfter = stockPrompt.closeAfter;
            setStockPrompt(null);
            if (created) {
              if (sourceLocation) {
                setValues((current) => ({ ...current, stock_location_id: sourceLocation }));
                setInitial((current) => ({ ...current, stock_location_id: sourceLocation }));
              }
              setTab('balances');
              setRefreshKey((current) => current + 1);
              void onChange();
            } else if (closeAfter) onClose();
          }}
        />
      )}
      {forms.dialog}
      {categoriesOpen && (
        <Modal title="Categorias do cardápio" onClose={() => setCategoriesOpen(false)}>
          <Resource
            path="categories"
            title="Categorias"
            records={allCategories}
            onChange={reload}
            fields={[
              { key: 'name', label: 'Nome', required: true, maxLength: 100 },
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
        </Modal>
      )}
      {groupsOpen && context && (
        <Modal
          title="Grupos e adicionais"
          className="catalog-groups-modal"
          onClose={() => setGroupsOpen(false)}
        >
          <CatalogAddons groups={context.groups} modifiers={context.modifiers} onChange={reload} />
        </Modal>
      )}
    </Modal>
  );
}
