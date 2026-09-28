import { test, expect } from '@playwright/test';
import { stageNow, handleStage, startNewExperiment } from './helpers';

/**
 * Every dashboard tab must be reachable to its last row on the shortest study viewport.
 *
 * Round 62: the dashboard was a min-h-screen box with no scroll container inside a root that is
 * overflow:hidden, on a body that is touch-action:none. At 1152x720 the Data Quality / QC tab hid
 * about 1560 CSS px — the "Why rows were excluded" table, the blink, PERCLOS and engagement charts and
 * every per-condition QC row — and three other tabs lost their lower parts. Nothing tested it: the
 * screen-fit suite walked the setup stages only.
 *
 * So: a sitting is driven to the dashboard at 1152x650 (a Xiaomi Pad 6 in Chrome with the address bar
 * showing), and on every tab the clipped root must not overflow, and the dashboard's own scroll must
 * bring its last element fully on screen.
 */
test('every dashboard tab scrolls to its last row at 1152x650', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1152, height: 650 });
  await startNewExperiment(page);
  let guard = 0;
  for (;;) {
    if (guard++ > 500) throw new Error('stage loop did not terminate');
    if (await handleStage(page, await stageNow(page))) break;
  }
  await expect(page.getByText('Analysis Dashboard')).toBeVisible();
  // The way back is the shared chip, and it is a 44 CSS px target.
  const back = page.getByTestId('nav-sessions');
  await expect(back).toHaveText('← Back to sessions');
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);

  const tabs = ['Overview', 'All Participants', 'Reaction Time', 'Fatigue', 'Search & Perception', 'Data Quality / QC', 'Export'];
  for (const name of tabs) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(400);   // charts and the pooled cohort render asynchronously
    const m = await page.evaluate(() => {
      const root = document.getElementById('root')!;
      const box = document.querySelector('[data-testid="dashboard-scroll"]') as HTMLElement;
      const before = { scroll: box.scrollHeight, client: box.clientHeight };
      box.scrollTop = box.scrollHeight;
      // The deepest element with a box: whatever is last in the tab's content.
      const all = Array.from(box.querySelectorAll('*')).filter((e) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.height > 0 && r.width > 0 && getComputedStyle(e as HTMLElement).position !== 'fixed'
          && !(e as HTMLElement).closest('[data-testid="scroll-cue"]');
      });
      const lastBottom = Math.max(...all.map((e) => (e as HTMLElement).getBoundingClientRect().bottom));
      return {
        rootOver: root.scrollHeight - root.clientHeight,
        scrolls: before.scroll > before.client + 1,
        lastBottom, viewport: window.innerHeight,
      };
    });
    expect(m.rootOver, `${name}: overflows the clipped root`).toBeLessThanOrEqual(1);
    expect(m.lastBottom, `${name}: its last element stays below the screen after scrolling`).toBeLessThanOrEqual(m.viewport + 1);
    if (name === 'Data Quality / QC') expect(m.scrolls, 'the QC tab is longer than one screen and must scroll').toBe(true);
    await page.getByTestId('dashboard-scroll').evaluate((el) => { el.scrollTop = 0; });
  }
});
