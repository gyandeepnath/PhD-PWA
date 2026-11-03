import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, dbAll } from './helpers';

/**
 * A shrink of the screen during one display is not carried into the next (Round 87, audit 86 F5).
 *
 * The scale was frozen on every stage of the condition loop, the grey field between displays
 * included, and a freeze cannot lapse into another: a 0.6 s turn to portrait and back during display 1
 * (scale 1 → 0.62, by design, for the rest of that display) drew the WHOLE of display 2 at 0.62 — its
 * passage in the middle 56% of the screen, 13.6 px text — with stimulus_scale_changes 0 on its row.
 * Now the grey field and the reading instruction card are re-fitted, and the scale freezes when the
 * passage is shown.
 */

test.use({ viewport: { width: 1152, height: 720 } });

const scaleNow = (page: Page) =>
  page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale') || '1'));

type Row = { session_position: number; stimulus_scale?: number; stimulus_scale_changes?: number; scale_freeze_version?: string };
const rows = async (page: Page) => (await dbAll<Row>(page, 'conditions')).sort((a, b) => a.session_position - b.session_position);

/** A turn to portrait and back, as the finder's reproduction did it. */
async function turnToPortraitAndBack(page: Page) {
  await page.setViewportSize({ width: 720, height: 1152 });
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1152, height: 720 });
  await page.waitForTimeout(800);
}

test('a turn to portrait during one display leaves the next display at full size', async ({ page }) => {
  test.setTimeout(300_000);
  await startNewExperiment(page);
  await driveUntil(page, 'READING_TASK');
  await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
  await expect(page.getByTestId('reading-text')).toBeVisible();
  const full = await scaleNow(page);
  expect(full).toBe(1);

  await turnToPortraitAndBack(page);
  // Inside display 1 the shrink stays — the text must never grow under a reader — and is counted.
  const shrunk = await scaleNow(page);
  expect(shrunk).toBeLessThan(full);

  // The grey field before display 2 is re-fitted, and display 2's passage is drawn at full size.
  await driveUntil(page, 'ADAPTATION');
  await expect.poll(() => scaleNow(page)).toBe(full);
  await driveUntil(page, 'READING_TASK');
  await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
  await expect(page.getByTestId('reading-text')).toBeVisible();
  expect(await scaleNow(page)).toBe(full);

  await driveUntil(page, 'BREAK_SCREEN');
  const [d1, d2] = await rows(page);
  expect(d1.stimulus_scale).toBe(full);
  expect(d1.stimulus_scale_changes).toBeGreaterThanOrEqual(1);
  expect(d2.stimulus_scale).toBe(full);
  expect(d2.stimulus_scale_changes).toBe(0);
  expect(d2.scale_freeze_version).toBe('sf-v2');
});

test('a turn to portrait on the reading instruction card is re-fitted before the passage is shown', async ({ page }) => {
  test.setTimeout(300_000);
  await startNewExperiment(page);
  await driveUntil(page, 'READING_TASK');
  await expect(page.getByRole('button', { name: /Begin reading/ })).toBeVisible();
  const full = await scaleNow(page);
  await turnToPortraitAndBack(page);
  await expect.poll(() => scaleNow(page)).toBe(full);
  await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
  await expect(page.getByTestId('reading-text')).toBeVisible();
  expect(await scaleNow(page)).toBe(full);
  await driveUntil(page, 'ADAPTATION');
  const [d1] = await rows(page);
  // Read when the passage was shown, and nothing shrank under it.
  expect(d1.stimulus_scale).toBe(full);
  expect(d1.stimulus_scale_changes).toBe(0);
});
