import { expect, type Locator } from '@playwright/test';

/** A card list must expose its fields and actions without horizontal page scrolling. */
export async function expectMobileListLayout(table: Locator) {
  await expect(table).toBeVisible();
  const viewport = table.page().viewportSize()!;
  const bounds = (await table.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  const rows = table.locator('tbody > tr:has(td:not([colspan]))');
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    const box = (await row.boundingBox())!;
    expect(
      await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      table.page().url(),
    ).toBe(true);
    const actions = [];
    for (const button of await row.locator('button:visible').all()) {
      const rect = (await button.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(
        await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      for (const prior of actions) {
        const overlap =
          Math.min(rect.x + rect.width, prior.x + prior.width) - Math.max(rect.x, prior.x) > 1 &&
          Math.min(rect.y + rect.height, prior.y + prior.height) - Math.max(rect.y, prior.y) > 1;
        expect(overlap).toBe(false);
      }
      actions.push(rect);
    }
  }
  expect(
    await table.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
}
