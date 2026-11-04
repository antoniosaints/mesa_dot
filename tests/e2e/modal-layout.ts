import { expect, type Locator } from '@playwright/test';

/** Check readable headers and reachable controls without relying on a specific modal layout. */
export async function expectMobileModalLayout(dialog: Locator) {
  if ((dialog.page().viewportSize()?.width ?? 1000) > 700) return;
  const header = dialog.locator(':scope > .modal-header');
  const title = header.locator('.modal-title');
  const close = header.getByRole('button', { name: 'Fechar', exact: true });
  for (const element of [title, close]) await expect(element).toBeInViewport({ ratio: 1 });
  const [heading, closing, modal] = await Promise.all(
    [title, close, dialog].map((element) => element.boundingBox()),
  );
  expect(heading!.x + heading!.width).toBeLessThanOrEqual(closing!.x + 1);
  expect(closing!.width).toBeGreaterThanOrEqual(42);
  expect(closing!.height).toBeGreaterThanOrEqual(42);
  expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  const actions = header.locator('.modal-header-actions');
  if (await actions.isVisible()) {
    const box = (await actions.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(
      Math.max(heading!.y + heading!.height, closing!.y + closing!.height) - 1,
    );
    for (const button of await actions.locator('button').all())
      await expect(button).toBeInViewport({ ratio: 1 });
  }
  for (const group of [actions, ...(await dialog.locator('.modal-footer').all())]) {
    const boxes = [];
    for (const button of await group.locator('button:visible').all()) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(modal!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(modal!.x + modal!.width + 1);
      expect(
        await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      for (const previous of boxes) {
        const overlap =
          Math.min(box.x + box.width, previous.x + previous.width) - Math.max(box.x, previous.x) >
            1 &&
          Math.min(box.y + box.height, previous.y + previous.height) - Math.max(box.y, previous.y) >
            1;
        expect(overlap).toBe(false);
      }
      boxes.push(box);
    }
  }
}
