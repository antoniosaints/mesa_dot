import { describe, it, expect } from 'vitest';
import { Mask } from 'maska';
import { normalizeMoney, formatMoneyInput, prepareMoneyInput } from '../packages/ui/src/money.js';
import { serializeFormValues, formValuesChanged } from '../packages/ui/src/forms.js';
const mask = new Mask({ number: { locale: 'pt-BR', fraction: 2, unsigned: false } });
const inputValue = (value: string) => normalizeMoney(mask.unmasked(prepareMoneyInput(value)));
describe('Valores monetários com Maska', () => {
  it.each([
    ['14', '14.00'],
    ['14,5', '14.50'],
    ['14.50', '14.50'],
    ['R$ 1.234,56', '1234.56'],
    ['0', '0.00'],
    ['999.999.999.999,99', '999999999999.99'],
  ])('normaliza %s para %s na API', (input, expected) => {
    expect(inputValue(input)).toBe(expected);
  });
  it('exibe os valores existentes sem alterar os centavos ou marcar alterações', () => {
    expect(formatMoneyInput('1234.56')).toBe('1.234,56');
    expect(formValuesChanged({ price: inputValue('14,00') }, { price: '14.00' })).toBe(false);
  });
  it('mantém campos vazios e rejeita valores fora do formato e limite', () => {
    expect(formatMoneyInput('')).toBe('');
    for (const value of ['', '-14.00', '1000000000000.00', '14.001', 'NaN'])
      expect(() => normalizeMoney(value)).toThrow('Informe um valor em reais');
  });
  it('serializa moeda com duas casas e preserva quantidades, flags e campos opcionais', () => {
    expect(
      serializeFormValues(
        [
          { key: 'price', label: 'Preço', type: 'currency', required: true },
          { key: 'capacity', label: 'Capacidade', type: 'number' },
          { key: 'enabled', label: 'Ativo', type: 'checkbox' },
          { key: 'optional', label: 'Opcional', type: 'currency' },
        ],
        { price: '14', capacity: '4', enabled: false, optional: '' },
      ),
    ).toEqual({ price: '14.00', capacity: 4, enabled: false });
  });
});
