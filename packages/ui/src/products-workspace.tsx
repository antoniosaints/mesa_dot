import { recordColorField, RecordTag, ColorDot } from './record-tags.js';
import { Pagination, TableLoading, paginate } from './pagination.js';
import { useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Empty, useAction } from './common.js';
import { SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import { ProductManagementModal } from './product-management.js';
import { normalizeOrderSearch } from './orders-view.js';

const stockLabels: Record<string, string> = {
  NO_CONTROL: 'Sem controle',
  ON_CONFIRMATION: 'Na confirmação',
  ON_DELIVERY: 'Na entrega',
  ON_PRODUCTION: 'Na produção',
  RECIPE: 'Ficha técnica',
};
export function ProductsWorkspace({
  products,
  categories,
  balances,
  canViewInventory,
  onChange,
  loading = false,
}: {
  loading?: boolean;
  products: Data[];
  categories: Data[];
  balances: Data[];
  canViewInventory: boolean;
  onChange: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [stock, setStock] = useState('ALL');
  const [production, setProduction] = useState('ALL');
  const [sort, setSort] = useState('name-asc');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [editing, setEditing] = useState<Data | null>(null);
  const [reloading, setReloading] = useState(false);
  const { run, busy } = useAction();
  const forms = useFormDialog();
  const query = normalizeOrderSearch(search);
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Sem categoria';
  const filtered = products
    .filter(
      (p) =>
        (category === 'ALL' ||
          (category === 'NONE' ? !p.category_id : p.category_id === category)) &&
        (status === 'ALL' || Boolean(p.enabled) === (status === 'ACTIVE')) &&
        (stock === 'ALL' ||
          (stock === 'CONTROLLED'
            ? !['NO_CONTROL', 'RECIPE'].includes(p.stock_policy)
            : p.stock_policy === stock)) &&
        (production === 'ALL' || Boolean(p.requires_production) === (production === 'YES')) &&
        normalizeOrderSearch(
          [p.name, p.description, p.id, categoryName(p.category_id)].join(' '),
        ).includes(query),
    )
    .sort((a, b) =>
      sort.startsWith('price')
        ? (Number(a.price) - Number(b.price)) * (sort.endsWith('desc') ? -1 : 1)
        : a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) *
          (sort.endsWith('desc') ? -1 : 1),
    );
  const { rows: visible } = paginate(filtered, page, size);
  const reset = () => setPage(1);
  const edit = (p: Data) => setEditing({ ...p, _key: crypto.randomUUID() });
  function newCategory() {
    forms.open({
      title: 'Nova categoria',
      fields: [
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
      ],
      onSubmit: async (data) => {
        const result = await api('/categories', data);
        await onChange();
        setCategory(result.id);
        reset();
      },
    });
  }
  const categoryChoices = [
    { id: 'ALL', name: 'Todos', color: null, count: products.length },
    {
      id: 'NONE',
      name: 'Sem categoria',
      color: null,
      count: products.filter((p) => !p.category_id).length,
    },
    ...categories
      .slice()
      .sort(
        (a, b) =>
          Number(a.sort_order) - Number(b.sort_order) || a.name.localeCompare(b.name, 'pt-BR'),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        count: products.filter((p) => p.category_id === c.id).length,
      })),
  ];
  return (
    <section className="products-workspace">
      <div className="catalog-toolbar">
        <label className="input-icon catalog-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            aria-label="Buscar em Produtos"
            placeholder="Buscar produtos, categorias ou código…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
          />
        </label>
        <div className="button-row">
          <button
            disabled={reloading}
            aria-label="Recarregar Produtos"
            onClick={() => {
              setReloading(true);
              void onChange().finally(() => setReloading(false));
            }}
          >
            <Icon name="refresh" size={16} />
            Recarregar
          </button>
          <button
            className="primary"
            onClick={() =>
              edit({ category_id: category !== 'ALL' && category !== 'NONE' ? category : '' })
            }
          >
            <Icon name="plus" size={17} />
            Novo produto
          </button>
        </div>
      </div>
      <div className="catalog-layout">
        <aside className="catalog-categories-panel" aria-label="Categorias de produtos">
          <div className="section-head">
            <h2>Categorias</h2>
            <button onClick={newCategory}>
              <Icon name="plus" size={15} />
              Nova
            </button>
          </div>
          <nav aria-label="Filtrar produtos por categoria">
            {categoryChoices.map((c) => (
              <button
                key={c.id}
                aria-pressed={category === c.id}
                onClick={() => {
                  setCategory(c.id);
                  reset();
                }}
              >
                <Icon
                  name={c.id === 'ALL' ? 'dashboard' : c.id === 'NONE' ? 'menu' : 'folder'}
                  size={18}
                />
                <span className="record-option-label">
                  <ColorDot color={c.color} />
                  {c.name}
                </span>
                <b>{c.count}</b>
              </button>
            ))}
          </nav>
        </aside>
        <section className="catalog-products-panel resource-panel" aria-label="Lista de produtos">
          <div className="catalog-list-toolbar">
            <div
              className="catalog-status-filters"
              role="group"
              aria-label="Disponibilidade dos produtos"
            >
              {[
                { id: 'ALL', name: 'Todos', count: products.length },
                { id: 'ACTIVE', name: 'Ativos', count: products.filter((p) => p.enabled).length },
                {
                  id: 'INACTIVE',
                  name: 'Inativos',
                  count: products.filter((p) => !p.enabled).length,
                },
              ].map((s) => (
                <button
                  key={s.id}
                  aria-pressed={status === s.id}
                  onClick={() => {
                    setStatus(s.id);
                    reset();
                  }}
                >
                  {s.name}
                  <span>{s.count}</span>
                </button>
              ))}
            </div>
            <div className="catalog-select-filters">
              <label>
                Ordenar por
                <SearchSelect
                  label="Ordenar produtos"
                  value={sort}
                  allowClear={false}
                  onChange={(v) => {
                    setSort(v);
                    reset();
                  }}
                  options={[
                    { id: 'name-asc', name: 'Nome (A–Z)' },
                    { id: 'name-desc', name: 'Nome (Z–A)' },
                    { id: 'price-asc', name: 'Menor preço' },
                    { id: 'price-desc', name: 'Maior preço' },
                  ]}
                />
              </label>
              <label>
                Estoque
                <SearchSelect
                  label="Filtrar estoque de produtos"
                  value={stock}
                  allowClear={false}
                  onChange={(v) => {
                    setStock(v);
                    reset();
                  }}
                  options={[
                    { id: 'ALL', name: 'Todos' },
                    { id: 'CONTROLLED', name: 'Controlado' },
                    { id: 'NO_CONTROL', name: 'Sem controle' },
                    { id: 'RECIPE', name: 'Ficha técnica' },
                  ]}
                />
              </label>
              <label>
                Produção
                <SearchSelect
                  label="Filtrar produção de produtos"
                  value={production}
                  allowClear={false}
                  onChange={(v) => {
                    setProduction(v);
                    reset();
                  }}
                  options={[
                    { id: 'ALL', name: 'Todos' },
                    { id: 'YES', name: 'Exige preparo' },
                    { id: 'NO', name: 'Sem preparo' },
                  ]}
                />
              </label>
            </div>
          </div>
          {loading ? (
            <TableLoading label="Carregando produtos…" />
          ) : visible.length ? (
            <div className="catalog-table-wrap">
              <table className="catalog-products-table" aria-label="Produtos do cardápio">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Preço</th>
                    <th>Categoria</th>
                    <th>Estoque</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const quantity = balances
                      .filter((b) => b.product_id === p.id)
                      .reduce(
                        (sum, b) => sum + Number(b.physical_quantity) - Number(b.reserved_quantity),
                        0,
                      );
                    const controlled = !['NO_CONTROL', 'RECIPE'].includes(p.stock_policy);
                    return (
                      <tr key={p.id} className={editing?.id === p.id ? 'selected' : ''}>
                        <td>
                          <button
                            className="catalog-product-link"
                            onClick={() => {
                              if (editing?.id !== p.id) edit(p);
                            }}
                          >
                            <span className="catalog-thumbnail">
                              <Icon
                                name={p.requires_production ? 'production' : 'menu'}
                                size={23}
                              />
                            </span>
                            <span>
                              <strong>{p.name}</strong>
                              <small>Cód. {p.id.slice(0, 8).toUpperCase()}</small>
                            </span>
                          </button>
                        </td>
                        <td className="catalog-product-price">{brl(p.price)}</td>
                        <td>
                          <RecordTag color={categories.find((c) => c.id === p.category_id)?.color}>
                            {categoryName(p.category_id)}
                          </RecordTag>
                        </td>
                        <td>
                          <strong className="catalog-stock-quantity">
                            {controlled
                              ? canViewInventory
                                ? quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) +
                                  ' un'
                                : 'Controlado'
                              : p.stock_policy === 'RECIPE'
                                ? 'Ver receita'
                                : '—'}
                          </strong>
                          <small
                            className={'catalog-stock-policy ' + (controlled ? 'controlled' : '')}
                          >
                            {controlled && <span aria-hidden="true">●</span>}
                            {stockLabels[p.stock_policy]}
                          </small>
                        </td>
                        <td>
                          <button
                            role="switch"
                            aria-checked={Boolean(p.enabled)}
                            aria-label={'Disponibilidade de ' + p.name}
                            title={p.enabled ? 'Desativar produto' : 'Ativar produto'}
                            className="catalog-switch"
                            disabled={busy || Boolean(editing)}
                            onClick={() =>
                              void run(
                                async () => {
                                  await api('/products/' + p.id, { enabled: !p.enabled }, 'PATCH');
                                  await onChange();
                                },
                                p.enabled ? 'Produto desativado.' : 'Produto ativado.',
                              )
                            }
                          >
                            <span />
                          </button>
                          <span className="catalog-mobile-status">
                            {p.enabled ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td>
                          <div className="catalog-row-actions">
                            <button
                              aria-label={'Editar ' + p.name}
                              title="Editar produto"
                              onClick={() => edit(p)}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                            <button
                              aria-label={'Duplicar ' + p.name}
                              title="Duplicar cadastro (sem variações)"
                              onClick={() => {
                                const { id: _id, ...copy } = p;
                                edit({ ...copy, name: p.name + ' (cópia)' });
                              }}
                            >
                              <Icon name="copy" size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nenhum produto encontrado. Ajuste a busca ou os filtros.</Empty>
          )}
          <Pagination
            label="Produtos"
            total={filtered.length}
            page={page}
            pageSize={size}
            onPageChange={setPage}
            onPageSizeChange={setSize}
            loading={loading || reloading}
            searchableSize
            pageSizeOptions={[10, 25, 50]}
          />
        </section>
      </div>
      {editing && (
        <ProductManagementModal
          key={editing._key}
          record={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onChange={onChange}
        />
      )}
      {forms.dialog}
    </section>
  );
}
