import { unitSymbol } from '../../shared/src/measurement-units.js';
import { RecordTag } from './record-tags.js';
import {
  ReplenishmentModal,
  ReplenishmentHistory,
  ReplenishmentDetail,
} from './inventory-replenishments.js';
import { Pagination, TableLoading, useClientPagination } from './pagination.js';
import { useState } from 'react';
import { session, type Data } from './client.js';
import { Empty, PageTitle } from './common.js';
import { AiSummaryButton } from './ai-assistant.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { ProductManagementModal } from './product-management.js';
import { StockLocations } from './product-configuration.js';
import { stockQuantity } from './stock-quantity.js';
import { normalizeOrderSearch } from './orders-view.js';
import { productLabel } from './product-label.js';
import { useStockLocationEditor } from './stock-location-editor.js';
export function InventoryOverview({
  balances,
  catalog,
  onChange,
  loading = false,
}: {
  loading?: boolean;
  balances: Data[];
  catalog: Data;
  onChange: () => Promise<void>;
}) {
  const [replenishOpen, setReplenishOpen] = useState(false),
    [locationsOpen, setLocationsOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [replenishment, setReplenishment] = useState<Data | null>(null);
  const canReplenish = session()?.actor?.permissions?.includes('inventory.adjust');
  const [reloading, setReloading] = useState(false);
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [product, setProduct] = useState<Data | null>(null);
  const products: Data[] = catalog.products ?? [],
    variants: Data[] = catalog.variants ?? [],
    locations: Data[] = catalog.locations ?? [];
  const rows = balances.filter(
    (b) =>
      (!location || b.location_id === location) &&
      normalizeOrderSearch(
        [
          productLabel(
            products.find((p) => p.id === b.product_id) ?? { name: b.product_id },
            variants.find((v) => v.id === b.variant_id)?.name,
          ),
          variants.find((v) => v.id === b.variant_id)?.name,
          locations.find((l) => l.id === b.location_id)?.name,
        ].join(' '),
      ).includes(normalizeOrderSearch(search)),
  );
  const paging = useClientPagination(rows, JSON.stringify({ search, location }));
  const locationEditor = useStockLocationEditor(locations, balances, onChange);
  return (
    <section className="inventory-workspace">
      <PageTitle
        className="module-page-title"
        eyebrow="OPERAÇÃO / ESTOQUE"
        title="Estoque"
        subtitle="Acompanhe os saldos por local e gerencie reposições e movimentações dos produtos."
        action={
          <div className="button-row inventory-main-actions">
            <AiSummaryButton focus="stock">Analisar estoque com IA</AiSummaryButton>
            <button
              type="button"
              onClick={() => setLocationsOpen(true)}
              disabled={!catalog.locations}
            >
              <Icon name="folder" size={16} />
              Locais de estoque
            </button>
            <button type="button" onClick={() => setHistoryOpen(true)}>
              <Icon name="receipt" size={16} />
              Histórico de reposições
            </button>
            {canReplenish && (
              <button
                type="button"
                className="primary"
                disabled={loading || !catalog.products || !catalog.locations || !balances.length}
                onClick={() => setReplenishOpen(true)}
              >
                <Icon name="plus" size={16} />
                Reposição em massa
              </button>
            )}
            <button
              type="button"
              disabled={loading || reloading}
              onClick={() => {
                setReloading(true);
                void onChange().finally(() => setReloading(false));
              }}
            >
              <Icon name="refresh" size={16} />
              Atualizar
            </button>
          </div>
        }
      />
      <section className="panel inventory-overview" aria-label="Saldos de estoque">
        <div className="product-config-filters">
          <label className="input-icon">
            <Icon name="search" size={16} />
            <input
              type="search"
              aria-label="Buscar no estoque"
              placeholder="Produto, variação ou local…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Local
            <SearchSelect
              label="Filtrar local no estoque"
              value={location}
              onChange={setLocation}
              options={locations.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
              placeholder="Todos os locais"
            />
          </label>
        </div>
        {loading ? (
          <TableLoading label="Carregando estoques…" />
        ) : rows.length ? (
          <div className="data-table">
            <table
              className="inventory-card-table inventory-overview-table"
              aria-label="Saldos por produto e local"
            >
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Variação</th>
                  <th>Local</th>
                  <th>Físico</th>
                  <th>Reservado</th>
                  <th>Disponível</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paging.rows.map((b) => (
                  <tr key={b.id}>
                    <td data-label="Produto">
                      <strong>
                        {productLabel(
                          products.find((p) => p.id === b.product_id) ?? { name: b.product_id },
                          variants.find((v) => v.id === b.variant_id)?.name,
                        )}
                      </strong>
                    </td>
                    <td data-label="Variação">
                      {variants.find((v) => v.id === b.variant_id)?.name ?? 'Compartilhado'}
                    </td>
                    <td data-label="Local">
                      <RecordTag color={locations.find((l) => l.id === b.location_id)?.color}>
                        {locations.find((l) => l.id === b.location_id)?.name ?? 'Local'}
                      </RecordTag>
                    </td>
                    <td data-label="Físico">
                      {stockQuantity(b.physical_quantity)}{' '}
                      {unitSymbol(
                        products.find((product) => product.id === b.product_id)?.unit_code,
                      )}
                    </td>
                    <td data-label="Reservado">
                      {stockQuantity(b.reserved_quantity)}{' '}
                      {unitSymbol(
                        products.find((product) => product.id === b.product_id)?.unit_code,
                      )}
                    </td>
                    <td data-label="Disponível">
                      {stockQuantity(Number(b.physical_quantity) - Number(b.reserved_quantity))}{' '}
                      {unitSymbol(
                        products.find((product) => product.id === b.product_id)?.unit_code,
                      )}
                    </td>
                    <td data-label="Ações">
                      <div className="button-row">
                        {canReplenish && (
                          <button
                            type="button"
                            onClick={() =>
                              locationEditor.open(
                                b,
                                productLabel(
                                  products.find((p) => p.id === b.product_id) ?? {
                                    name: b.product_id,
                                  },
                                  variants.find((v) => v.id === b.variant_id)?.name,
                                ),
                              )
                            }
                          >
                            <Icon name="folder" size={16} /> Alterar local
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setProduct(
                              products.find((p) => p.id === b.product_id) ?? { id: b.product_id },
                            )
                          }
                        >
                          <Icon name="inventory" size={16} />
                          Gerenciar produto
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nenhum saldo encontrado. Vincule estoques pelo cadastro do produto.</Empty>
        )}
        <Pagination
          label="Saldos do estoque"
          total={paging.total}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageChange={paging.onPageChange}
          onPageSizeChange={paging.onPageSizeChange}
          loading={loading || reloading}
        />
      </section>
      {locationsOpen && (
        <StockLocations
          locations={locations}
          canAdjust={Boolean(canReplenish)}
          refresh={onChange}
          onClose={() => setLocationsOpen(false)}
        />
      )}
      {replenishOpen && (
        <ReplenishmentModal
          balances={balances}
          catalog={catalog}
          onClose={() => setReplenishOpen(false)}
          onSaved={(record) => {
            setReplenishOpen(false);
            setReplenishment(record);
            void onChange();
          }}
        />
      )}
      {historyOpen && <ReplenishmentHistory onClose={() => setHistoryOpen(false)} />}
      {replenishment && (
        <ReplenishmentDetail record={replenishment} onClose={() => setReplenishment(null)} />
      )}
      {product && (
        <ProductManagementModal
          record={product}
          initialTab="balances"
          onClose={() => setProduct(null)}
          onChange={onChange}
        />
      )}
      {locationEditor.dialog}
    </section>
  );
}
