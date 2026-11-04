import { paginate } from './pagination.js';
import {
  DataTable,
  TableToolbar,
  TableActions,
  type DataColumn,
  type TableSort,
} from './data-table.js';
import { ErrorState } from './data-display.js';
import { useFormValidation } from './form-field.js';
import { useManagementInterface } from './interface-scope.js';
import { FormFields, formValuesChanged, serializeFormValues, type Field } from './forms.js';
import { useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { Icon } from './appearance.js';
import { RecordTag } from './record-tags.js';
export type { Field } from './forms.js';
export function Resource({
  path,
  fields,
  title,
  records,
  onChange,
  render,
  renderActions,
  readOnly = false,
  loading = false,
}: {
  readOnly?: boolean;
  loading?: boolean;
  path: string;
  fields: Field[];
  title: string;
  records: Data[];
  onChange: () => void | Promise<void>;
  render?: (record: Data) => React.ReactNode;
  renderActions?: (record: Data) => React.ReactNode;
}) {
  const enhanced = useManagementInterface();
  const [sort, setSort] = useState<TableSort | null>(null);
  const [editing, setEditing] = useState<Data | null>(null);
  const [values, setValues] = useState<Data>({});
  const [initialValues, setInitialValues] = useState<Data>({});
  const validation = useFormValidation(editing);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [refreshing, setRefreshing] = useState(false);
  const { run, busy, feedback, error, clearError, refresh: refreshRecords } = useAction();
  async function reload() {
    setRefreshing(true);
    try {
      await refreshRecords(async () => await onChange());
    } finally {
      setRefreshing(false);
    }
  }
  function openEditor(record: Data) {
    clearError();
    const initial = Object.fromEntries(
      fields.map((field) => {
        const value =
          record[field.key] ?? field.initial ?? (field.type === 'checkbox' ? false : '');
        return [field.key, field.type === 'checkbox' ? Boolean(value) : value];
      }),
    );
    setInitialValues(initial);
    setValues(initial);
    setEditing(record);
  }
  const primary = fields.find((f) => f.key === 'name' || f.key === 'number') ?? fields[0];
  const columns = fields
    .filter(
      (f) =>
        f.key !== primary?.key &&
        !['description', 'position_x', 'position_y', 'password', 'layout_json'].includes(f.key) &&
        (path !== 'products' || f.key !== 'requires_production'),
    )
    .slice(0, 4);
  const text = (record: Data, field: Field) =>
    field.options?.find((o) => o.id === String(record[field.key]))?.name ??
    String(record[field.key] ?? '—');
  const filtered = records.filter((r) =>
    [primary, ...columns]
      .filter(Boolean)
      .map((f) => text(r, f!))
      .join(' ')
      .toLocaleLowerCase('pt-BR')
      .includes(search.toLocaleLowerCase('pt-BR')),
  );
  if (enhanced && sort) {
    const field = [primary, ...columns].find((field) => field?.key === sort.key);
    if (field) {
      const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
      filtered.sort((a, b) => {
        const difference = ['currency', 'number', 'quantity'].includes(field.type ?? '')
          ? Number(a[field.key] ?? 0) - Number(b[field.key] ?? 0)
          : collator.compare(text(a, field), text(b, field));
        return sort.direction === 'asc' ? difference : -difference;
      });
    }
  }
  function changeSort(next: TableSort | null) {
    setSort(next);
    setPage(1);
  }
  const { rows: visible } = paginate(filtered, page, size);
  const tableColumns: DataColumn<Data>[] = [
    {
      id: primary?.key ?? '_primary',
      label: primary?.label ?? 'Registro',
      sortable: true,
      render: (record) =>
        render ? (
          render(record)
        ) : fields.some((field) => field.type === 'color') ? (
          <RecordTag color={record.color}>
            {primary ? text(record, primary) : record.id.slice(0, 8)}
          </RecordTag>
        ) : (
          <strong>{primary ? text(record, primary) : record.id.slice(0, 8)}</strong>
        ),
    },
    ...columns.map((field) => ({
      id: field.key,
      label: field.label.replace(/\s*\(.*\)$/, ''),
      sortable: true,
      align: ['currency', 'number', 'quantity'].includes(field.type ?? '')
        ? ('right' as const)
        : ('left' as const),
      render: (record: Data) =>
        field.type === 'color' ? (
          <RecordTag color={record[field.key]}>{record[field.key] ?? 'Padrão'}</RecordTag>
        ) : field.type === 'checkbox' ? (
          <span className={`badge ${record[field.key] ? 'available' : 'cancelled'}`}>
            {field.key === 'enabled'
              ? record[field.key]
                ? 'Ativo'
                : 'Inativo'
              : record[field.key]
                ? 'Sim'
                : 'Não'}
          </span>
        ) : field.type === 'currency' ? (
          brl(record[field.key])
        ) : (
          text(record, field)
        ),
    })),
    ...(!readOnly
      ? [
          {
            id: '_actions',
            label: 'Ações',
            className: 'actions-column',
            align: 'right' as const,
            render: (record: Data) => (
              <TableActions className="resource-row-actions">
                <button
                  className="table-action"
                  title="Editar"
                  aria-label={`Editar ${primary ? text(record, primary) : 'registro'}`}
                  onClick={() => openEditor(record)}
                >
                  <Icon name="edit" size={17} />
                </button>
                {renderActions?.(record)}
              </TableActions>
            ),
          },
        ]
      : []),
  ];
  return (
    <section className="panel resource-panel" aria-busy={loading || refreshing}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <p className="muted small">Consulte e gerencie os registros do estabelecimento.</p>
        </div>
        <div className="button-row">
          <button
            disabled={loading || refreshing}
            onClick={() => void reload()}
            aria-label={`Recarregar ${title}`}
          >
            <Icon name="refresh" size={16} />
            Recarregar
          </button>
          {!readOnly && (
            <button className="primary" onClick={() => openEditor({})}>
              <Icon name="plus" size={16} />
              Adicionar
            </button>
          )}
        </div>
      </div>
      {feedback}
      <TableToolbar label={'Filtros de ' + title}>
        <label className="input-icon search-control">
          <Icon name="search" size={17} />
          <input
            type="search"
            aria-label={`Buscar em ${title}`}
            placeholder="Buscar registros…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {enhanced && (
          <label className="resource-sort-control">
            <span>Ordenar por</span>
            <select
              aria-label={'Ordenar ' + title}
              value={sort ? sort.key + ':' + sort.direction : ''}
              onChange={(event) => {
                if (!event.target.value) changeSort(null);
                else {
                  const [key, direction] = event.target.value.split(':');
                  changeSort({ key, direction: direction as 'asc' | 'desc' });
                }
              }}
            >
              <option value="">Ordem original</option>
              {[primary, ...columns].filter(Boolean).flatMap((field) =>
                (['asc', 'desc'] as const).map((direction) => (
                  <option key={field!.key + direction} value={field!.key + ':' + direction}>
                    {field!.label} · {direction === 'asc' ? 'Crescente' : 'Decrescente'}
                  </option>
                )),
              )}
            </select>
          </label>
        )}
      </TableToolbar>
      <DataTable
        columns={tableColumns}
        rows={visible}
        rowKey={(record) => record.id}
        label={title}
        className="resource-table mobile-card-table"
        loading={loading}
        sort={sort}
        onSortChange={enhanced ? changeSort : undefined}
        empty={
          search ? 'Nenhum registro encontrado para esta busca.' : 'Nenhum registro cadastrado.'
        }
        pagination={{
          label: title,
          total: filtered.length,
          page,
          pageSize: size,
          onPageChange: setPage,
          onPageSizeChange: setSize,
          loading: loading || refreshing,
          searchableSize: true,
          sizeLabel: `Registros por página em ${title}`,
        }}
      />
      {editing && (
        <Modal
          title={`${editing.id ? 'Editar' : 'Adicionar'} · ${title}`}
          size="form"
          dirty={formValuesChanged(values, initialValues)}
          closeDisabled={busy}
          onClose={() => setEditing(null)}
        >
          <p className="modal-description">Preencha os dados e salve para atualizar a lista.</p>
          <form
            className="form-grid"
            onInvalidCapture={validation.onInvalidCapture}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = serializeFormValues(fields, values);
                await api(
                  `/${path}${editing.id ? `/${editing.id}` : ''}`,
                  data,
                  editing.id ? 'PATCH' : 'POST',
                );
                setEditing(null);
                await reload();
              }, 'Cadastro salvo.');
            }}
          >
            {validation.summary}
            {error && <ErrorState title="Não foi possível salvar" message={error} />}
            <FormFields fields={fields} values={values} onChange={setValues} />
            {feedback}
            <div className="modal-footer">
              <ModalCloseButton disabled={busy} />
              <button className="primary" disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
