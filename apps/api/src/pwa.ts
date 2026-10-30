import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { db, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { resolveUnit, resolveUnitId } from '../../../packages/database/src/slugs.js';
import { ensure } from '../../../packages/shared/src/index.js';
import {
  pwaSurfaces,
  pwaManifest,
  pwaNotFoundHtml,
  parsePwaPath,
  brandPwaHtml,
  safePwaSearch,
  stableBase,
  type PwaIdentity,
  type PwaSurface,
} from '../../../packages/shared/src/pwa.js';
import { fallbackRevision, fallbackIcon, iconBytes, savePwaIcon } from './pwa-icons.js';
export function publicPwaIdentity(unit: Row): PwaIdentity {
  const primary = unit.primary_color ?? '#2584f8',
    background = unit.pwa_background_color ?? '#ffffff';
  return {
    establishment_id: unit.id,
    slug: unit.slug,
    name: unit.name,
    short_name:
      unit.pwa_short_name ||
      Array.from(unit.name as string)
        .slice(0, 24)
        .join(''),
    primary_color: primary,
    sidebar_color: unit.sidebar_color ?? '#0d1b2a',
    background_color: background,
    icon_revision: unit.pwa_icon_revision || fallbackRevision(primary, background),
  };
}
export async function pwaSettings(s: Scope) {
  const unit = await resolveUnitId(s.tx, s.actor.establishmentId);
  ensure(unit.tenant_id === s.actor.tenantId, 'FORBIDDEN', 'Unidade de outra conta.', 403);
  return {
    ...publicPwaIdentity(unit),
    public_path: '/' + unit.slug + '/',
    launch_path: stableBase(unit.id),
  };
}
export const pwaSettingsSchema = z
  .object({
    short_name: z.string().trim().min(1).max(32).nullable().optional(),
    background_color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    primary_color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    icon_base64: z.string().min(40).max(2000000).optional(),
    reset_icon: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !(v.icon_base64 && v.reset_icon), 'Escolha um ícone ou restaure o padrão.');
export async function updatePwaSettings(s: Scope, input: z.infer<typeof pwaSettingsSchema>) {
  ensure(Object.keys(input).length, 'BAD_REQUEST', 'Configuração vazia.', 400);
  await s.tx.execute(
    sql`INSERT IGNORE INTO establishment_pwa_settings(tenant_id,establishment_id) VALUES(${s.actor.tenantId},${s.actor.establishmentId})`,
  );
  if (input.short_name !== undefined)
    await s.tx.execute(
      sql`UPDATE establishment_pwa_settings SET short_name=${input.short_name} WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${s.actor.establishmentId}`,
    );
  if (input.background_color)
    await s.tx.execute(
      sql`UPDATE establishment_pwa_settings SET background_color=${input.background_color.toLowerCase()} WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${s.actor.establishmentId}`,
    );
  if (input.primary_color)
    await s.tx.execute(
      sql`UPDATE establishments SET primary_color=${input.primary_color.toLowerCase()} WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
    );
  if (input.reset_icon)
    await s.tx.execute(
      sql`UPDATE establishment_pwa_settings SET icon_revision=NULL WHERE tenant_id=${s.actor.tenantId} AND establishment_id=${s.actor.establishmentId}`,
    );
  if (input.icon_base64) await savePwaIcon(s, input.icon_base64);
  await s.audit('pwa.settings_updated', s.actor.establishmentId, {
    fields: Object.keys(input).filter((k) => k !== 'icon_base64'),
    icon_changed: Boolean(input.icon_base64),
  });
  await s.event('settings.updated', s.actor.establishmentId, { pwa: true });
  return pwaSettings(s);
}
export async function registerPwa(app: FastifyInstance) {
  app.get('/api/v1/pwa/resolve/:slug', async (req, reply) =>
    reply.header('Cache-Control', 'no-store').send(
      publicPwaIdentity(
        await resolveUnit(
          db,
          z
            .string()
            .max(80)
            .parse((req.params as Row).slug),
        ),
      ),
    ),
  );
  app.get('/api/v1/pwa/apps/:id', async (req, reply) =>
    reply
      .header('Cache-Control', 'no-store')
      .send(publicPwaIdentity(await resolveUnitId(db, z.uuid().parse((req.params as Row).id)))),
  );
  for (const path of ['/api/v1/pwa/assets/:id/:revision/:file', '/pwa/assets/:id/:revision/:file'])
    app.get(path, async (req, reply) => {
      const params = z
        .object({
          id: z.uuid(),
          revision: z.string().regex(/^(?:[a-f0-9]{64}|default-[a-f0-9]{6}-[a-f0-9]{6})$/),
          file: z.enum(['32.png', '180.png', '192.png', '512.png']),
        })
        .parse(req.params);
      const unit = await resolveUnitId(db, params.id),
        size = Number(params.file.split('.')[0]);
      const data = params.revision.startsWith('default-')
        ? fallbackIcon('#' + params.revision.split('-')[1], size)
        : await iconBytes(db, unit.tenant_id, unit.id, params.revision, size);
      ensure(data, 'NOT_FOUND', 'Ícone não encontrado.', 404);
      return reply
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .type('image/png')
        .send(data);
    });
  // Production reverse proxies forward public branded paths here; assets remain on their frontend origin.
  const document = async (req: any, reply: any) => {
    const surface = z
      .enum(pwaSurfaces)
      .parse(req.headers['x-mesa-app'] ?? 'customer') as PwaSurface;
    const url = new URL(req.raw.url, 'http://localhost'),
      entry = parsePwaPath(url.pathname, surface);
    if (
      surface === 'admin' &&
      /^(?:\/|\/entrar\/?|\/criar-conta\/?|\/gestor(?:\/[^.]*)?\/?)$/.test(url.pathname)
    ) {
      const shell = await readFile(
        new URL('../web/admin/index.html', import.meta.url),
        'utf8',
      ).catch(() =>
        process.env.NODE_ENV === 'production'
          ? null
          : readFile(new URL('../../admin-web/index.html', import.meta.url), 'utf8').catch(
              () => null,
            ),
      );
      ensure(shell, 'UNAVAILABLE', 'Compile o frontend para servir esta página.', 503);
      return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(shell);
    }
    ensure(entry, 'NOT_FOUND', 'Endereço não encontrado.', 404);
    let unit: Row;
    try {
      unit =
        entry.kind === 'id'
          ? await resolveUnitId(db, entry.value)
          : await resolveUnit(db, entry.value);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      return reply
        .code(404)
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(pwaNotFoundHtml(surface));
    }
    const identity = publicPwaIdentity(unit),
      base = entry.kind === 'id' ? stableBase(unit.id) : '/' + unit.slug + '/';
    const canonical = base + entry.rest,
      search = safePwaSearch(url.searchParams, surface);
    reply.header('Cache-Control', 'no-store');
    if (url.pathname !== canonical || (entry.kind === 'slug' && entry.value !== unit.slug))
      return reply
        .code(302)
        .header('Location', canonical + (search ? '?' + search : ''))
        .send();
    if (entry.manifest)
      return reply.type('application/manifest+json').send(pwaManifest(identity, surface));
    const template = await readFile(
      new URL(`../web/${surface}/index.html`, import.meta.url),
      'utf8',
    ).catch(() =>
      process.env.NODE_ENV === 'production'
        ? null
        : readFile(
            new URL(
              `../../${{ customer: 'customer-pwa', admin: 'admin-web', waiter: 'waiter-pwa', kitchen: 'kitchen-display' }[surface]}/index.html`,
              import.meta.url,
            ),
            'utf8',
          ).catch(() => null),
    );
    ensure(
      template,
      'UNAVAILABLE',
      'O frontend precisa ser compilado para servir esta página.',
      503,
    );
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss://localhost:17861 wss://localhost:17862 wss://localhost:17863; worker-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self'",
    );
    return reply
      .type('text/html; charset=utf-8')
      .send(brandPwaHtml(template, { ...identity, surface, base_path: base }));
  };
  app.get('/', document);
  app.get('/pwa/*', document);
  app.get('/:slug/manifest.webmanifest', document);
  app.get('/:slug/*', document);
  app.get('/:slug', document);
}
