import { describe, it, expect } from 'vitest';
import { paginate, pageInfo, pageButtons } from '../packages/shared/src/pagination.js';
describe('paginação compartilhada', () => {
  it('cobre primeira, intermediária, última incompleta e vazio sem sobreposição', () => {
    const rows = Array.from({ length: 23 }, (_, i) => i + 1);
    expect(paginate(rows, 1, 10)).toMatchObject({
      page: 1,
      pages: 3,
      start: 1,
      end: 10,
      rows: rows.slice(0, 10),
    });
    expect(paginate(rows, 2, 10)).toMatchObject({ start: 11, end: 20, rows: rows.slice(10, 20) });
    expect(paginate(rows, 99, 10)).toMatchObject({
      page: 3,
      start: 21,
      end: 23,
      rows: [21, 22, 23],
    });
    expect(paginate([], 5, 10)).toMatchObject({
      page: 1,
      pages: 1,
      start: 0,
      end: 0,
      offset: 0,
      rows: [],
    });
    expect([1, 2, 3].flatMap((page) => paginate(rows, page, 10).rows)).toEqual(rows);
  });
  it('corrige redução do total, tamanho e entradas numéricas inválidas', () => {
    expect(pageInfo(9, 3, 10)).toMatchObject({ page: 1, pages: 1, start: 1, end: 9 });
    expect(pageInfo(101, 5, 25)).toMatchObject({ page: 5, start: 101, end: 101 });
    expect(pageInfo(101, 5, 50)).toMatchObject({ page: 3, start: 101, end: 101 });
    expect(pageInfo(NaN, -1, Infinity)).toMatchObject({ total: 0, page: 1, pageSize: 10 });
  });
  it('usa total remoto e mantém o número de controles limitado em bases grandes', () => {
    expect(pageInfo(1000000, 50000, 10)).toMatchObject({
      pages: 100000,
      page: 50000,
      start: 499991,
      end: 500000,
    });
    for (const page of [1, 4, 5, 50000, 99997, 100000]) {
      const buttons = pageButtons(page, 100000);
      expect(buttons.length).toBeLessThanOrEqual(7);
      expect(buttons).toContain(page);
      expect(buttons[0]).toBe(1);
      expect(buttons.at(-1)).toBe(100000);
      expect(new Set(buttons).size).toBe(buttons.length);
    }
  });
});
