import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil, click } from './helpers';

/**
 * Every control the operator or participant must press has to be REACHABLE.
 *
 * `#root` is `overflow: hidden` and `body` carries `touch-action: none`, so a control below the
 * fold on a screen with no scroll container of its own is not merely awkward — no gesture can
 * reach it. Measured on the participant profile at iPad 11" landscape, the mandated orientation:
 * content 1167 px against a viewport of 834, with the caffeine buttons AND Continue past the
 * bottom edge. The operator fills in the form and there is no way to submit it. Portrait fits,
 * which is why it went unnoticed.
 *
 * The rest of the E2E suite cannot catch this: every click in helpers.ts passes `force: true`,
 * which skips Playwright's actionability checks and dispatches the click wherever the element is.
 * These tests deliberately do NOT use force.
 */
const LANDSCAPE = [
  { name: 'iPad 11in', width: 1194, height: 834 },
  { name: 'iPad 10.2in', width: 1080, height: 810 },
  /*
   * The Android tablets the study will actually run on are SHORTER than any iPad, and height is
   * the binding dimension for these screens. A Xiaomi Pad 6 in Chrome is about 1152x720 CSS px,
   * and roughly 650 while the address bar is showing — some 180px under the design canvas. Testing
   * only iPads is why the first real device found Continue buttons that no gesture could reach.
   */
  { name: 'Xiaomi Pad 6, address bar showing', width: 1152, height: 650 },
  { name: 'Xiaomi Pad 6, address bar hidden', width: 1152, height: 720 },
];

for (const vp of LANDSCAPE) {
  test(`setup controls are reachable at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'PARTICIPANT_PROFILE');

    // The shell must be a bounded scroll container, not a box that grows past the clipped root.
    const shell = await page.evaluate(() => {
      const root = document.getElementById('root')!;
      return { rootScroll: root.scrollHeight, rootClient: root.clientHeight };
    });
    expect(shell.rootScroll).toBeLessThanOrEqual(shell.rootClient + 1);

    // And the submit control must be brought into view by an ordinary scroll.
    const btn = page.getByRole('button', { name: /Continue/ });
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toBeInViewport();
  });

  test(`the visual-search passage scrolls and its end control is on screen at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'VISUAL_SEARCH');
    await click(page, /Start searching|Begin/);
    await page.waitForTimeout(300);

    const box = await page.evaluate(() => {
      const el = document.querySelector('.scrollable') as HTMLElement | null;
      return el ? { scrollH: el.scrollHeight, clientH: el.clientHeight } : null;
    });
    expect(box).not.toBeNull();
    // The passage is longer than the viewport by design; what matters is that it SCROLLS rather
    // than pushing the rest of the screen outside the clipped root.
    expect(box!.clientH).toBeLessThan(box!.scrollH);

    // Without this, the block could only ever end on the 40 s cap: termination_mode could never be
    // voluntary_early, and every search score came from whatever fraction was above the fold.
    await expect(page.getByRole('button', { name: /Done searching/ })).toBeInViewport();
  });

  /*
   * The questionnaire is the screen that actually broke in the field, and it broke only on a
   * viewport shorter than any iPad. Measured with the root scaler disabled at 1152x650: the
   * clipped root overflowed by 106 px with Continue inside that overflow, so the operator could
   * fill in all sixteen items and had no way to submit them. Every other setup screen fitted,
   * which is why adding a shorter viewport to the tests above was not by itself enough to catch it.
   */
  test(`the CVS-Q fits the clipped root and can be submitted at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'CVSQ_BASELINE');

    const root = await page.evaluate(() => {
      const el = document.getElementById('root')!;
      return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    // #root is overflow:hidden and body is touch-action:none. Anything past these bounds cannot be
    // reached by any gesture — it is not merely below the fold.
    expect(root.scrollH, 'the questionnaire overflows the clipped root vertically').toBeLessThanOrEqual(root.clientH + 1);
    expect(root.scrollW, 'the questionnaire overflows the clipped root horizontally').toBeLessThanOrEqual(root.clientW + 1);

    const btn = page.getByRole('button', { name: /Continue/ });
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toBeInViewport();
  });
}
