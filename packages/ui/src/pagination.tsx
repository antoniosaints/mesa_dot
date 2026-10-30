import { useEffect, useState } from 'react';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { pageInfo, pageButtons, paginate } from './pagination-model.js';
export { paginate, pageInfo } from './pagination-model.js';
export function TableLoading({
  label = 'Carregando registros…',
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={'table-loading' + (compact ? ' is-compact' : '')}
      role="status"
      aria-live="polite"
    >
      <svg
        className="mesa-loading-svg"
        viewBox="0 0 48 48"
        width={compact ? 20 : 44}
        height={compact ? 20 : 44}
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="mesa-loading-track"
          cx="24"
          cy="24"
          r="20"
          stroke="currentColor"
          strokeWidth="3"
        />
        <circle
          className="mesa-loading-orbit"
          cx="24"
          cy="24"
          r="20"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="30 96"
        />
        <rect x="15" y="15" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M15 21h18M21 21v12" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
export interface PaginationProps {
  /** For server pagination, pass the filtered server COUNT, never rows.length. */
  total: number;
  page: number;
  pageSize: number;
  label: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading?: boolean;
  pageSizeOptions?: number[];
  className?: string;
  previousLabel?: string;
  nextLabel?: string;
  sizeLabel?: string;
  searchableSize?: boolean;
}
export function Pagination({
  total,
  page,
  pageSize,
  label,
  onPageChange,
  onPageSizeChange,
  loading = false,
  pageSizeOptions = [10, 25, 50, 100],
  className = '',
  previousLabel,
  nextLabel,
  sizeLabel,
  searchableSize = false,
}: PaginationProps) {
  const info = pageInfo(total, page, pageSize);
  const choices = [...new Set([...pageSizeOptions, info.pageSize])]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  useEffect(() => {
    if (!loading && page !== info.page) onPageChange(info.page);
  }, [page, info.page, loading, onPageChange]);
  function selectSize(size: number) {
    if (loading || !choices.includes(size)) return;
    onPageSizeChange(size);
    onPageChange(1);
  }
  function selectPage(value: number) {
    if (!loading && value !== info.page) onPageChange(pageInfo(total, value, pageSize).page);
  }
  return (
    <nav
      className={'table-pagination ' + className}
      aria-label={'Paginação de ' + label}
      aria-busy={loading}
    >
      <span className="table-pagination-range" aria-live="polite">
        Mostrando{' '}
        <b>
          {info.start}–{info.end}
        </b>{' '}
        de <b>{info.total}</b>
      </span>
      {loading && <TableLoading label="Atualizando…" compact />}
      <div className="table-pagination-controls">
        <button
          type="button"
          aria-label={'Primeira página em ' + label}
          disabled={loading || info.page === 1}
          onClick={() => selectPage(1)}
        >
          <Icon name="back" size={14} />
          <Icon name="back" size={14} />
        </button>
        <button
          type="button"
          aria-label={previousLabel ?? 'Página anterior em ' + label}
          disabled={loading || info.page === 1}
          onClick={() => selectPage(info.page - 1)}
        >
          <Icon name="back" size={16} />
        </button>
        <div className="table-pagination-numbers">
          {pageButtons(info.page, info.pages).map((p) =>
            typeof p === 'number' ? (
              <button
                type="button"
                key={p}
                aria-label={`Página ${p} em ${label}`}
                aria-current={p === info.page ? 'page' : undefined}
                disabled={loading}
                onClick={() => selectPage(p)}
              >
                {p}
              </button>
            ) : (
              <span key={p} aria-hidden="true">
                …
              </span>
            ),
          )}
        </div>
        <span className="table-pagination-position">
          Página {info.page} de {info.pages}
        </span>
        <button
          type="button"
          aria-label={nextLabel ?? 'Próxima página em ' + label}
          disabled={loading || info.page === info.pages}
          onClick={() => selectPage(info.page + 1)}
        >
          <Icon name="next" size={16} />
        </button>
        <button
          type="button"
          aria-label={'Última página em ' + label}
          disabled={loading || info.page === info.pages}
          onClick={() => selectPage(info.pages)}
        >
          <Icon name="next" size={14} />
          <Icon name="next" size={14} />
        </button>
      </div>
      {searchableSize ? (
        <SearchSelect
          label={sizeLabel ?? label + ' por página'}
          value={String(info.pageSize)}
          onChange={(v) => selectSize(Number(v))}
          options={choices.map((n) => ({ id: String(n), name: n + ' por página' }))}
          disabled={loading}
          allowClear={false}
        />
      ) : (
        <select
          aria-label={sizeLabel ?? label + ' por página'}
          value={info.pageSize}
          disabled={loading}
          onChange={(e) => selectSize(Number(e.target.value))}
        >
          {choices.map((n) => (
            <option value={n} key={n}>
              {n} por página
            </option>
          ))}
        </select>
      )}
    </nav>
  );
}
export function useClientPagination<T>(rows: readonly T[], resetKey = '', initialSize = 10) {
  const [state, setState] = useState({ page: 1, size: initialSize, key: resetKey });
  const result = paginate(rows, state.key === resetKey ? state.page : 1, state.size);
  useEffect(() => {
    if (state.key !== resetKey || result.page !== state.page)
      setState((s) => ({ ...s, key: resetKey, page: result.page }));
  }, [resetKey, result.page, state.key, state.page]);
  return {
    ...result,
    onPageChange: (page: number) => setState((s) => ({ ...s, key: resetKey, page })),
    onPageSizeChange: (size: number) => setState({ key: resetKey, size, page: 1 }),
  };
}
