import { expect, it } from 'vitest';
import { contrast } from '../packages/ui/src/preferences.js';
import { recordColorStyle, validRecordColor } from '../packages/ui/src/record-colors.js';
import { serializeFormValues } from '../packages/ui/src/forms.js';
import { recordColorField } from '../packages/ui/src/record-tags.js';
const toHex = (rgb: string) =>
  rgb.startsWith('#')
    ? rgb
    : '#' +
      rgb
        .match(/\d+/g)!
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('');
it('cores de identificação só aceitam hex completo e mantêm o contraste das tags', () => {
  for (const invalid of [
    null,
    undefined,
    '',
    '#fff',
    'red',
    'url(javascript:alert(1))',
    '#12z456',
  ]) {
    expect(validRecordColor(invalid)).toBe(false);
    expect(recordColorStyle(invalid)).toBeUndefined();
  }
  for (const color of [
    '#000000',
    '#ffffff',
    '#ffff00',
    '#AABBCC',
    '#2563eb',
    '#dc2626',
    '#059669',
  ]) {
    for (const theme of ['light', 'dark'] as const) {
      const style = recordColorStyle(color, theme)!;
      expect(contrast(toHex(style.color), toHex(style.backgroundColor))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }
});
it('remover a cor envia null para limpar o cadastro e mantém os outros campos', () => {
  expect(serializeFormValues([recordColorField], { color: '' })).toEqual({ color: null });
  expect(serializeFormValues([recordColorField], { color: '#AABBCC' })).toEqual({
    color: '#aabbcc',
  });
});
