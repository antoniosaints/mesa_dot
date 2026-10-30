import { recordColorField, RecordTag } from './record-tags.js';
import { ProductInitialStockModal } from './product-initial-stock.js';
import { TableLoading } from './pagination.js';
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
  const [context, setContext] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState(initialTab ?? (canCatalog ? 'general' : 'balances'));
  const [movementBalance, setMovementBalance] = useState('');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const allCategories = context?.categories ?? categories;
  const locations = context?.locations ?? [];
  const fields: Field[] = [
    { key: 'name', label: 'Nome', required: true, maxLength: 160 },
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
  const dirty = canCatalog && formValuesChanged(values, initial);
  async function reload() {
    if (!productId) return;
    const data = await api('/products/' + productId + '/management');
    setContext(data);
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
          { id: 'general', name: 'Geral' },
          { id: 'prices', name: 'Preços e variações' },
          { id: 'policy', name: 'Estoque e produção' },
        ]
      : []),
    ...(canStock
      ? [
          { id: 'balances', name: 'Estoques e locais' },
          { id: 'movements', name: 'Movimentações' },
        ]
      : []),
    ...(canCatalog
      ? [
          { id: 'recipe', name: 'Ficha técnica' },
          { id: 'addons', name: 'Adicionais' },
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
  const needsSaved = !productId && ['balances', 'movements', 'recipe', 'addons'].includes(tab);
  return (
    <Modal
      title={productId ? 'Editar · Produtos' : 'Adicionar · Produtos'}
      heading={
        <span>
          <Icon name="menu" size={23} />
          <span>
            {values.name || record.name || 'Novo produto'}
            <small>Gestão do produto · cadastro, variações e estoques</small>
          </span>
        </span>
      }
      className="product-management-modal"
      dirty={dirty}
      closeDisabled={busy}
      onClose={() => {
        onClose();
        void onChange();
      }}
    >
      <div className="product-management-top">
        {productId && (
          <button type="button" disabled={busy} onClick={() => void run(reload)}>
            <Icon name="refresh" size={15} />
            Atualizar dados
          </button>
        )}
        <span className={'badge ' + (values.enabled ? 'available' : 'cancelled')}>
          {values.enabled ? 'Ativo' : 'Inativo'}
        </span>
        <RecordTag color={allCategories.find((c: Data) => c.id === values.category_id)?.color}>
          {allCategories.find((c: Data) => c.id === values.category_id)?.name ?? 'Sem categoria'}
        </RecordTag>
        <span>{productId ? 'Cód. ' + productId.slice(0, 8).toUpperCase() : 'Novo cadastro'}</span>
        {context && (
          <span>
            {context.variants.length} variação(ões) · {context.balances.length} estoque(s)
          </span>
        )}
        {dirty && <span className="product-unsaved">Alterações não salvas</span>}
      </div>
      <div className="product-management-tabs" role="tablist" aria-label="Dados do produto">
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
            const data = serializeFormValues(fields, values);
            data.category_id = values.category_id || null;
            data.stock_location_id = values.stock_location_id || null;
            const saved = await api(
              '/products' + (productId ? '/' + productId : ''),
              data,
              productId ? 'PATCH' : 'POST',
            );
            const created = !productId;
            setInitial(values);
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
          disabled={busy || (loading && !initialized.current)}
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
              <div className="product-main-fields">
                <FormFields
                  fields={fields.filter((f) =>
                    ['name', 'category_id', 'description', 'enabled'].includes(f.key),
                  )}
                  values={values}
                  onChange={setValues}
                />
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
                <h3>Preço padrão</h3>
                <div className="product-base-price">
                  <FormFields
                    fields={fields.filter((f) => f.key === 'price')}
                    values={values}
                    onChange={setValues}
                  />
                </div>
                <div className="section-head">
                  <div>
                    <h3>Variações ({context?.variants.length ?? 0})</h3>
                    <p className="muted small">
                      Nome, preço, disponibilidade e modo de estoque de cada opção.
                    </p>
                  </div>
                  {productId && (
                    <button type="button" onClick={() => editVariant()}>
                      <Icon name="plus" size={16} />
                      Nova variação
                    </button>
                  )}
                </div>
                {!productId ? (
                  <p className="product-management-note">
                    Salve e continue para adicionar variações a este produto.
                  </p>
                ) : context?.variants.length ? (
                  <div className="product-config-list">
                    {context.variants.map((v: Data) => (
                      <article key={v.id}>
                        <div>
                          <strong>{v.name}</strong>
                          <small>
                            {v.enabled ? 'Ativa' : 'Inativa'} ·{' '}
                            {v.stock_mode === 'OWN' ? 'Saldo próprio' : 'Estoque compartilhado'}
                            {v.stock_mode === 'OWN'
                              ? ' · ' +
                                (locations.find((l: Data) => l.id === v.stock_location_id)?.name ??
                                  'Origem do produto')
                              : ''}
                          </small>
                        </div>
                        <b>{brl(v.price)}</b>
                        <button
                          type="button"
                          aria-label={'Editar variação ' + v.name}
                          onClick={() => editVariant(v)}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty>Nenhuma variação. O preço padrão será usado.</Empty>
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
                <p className="product-management-note">
                  Essas regras valem para novos pedidos. Reservas de pedidos já lançados continuam
                  vinculadas ao estoque original.
                </p>
                <div className="product-main-fields">
                  <FormFields
                    fields={fields.filter((f) =>
                      [
                        'stock_policy',
                        'requires_production',
                        'sector',
                        ...(canStock ? ['stock_location_id'] : []),
                      ].includes(f.key),
                    )}
                    values={values}
                    onChange={setValues}
                  />
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
                <div className="product-shared-actions">
                  <button type="button" onClick={() => setGroupsOpen(true)}>
                    <Icon name="folder" size={16} />
                    Gerenciar grupos e adicionais
                  </button>
                </div>
                <ProductAddons context={context} refresh={reload} />
              </section>
            )}
          </>
        )
      )}
      <div className="modal-footer product-management-footer">
        <span className="muted small">
          {dirty
            ? 'Cadastro com alterações pendentes'
            : 'Estoque, variações e vínculos são salvos em suas próprias operações.'}
        </span>
        <ModalCloseButton disabled={busy} />
        {canCatalog && (
          <>
            <button type="submit" form={formId} data-continue="true" disabled={busy}>
              Salvar e continuar
            </button>
            <button type="submit" form={formId} className="primary" disabled={busy}>
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
