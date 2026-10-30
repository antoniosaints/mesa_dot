import { reservedSlugs } from '../../shared/src/slug.js';
import type { Plugin, Connect, ViteDevServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parsePwaPath,
  brandPwaHtml,
  pwaManifest,
  pwaNotFoundHtml,
  safePwaSearch,
  stableBase,
  type PwaIdentity,
  type PwaSurface,
} from '../../shared/src/pwa.js';
export function tenantPwa(surface: PwaSurface): Plugin {
  function middleware(
    root: string,
    transform?: (url: string, html: string) => Promise<string>,
  ): Connect.NextHandleFunction {
    return async (req, res, next) => {
      if (req.method !== 'GET') return next();
      const url = new URL(req.url ?? '/', 'http://localhost');
      const asset =
        /^\/pwa\/assets\/[a-f0-9-]{36}\/(?:[a-f0-9]{64}|default-[a-f0-9]{6}-[a-f0-9]{6})\/(?:32|180|192|512)\.png$/.test(
          url.pathname,
        );
      const entry = parsePwaPath(url.pathname, surface);
      if (!entry && !asset) {
        const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
        if (
          url.pathname.startsWith('/pwa/') ||
          (/^[a-z0-9-]{1,80}$/.test(first) && !reservedSlugs.has(first))
        ) {
          res.statusCode = 404;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(pwaNotFoundHtml(surface));
          return;
        }
        return next();
      }
      const api = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
      try {
        const endpoint = asset
          ? '/api/v1' + url.pathname
          : entry!.kind === 'id'
            ? '/api/v1/pwa/apps/' + entry!.value
            : '/api/v1/pwa/resolve/' + entry!.value;
        const response = await fetch(api + endpoint, {
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
        if (!response.ok) {
          res.statusCode = response.status;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader(
            'Content-Type',
            response.status === 404 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
          );
          res.end(
            response.status === 404
              ? pwaNotFoundHtml(surface)
              : 'Não foi possível carregar o estabelecimento.',
          );
          return;
        }
        if (asset) {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
          res.end(Buffer.from(await response.arrayBuffer()));
          return;
        }
        const identity = (await response.json()) as PwaIdentity;
        const base =
          entry!.kind === 'id' ? stableBase(identity.establishment_id) : '/' + identity.slug + '/';
        const canonical = base + entry!.rest,
          search = safePwaSearch(url.searchParams, surface);
        res.setHeader('Cache-Control', 'no-store');
        if (url.pathname !== canonical) {
          res.statusCode = 302;
          res.setHeader('Location', canonical + (search ? '?' + search : ''));
          res.end();
          return;
        }
        if (entry!.manifest) {
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          res.end(JSON.stringify(pwaManifest(identity, surface)));
          return;
        }
        let template = await readFile(join(root, 'index.html'), 'utf8');
        template = brandPwaHtml(template, { ...identity, surface, base_path: base });
        if (transform) template = await transform(req.url!, template);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(template);
      } catch {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end('O aplicativo está temporariamente indisponível. Tente novamente.');
      }
    };
  }
  return {
    name: 'mesa-tenant-pwa',
    async generateBundle() {
      if (surface !== 'customer')
        this.emitFile({
          type: 'asset',
          fileName: 'mesa-push-sw.js',
          source: await readFile(new URL('../public/mesa-push-sw.js', import.meta.url), 'utf8'),
        });
    },
    configureServer(server: ViteDevServer) {
      if (surface !== 'customer')
        server.middlewares.use('/mesa-push-sw.js', async (_req, res) => {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(await readFile(new URL('../public/mesa-push-sw.js', import.meta.url), 'utf8'));
        });
      server.middlewares.use(
        middleware(server.config.root, (url, html) => server.transformIndexHtml(url, html)),
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(join(server.config.root, server.config.build.outDir)));
    },
  };
}
