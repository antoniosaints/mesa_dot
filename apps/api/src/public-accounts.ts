import { db, rows, sql } from '../../../packages/database/src/index.js';
import { iconPath } from '../../../packages/shared/src/pwa.js';
import { publicPwaIdentity } from './pwa.js';

/** The earliest unit is the account entry point; branch names stay out of the directory. */
export async function publicAccounts() {
  const units = await rows(
    db,
    sql`SELECT e.*,p.background_color pwa_background_color,p.icon_revision pwa_icon_revision
    FROM tenants t JOIN establishments e ON e.tenant_id=t.id
    LEFT JOIN establishment_pwa_settings p ON p.tenant_id=e.tenant_id AND p.establishment_id=e.id
    JOIN tenant_slugs a ON a.tenant_id=e.tenant_id AND a.establishment_id=e.id AND a.is_current=TRUE AND a.slug=e.slug
    WHERE t.enabled=TRUE AND t.is_platform=FALSE AND e.id=(SELECT first_unit.id FROM establishments first_unit WHERE first_unit.tenant_id=t.id ORDER BY first_unit.created_at,first_unit.id LIMIT 1)
    ORDER BY e.name,e.slug`,
  );
  return units.map((unit) => ({
    name: unit.name,
    slug: unit.slug,
    icon_url: iconPath(publicPwaIdentity(unit), 192),
  }));
}
