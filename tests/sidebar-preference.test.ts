import { it, expect, vi } from 'vitest';
import {
  readSidebarCollapsed,
  sidebarPreferenceKey,
} from '../packages/ui/src/sidebar-preference.js';
it('preferência de recolhimento é separada por conta, unidade e usuário e tolera storage indisponível', () => {
  const values = new Map([[sidebarPreferenceKey('tenant-a:unit-1:user-1'), 'true']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null });
  try {
    expect(readSidebarCollapsed('tenant-a:unit-1:user-1')).toBe(true);
    expect(readSidebarCollapsed('tenant-a:unit-2:user-1')).toBe(false);
    expect(readSidebarCollapsed('tenant-a:unit-1:user-2')).toBe(false);
    expect(readSidebarCollapsed('tenant-b:unit-1:user-1')).toBe(false);
    expect(readSidebarCollapsed('')).toBe(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage bloqueado');
      },
    });
    expect(readSidebarCollapsed('tenant-a:unit-1:user-1')).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
