export function orderLocationLabel(record: { service_mode?: string; table_number?: unknown }) {
  return record.service_mode === 'COUNTER'
    ? 'Balcão · Pedido avulso'
    : 'Mesa ' + (record.table_number ?? '—');
}
