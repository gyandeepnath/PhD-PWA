import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, markAllVas, click } from './helpers';
import { TAP_GUARD_MS } from '../src/lib/tapGuard';

/**
 * Only a tap inside a rating line's own target marks it, on a TOUCH screen (Round 85).
 *
 * The rest of the suite marks the lines with a mouse, where a click lands exactly where it is aimed. On
 * a touch screen Chromium hands a tap that lands near something tappable to that thing (touch
 * adjustment), and the lines' labels, end words and the space between items were not tappable: a tap
 * on the label "Tired or aching eyes", a few pixels above its target, was taken as a rating on that line,
 * at the left end where the label starts. Every part of an item but its target now takes its own taps
 * (VasLine.tsx). This drives a sitting with a touch screen to both rating screens and taps the label,
 * the end word and the space under each line — none may mark — and then the line itself, which must.
 */
test.use({ viewport: { width: 1152, height: 720 }, hasTouch: true });

async function value(page: Page, name: string): Promise<string | null> {
  return page.getByTestId(`vas-${name}`).getAttribute('data-value');
}

/** Taps around and on one item: its label is the `index`-th on the screen, its left end word the `wordIndex`-th `endWord`. */
async function tapsMarkOnlyTheTarget(page: Page, name: string, index: number, endWord: string, wordIndex = 0) {
  // Past the screen's tap guard (lib/tapGuard.ts, Round 86), or a miss below could pass only because the
  // guard dropped it as the second tap of whatever brought the screen up.
  await page.waitForTimeout(TAP_GUARD_MS + 100);
  const target = (await page.getByTestId(`vas-${name}`).boundingBox())!;
  const label = (await page.locator('[data-vas-label]').nth(index).boundingBox())!;
  const word = (await page.getByText(endWord, { exact: true }).nth(wordIndex).boundingBox())!;
  const misses: [string, number, number][] = [
    ['the middle of the label', label.x + Math.min(120, label.width / 2), label.y + label.height / 2],
    ['the label, 3 px above the target', target.x + target.width / 2, target.y - 3],
    ['the end word', word.x + word.width / 2, word.y + word.height / 2],
    ['the space under the target, 4 px down', target.x + target.width / 2, target.y + target.height + 4],
  ];
  for (const [where, x, y] of misses) {
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(100);
    expect(await value(page, name), `a tap on ${where} marked the ${name} line`).toBe('');
  }
  // The line itself, halfway along: marked, near 50 mm.
  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
  await expect.poll(() => value(page, name)).not.toBe('');
  expect(Math.abs(Number(await value(page, name)) - 50)).toBeLessThanOrEqual(3);
}

test('a tap on a label, an end word or the space between items marks no line; a tap on the line does', async ({ page }) => {
  await startNewExperiment(page);
  await driveUntil(page, 'BASELINE_FATIGUE');
  // The first item, and the fourth, one between two others; "None" is each item's left end word.
  await tapsMarkOnlyTheTarget(page, 'eye_strain', 0, 'None', 0);
  for (const name of ['dryness', 'blur', 'burning', 'headache']) expect(await value(page, name)).toBe('');
  await tapsMarkOnlyTheTarget(page, 'burning', 3, 'None', 3);
  await markAllVas(page, 0.3);
  await click(page, /Continue|Record baseline/);

  await driveUntil(page, 'DISPLAY_PERCEPTION');
  await tapsMarkOnlyTheTarget(page, 'comfort', 0, 'Very uncomfortable');
  expect(await value(page, 'clarity')).toBe('');
  await tapsMarkOnlyTheTarget(page, 'clarity', 1, 'Very unclear');
});
