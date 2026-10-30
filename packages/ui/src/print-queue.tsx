import { printDocumentLabel } from '../../shared/src/table-qr-print.js';
import { useState } from 'react';
import { api, statusLabel, type Data } from './client.js';
import { Badge, Empty, useAction } from './common.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import { Pagination, TableLoading, useClientPagination } from './pagination.js';
import { operationTime, shortId } from './operation-format.js';
const active = (job: Data) => ['PENDING', 'PROCESSING', 'FAILED'].includes(job.status);
const cancellationNote =
  'O cancelamento interrompe os envios e as novas tentativas na fila do sistema. Documentos já enviados ao PrintBridge ou à impressora podem terminar; confira a fila local nesses casos. Os pedidos, as fichas e os cupons permanecem registrados.';
export function PrintQueue({
  jobs,
  printers,
  loading,
  onChange,
  scopeKey,
}: {
  jobs: Data[];
  printers: Data[];
  loading: boolean;
  onChange: () => Promise<void>;
  scopeKey: string;
}) {
  const [status, setStatus] = useState('ALL'),
    [search, setSearch] = useState('');
  const forms = useFormDialog(),
    { run, busy } = useAction();
  const pending = jobs.filter(active),
    processing = pending.filter((j) => j.status === 'PROCESSING').length;
  const printerName = (id: string) => printers.find((p) => p.id === id)?.name ?? 'Impressora';
  const filtered = jobs.filter(
    (j) =>
      (status === 'ALL' || j.status === status) &&
      [j.id, printDocumentLabel(j.document_kind), printerName(j.printer_id), statusLabel[j.status]]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
  );
  const paging = useClientPagination(filtered, JSON.stringify({ scopeKey, status, search }));
  function cancel(job?: Data) {
    const key = crypto.randomUUID();
    forms.open({
      title: job ? 'Cancelar impressão' : 'Cancelar fila de impressão',
      description:
        (job
          ? `Cancelar ${printDocumentLabel(job.document_kind).toLowerCase()} ${shortId(job.id)} de ${printerName(job.printer_id)}? `
          : `Cancelar todas as ${pending.length} impressões pendentes, em processamento ou com falha desta unidade, inclusive fora desta página e dos filtros? `) +
        cancellationNote,
      fields: [
        {
          key: 'reason',
          label: 'Motivo do cancelamento (opcional)',
          type: 'textarea',
          maxLength: 255,
        },
      ],
      submitLabel: job ? 'Confirmar cancelamento' : 'Cancelar toda a fila',
      submitVariant: 'danger',
      successMessage: job ? 'Impressão cancelada no sistema.' : 'Fila cancelada no sistema.',
      onSubmit: async (values) => {
        const result = await api(
          job ? `/print/jobs/${job.id}/cancel` : '/print/jobs/cancel',
          values,
          'POST',
          key,
        );
        await onChange();
        return result;
      },
    });
  }
  function retry(job: Data) {
    if (job.bridge_delivery)
      forms.open({
        title: 'Confirmar nova via',
        description:
          'Confira a fila do sistema e a saída física antes de reenviar. Um resultado incerto pode já ter impresso. Uma nova emissão terá outra chave no PrintBridge.',
        fields: [
          {
            key: 'reason',
            label: 'Motivo da nova via',
            type: 'textarea',
            required: true,
            minLength: 3,
            maxLength: 255,
          },
        ],
        submitLabel: 'Solicitar nova via',
        successMessage: 'Nova via adicionada à fila.',
        onSubmit: async (values) => {
          await api(`/print/jobs/${job.id}/retry`, values);
          await onChange();
        },
      });
    else
      void run(async () => {
        await api(`/print/jobs/${job.id}/retry`, {});
        await onChange();
      }, 'Impressão adicionada à fila.');
  }
  return (
    <section className="panel print-queue-panel">
      <div className="section-head">
        <div>
          <h2>Fila de impressão</h2>
          <p className="muted small">
            {pending.length} a concluir · {processing} em processamento
          </p>
        </div>
        <div className="button-row">
          <button type="button" disabled={busy || loading} onClick={() => void run(onChange)}>
            <Icon name="refresh" size={16} />
            Atualizar fila
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy || loading || !pending.length}
            onClick={() => cancel()}
          >
            <Icon name="close" size={16} />
            Cancelar fila
          </button>
        </div>
      </div>
      <p className="product-management-note">{cancellationNote}</p>
      <div className="product-config-filters">
        <label>
          Buscar impressão
          <span className="input-icon">
            <Icon name="search" size={16} />
            <input
              type="search"
              aria-label="Buscar na fila de impressão"
              placeholder="Código, documento ou impressora…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </span>
        </label>
        <label>
          Situação
          <SearchSelect
            label="Situação da impressão"
            value={status}
            allowClear={false}
            onChange={setStatus}
            options={[
              { id: 'ALL', name: 'Todas' },
              ...['PENDING', 'PROCESSING', 'FAILED', 'COMPLETED', 'CANCELLED'].map((id) => ({
                id,
                name: statusLabel[id],
              })),
            ]}
          />
        </label>
      </div>
      {loading ? (
        <TableLoading label="Carregando fila de impressão…" />
      ) : !paging.rows.length ? (
        <Empty>Nenhuma impressão encontrada.</Empty>
      ) : (
        <div className="print-queue-table-wrap">
          <table className="print-queue-table compact-table" aria-label="Fila de impressão">
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Impressora</th>
                <th scope="col">Criado em</th>
                <th scope="col">Situação</th>
                <th scope="col" className="print-queue-actions-heading">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {paging.rows.map((job) => (
                <tr key={job.id}>
                  <td data-label="Documento">
                    <strong>
                      {printDocumentLabel(job.document_kind)} {shortId(job.id)}
                    </strong>
                    <small>{job.is_copy ? 'Segunda via' : 'Original'}</small>
                  </td>
                  <td data-label="Impressora">
                    <span>{printerName(job.printer_id)}</span>
                    <small>{job.attempts} tentativa(s)</small>
                  </td>
                  <td data-label="Criado em" className="print-queue-date">
                    <time dateTime={job.created_at}>{operationTime(job.created_at)}</time>
                  </td>
                  <td data-label="Situação">
                    <Badge status={job.status} />
                    {job.status === 'CANCELLED' ? (
                      <small>
                        Cancelada no sistema
                        {job.cancelled_at ? ' · ' + operationTime(job.cancelled_at) : ''}
                        {job.cancellation_reason ? ' · ' + job.cancellation_reason : ''}
                      </small>
                    ) : (
                      job.last_error && <small className="error-text">{job.last_error}</small>
                    )}
                  </td>
                  <td data-label="Ações">
                    <div className="print-queue-actions">
                      {job.status === 'FAILED' && (
                        <button type="button" disabled={busy} onClick={() => retry(job)}>
                          <Icon name="refresh" size={15} />
                          Tentar novamente
                        </button>
                      )}
                      {active(job) && (
                        <button
                          type="button"
                          className="danger"
                          disabled={busy}
                          aria-label={'Cancelar impressão ' + shortId(job.id)}
                          onClick={() => cancel(job)}
                        >
                          <Icon name="close" size={15} />
                          Cancelar impressão
                        </button>
                      )}
                      {!active(job) && <span className="muted">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        label="Fila de impressão"
        total={paging.total}
        page={paging.page}
        pageSize={paging.pageSize}
        onPageChange={paging.onPageChange}
        onPageSizeChange={paging.onPageSizeChange}
        loading={loading}
      />
      {forms.dialog}
    </section>
  );
}
