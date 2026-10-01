import { test, expect } from '@playwright/test';

/*
 * The investigator's Xiaomi Pad 6 ran at half size: opened small (a floating window), then maximised,
 * the scale stayed at MIN_SCALE because it was sized from the smallest viewport ever seen and nothing
 * let it rise. It must now recover at the next screen change outside a condition.
 */
const scaleNow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale') || '1'));

test('a scale locked small by a floating window recovers at the next screen', async ({ page }) => {
  // A floating window small enough to hit the floor on the 1152x720 canvas.
  await page.setViewportSize({ width: 560, height: 340 });
  await page.goto('/?e2e=1');
  expect(await scaleNow(page)).toBe(0.5);
  await page.setViewportSize({ width: 1152, height: 720 });
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await page.waitForTimeout(200);
  // The study tablet, installed: the canvas itself, so the design size.
  expect(await scaleNow(page)).toBe(1);
});
