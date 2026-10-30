import { assignSlug, reserveLegacySlug } from './slugs.js';
import { randomUUID } from 'node:crypto';
import { db, rows, sql, Scope, type Row, type Executor } from './index.js';
import { ensure, passwordHash, permissions, type Actor } from '../../shared/src/index.js';
export interface ProvisionInput {
  /** Trusted legacy import alias only; public APIs do not accept this field. */
  slug?: string;
  name: string;
  owner_email: string;
  owner_name: string;
  password: string;
  demo?: boolean;
  superadmin?: boolean;
  /** Trusted platform bootstrap only. Hidden from the public restaurant directory. */
  platform?: boolean;
}
export async function provision(input: ProvisionInput) {
  ensure(
    input.password.length >= 12,
    'BAD_REQUEST',
    'Senha deve ter pelo menos 12 caracteres.',
    400,
  );
  return db.transaction((tx) => provisionIn(tx, input));
}
export async function provisionIn(tx: Executor, input: ProvisionInput) {
  input = { ...input, name: input.name.trim() };
  ensure(
    input.name.length >= 1 && input.name.length <= 160,
    'BAD_REQUEST',
    'Informe o nome do estabelecimento.',
    400,
  );
  const tenantId = randomUUID();
  const establishmentId = randomUUID();
  const userId = randomUUID();
  await tx.execute(
    sql`INSERT INTO tenants(id,name,slug,is_platform) VALUES(${tenantId},${input.name},${tenantId},${Boolean(input.platform)})`,
  );
  await tx.execute(
    sql`INSERT INTO establishments(id,tenant_id,name,slug,opening_hours) VALUES(${establishmentId},${tenantId},${input.name},${tenantId},${JSON.stringify({ daily: '17:00 - 02:00' })})`,
  );
  const publicAddress = await assignSlug(tx, tenantId, establishmentId, input.name);
  if (input.slug) await reserveLegacySlug(tx, tenantId, establishmentId, input.slug);
  await tx.execute(sql`UPDATE tenants SET slug=${publicAddress.slug} WHERE id=${tenantId}`);
  await tx.execute(
    sql`INSERT INTO users(id,name,email,password_hash,is_superadmin) VALUES(${userId},${input.owner_name},${input.owner_email.toLowerCase()},${passwordHash(input.password)},${Boolean(input.superadmin)})`,
  );
  await tx.execute(
    sql`INSERT INTO tenant_memberships(id,tenant_id,user_id,is_account_admin) VALUES(${randomUUID()},${tenantId},${userId},TRUE)`,
  );
  const actor: Actor = {
    id: userId,
    tenantId,
    establishmentId,
    kind: 'STAFF',
    isAccountAdmin: true,
    permissions: [...permissions],
  };
  const s = new Scope(tx, actor);
  const role = await s.insert('roles', { name: 'Administrador' });
  const grants = new Map<string, string>();
  for (const code of permissions) {
    await tx.execute(
      sql`INSERT INTO permissions(id,code) VALUES(${randomUUID()},${code}) ON DUPLICATE KEY UPDATE code=VALUES(code)`,
    );
    const p = await rows(tx, sql`SELECT id FROM permissions WHERE code=${code}`);
    grants.set(code, p[0].id);
    await s.insert('role_permissions', { role_id: role.id, permission_id: p[0].id });
  }
  await s.insert('staff_memberships', { user_id: userId, role_id: role.id });
  const profiles: Record<string, string[]> = {
    Garçom: [
      'table.view',
      'order.create',
      'order.postpaid',
      'ticket.view',
      'ticket.redeem',
      'table.release',
      'payment.receive',
    ],
    Caixa: [
      'table.view',
      'order.create',
      'order.postpaid',
      'order.cancel',
      'ticket.view',
      'ticket.reprint',
      'payment.receive',
      'payment.refund',
      'cash.manage',
    ],
    Cozinha: ['production.manage', 'ticket.view'],
  };
  const roles: Row[] = [role];
  for (const [name, codes] of Object.entries(profiles)) {
    const r = await s.insert('roles', { name });
    roles.push(r);
    for (const code of codes)
      await s.insert('role_permissions', { role_id: r.id, permission_id: grants.get(code) });
  }
  const area = await s.insert('areas', { name: 'Salão principal' });
  const tables: Row[] = [];
  for (let i = 1; i <= (input.demo ? 8 : 1); i++)
    tables.push(
      await s.insert('dining_tables', {
        area_id: area.id,
        number: String(i).padStart(2, '0'),
        public_code: randomUUID(),
        capacity: i % 3 === 0 ? 6 : 4,
        position_x: ((i - 1) % 4) * 150 + 30,
        position_y: Math.floor((i - 1) / 4) * 150 + 30,
        shape: i % 3 === 0 ? 'round' : 'square',
      }),
    );
  const location = await s.insert('stock_locations', {
    name: 'Estoque principal',
    is_default: true,
  });
  const register = await s.insert('cash_registers', { name: 'Caixa principal' });
  const products: Row[] = [];
  if (input.demo) {
    const drinks = await s.insert('categories', { name: 'Bebidas', sort_order: 1 });
    const food = await s.insert('categories', { name: 'Da cozinha', sort_order: 2 });
    const catalog = [
      {
        name: 'Cerveja Pilsen 600 ml',
        description: 'Garrafa bem gelada para compartilhar.',
        price: '14.00',
        stock_policy: 'ON_DELIVERY',
        category_id: drinks.id,
        sector: 'bar',
      },
      {
        name: 'Água mineral',
        description: 'Sem gás · 500 ml',
        price: '5.00',
        stock_policy: 'NO_CONTROL',
        category_id: drinks.id,
        sector: 'bar',
      },
      {
        name: 'Porção de batata',
        description: 'Crocante, com maionese da casa.',
        price: '32.00',
        stock_policy: 'ON_PRODUCTION',
        requires_production: true,
        category_id: food.id,
        sector: 'cozinha',
      },
      {
        name: 'Caipirinha da casa',
        description: 'Limão fresco e cachaça artesanal.',
        price: '22.00',
        stock_policy: 'RECIPE',
        category_id: drinks.id,
        sector: 'bar',
      },
      {
        name: 'Cachaça (ingrediente)',
        description: 'Insumo',
        price: '1.00',
        stock_policy: 'NO_CONTROL',
        enabled: false,
        category_id: drinks.id,
        sector: 'bar',
      },
    ];
    for (const data of catalog) {
      const p = await s.insert('products', data);
      products.push(p);
      await s.insert('stock_balances', {
        location_id: location.id,
        product_id: p.id,
        physical_quantity: '100.000',
      });
    }
    const recipe = await s.insert('recipes', { product_id: products[3].id });
    await s.insert('recipe_items', {
      recipe_id: recipe.id,
      ingredient_id: products[4].id,
      quantity: '0.050',
    });
  }
  await s.audit('tenant.provisioned', tenantId, { demo: Boolean(input.demo) });
  return {
    slug: publicAddress.slug,
    tenant_id: tenantId,
    establishment_id: establishmentId,
    user_id: userId,
    actor,
    roles,
    tables,
    products,
    location,
    register,
  };
}
