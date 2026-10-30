import { describe, it, expect } from 'vitest';
import {
  contrast,
  appearanceStore,
  appearancePresets,
  sidebarPalette,
  defaultPrimary,
  mixColor,
  primaryForeground,
  readableAccent,
  validColor,
} from '../packages/ui/src/preferences.js';
describe('Aparência e legibilidade', () => {
  it('aceita apenas cores hexadecimais completas', () => {
    expect(validColor('#8b5cf6')).toBe(true);
    for (const color of ['red', '#fff', 'url(javascript:alert(1))', '#1234567', ''])
      expect(validColor(color)).toBe(false);
  });
  it('preserva a cor padrão e mistura canais sem valores inválidos', () => {
    expect(defaultPrimary).toBe('#2584f8');
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it.each(['#2584f8', '#8b5cf6', '#ffff00', '#ffffff', '#000000', '#00ff00'])(
    'escolhe texto legível para a cor %s',
    (color) => {
      expect(contrast(color, primaryForeground(color))).toBeGreaterThanOrEqual(4.5);
    },
  );
  it.each(['dark', 'light'] as const)('mantém o texto de destaque legível no tema %s', (theme) => {
    for (const color of ['#2584f8', '#8b5cf6', '#ffff00', '#ffffff', '#000000'])
      expect(
        contrast(readableAccent(color, theme), theme === 'dark' ? '#090e1a' : '#f3f6fb'),
      ).toBeGreaterThanOrEqual(4.5);
  });
});

it('presets mantêm contraste em menus claros e escuros, inclusive no hover', () => {
  for (const preset of appearancePresets) {
    expect(validColor(preset.primary)).toBe(true);
    expect(validColor(preset.sidebar)).toBe(true);
    expect(contrast(preset.primary, primaryForeground(preset.primary))).toBeGreaterThanOrEqual(4.5);
    const colors = sidebarPalette(preset.sidebar);
    expect(contrast(colors.ink, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.hoverInk, colors.hover)).toBeGreaterThanOrEqual(4.5);
  }
  for (const background of ['#000000', '#ffffff', '#777777', '#ffff00', '#00ff00', '#0000ff']) {
    const colors = sidebarPalette(background);
    expect(contrast(colors.ink, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.hoverInk, colors.hover)).toBeGreaterThanOrEqual(4.5);
  }
});
it('mudar tema ou apenas a cor primária preserva a cor independente do sidebar', () => {
  const original = appearanceStore.getSnapshot();
  try {
    appearanceStore.setColors({ primary_color: '#8b5cf6', sidebar_color: '#ffffff' });
    appearanceStore.setTheme('light');
    appearanceStore.setPrimary('#059669');
    expect(appearanceStore.getSnapshot()).toMatchObject({
      primary: '#059669',
      sidebar: '#ffffff',
      theme: 'light',
    });
  } finally {
    appearanceStore.setColors({ primary_color: original.primary, sidebar_color: original.sidebar });
    appearanceStore.setTheme(original.theme);
  }
});
