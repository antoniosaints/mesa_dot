import { describe, it, expect } from 'vitest';
import { financeRange } from '../apps/api/src/finance.js';
import { financeCsv, financeChange } from '../packages/ui/src/finance-format.js';
describe('financeiro: datas e exportação', () => {
  it('usa dias de Brasília, inclusive o último e compara períodos com duração igual', () => {
    const r = financeRange('2026-10-01', '2026-10-28');
    expect(r.days).toBe(28);
    expect(r.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(r.until.toISOString()).toBe('2026-10-29T03:00:00.000Z');
    expect(r.previous.toISOString()).toBe('2026-09-03T03:00:00.000Z');
    expect(() => financeRange('2026-10-29', '2026-10-28')).toThrow();
    expect(() => financeRange('2024-01-01', '2026-01-01')).toThrow();
  });
  it('protege células CSV de fórmulas, preserva aspas e acentos e trata comparação sem base', () => {
    expect(
      financeCsv(
        ['Nome', 'Valor'],
        [
          ['=1+1', 'R$ 10,00'],
          ['  @SUM(A1)', 'A "B"'],
        ],
      ),
    ).toBe('\ufeff"Nome";"Valor"\r\n"\'=1+1";"R$ 10,00"\r\n"\'  @SUM(A1)";"A ""B"""');
    expect(financeChange(10, 0)).toContain('Sem base');
    expect(financeChange(110, 100)).toContain('+10%');
  });
});
