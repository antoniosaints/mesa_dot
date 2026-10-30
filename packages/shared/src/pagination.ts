const integer = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
/** Shared by local slices and controlled server pages; never manufactures a nonempty range. */
export function pageInfo(total: number, requested: number, pageSize: number) {
  const count = integer(total, 0),
    size = Math.max(1, integer(pageSize, 10));
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Math.max(1, Math.min(integer(requested, 1), pages));
  const start = count ? (page - 1) * size + 1 : 0,
    end = Math.min(page * size, count);
  return { total: count, page, pages, pageSize: size, start, end, offset: start ? start - 1 : 0 };
}
export function paginate<T>(rows: readonly T[], requested: number, size: number) {
  const info = pageInfo(rows.length, requested, size);
  return { ...info, rows: rows.slice(info.offset, info.offset + info.pageSize) };
}
/** At most seven buttons, even for very large server totals. */
export function pageButtons(page: number, pages: number): (number | 'gap-left' | 'gap-right')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'gap-right', pages];
  if (page >= pages - 3) return [1, 'gap-left', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, 'gap-left', page - 1, page, page + 1, 'gap-right', pages];
}
