import { Pagination, TableLoading, paginate } from './pagination.js';
import { FormFields, formValuesChanged, serializeFormValues, type Field } from './forms.js';
import { useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Empty, Modal, ModalCloseButton, useAction } from './common.js';
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
  const [editing, setEditing] = useState<Data | null>(null);
  const [values, setValues] = useState<Data>({});
  const [initialValues, setInitialValues] = useState<Data>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [refreshing, setRefreshing] = useState(false);
  const { run, busy, feedback, refresh: refreshRecords } = useAction();
  async function reload() {
    setRefreshing(true);
    try {
      await refreshRecords(async () => await onChange());
    } finally {
      setRefreshing(false);
    }
  }
  function openEditor(record: Data) {
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
  const { rows: visible } = paginate(filtered, page, size);
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
      <div className="list-toolbar">
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
      </div>
      {loading ? (
        <TableLoading label={'Carregando ' + title + '…'} />
      ) : visible.length ? (
        <div className="data-table">
          <table className="resource-table">
            <thead>
              <tr>
                <th>{primary?.label ?? 'Registro'}</th>
                {columns.map((f) => (
                  <th key={f.key}>{f.label.replace(/\s*\(.*\)$/, '')}</th>
                ))}
                {!readOnly && <th className="actions-column">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    {render ? (
                      render(r)
                    ) : fields.some((f) => f.type === 'color') ? (
                      <RecordTag color={r.color}>
                        {primary ? text(r, primary) : r.id.slice(0, 8)}
                      </RecordTag>
                    ) : (
                      <strong>{primary ? text(r, primary) : r.id.slice(0, 8)}</strong>
                    )}
                  </td>
                  {columns.map((f) => (
                    <td key={f.key}>
                      {f.type === 'color' ? (
                        <RecordTag color={r[f.key]}>{r[f.key] ?? 'Padrão'}</RecordTag>
                      ) : f.type === 'checkbox' ? (
                        <span className={`badge ${r[f.key] ? 'available' : 'cancelled'}`}>
                          {f.key === 'enabled'
                            ? r[f.key]
                              ? 'Ativo'
                              : 'Inativo'
                            : r[f.key]
                              ? 'Sim'
                              : 'Não'}
                        </span>
                      ) : f.type === 'currency' ? (
                        brl(r[f.key])
                      ) : (
                        text(r, f)
                      )}
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="actions-column">
                      <span className="resource-row-actions">
                        <button
                          className="table-action"
                          title="Editar"
                          aria-label={`Editar ${primary ? text(r, primary) : 'registro'}`}
                          onClick={() => openEditor(r)}
                        >
                          <Icon name="edit" size={17} />
                        </button>
                        {renderActions?.(r)}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>
          {search ? 'Nenhum registro encontrado para esta busca.' : 'Nenhum registro cadastrado.'}
        </Empty>
      )}
      <Pagination
        label={title}
        total={filtered.length}
        page={page}
        pageSize={size}
        onPageChange={setPage}
        onPageSizeChange={setSize}
        loading={loading || refreshing}
        searchableSize
        sizeLabel={`Registros por página em ${title}`}
      />
      {editing && (
        <Modal
          title={`${editing.id ? 'Editar' : 'Adicionar'} · ${title}`}
          dirty={formValuesChanged(values, initialValues)}
          closeDisabled={busy}
          onClose={() => setEditing(null)}
        >
          <p className="modal-description">Preencha os dados e salve para atualizar a lista.</p>
          <form
            className="form-grid"
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
