import { recordColorField, RecordTag } from './record-tags.js';
import { Pagination, useClientPagination } from './pagination.js';
import { useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Empty, Modal } from './common.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import { normalizeStockQuantity, stockQuantity } from './stock-quantity.js';
import { operationTime } from './operation-format.js';
import { ProductHelp } from './product-ui.js';
import { unitSymbol } from '../../shared/src/measurement-units.js';
import { useStockLocationEditor } from './stock-location-editor.js';
const movementNames: Record<string, string> = {
  PURCHASE: 'Compra',
  LOSS: 'Perda',
  ADJUSTMENT: 'Ajuste',
  COUNT: 'Inventário',
  RESERVE: 'Reserva',
  CONSUMPTION: 'Baixa',
  CANCELLATION: 'Devolução',
  CHECKOUT_HOLD: 'Reserva temporária',
  CHECKOUT_RELEASE: 'Liberação temporária',
};
export function ProductStock({
  context,
  refresh,
  canAdjust,
  onMovements,
}: {
  context: Data;
  refresh: () => Promise<void>;
  canAdjust: boolean;
  onMovements: (id: string) => void;
}) {
  const forms = useFormDialog();
  const stockPage = useClientPagination<Data>(context.balances, context.product.id);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const locationEditor = useStockLocationEditor(context.locations, context.balances, refresh);
  const location = (id: string) =>
    context.locations.find((l: Data) => l.id === id)?.name ?? 'Local não identificado';
  const variant = (id: string) => {
    const item = [...context.variants, ...(context.archived_variants ?? [])].find(
      (v: Data) => v.id === id,
    );
    return item
      ? item.name + (item.deleted_at ? ' · removida' : '')
      : context.product.default_variant_name && context.product.default_variant_name !== 'Padrão'
        ? context.product.default_variant_name + ' / compartilhado'
        : 'Produto / compartilhado';
  };
  function adjust(balance: Data) {
    forms.open({
      title: 'Movimentar estoque',
      description: `${context.product.name} · ${variant(balance.variant_id)} · ${location(balance.location_id)} · Reservado: ${stockQuantity(balance.reserved_quantity)}`,
      fields: [
        {
          key: 'type',
          label: 'Tipo de movimentação',
          type: 'select',
          required: true,
          initial: 'PURCHASE',
          options: [
            { id: 'PURCHASE', name: 'Compra / entrada' },
            { id: 'LOSS', name: 'Perda / saída' },
            { id: 'ADJUSTMENT', name: 'Ajuste de quantidade' },
            { id: 'COUNT', name: 'Inventário contado' },
          ],
        },
        {
          key: 'quantity',
          label: 'Quantidade',
          type: 'quantity',
          numericOptions: (values) => ({
            signed: ['LOSS', 'ADJUSTMENT'].includes(values.type),
            positive: values.type === 'PURCHASE',
            min: values.type === 'COUNT' ? '0' : undefined,
            max: values.type === 'LOSS' ? '-0.001' : undefined,
          }),
          required: true,
          hint: `Quantidade em ${unitSymbol(context.product.unit_code)}, com até três casas decimais. Em perda, use valor negativo; em inventário, informe o físico contado.`,
        },
        { key: 'reason', label: 'Motivo', type: 'textarea', required: true, minLength: 3 },
      ],
      onSubmit: async (values) => {
        await api('/inventory/adjustments', {
          ...values,
          balance_id: balance.id,
          quantity: normalizeStockQuantity(values.quantity, { signed: true }),
        });
        await refresh();
      },
      successMessage: 'Movimentação registrada com auditoria.',
    });
  }
  function addBalance() {
    forms.open({
      title: 'Vincular estoque ao produto',
      description: 'O saldo inicia em zero. Depois, registre uma compra ou o inventário contado.',
      fields: [
        {
          key: 'location_id',
          label: 'Local de estoque',
          type: 'select',
          required: true,
          options: context.locations.map((l: Data) => ({ id: l.id, name: l.name, color: l.color })),
        },
        {
          key: 'variant_id',
          label: 'Estoque de',
          type: 'select',
          initial: '',
          options: [
            { id: '', name: 'Produto / compartilhado' },
            ...context.variants.map((v: Data) => ({ id: v.id, name: v.name + ' · saldo próprio' })),
          ],
        },
      ],
      onSubmit: async (values) => {
        if (
          context.balances.some(
            (b: Data) =>
              b.location_id === values.location_id &&
              (b.variant_id ?? '') === (values.variant_id ?? ''),
          )
        )
          throw new Error(
            'Este produto ou variação já possui estoque nesse local. Use Movimentar.',
          );
        await api('/stock-balances', {
          product_id: context.product.id,
          location_id: values.location_id,
          variant_id: values.variant_id || null,
        });
        await refresh();
      },
    });
  }
  return (
    <section className="product-config-section">
      <div className="section-head">
        <div>
          <h3>
            Estoques por local e variação{' '}
            <span className="product-count">{context.balances.length}</span>
          </h3>
          <p className="muted small">Físico, reservado e disponível separados para cada estoque.</p>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => setLocationsOpen(true)}>
            <Icon name="folder" size={16} />
            Locais
          </button>
          {canAdjust && (
            <button type="button" className="primary" onClick={addBalance}>
              <Icon name="plus" size={16} />
              Vincular estoque
            </button>
          )}
        </div>
      </div>
      {context.product.stock_policy === 'NO_CONTROL' && (
        <p className="product-management-note">
          Este produto está sem controle de estoque. Os saldos cadastrados só serão reservados e
          baixados nos pedidos após ativar uma política de baixa.
        </p>
      )}
      {context.product.stock_policy === 'RECIPE' && (
        <p className="product-management-note">
          Este produto usa a ficha técnica: a baixa ocorre nos estoques dos ingredientes, conforme
          suas origens configuradas.
        </p>
      )}
      <details className="product-explainer">
        <summary>
          <Icon name="help" size={15} />
          Como funcionam os saldos e a origem de baixa?
        </summary>
        <p>
          Físico é a quantidade registrada; reservado é o saldo comprometido com pedidos. Disponível
          é o físico menos o reservado. O local de baixa é configurado em Estoque e produção.
          Variações compartilhadas usam o saldo do produto; variações com saldo próprio usam sua
          linha específica. Nenhum saldo é transferido ao mudar essa configuração. Para corrigir o
          depósito de uma linha sem mudar suas quantidades, use Alterar local.
        </p>
      </details>
      {context.balances.length ? (
        <div className="data-table">
          <table className="inventory-card-table product-stock-table">
            <thead>
              <tr>
                <th>Local</th>
                <th>Produto / variação</th>
                <th>Físico</th>
                <th>Reservado</th>
                <th>Disponível</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {stockPage.rows.map((b: Data) => (
                <tr key={b.id}>
                  <td data-label="Local">
                    <RecordTag
                      color={context.locations.find((l: Data) => l.id === b.location_id)?.color}
                    >
                      {location(b.location_id)}
                    </RecordTag>
                  </td>
                  <td data-label="Produto / variação">{variant(b.variant_id)}</td>
                  <td data-label="Físico">
                    {stockQuantity(b.physical_quantity)} {unitSymbol(context.product.unit_code)}
                  </td>
                  <td data-label="Reservado">
                    {stockQuantity(b.reserved_quantity)} {unitSymbol(context.product.unit_code)}
                  </td>
                  <td data-label="Disponível">
                    <strong
                      className={
                        'product-stock-available ' +
                        (Number(b.physical_quantity) - Number(b.reserved_quantity) > 0
                          ? 'positive'
                          : 'empty')
                      }
                    >
                      {stockQuantity(Number(b.physical_quantity) - Number(b.reserved_quantity))}{' '}
                      {unitSymbol(context.product.unit_code)}
                    </strong>
                  </td>
                  <td data-label="Ações">
                    <div className="button-row">
                      {canAdjust && (
                        <button
                          type="button"
                          onClick={() =>
                            locationEditor.open(
                              b,
                              context.product.name + ' · ' + variant(b.variant_id),
                            )
                          }
                        >
                          <Icon name="folder" size={15} /> Alterar local
                        </button>
                      )}
                      {canAdjust && (
                        <button type="button" onClick={() => adjust(b)}>
                          <Icon name="inventory" size={15} />
                          Movimentar
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={
                          'Histórico de ' + variant(b.variant_id) + ' em ' + location(b.location_id)
                        }
                        onClick={() => onMovements(b.id)}
                      >
                        <Icon name="clock" size={15} />
                        Histórico
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>
          Nenhum estoque vinculado. Adicione um local e vincule o produto ou uma variação.
        </Empty>
      )}
      <Pagination
        label="Estoques do produto"
        total={stockPage.total}
        page={stockPage.page}
        pageSize={stockPage.pageSize}
        onPageChange={stockPage.onPageChange}
        onPageSizeChange={stockPage.onPageSizeChange}
      />
      {forms.dialog}
      {locationEditor.dialog}
      {locationsOpen && (
        <StockLocations
          locations={context.locations}
          canAdjust={canAdjust}
          refresh={refresh}
          onClose={() => setLocationsOpen(false)}
        />
      )}
    </section>
  );
}
export function StockLocations({
  locations,
  canAdjust,
  refresh,
  onClose,
}: {
  locations: Data[];
  canAdjust: boolean;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const forms = useFormDialog();
  function edit(record: Data = {}) {
    forms.open({
      title: record.id ? 'Editar local' : 'Novo local de estoque',
      description: 'Locais são compartilhados por todos os produtos da unidade.',
      fields: [
        { key: 'name', label: 'Nome do local', required: true, maxLength: 100 },
        recordColorField,
      ],
      initial: record,
      onSubmit: async (values) => {
        await api(
          '/stock-locations' + (record.id ? '/' + record.id : ''),
          record.id ? values : { ...values, is_default: false },
          record.id ? 'PATCH' : 'POST',
        );
        await refresh();
      },
    });
  }
  return (
    <Modal title="Locais de estoque" onClose={onClose}>
      <p className="modal-description">
        O padrão é usado quando produto e variação não têm uma origem específica. Alterações no
        padrão valem para novos pedidos.
      </p>
      {canAdjust && (
        <button type="button" className="primary" onClick={() => edit()}>
          <Icon name="plus" size={16} />
          Novo local
        </button>
      )}
      <div className="product-config-list">
        {locations.map((l) => (
          <article key={l.id}>
            <div>
              <RecordTag color={l.color}>{l.name}</RecordTag>
              {l.is_default ? (
                <span className="badge available">Padrão</span>
              ) : (
                <small>Local adicional</small>
              )}
            </div>
            {canAdjust && (
              <div className="button-row">
                <button type="button" aria-label={'Editar local ' + l.name} onClick={() => edit(l)}>
                  <Icon name="edit" size={16} />
                </button>
                {!l.is_default && (
                  <button
                    type="button"
                    onClick={() =>
                      forms.open({
                        title: 'Alterar local padrão',
                        description: `Usar ${l.name} como padrão para novos pedidos sem origem específica? Reservas existentes são preservadas.`,
                        fields: [],
                        submitLabel: 'Definir como padrão',
                        onSubmit: async () => {
                          await api('/inventory/locations/' + l.id + '/default', {});
                          await refresh();
                        },
                      })
                    }
                  >
                    Definir padrão
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {forms.dialog}
    </Modal>
  );
}
export function ProductMovements({
  context,
  initialBalance,
}: {
  context: Data;
  initialBalance: string;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');

  const label = (id: string, locationId?: string) => {
    const b = context.balances.find((b: Data) => b.id === id);
    return (
      (context.locations.find((l: Data) => l.id === (locationId ?? b?.location_id))?.name ??
        'Local') +
      ' · ' +
      ([...context.variants, ...(context.archived_variants ?? [])].find(
        (v: Data) => v.id === b?.variant_id,
      )?.name ??
        (context.product.default_variant_name && context.product.default_variant_name !== 'Padrão'
          ? context.product.default_variant_name
          : 'Compartilhado'))
    );
  };
  const filtered = context.movements.filter(
    (m: Data) =>
      (!balance || m.balance_id === balance) &&
      (type === 'ALL' || m.type === type) &&
      [m.reason, label(m.balance_id, m.location_id), movementNames[m.type]]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
  );
  const paging = useClientPagination<Data>(
    filtered,
    JSON.stringify({ product: context.product.id, balance, type, search }),
    25,
  );
  return (
    <section className="product-config-section">
      <div className="section-head">
        <div>
          <h3>Movimentações do produto</h3>
          <p className="muted small">
            Histórico auditável, incluindo reservas, baixas e devoluções.
          </p>
        </div>
        <span className="muted small">{filtered.length} registros</span>
      </div>
      <div className="product-config-filters">
        <label className="product-inline-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            aria-label="Buscar movimentação do produto"
            placeholder="Buscar por motivo ou local…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Estoque
          <SearchSelect
            label="Filtrar movimentações por estoque"
            value={balance}
            allowClear={false}
            options={[
              { id: '', name: 'Todos os estoques' },
              ...context.balances.map((b: Data) => ({ id: b.id, name: label(b.id) })),
            ]}
            onChange={(v) => {
              setBalance(v);
            }}
          />
        </label>
        <label>
          Tipo
          <SearchSelect
            label="Filtrar movimentações por tipo"
            value={type}
            allowClear={false}
            options={[
              { id: 'ALL', name: 'Todos' },
              ...Object.entries(movementNames).map(([id, name]) => ({ id, name })),
            ]}
            onChange={(v) => {
              setType(v);
            }}
          />
        </label>
        {(balance || type !== 'ALL' || search) && (
          <button
            type="button"
            onClick={() => {
              setBalance('');
              setType('ALL');
              setSearch('');
            }}
          >
            <Icon name="close" size={14} />
            Limpar filtros
          </button>
        )}
      </div>
      {filtered.length ? (
        <div className="data-table">
          <table className="inventory-card-table product-movements-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Estoque</th>
                <th>Tipo</th>
                <th>Quantidade</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {paging.rows.map((m: Data) => (
                <tr key={m.id}>
                  <td data-label="Data">{operationTime(m.created_at)}</td>
                  <td data-label="Estoque">
                    <RecordTag
                      color={
                        context.locations.find(
                          (l: Data) =>
                            l.id ===
                            (m.location_id ??
                              context.balances.find((b: Data) => b.id === m.balance_id)
                                ?.location_id),
                        )?.color
                      }
                    >
                      {label(m.balance_id, m.location_id)}
                    </RecordTag>
                  </td>
                  <td data-label="Tipo">
                    <span className="badge">{movementNames[m.type] ?? m.type}</span>
                  </td>
                  <td
                    data-label="Quantidade"
                    className={
                      'product-movement-quantity ' +
                      (Number(m.quantity) < 0 ? 'negative' : 'positive')
                    }
                  >
                    {Number(m.quantity) > 0 ? '+' : ''}
                    {stockQuantity(m.quantity)} {unitSymbol(m.unit_code)}
                  </td>
                  <td data-label="Motivo">{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Nenhuma movimentação encontrada.</Empty>
      )}
      <Pagination
        label="Movimentações do produto"
        total={paging.total}
        page={paging.page}
        pageSize={paging.pageSize}
        onPageChange={paging.onPageChange}
        onPageSizeChange={paging.onPageSizeChange}
      />
    </section>
  );
}
export function ProductRecipe({
  context,
  refresh,
}: {
  context: Data;
  refresh: () => Promise<void>;
}) {
  const forms = useFormDialog();
  const recipe = context.recipes[0];
  function edit(item: Data = {}) {
    forms.open({
      title: item.id ? 'Editar ingrediente' : 'Adicionar ingrediente',
      fields: [
        {
          key: 'ingredient_id',
          label: 'Ingrediente',
          type: 'select',
          required: true,
          options: context.ingredients
            .filter((p: Data) => p.id !== context.product.id)
            .map((p: Data) => ({ id: p.id, name: p.name })),
        },
        {
          key: 'quantity',
          label: 'Quantidade por unidade',
          type: 'quantity',
          positive: true,
          maxIntegerDigits: 8,
          required: true,
          hint: (values) =>
            `Informe em ${unitSymbol(context.ingredients.find((ingredient: Data) => ingredient.id === values.ingredient_id)?.unit_code)}. Consumo do ingrediente para cada item vendido deste produto, com até três casas decimais (ex.: 0,050).`,
        },
      ],
      initial: item,
      onSubmit: async (values) => {
        if (
          context.recipe_items.some(
            (i: Data) => i.id !== item.id && i.ingredient_id === values.ingredient_id,
          )
        )
          throw new Error('Este ingrediente já está na ficha. Edite sua quantidade.');
        await api(
          '/recipe-items' + (item.id ? '/' + item.id : ''),
          {
            ...values,
            recipe_id: recipe.id,
            quantity: normalizeStockQuantity(values.quantity, { positive: true }),
          },
          item.id ? 'PATCH' : 'POST',
        );
        await refresh();
      },
    });
  }
  return (
    <section className="product-config-section">
      <div className="section-head">
        <div>
          <h3>Ficha técnica e ingredientes</h3>
          <p className="muted small">Quantidades consumidas por unidade vendida do produto.</p>
        </div>
        {recipe ? (
          <button type="button" className="primary" onClick={() => edit()}>
            <Icon name="plus" size={16} />
            Adicionar ingrediente
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() =>
              forms.open({
                title: 'Criar ficha técnica',
                description:
                  'A ficha será vinculada a ' +
                  context.product.name +
                  '. Cadastre os ingredientes e depois ative a política Ficha técnica em Estoque e produção.',
                fields: [],
                submitLabel: 'Criar ficha',
                onSubmit: async () => {
                  await api('/recipes', { product_id: context.product.id });
                  await refresh();
                },
              })
            }
          >
            <Icon name="plus" size={16} />
            Criar ficha técnica
          </button>
        )}
      </div>
      <ProductHelp>
        {context.product.stock_policy !== 'RECIPE'
          ? 'Ficha técnica ainda não utilizada na baixa. Para consumir os ingredientes dos pedidos, selecione Ficha técnica em Estoque e produção e salve o cadastro.'
          : 'Baixa por ficha técnica ativa. Cada unidade vendida consome as quantidades abaixo, nos estoques de origem dos ingredientes.'}
      </ProductHelp>
      {!recipe ? (
        <Empty>
          Este produto ainda não possui ficha técnica. Crie a ficha para cadastrar os ingredientes e
          o consumo por unidade vendida.
        </Empty>
      ) : context.recipe_items.length ? (
        <div className="product-config-list">
          {context.recipe_items.map((item: Data) => (
            <article key={item.id}>
              <div>
                <strong>
                  {context.ingredients.find((p: Data) => p.id === item.ingredient_id)?.name ??
                    'Ingrediente'}
                </strong>
                <small>
                  {stockQuantity(item.quantity)}{' '}
                  {unitSymbol(
                    context.ingredients.find(
                      (ingredient: Data) => ingredient.id === item.ingredient_id,
                    )?.unit_code,
                  )}{' '}
                  por unidade vendida
                </small>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  aria-label={
                    'Editar ingrediente ' +
                    (context.ingredients.find((p: Data) => p.id === item.ingredient_id)?.name ??
                      item.ingredient_id)
                  }
                  onClick={() => edit(item)}
                >
                  <Icon name="edit" size={16} />
                  Editar
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={
                    'Remover ingrediente ' +
                    (context.ingredients.find((p: Data) => p.id === item.ingredient_id)?.name ??
                      item.ingredient_id)
                  }
                  onClick={() =>
                    forms.open({
                      title: 'Remover ingrediente',
                      description:
                        'Remover este ingrediente da ficha? Pedidos já lançados mantêm os componentes reservados.',
                      fields: [],
                      submitLabel: 'Remover ingrediente',
                      onSubmit: async () => {
                        await api('/recipe-items/' + item.id, undefined, 'DELETE');
                        await refresh();
                      },
                    })
                  }
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty>Adicione os ingredientes da receita.</Empty>
      )}
      {forms.dialog}
    </section>
  );
}
export function ProductAddons({
  context,
  refresh,
  onManageGroups,
}: {
  context: Data;
  refresh: () => Promise<void>;
  onManageGroups?: () => void;
}) {
  const forms = useFormDialog();
  const groups = context.groups.filter((g: Data) =>
    context.links.some((l: Data) => l.group_id === g.id),
  );
  return (
    <section className="product-config-section">
      <div className="section-head">
        <div>
          <h3>
            Grupos de adicionais deste produto{' '}
            <span className="product-count">{groups.length}</span>
          </h3>
          <p className="muted small">
            Defina as opções que o cliente pode escolher ao adicionar este produto.
          </p>
        </div>
        <div className="button-row">
          {onManageGroups && (
            <button type="button" onClick={onManageGroups}>
              <Icon name="folder" size={16} />
              Gerenciar grupos e adicionais
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={groups.length === context.groups.length}
            onClick={() =>
              forms.open({
                title: 'Vincular grupo de adicionais',
                fields: [
                  {
                    key: 'group_id',
                    label: 'Grupo de adicionais',
                    type: 'select',
                    required: true,
                    options: context.groups
                      .filter((g: Data) => !groups.some((x: Data) => x.id === g.id))
                      .map((g: Data) => ({ id: g.id, name: g.name })),
                  },
                ],
                onSubmit: async (values) => {
                  await api('/product-modifiers', { product_id: context.product.id, ...values });
                  await refresh();
                },
              })
            }
          >
            <Icon name="plus" size={16} />
            Vincular grupo
          </button>
        </div>
      </div>
      {!context.groups.length && (
        <ProductHelp>
          Comece em Gerenciar grupos e adicionais para cadastrar as opções, depois vincule um grupo
          a este produto.
        </ProductHelp>
      )}
      {!groups.length ? (
        <Empty>Nenhum grupo vinculado a este produto.</Empty>
      ) : (
        groups.map((g: Data) => (
          <article className="product-addon-group" key={g.id}>
            <div className="section-head">
              <div>
                <h3>{g.name}</h3>
                <span className={'badge ' + (Number(g.min_choices) > 0 ? 'pending' : 'available')}>
                  {Number(g.min_choices) > 0 ? 'Obrigatório' : 'Opcional'}
                </span>
                <small>
                  Escolha de {g.min_choices} a {g.max_choices}
                </small>
              </div>
              <button
                type="button"
                className="danger"
                aria-label={'Desvincular grupo ' + g.name}
                onClick={() => {
                  const link = context.links.find((l: Data) => l.group_id === g.id);
                  forms.open({
                    title: 'Desvincular grupo',
                    description:
                      'Remover ' +
                      g.name +
                      ' apenas deste produto? O grupo e os adicionais continuam disponíveis nos outros produtos.',
                    fields: [],
                    submitLabel: 'Desvincular',
                    onSubmit: async () => {
                      await api('/product-modifiers/' + link.id, undefined, 'DELETE');
                      await refresh();
                    },
                  });
                }}
              >
                Desvincular
              </button>
            </div>
            <div className="product-addon-options">
              {context.modifiers
                .filter((m: Data) => m.group_id === g.id)
                .map((m: Data) => (
                  <span key={m.id}>
                    {m.name} · {brl(m.price)}
                    {!m.enabled ? ' · Inativo' : ''}
                  </span>
                ))}
              {!context.modifiers.some((m: Data) => m.group_id === g.id) && (
                <p className="muted small">
                  Nenhum adicional neste grupo. Cadastre as opções em Gerenciar grupos e adicionais.
                </p>
              )}
            </div>
          </article>
        ))
      )}
      {forms.dialog}
    </section>
  );
}
