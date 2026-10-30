import { describe, it, expect } from 'vitest';
import { cashLocalDay, filterCashSessions, cashPage } from '../packages/ui/src/cash-view.js';
const rows = [
  {
    id: 'a',
    register_id: 'one',
    register_name: 'Balcão',
    opened_by_name: 'João',
    status: 'OPEN',
    created_at: '2026-10-28 02:59:59',
    expected_amount: '120.00',
    difference_amount: null,
  },
  {
    id: 'b',
    register_id: 'two',
    register_name: 'Salão',
    opened_by_name: 'Ana',
    status: 'CLOSED',
    created_at: '2026-10-28 03:00:00',
    expected_amount: '90.00',
    difference_amount: '-10.00',
  },
  {
    id: 'c',
    register_id: 'one',
    register_name: 'Balcão',
    opened_by_name: 'Ana',
    status: 'CLOSED',
    created_at: '2026-10-29 04:00:00',
    expected_amount: '100.00',
    difference_amount: '2.00',
  },
];
const base = { search: '', register: '', status: '', from: '', to: '', sort: 'newest' };
describe('consultas de caixas', () => {
  it('combina busca sem acentos, caixa, situação e data de abertura em Brasília', () => {
    expect(cashLocalDay(rows[0].created_at)).toBe('2026-10-27');
    expect(cashLocalDay(rows[1].created_at)).toBe('2026-10-28');
    expect(
      filterCashSessions(rows, {
        ...base,
        search: 'balcao',
        register: 'one',
        status: 'OPEN',
        to: '2026-10-27',
      }).map((r) => r.id),
    ).toEqual(['a']);
    expect(
      filterCashSessions(rows, { ...base, from: '2026-10-28', to: '2026-10-28' }).map((r) => r.id),
    ).toEqual(['b']);
    expect(filterCashSessions(rows, { ...base, search: 'joao' }).map((r) => r.id)).toEqual(['a']);
  });
  it('ordena por diferença absoluta e pagina sem alterar a lista original', () => {
    expect(filterCashSessions(rows, { ...base, sort: 'difference' }).map((r) => r.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(filterCashSessions(rows, { ...base, sort: 'amount' }).map((r) => r.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(cashPage(rows, 8, 2)).toMatchObject({ page: 2, pages: 2, total: 3, rows: [rows[2]] });
    expect(cashPage([], 4, 10)).toMatchObject({ page: 1, pages: 1, total: 0, rows: [] });
  });
});
