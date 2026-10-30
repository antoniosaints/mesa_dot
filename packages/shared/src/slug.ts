export const slugLimit = 80;
export const reservedSlugs = new Set([
  'api',
  'admin',
  'login',
  'logout',
  'entrar',
  'criar-conta',
  'gestor',
  'mesa-mark.svg',
  'assets',
  'static',
  'manifest',
  'manifest-webmanifest',
  'manifest.webmanifest',
  'auth',
  'config',
  'system',
  'health',
  'pwa',
  'sw',
  'sw.js',
  'socket',
  'socket.io',
  'src',
  'node_modules',
  'dashboard',
  'salao',
  'pedidos',
  'producao',
  'cardapio',
  'pagamentos',
  'caixa',
  'financeiro',
  'estoque',
  'impressao',
  'equipe',
  'configuracoes',
  'minhas-fichas',
  'consumo',
  'entregas',
  'mesas',
  'atendimento',
  'chamados',
  'conferir-ficha',
  'index',
  'index.html',
  'favicon',
  'favicon.ico',
  'icon',
  'icons',
]);
export function slugBase(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, slugLimit)
      .replace(/-+$/, '') || 'estabelecimento'
  );
}
export function slugCandidate(base: string, index: number) {
  const suffix = index === 1 ? '' : '-' + index;
  return base.slice(0, slugLimit - suffix.length).replace(/-+$/, '') + suffix;
}
