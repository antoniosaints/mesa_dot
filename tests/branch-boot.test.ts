import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
const source = readFileSync('apps/admin-web/public/mesa-boot.js', 'utf8');
const marker = {
  slug: 'filial-centro',
  unitId: '12345678-1234-1234-1234-123456789abc',
  startedAt: Date.now(),
  background: '#f3f6fb',
  text: '#17243b',
  muted: '#64748b',
  accent: '#1679ee',
};
function boot(value: unknown, path = '/filial-centro/', theme = 'light') {
  const attributes: Record<string, string> = {},
    styles: Record<string, string> = {};
  let stored = typeof value === 'string' ? value : JSON.stringify(value);
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, color: string) => {
        styles[name] = color;
      },
    },
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
    },
  };
  runInNewContext(source, {
    document: { documentElement: root },
    location: { pathname: path },
    localStorage: { getItem: () => theme },
    sessionStorage: {
      getItem: () => stored,
      removeItem: () => {
        stored = 'null';
      },
    },
  });
  return { attributes, styles, root, stored };
}
describe('handoff visual entre documentos de filiais', () => {
  it('restaura tema e cores antes dos módulos do aplicativo', () => {
    const result = boot(marker);
    expect(result.root.dataset.theme).toBe('light');
    expect(result.attributes).toHaveProperty('data-mesa-branch-loading');
    expect(result.styles['--mesa-transition-background']).toBe('#f3f6fb');
    expect(boot(marker, '/pwa/' + marker.unitId + '/dashboard', 'dark').attributes).toHaveProperty(
      'data-mesa-branch-loading',
    );
  });
  it('descarta uma transição expirada ou destinada a outra filial', () => {
    for (const result of [
      boot(marker, '/outra-filial/'),
      boot({ ...marker, startedAt: Date.now() - 121000 }),
      boot({ ...marker, startedAt: Date.now() + 10000 }),
    ]) {
      expect(result.attributes).not.toHaveProperty('data-mesa-branch-loading');
      expect(result.stored).toBe('null');
    }
  });
  it('um marcador inválido não cobre o login e cores inválidas usam o padrão do tema', () => {
    expect(boot('{broken').attributes).not.toHaveProperty('data-mesa-branch-loading');
    expect(
      boot({ ...marker, background: 'url(invalid)' }).styles['--mesa-transition-background'],
    ).toBe('#f3f6fb');
    expect(boot({ ...marker, slug: '../outra-filial' }).attributes).not.toHaveProperty(
      'data-mesa-branch-loading',
    );
  });
  it('continua permitindo o login quando o navegador bloqueia o armazenamento', () => {
    const setAttribute = () => {
      throw new Error('O loading não deve ser ativado.');
    };
    expect(() =>
      runInNewContext(source, {
        document: { documentElement: { dataset: {}, style: {}, setAttribute } },
        localStorage: {
          getItem: () => {
            throw new Error('Armazenamento bloqueado.');
          },
        },
      }),
    ).not.toThrow();
  });
});
