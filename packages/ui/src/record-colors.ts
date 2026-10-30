import { contrast, mixColor, type Theme } from './preferences.js';

export const validRecordColor = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);

// Keep identification colors subtle on each surface while preserving readable labels.
export function recordColorStyle(value: unknown, theme: Theme = 'light') {
  if (!validRecordColor(value)) return undefined;
  if (theme === 'dark') {
    const backgroundColor = mixColor('#0e1525', value, 0.18);
    const ink = mixColor(value, '#ffffff', 0.65);
    return {
      backgroundColor,
      color: contrast(ink, backgroundColor) >= 4.5 ? ink : '#ffffff',
      borderColor: mixColor('#0e1525', value, 0.4),
    };
  }
  const rgb = [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16));
  return {
    backgroundColor: `rgb(${rgb.map((n) => Math.round(255 * 0.88 + n * 0.12)).join(', ')})`,
    color: `rgb(${rgb.map((n) => Math.round(n * 0.4)).join(', ')})`,
    borderColor: `rgb(${rgb.map((n) => Math.round(255 * 0.65 + n * 0.35)).join(', ')})`,
  };
}
