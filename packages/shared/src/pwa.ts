import { reservedSlugs } from './slug.js';
export const pwaSurfaces = ['customer', 'admin', 'waiter', 'kitchen'] as const;
export type PwaSurface = (typeof pwaSurfaces)[number];
export interface PwaIdentity {
  establishment_id: string;
  tenant_id?: never;
  slug: string;
  name: string;
  short_name: string;
  primary_color: string;
  sidebar_color?: string;
  background_color: string;
  icon_revision: string;
}
export interface PwaContext extends PwaIdentity {
  surface: PwaSurface;
  base_path: string;
}
export const surfaceNames: Record<PwaSurface, string> = {
  customer: 'Cardápio',
  admin: 'Gestão',
  waiter: 'Garçom',
  kitchen: 'Cozinha',
};
export const stableBase = (id: string) => '/pwa/apps/' + id + '/';
export const iconPath = (i: PwaIdentity, size: number) =>
  `/pwa/assets/${i.establishment_id}/${i.icon_revision}/${size}.png`;
export function pwaManifest(i: PwaIdentity, surface: PwaSurface) {
  const base = stableBase(i.establishment_id);
  return {
    id: base + 'identity/' + surface,
    name: surface === 'customer' ? i.name : i.name + ' · ' + surfaceNames[surface],
    short_name: i.short_name,
    start_url: base,
    scope: base,
    display: 'standalone',
    lang: 'pt-BR',
    background_color: i.background_color,
    theme_color: i.primary_color,
    icons: [
      { src: iconPath(i, 192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: iconPath(i, 512), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const routes: Record<PwaSurface, RegExp> = {
  customer: /^(?:|cardapio|consumo|minhas-fichas)\/?$/,
  admin:
    /^(?:|dashboard|salao(?:\/atendimento\/[a-f0-9-]{36})?|pedidos(?:\/[a-f0-9-]{36}(?:\/fichas\/[a-f0-9-]{36})?)?|producao|cardapio|pagamentos|caixa|financeiro|estoque|impressao|estacao-impressao|equipe|configuracoes|complementos)\/?$/,
  waiter: /^(?:|mesas(?:\/[a-f0-9-]{36})?|entregas|chamados|conferir-ficha)\/?$/,

  kitchen: /^(?:|producao)\/?$/,
};
export function parsePwaPath(pathname: string, surface: PwaSurface) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'pwa' && parts[1] === 'apps' && uuid.test(parts[2] ?? '')) {
    const rest = parts.slice(3).join('/');
    if (rest !== 'manifest.webmanifest' && !routes[surface].test(rest)) return null;
    return {
      kind: 'id' as const,
      value: parts[2],
      base_path: stableBase(parts[2]),
      rest,
      manifest: rest === 'manifest.webmanifest',
    };
  }
  const slug = parts[0] ?? '';
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || reservedSlugs.has(slug)) return null;
  const rest = parts.slice(1).join('/');
  if (rest !== 'manifest.webmanifest' && !routes[surface].test(rest)) return null;
  return {
    kind: 'slug' as const,
    value: slug,
    base_path: '/' + slug + '/',
    rest,
    manifest: rest === 'manifest.webmanifest',
  };
}
/** Only known presentation filters and public table references survive a redirect. */
export function safePwaSearch(params: URLSearchParams, surface: PwaSurface) {
  const result = new URLSearchParams();
  const table = params.get('table');
  if (table && uuid.test(table)) result.set('table', table);
  const tab = params.get('aba');
  if (surface !== 'customer' && tab && /^[a-z0-9-]{1,60}$/.test(tab)) result.set('aba', tab);
  const paymentReturn = params.get('payment_return');
  if (surface === 'customer' && paymentReturn && uuid.test(paymentReturn))
    result.set('payment_return', paymentReturn);
  const oauth = params.get('oauth');
  if (surface === 'admin' && oauth && ['success', 'denied', 'error'].includes(oauth))
    result.set('oauth', oauth);
  return result.toString();
}
const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function brandPwaHtml(template: string, context: PwaContext) {
  const serialized = JSON.stringify(context)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const base = stableBase(context.establishment_id);
  const title = html(
    context.name + (context.surface === 'customer' ? '' : ' · ' + surfaceNames[context.surface]),
  );
  return template
    .replace(
      '<strong id="mesa-boot-name"></strong>',
      `<strong id="mesa-boot-name">${html(context.name)}</strong>`,
    )
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<link\b[^>]*rel=["'](?:manifest|icon|apple-touch-icon)["'][^>]*>/gi, '')
    .replace(/<meta\b[^>]*name=["']theme-color["'][^>]*>/gi, '')
    .replace(
      '</head>',
      `<title>${title}</title>\n<meta name="theme-color" content="${context.primary_color}">\n<link rel="manifest" href="${base}manifest.webmanifest">\n<link rel="icon" type="image/png" href="${iconPath(context, 32)}">\n<link rel="apple-touch-icon" href="${iconPath(context, 180)}">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="${html(context.short_name)}">\n<script type="application/json" id="mesa-pwa-context">${serialized}</script>\n</head>`,
    );
}

/** Public, neutral error document: never boots another establishment's stored session. */
export function pwaNotFoundHtml(surface: PwaSurface) {
  const home = { admin: '/dashboard', customer: '/', waiter: '/mesas', kitchen: '/producao' }[
    surface
  ];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Endereço não encontrado</title><style>body{margin:0;background:#f3f6fb;color:#17243b;font-family:system-ui,sans-serif}main{max-width:560px;margin:15vh auto;padding:28px;background:white;border:1px solid #d7e0ef;border-radius:12px}h1{font-size:22px}p{line-height:1.6;color:#536681}button{padding:12px 18px;border-radius:7px;border:1px solid #d7e0ef;background:#f7f9fc;color:#17243b;font:600 14px system-ui;cursor:pointer}</style></head><body><main><h1>Tela não encontrada ou sem acesso</h1><p>Este endereço de estabelecimento ou tela não está disponível. Confira o link recebido ou o QR Code da mesa.</p><form action="${home}" method="get"><button type="submit">Voltar ao início</button></form></main></body></html>`;
}
