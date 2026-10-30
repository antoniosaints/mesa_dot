import { pwaContext, tenantStorageKey } from './pwa-context.js';
export type Theme = 'dark' | 'light';
export const defaultPrimary = '#2584f8';
export const defaultSidebar = '#0d1b2a';
export const appearancePresets = [
  { name: 'Oceano', primary: defaultPrimary, sidebar: defaultSidebar },
  { name: 'Violeta', primary: '#8b5cf6', sidebar: '#21163b' },
  { name: 'Floresta', primary: '#059669', sidebar: '#102b25' },
  { name: 'Solar', primary: '#ea580c', sidebar: '#291d16' },
  { name: 'Rosa', primary: '#db2777', sidebar: '#30182b' },
  { name: 'Grafite', primary: '#475569', sidebar: '#0f172a' },
  { name: 'Azul claro', primary: '#0757f9', sidebar: '#ffffff' },
  { name: 'Petróleo claro', primary: '#0f766e', sidebar: '#eaf4f3' },
] as const;
export function validColor(value: string) {
  return value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);
}
function rgb(value: string) {
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
}
function luminance(value: string) {
  const [r, g, b] = rgb(value).map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function mixColor(a: string, b: string, amount: number) {
  const first = rgb(a),
    second = rgb(b);
  return (
    '#' +
    first
      .map((channel, index) =>
        Math.round(channel + (second[index] - channel) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function primaryForeground(color: string) {
  return contrast(color, '#ffffff') >= 4.5 ? '#ffffff' : '#000000';
}
export function sidebarPalette(background: string) {
  const ink = primaryForeground(background),
    muted = mixColor(ink, background, 0.22),
    hover = mixColor(background, ink, 0.08);
  return {
    background,
    ink,
    muted: contrast(muted, background) >= 4.5 ? muted : ink,
    hover,
    hoverInk: primaryForeground(hover),
    border: mixColor(background, ink, 0.18),
  };
}
export function readableAccent(color: string, theme: Theme) {
  const background = theme === 'dark' ? '#090e1a' : '#f3f6fb';
  if (contrast(color, background) >= 4.5) return color;
  for (let step = 1; step <= 20; step++) {
    const candidate = mixColor(color, theme === 'dark' ? '#ffffff' : '#000000', step / 20);
    if (contrast(candidate, background) >= 4.5) return candidate;
  }
  return theme === 'dark' ? '#ffffff' : '#000000';
}
function readSaved() {
  try {
    return {
      theme:
        localStorage.getItem('mesa-theme') === 'light' ? ('light' as Theme) : ('dark' as Theme),
      primary: validColor(localStorage.getItem(tenantStorageKey('mesa-primary')) ?? '')
        ? localStorage.getItem(tenantStorageKey('mesa-primary'))!
        : defaultPrimary,
      sidebar: validColor(localStorage.getItem(tenantStorageKey('mesa-sidebar-color')) ?? '')
        ? localStorage.getItem(tenantStorageKey('mesa-sidebar-color'))!
        : defaultSidebar,
    };
  } catch {
    return { theme: 'dark' as Theme, primary: defaultPrimary, sidebar: defaultSidebar };
  }
}
let state = {
  ...readSaved(),
  ...(pwaContext()
    ? {
        primary: pwaContext()!.primary_color,
        sidebar: validColor(pwaContext()!.sidebar_color ?? '')
          ? pwaContext()!.sidebar_color!
          : defaultSidebar,
      }
    : {}),
};
const listeners = new Set<() => void>();
function apply() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.style.colorScheme = state.theme;
  const sidebar = sidebarPalette(state.sidebar);
  const tokens = {
    '--blue': state.primary,
    '--blue-hover': mixColor(state.primary, '#000000', 0.13),
    '--soft-blue': `${state.primary}1a`,
    '--primary-ring': `${state.primary}2a`,
    '--primary-border': `${state.primary}66`,
    '--on-primary': primaryForeground(state.primary),
    '--accent-ink': readableAccent(state.primary, state.theme),
    '--brand-start': mixColor(state.primary, '#ffffff', 0.15),
    '--brand-end': mixColor(state.primary, '#000000', 0.18),
    '--sidebar-bg': sidebar.background,
    '--sidebar-ink': sidebar.ink,
    '--sidebar-muted': sidebar.muted,
    '--sidebar-hover': sidebar.hover,
    '--sidebar-hover-ink': sidebar.hoverInk,
    '--sidebar-border': sidebar.border,
  };
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
}
apply();
function update(next: typeof state) {
  if (
    next.theme === state.theme &&
    next.primary === state.primary &&
    next.sidebar === state.sidebar
  )
    return;
  state = next;
  try {
    localStorage.setItem('mesa-theme', state.theme);
    localStorage.setItem(tenantStorageKey('mesa-primary'), state.primary);
    localStorage.setItem(tenantStorageKey('mesa-sidebar-color'), state.sidebar);
  } catch {
    /* Preferences still work when storage is unavailable. */
  }
  apply();
  listeners.forEach((listener) => listener());
}
export const appearanceStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  setTheme: (theme: Theme) => update({ ...state, theme }),
  setPrimary: (primary: string) => {
    if (validColor(primary)) update({ ...state, primary: primary.toLowerCase() });
  },
  setColors: (colors: { primary_color?: string; sidebar_color?: string }) =>
    update({
      ...state,
      ...(colors.primary_color && validColor(colors.primary_color)
        ? { primary: colors.primary_color.toLowerCase() }
        : {}),
      ...(colors.sidebar_color && validColor(colors.sidebar_color)
        ? { sidebar: colors.sidebar_color.toLowerCase() }
        : {}),
    }),
};
