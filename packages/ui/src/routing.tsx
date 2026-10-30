import { pwaContext } from './pwa-context.js';
import { NavigationGuard } from './navigation-guard.js';
import { useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, useLocation, useNavigate } from 'react-router';
export function AppRouter({ children }: { children: ReactNode }) {
  const [router] = useState(() =>
    createBrowserRouter([{ path: '*', element: <NavigationGuard>{children}</NavigationGuard> }], {
      basename: pwaContext()?.base_path ?? '/',
    }),
  );
  return <RouterProvider router={router} />;
}
export const adminPaths: Record<string, string> = {
  overview: '/dashboard',
  floor: '/salao',
  orders: '/pedidos',
  menu: '/cardapio',
  payments: '/pagamentos',
  cash: '/caixa',
  finance: '/financeiro',
  inventory: '/estoque',
  production: '/producao',
  printing: '/impressao',
  team: '/equipe',
  settings: '/configuracoes',
};
export function usePageRoute(
  paths: Record<string, string>,
  fallback: string,
  enabled = true,
  nested: Record<string, RegExp> = {},
) {
  const location = useLocation();
  const navigate = useNavigate();
  const root = '/' + location.pathname.split('/').filter(Boolean)[0];
  const candidate = Object.keys(paths).find((key) => paths[key] === root);
  const page =
    candidate &&
    (location.pathname.replace(/\/$/, '') === paths[candidate] ||
      nested[candidate]?.test(location.pathname))
      ? candidate
      : 'notfound';
  useEffect(() => {
    if (enabled && ['/', '/entrar'].includes(location.pathname))
      void navigate({ pathname: paths[fallback], search: location.search }, { replace: true });
  }, [enabled, location.pathname, fallback]);
  function setPage(key: string) {
    const params = new URLSearchParams(location.search);
    params.delete('aba');
    void navigate({ pathname: paths[key], search: params.toString() });
  }
  return { page, setPage, location, navigate };
}
export function RouteNotFound({ onHome }: { onHome: () => void }) {
  return (
    <section className="panel empty-route">
      <h2>Tela não encontrada ou sem acesso</h2>
      <p className="muted">Confira o endereço ou escolha uma opção no menu.</p>
      <button onClick={onHome}>Voltar ao início</button>
    </section>
  );
}
