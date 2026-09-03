import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil } from './helpers';

/**
 * Every screen must fit the box that clips it, on the shortest device the study will use.
 *
 * `#root` is `overflow: hidden` and `body` carries `touch-action: none`, both deliberately, so that
 * a stimulus cannot be scrolled mid-exposure. The cost is that overflow is not "below the fold" —
 * it is unreachable. The CVS-Q shipped 43 px over the canvas on an iPad and 106 px over on a
 * Xiaomi Pad 6, which meant sixteen items could be answered and never submitted.
 *
 * The existing reachability suite checked two screens. This walks the whole setup chain, because
 * the one that broke was not among the two.
 */
const STAGES = [
  'CONSENT', 'PARTICIPANT_PROFILE', 'PREFLIGHT', 'COLOR_VISION',
  'CAMERA_SETUP', 'CVSQ_BASELINE', 'BASELINE_FATIGUE', 'INSTRUCTIONS',
];

// The shortest viewport the study will meet: a Xiaomi Pad 6 in Chrome with the address bar showing.
const SHORTEST = { width: 1152, height: 650 };

for (const stage of STAGES) {
  test(`${stage} fits the clipped root at ${SHORTEST.width}x${SHORTEST.height}`, async ({ page }) => {
    await page.setViewportSize(SHORTEST);
    await startNewExperiment(page);
    await driveUntil(page, stage);

    const root = await page.evaluate(() => {
      const el = document.getElementById('root')!;
      return {
        scrollH: el.scrollHeight, clientH: el.clientHeight,
        scrollW: el.scrollWidth, clientW: el.clientWidth,
      };
    });

    expect(root.scrollH - root.clientH, `${stage} overflows the clipped root vertically`)
      .toBeLessThanOrEqual(1);
    expect(root.scrollW - root.clientW, `${stage} overflows the clipped root horizontally`)
      .toBeLessThanOrEqual(1);
  });
}
