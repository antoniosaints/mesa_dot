import type { PwaSurface } from './pwa.js';
/** Choose a usable application from actual permissions, including custom profiles. */
export function staffAccessSurface(grants: readonly string[], accountAdmin = false): PwaSurface {
  if (
    accountAdmin ||
    grants.some((code) =>
      [
        'cash.manage',
        'reports.view',
        'staff.manage',
        'settings.update',
        'catalog.manage',
        'inventory.view',
        'print.manage',
      ].includes(code),
    )
  )
    return 'admin';
  if (grants.includes('production.manage')) return 'kitchen';
  if (grants.includes('table.view')) return 'waiter';
  return 'admin';
}
export function frontendAccessUrl(
  surface: PwaSurface,
  slug: string,
  currentUrl: string,
  configured: Partial<Record<PwaSurface, string>> = {},
) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new Error('Endereço do estabelecimento indisponível.');
  const current = new URL(currentUrl);
  const base = configured[surface];
  const url = new URL(base || current.origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Endereço do aplicativo inválido.');
  if (!base) {
    const port = Number(current.port),
      offset = { admin: 0, customer: 1, waiter: 2, kitchen: 3 }[surface];
    if (port >= 5173 && port <= 5176) url.port = String(5173 + offset);
    else if (port >= 35173 && port <= 35176) url.port = String(35173 + offset);
    else if (surface !== 'admin')
      throw new Error('Configure o endereço público do aplicativo ' + surface + '.');
  }
  url.pathname = url.pathname.replace(/\/$/, '') + '/' + slug + '/';
  url.search = '';
  url.hash = '';
  return url.href;
}
export function credentialsText(input: {
  name: string;
  role: string;
  venue: string;
  url: string;
  email: string;
  password: string;
}) {
  return `${input.venue}\nAcesso de ${input.name}\nPerfil: ${input.role}\nLink: ${input.url}\nE-mail: ${input.email}\nSenha: ${input.password}`;
}
