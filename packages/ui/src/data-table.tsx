import type { ReactNode } from 'react';
import { Icon } from './appearance.js';
import { Pagination, TableLoading, type PaginationProps } from './pagination.js';
import { EmptyState, ErrorState } from './data-display.js';

export type TableSort = { key: string; direction: 'asc' | 'desc' };
export interface DataColumn<Row> {
  id: string;
  label: string;
  render: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  sortable?: boolean;
}

/** Presentation only. Server callers supply their filtered COUNT and page rows;
 * local callers filter and sort the full collection before passing page rows. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  label,
  className = '',
  loading = false,
  error,
  onRetry,
  sort,
  onSortChange,
  pagination,
  empty,
}: {
  columns: DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  label: string;
  className?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  pagination?: PaginationProps;
  empty?: ReactNode;
}) {
  const content = error ? (
    <ErrorState message={error} onRetry={onRetry} />
  ) : loading && !rows.length ? (
    <TableLoading label={'Carregando ' + label + '…'} />
  ) : !rows.length ? (
    <EmptyState>{empty ?? 'Nenhum registro encontrado.'}</EmptyState>
  ) : (
    <div className="data-table" aria-busy={loading}>
      <table className={className} role="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = column.sortable && onSortChange;
              const selected = sort?.key === column.id;
              return (
                <th
                  key={column.id}
                  scope="col"
                  className={[column.className, column.align === 'right' ? 'numeric-column' : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-sort={
                    sortable
                      ? selected
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="data-table-sort"
                      onClick={() =>
                        onSortChange({
                          key: column.id,
                          direction: selected && sort.direction === 'asc' ? 'desc' : 'asc',
                        })
                      }
                    >
                      {column.label}
                      <Icon
                        name={
                          selected ? (sort.direction === 'asc' ? 'sort-up' : 'sort-down') : 'sort'
                        }
                        size={14}
                      />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  data-label={column.label}
                  className={[column.className, column.align === 'right' ? 'numeric-column' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      {content}
      {pagination && <Pagination {...pagination} />}
    </>
  );
}

export function TableToolbar({
  children,
  label = 'Filtros da listagem',
  className = '',
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={'table-toolbar list-toolbar ' + className} role="group" aria-label={label}>
      {children}
    </div>
  );
}
export function TableActions({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={'table-actions ' + className}>{children}</span>;
}
