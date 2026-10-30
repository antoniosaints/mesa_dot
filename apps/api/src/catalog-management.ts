import { sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure, permit } from '../../../packages/shared/src/index.js';
export async function validateCatalogResource(s: Scope, path: string, data: Row, current?: Row) {
  const next = { ...current, ...data };
  if (path === 'products' || path === 'product-variants') {
    if (next.stock_location_id) await s.get('stock_locations', next.stock_location_id);
    if (path === 'product-variants') {
      if (current)
        ensure(
          current.product_id === next.product_id,
          'BAD_REQUEST',
          'Não é permitido mover uma variação para outro produto.',
          400,
        );
      const product = await s.get('products', next.product_id);
      ensure(
        next.stock_mode !== 'OWN' || product.stock_policy !== 'RECIPE',
        'BAD_REQUEST',
        'Produtos com ficha técnica usam o estoque dos ingredientes. Mantenha a variação compartilhada.',
        400,
      );
    } else if (next.stock_policy === 'RECIPE' && current)
      ensure(
        !(await s.list('product_variants', sql`product_id=${current.id} AND stock_mode='OWN'`))
          .length,
        'BAD_REQUEST',
        'Altere as variações para estoque compartilhado antes de ativar a ficha técnica.',
        400,
      );
  }
  if (path === 'stock-balances') {
    await s.get('products', next.product_id);
    await s.get('stock_locations', next.location_id);
    if (next.variant_id) {
      const variant = await s.get('product_variants', next.variant_id);
      ensure(
        variant.product_id === next.product_id,
        'BAD_REQUEST',
        'A variação não pertence ao produto.',
        400,
      );
    }
  }
  if (path === 'recipe-items') {
    const recipe = await s.get('recipes', next.recipe_id);
    await s.get('products', next.ingredient_id);
    ensure(
      recipe.product_id !== next.ingredient_id,
      'BAD_REQUEST',
      'O próprio produto não pode ser ingrediente da sua ficha.',
      400,
    );
  }
  if (path === 'modifier-groups')
    ensure(
      next.min_choices <= next.max_choices,
      'BAD_REQUEST',
      'O mínimo não pode superar o máximo de adicionais.',
      400,
    );
}
export async function productManagement(s: Scope, id: string) {
  const catalog = s.actor.permissions.includes('catalog.manage');
  const stock = s.actor.permissions.includes('inventory.view');
  ensure(catalog || stock, 'FORBIDDEN', 'Sem acesso à gestão do produto.', 403);
  const product = await s.get('products', id);
  const [
    variants,
    balances,
    locations,
    movements,
    recipes,
    recipeItems,
    groups,
    modifiers,
    links,
    products,
  ] = await Promise.all([
    s.list('product_variants', sql`product_id=${id}`),
    stock ? s.list('stock_balances', sql`product_id=${id}`) : [],
    stock ? s.list('stock_locations') : [],
    stock ? s.list('stock_movements') : [],
    catalog ? s.list('recipes', sql`product_id=${id}`) : [],
    catalog ? s.list('recipe_items') : [],
    catalog ? s.list('modifier_groups') : [],
    catalog ? s.list('modifiers') : [],
    catalog ? s.list('product_modifiers', sql`product_id=${id}`) : [],
    catalog ? s.list('products') : [],
  ]);
  const ids = new Set(balances.map((b) => b.id));
  const recipeIds = new Set(recipes.map((r) => r.id));
  return {
    product: catalog
      ? product
      : {
          id: product.id,
          name: product.name,
          enabled: product.enabled,
          stock_policy: product.stock_policy,
          stock_location_id: product.stock_location_id,
        },
    variants: catalog
      ? variants
      : variants.map((v) => ({
          id: v.id,
          name: v.name,
          stock_mode: v.stock_mode,
          stock_location_id: v.stock_location_id,
          enabled: v.enabled,
        })),
    balances,
    locations,
    movements: movements.filter((m) => ids.has(m.balance_id)),
    recipes,
    recipe_items: recipeItems.filter((i) => recipeIds.has(i.recipe_id)),
    groups,
    modifiers,
    links,
    categories: catalog ? await s.list('categories') : [],
    ingredients: products.map((p) => ({
      id: p.id,
      name: p.name,
      stock_policy: p.stock_policy,
      stock_location_id: p.stock_location_id,
    })),
  };
}
export async function makeDefaultStockLocation(s: Scope, id: string) {
  permit(s.actor, 'inventory.adjust');
  await s.tx.execute(
    sql`SELECT id FROM establishments WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId} FOR UPDATE`,
  );
  const location = await s.get('stock_locations', id);
  for (const previous of await s.list('stock_locations', sql`is_default=TRUE`))
    await s.update('stock_locations', previous.id, { is_default: false });
  await s.update('stock_locations', id, { is_default: true });
  await s.audit('stock.default_changed', id);
  await s.event('stock.updated', id);
  return { ...location, is_default: true };
}
export async function removeCatalogLink(
  s: Scope,
  table: 'recipe_items' | 'product_modifiers',
  id: string,
) {
  permit(s.actor, 'catalog.manage');
  const record = await s.get(table, id);
  await s.audit(table + '.removed', id, record);
  await s.tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${s.where(sql`id=${id}`)}`);
  await s.event(table + '.updated', id);
  return { id, removed: true };
}
