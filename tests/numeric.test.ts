import { expect, it } from 'vitest';
import { Mask } from 'maska';
import {
  prepareNumericInput,
  normalizeNumericValue,
  normalizeInteger,
  formatNumericInput,
  type NumericRules,
} from '../packages/ui/src/numeric.js';
import { serializeFormValues } from '../packages/ui/src/forms.js';
const rules: NumericRules = { precision: 3, maxIntegerDigits: 11 };
const canonical = (value: string, options = rules) =>
  normalizeNumericValue(
    new Mask({
      number: { locale: 'pt-BR', fraction: options.precision, unsigned: !options.signed },
    }).unmasked(prepareNumericInput(value, options)),
    options,
  );
it.each([
  ['10', '10.000'],
  ['1.5', '1.500'],
  ['1.250', '1.250'],
  ['1,250', '1.250'],
  ['1.234,567', '1234.567'],
  [',5', '0.500'],
  ['0', '0.000'],
  ['99999999999.999', '99999999999.999'],
])('Maska prepara %s sem alterar a quantidade %s', (raw, expected) => {
  expect(canonical(raw)).toBe(expected);
  expect(formatNumericInput(expected, rules)).toBe(expected.replace('.', ','));
});
it('não trunca precisão, letras, notação científica, sinais ou dígitos excedentes', () => {
  for (const raw of [
    'abc',
    '12abc',
    '1e3',
    '1,2345',
    '1.2345',
    '100000000000',
    '-1',
    '1,2,3',
    '12.34,50',
  ])
    expect(() => prepareNumericInput(raw, rules), raw).toThrow();
  expect(() => canonical('0', { ...rules, positive: true })).toThrow('maior que zero');
  expect(canonical('-2.5', { ...rules, signed: true, max: '-0.001' })).toBe('-2.500');
  expect(() => canonical('2', { ...rules, signed: true, max: '-0.001' })).toThrow('máximo');
  expect(() => canonical('100000000', { ...rules, maxIntegerDigits: 8 })).toThrow('8 dígitos');
});
it('inteiros validam faixa e serializam como número JSON sem aceitar decimais', () => {
  for (const raw of ['1.5', '1,5', '1e3', 'NaN']) expect(() => normalizeInteger(raw)).toThrow();
  expect(normalizeInteger('-2147483648', { min: -2147483648, max: 2147483647 })).toBe(-2147483648);
  expect(() => normalizeInteger('2147483648', { max: 2147483647 })).toThrow('máximo');
  expect(
    serializeFormValues(
      [
        { key: 'capacity', label: 'Lugares', type: 'number', min: 1, max: 100 },
        { key: 'quantity', label: 'Quantidade', type: 'quantity', positive: true },
      ],
      { capacity: '4', quantity: '1.250' },
    ),
  ).toEqual({ capacity: 4, quantity: '1.250' });
  expect(() =>
    serializeFormValues([{ key: 'capacity', label: 'Lugares', type: 'number', min: 1, max: 100 }], {
      capacity: '101',
    }),
  ).toThrow('máximo');
});
it('dinheiro usa duas casas e preserva os centavos no limite suportado', () => {
  const money: NumericRules = { precision: 2, maxIntegerDigits: 12, currency: true, min: '0' };
  expect(canonical('R$ 1.234,56', money)).toBe('1234.56');
  expect(canonical('14.5', money)).toBe('14.50');
  expect(canonical('999999999999,99', money)).toBe('999999999999.99');
  expect(formatNumericInput('1234.56', money, true)).toBe('1.234,56');
  for (const raw of ['-14', '1.234', '1000000000000'])
    expect(() => canonical(raw, money)).toThrow();
});
