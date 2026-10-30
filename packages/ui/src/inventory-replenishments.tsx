import { unitSymbol } from '../../shared/src/measurement-units.js';
import { NumericInput } from './numeric-input.js';
import { RecordTag } from './record-tags.js';
import { useEffect, useRef, useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Modal, ModalCloseButton, Empty, useAction, useRefresh } from './common.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { MoneyInput } from './money-input.js';
import { normalizeMoney } from './money.js';
import { normalizeStockQuantity, stockQuantity } from './stock-quantity.js';
import { normalizeOrderSearch } from './orders-view.js';
import { Pagination, TableLoading, useClientPagination } from './pagination.js';
import { operationTime, shortId } from './operation-format.js';
import { replenishmentCosts } from '../../shared/src/replenishment.js';
import { useToasts } from './toasts.js';
type Selection = Record<string, { quantity: string; unit_cost: string }>;
export function ReplenishmentModal({
  balances,
  catalog,
  onClose,
  onSaved,
}: {
  balances: Data[];
  catalog: Data;
  onClose: () => void;
  onSaved: (record: Data) => void;
}) {
  const [selected, setSelected] = useState<Selection>({}),
    [search, setSearch] = useState(''),
    [location, setLocation] = useState(''),
    [onlySelected, setOnlySelected] = useState(false);
  const [fields, setFields] = useState({
    supplier_name: '',
    invoice_number: '',
    freight: '',
    discount: '',
    notes: '',
  });
  const { run, busy, feedback } = useAction(),
    toast = useToasts();
  const attempt = useRef({ signature: '', key: crypto.randomUUID() });
  const products = new Map<string, Data>(
      (catalog.products ?? []).map((item: Data) => [item.id, item]),
    ),
    variants = new Map<string, Data>((catalog.variants ?? []).map((item: Data) => [item.id, item])),
    locations: Data[] = catalog.locations ?? [];
  const described: Data[] = balances
    .filter((balance) => !variants.get(balance.variant_id)?.deleted_at)
    .map((balance) => ({
      ...balance,
      product_name: products.get(balance.product_id)?.name ?? 'Produto',
      unit_code: products.get(balance.product_id)?.unit_code ?? 'UN',
      variant_name: variants.get(balance.variant_id)?.name ?? 'Compartilhado',
      location_name: locations.find((item) => item.id === balance.location_id)?.name ?? 'Local',
      location_color: locations.find((item) => item.id === balance.location_id)?.color,
    }));
  const filtered = described.filter(
    (balance) =>
      (!location || balance.location_id === location) &&
      (!onlySelected || selected[balance.id]) &&
      normalizeOrderSearch(
        [balance.product_name, balance.variant_name, balance.location_name].join(' '),
      ).includes(normalizeOrderSearch(search)),
  );
  const paging = useClientPagination(filtered, JSON.stringify({ search, location, onlySelected }));
  const count = Object.keys(selected).length;
  function toggle(id: string) {
    if (!selected[id] && count >= 100) {
      toast.error('Selecione até 100 estoques por reposição.');
      return;
    }
    setSelected((previous) => {
      const next = { ...previous };
      if (next[id]) delete next[id];
      else if (Object.keys(next).length < 100) next[id] = { quantity: '', unit_cost: '' };
      else return previous;
      return next;
    });
  }
  function update(id: string, key: 'quantity' | 'unit_cost', value: string) {
    setSelected((previous) => ({ ...previous, [id]: { ...previous[id], [key]: value } }));
  }
  function pageSelection() {
    const missing = paging.rows.filter((row) => !selected[row.id]);
    if (count + missing.length > 100) {
      toast.error('Selecione até 100 estoques por reposição.');
      return;
    }
    setSelected((previous) => ({
      ...previous,
      ...Object.fromEntries(missing.map((row) => [row.id, { quantity: '', unit_cost: '' }])),
    }));
  }
  let preview: ReturnType<typeof replenishmentCosts> | null = null;
  try {
    if (count)
      preview = replenishmentCosts(
        Object.values(selected).map((item) => ({
          quantity: normalizeStockQuantity(item.quantity || '0'),
          unit_cost: item.unit_cost ? normalizeMoney(item.unit_cost) : null,
        })),
        fields.freight ? normalizeMoney(fields.freight) : '0.00',
        fields.discount ? normalizeMoney(fields.discount) : '0.00',
      );
  } catch {
    /* The submit path gives the specific validation message. */
  }
  return (
    <Modal
      title="Reposição em massa"
      className="stock-replenishment-modal"
      dirty={count > 0 || Object.values(fields).some(Boolean)}
      closeDisabled={busy}
      onClose={onClose}
    >
      <form
        className="replenishment-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (!count) throw new Error('Selecione ao menos um estoque para repor.');
            const items = Object.entries(selected)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([balance_id, item]) => {
                try {
                  return {
                    balance_id,
                    quantity: normalizeStockQuantity(item.quantity, { positive: true }),
                    unit_cost: item.unit_cost ? normalizeMoney(item.unit_cost) : null,
                  };
                } catch (error) {
                  const balance = described.find((row) => row.id === balance_id);
                  throw new Error(
                    `${balance?.product_name ?? 'Estoque'} · ${balance?.location_name ?? ''}: ${(error as Error).message}`,
                  );
                }
              });
            const data = {
              ...fields,
              supplier_name: fields.supplier_name.trim(),
              invoice_number: fields.invoice_number.trim(),
              notes: fields.notes.trim(),
              freight: fields.freight ? normalizeMoney(fields.freight) : '0.00',
              discount: fields.discount ? normalizeMoney(fields.discount) : '0.00',
              items,
            };
            replenishmentCosts(items, data.freight, data.discount);
            const signature = JSON.stringify(data);
            if (attempt.current.signature !== signature)
              attempt.current = { signature, key: crypto.randomUUID() };
            onSaved(await api('/inventory/replenishments', data, 'POST', attempt.current.key));
          }, 'Reposição registrada.');
        }}
      >
        <fieldset disabled={busy}>
          <p className="modal-description">
            Selecione os estoques e informe quanto deseja adicionar em cada um. Produto, variação e
            local identificam cada saldo.
          </p>
          <div className="replenishment-fields">
            <label>
              Fornecedor (opcional)
              <input
                aria-label="Fornecedor da reposição"
                maxLength={160}
                value={fields.supplier_name}
                onChange={(e) => setFields({ ...fields, supplier_name: e.target.value })}
                placeholder="Nome do fornecedor"
              />
            </label>
            <label>
              Número da nota (opcional)
              <input
                aria-label="Número da nota"
                maxLength={80}
                value={fields.invoice_number}
                onChange={(e) => setFields({ ...fields, invoice_number: e.target.value })}
                placeholder="Ex.: 000123 / série 1"
              />
            </label>
            <label>
              Frete (opcional)
              <MoneyInput
                label="Frete da reposição"
                value={fields.freight}
                onChange={(value) => setFields({ ...fields, freight: value })}
              />
            </label>
            <label>
              Desconto (opcional)
              <MoneyInput
                label="Desconto da reposição"
                value={fields.discount}
                onChange={(value) => setFields({ ...fields, discount: value })}
              />
            </label>
          </div>
          <div className="replenishment-filters">
            <label>
              Buscar estoque
              <input
                type="search"
                aria-label="Buscar estoques para repor"
                placeholder="Produto, variação ou local…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Local
              <SearchSelect
                label="Local para reposição"
                value={location}
                onChange={setLocation}
                options={locations.map((item) => ({
                  id: item.id,
                  name: item.name,
                  color: item.color,
                }))}
                placeholder="Todos os locais"
              />
            </label>
          </div>
          <div className="replenishment-selection">
            <strong>{count} estoque(s) selecionado(s)</strong>
            <div className="button-row">
              <button type="button" onClick={pageSelection} disabled={!paging.rows.length}>
                Selecionar página
              </button>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={onlySelected}
                  onChange={(e) => setOnlySelected(e.target.checked)}
                />
                Só selecionados
              </label>
            </div>
          </div>
          <p className="field-hint">
            Até 100 estoques por reposição. Custo de compra por medida do produto é opcional;
            informe todos os custos para calcular o total.
          </p>
          {paging.rows.length ? (
            <div className="data-table">
              <table
                className="inventory-card-table replenishment-picker"
                aria-label="Estoques para reposição"
              >
                <thead>
                  <tr>
                    <th>Selecionar</th>
                    <th>Estoque</th>
                    <th>Físico atual</th>
                    <th>Quantidade a repor</th>
                    <th>Custo unitário (opcional)</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.rows.map((balance) => (
                    <tr key={balance.id} className={selected[balance.id] ? 'is-selected' : ''}>
                      <td data-label="Selecionar">
                        <input
                          type="checkbox"
                          aria-label={
                            'Selecionar ' +
                            balance.product_name +
                            ' · ' +
                            balance.variant_name +
                            ' · ' +
                            balance.location_name
                          }
                          checked={Boolean(selected[balance.id])}
                          onChange={() => toggle(balance.id)}
                        />
                      </td>
                      <td data-label="Estoque">
                        <strong>{balance.product_name}</strong>
                        <div className="replenishment-stock-meta">
                          <span>{balance.variant_name}</span>
                          <RecordTag color={balance.location_color}>
                            {balance.location_name}
                          </RecordTag>
                        </div>
                      </td>
                      <td data-label="Físico atual">
                        {stockQuantity(balance.physical_quantity)} {unitSymbol(balance.unit_code)}
                      </td>
                      <td data-label="Quantidade a repor">
                        <NumericInput
                          label={
                            'Quantidade a repor · ' +
                            balance.product_name +
                            ' · ' +
                            balance.variant_name +
                            ' · ' +
                            balance.location_name
                          }
                          positive
                          required={Boolean(selected[balance.id])}
                          disabled={!selected[balance.id]}
                          value={selected[balance.id]?.quantity ?? ''}
                          placeholder={`Quantidade em ${unitSymbol(balance.unit_code)}`}
                          onChange={(value) => update(balance.id, 'quantity', value)}
                        />
                      </td>
                      <td data-label="Custo unitário">
                        <fieldset disabled={!selected[balance.id]}>
                          <MoneyInput
                            label={
                              'Custo unitário · ' +
                              balance.product_name +
                              ' · ' +
                              balance.variant_name +
                              ' · ' +
                              balance.location_name
                            }
                            value={selected[balance.id]?.unit_cost ?? ''}
                            onChange={(value) => {
                              if (selected[balance.id]) update(balance.id, 'unit_cost', value);
                            }}
                          />
                        </fieldset>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nenhum estoque corresponde aos filtros.</Empty>
          )}
          <Pagination
            label="Estoques para repor"
            total={paging.total}
            page={paging.page}
            pageSize={paging.pageSize}
            onPageChange={paging.onPageChange}
            onPageSizeChange={paging.onPageSizeChange}
            loading={busy}
          />
          <label>
            Observações (opcional)
            <textarea
              aria-label="Observações da reposição"
              rows={2}
              maxLength={500}
              value={fields.notes}
              onChange={(e) => setFields({ ...fields, notes: e.target.value })}
            />
          </label>
        </fieldset>
        {feedback}
        <div className="replenishment-summary">
          <span>
            Subtotal
            <strong>{preview?.subtotal != null ? brl(preview.subtotal) : 'Não informado'}</strong>
          </span>
          <span>
            Frete<strong>{brl(fields.freight || '0.00')}</strong>
          </span>
          <span>
            Desconto<strong>{brl(fields.discount || '0.00')}</strong>
          </span>
          <span>
            Total da reposição
            <strong>{preview?.total != null ? brl(preview.total) : 'Não calculado'}</strong>
          </span>
        </div>
        <div className="modal-footer">
          <ModalCloseButton disabled={busy} />
          <button className="primary" disabled={busy || !count}>
            <Icon name="check" size={16} />
            {busy ? 'Registrando…' : 'Confirmar reposição'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ReplenishmentDetail({ record, onClose }: { record: Data; onClose: () => void }) {
  const paging = useClientPagination<Data>(record.items, record.id);
  return (
    <Modal
      title={'Reposição ' + shortId(record.id)}
      className="stock-replenishment-modal"
      onClose={onClose}
    >
      <div className="replenishment-detail">
        <p className="modal-description">
          Registrada em {operationTime(record.created_at)} por{' '}
          {record.created_by_name ?? 'Operador'}. {record.item_count} estoque(s) reposto(s).
        </p>
        <dl className="replenishment-metadata">
          <div>
            <dt>Fornecedor</dt>
            <dd>{record.supplier_name || 'Não informado'}</dd>
          </div>
          <div>
            <dt>Número da nota</dt>
            <dd>{record.invoice_number || 'Não informado'}</dd>
          </div>
        </dl>
        <div className="data-table">
          <table
            className="inventory-card-table replenishment-detail-table"
            aria-label="Itens da reposição"
          >
            <thead>
              <tr>
                <th>Produto / estoque</th>
                <th>Entrada</th>
                <th>Físico antes → depois</th>
                <th>Custo unitário</th>
                <th>Total do item</th>
              </tr>
            </thead>
            <tbody>
              {paging.rows.map((item) => (
                <tr key={item.id}>
                  <td data-label="Produto / estoque">
                    <strong>{item.product_name}</strong>
                    <div className="replenishment-stock-meta">
                      <span>{item.variant_name || 'Compartilhado'}</span>
                      <RecordTag color={item.location_color}>{item.location_name}</RecordTag>
                    </div>
                  </td>
                  <td data-label="Entrada">
                    +{stockQuantity(item.quantity)} {unitSymbol(item.unit_code)}
                  </td>
                  <td data-label="Físico antes → depois">
                    {stockQuantity(item.physical_before)} → {stockQuantity(item.physical_after)}{' '}
                    {unitSymbol(item.unit_code)}
                  </td>
                  <td data-label="Custo unitário">
                    {item.unit_cost == null ? 'Não informado' : brl(item.unit_cost)}
                  </td>
                  <td data-label="Total do item">
                    {item.line_total == null ? 'Não informado' : brl(item.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          label="Itens da reposição"
          total={paging.total}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageChange={paging.onPageChange}
          onPageSizeChange={paging.onPageSizeChange}
        />
        {record.notes && (
          <p className="replenishment-notes">
            <strong>Observações</strong>
            <span>{record.notes}</span>
          </p>
        )}
        <div className="replenishment-summary">
          <span>
            Subtotal
            <strong>{record.subtotal == null ? 'Não informado' : brl(record.subtotal)}</strong>
          </span>
          <span>
            Frete<strong>{brl(record.freight)}</strong>
          </span>
          <span>
            Desconto<strong>{brl(record.discount)}</strong>
          </span>
          <span>
            Total registrado
            <strong>{record.total == null ? 'Não calculado' : brl(record.total)}</strong>
          </span>
        </div>
        {record.total == null && (
          <p className="field-hint">
            Reposição registrada com custos não informados em um ou mais itens.
          </p>
        )}
      </div>
      <div className="modal-footer">
        <ModalCloseButton>Fechar reposição</ModalCloseButton>
      </div>
    </Modal>
  );
}
export function ReplenishmentHistory({ onClose }: { onClose: () => void }) {
  const [response, setResponse] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(''),
    [debounced, setDebounced] = useState(''),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [detail, setDetail] = useState<Data | null>(null);
  const version = useRef(0),
    pending = useRef<AbortController | null>(null),
    alive = useRef(true);
  const { run, busy } = useAction();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
      version.current++;
    };
  }, []);
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(size),
    search: debounced,
  }).toString();
  const matching = response?._key === query;
  const records: Data[] = matching ? response!.rows : [];
  const busyQuery = loading || search.trim() !== debounced || !matching;
  async function load() {
    const current = ++version.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const data = await api(
        '/inventory/replenishments?' + query,
        undefined,
        undefined,
        undefined,
        'json',
        controller.signal,
      );
      if (alive.current && current === version.current) {
        setResponse({ ...data, _key: query });
        setError('');
        if (data.page !== page) setPage(data.page);
      }
    } catch (error) {
      if (alive.current && current === version.current) setError((error as Error).message);
    } finally {
      if (alive.current && current === version.current) setLoading(false);
    }
  }
  useRefresh(load, [query]);
  return (
    <Modal title="Histórico de reposições" className="stock-replenishment-modal" onClose={onClose}>
      <div className="replenishment-history">
        <div className="section-head">
          <p className="muted small">
            Consulte entradas, fornecedores, notas e custos registrados nesta unidade.
          </p>
          <button disabled={loading} onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Atualizar
          </button>
        </div>
        <label>
          Buscar reposição
          <input
            type="search"
            aria-label="Buscar reposições"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Fornecedor, nota, produto ou local…"
          />
        </label>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button onClick={() => void load()} disabled={loading}>
              Tentar novamente
            </button>
          </div>
        )}
        {busyQuery && !error ? (
          <TableLoading label="Carregando reposições…" />
        ) : records.length ? (
          <div className="data-table">
            <table
              className="inventory-card-table replenishment-history-table"
              aria-label="Reposições registradas"
            >
              <thead>
                <tr>
                  <th>Registro</th>
                  <th>Fornecedor / nota</th>
                  <th>Estoques</th>
                  <th>Total</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record: Data) => (
                  <tr key={record.id}>
                    <td data-label="Registro">
                      <strong>{shortId(record.id)}</strong>
                      <small>{operationTime(record.created_at)}</small>
                    </td>
                    <td data-label="Fornecedor / nota">
                      <strong>{record.supplier_name || 'Fornecedor não informado'}</strong>
                      <small>
                        {record.invoice_number
                          ? 'Nota ' + record.invoice_number
                          : 'Nota não informada'}
                      </small>
                    </td>
                    <td data-label="Estoques">{record.item_count}</td>
                    <td data-label="Total">
                      {record.total == null ? 'Não informado' : brl(record.total)}
                    </td>
                    <td data-label="Ações">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () =>
                            setDetail(await api('/inventory/replenishments/' + record.id)),
                          )
                        }
                      >
                        <Icon name="eye" size={16} />
                        Ver reposição
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <Empty>Nenhuma reposição encontrada para estes filtros.</Empty>
        ) : null}
        <Pagination
          label="Reposições"
          total={matching ? response!.total : 0}
          page={response?._key === query ? response.page : page}
          pageSize={size}
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setSize(value);
            setPage(1);
          }}
          loading={busyQuery && !error}
        />
      </div>
      <div className="modal-footer">
        <ModalCloseButton>Fechar histórico</ModalCloseButton>
      </div>
      {detail && <ReplenishmentDetail record={detail} onClose={() => setDetail(null)} />}
    </Modal>
  );
}
