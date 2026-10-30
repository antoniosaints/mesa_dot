export function financeDay(offset = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offset * 86400000));
}
export function financeCsv(headers: string[], records: unknown[][]) {
  const escape = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\ufeff' + [headers, ...records].map((row) => row.map(escape).join(';')).join('\r\n');
}
export function financeChange(value: string | number, previous: string | number) {
  const current = Number(value),
    before = Number(previous);
  if (!before) return current ? 'Sem base no período anterior' : 'Sem variação no período';
  const pct = ((current - before) / Math.abs(before)) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% em relação ao período anterior`;
}
