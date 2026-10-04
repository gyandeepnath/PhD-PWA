import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, handleStage, throughCameraAndCalibration, driveUntil } from './helpers';

/**
 * Every screen must fit the box that clips it, on the study tablet.
 *
 * `#root` is `overflow: hidden` and `body` carries `touch-action: none`, both deliberately, so that
 * a stimulus cannot be scrolled mid-exposure. The cost is that overflow is not "below the fold" —
 * it is unreachable. The CVS-Q shipped 43 px over the canvas on an iPad and 106 px over on a
 * Xiaomi Pad 6, which meant sixteen items could be answered and never submitted.
 *
 * This used to walk the setup chain only, at 1152x650. Since the design canvas became 1152x720
 * (Round 63), the tightest box is no longer the address-bar viewport — at 0.90 that root is 1280x722
 * — but the canvas's own 720 design px, and a viewport the scale rounds UP for, where the root box is
 * up to 1% smaller than the canvas (OVERFILL_TOLERANCE, viewportScale.ts): 1152x713 (scale 1.0, root
 * 1152x713) and, since the canvas is fitted up as well as down (Round 74), 1280x800 (scale 1.12, root
 * 1143x714 — the narrowest). So the walk covers EVERY screen of a full sitting — setup, each
 * condition's intro cards, pages, items, ratings, the reaction-time card, the break, the closing
 * questionnaires — at all four, and checks each screen as the driver meets it, before acting on it.
 * (e2e/fillScreen.spec.ts checks the other side: that a larger screen is FILLED.)
 *
 * Content that is legitimately long scrolls inside its own container with a "More below" cue; that
 * passes here by construction, and the reachability suite checks its controls can be scrolled to.
 */
const VIEWPORTS = [
  { name: 'installed (1152x720)', width: 1152, height: 720 },
  { name: 'shortest viewport that rounds up to 1.0 (1152x713)', width: 1152, height: 713 },
  { name: 'rounded up to 1.12: the narrowest root (1280x800)', width: 1280, height: 800 },
  { name: 'address bar showing (1152x650)', width: 1152, height: 650 },
];

async function assertRootFits(page: Page, where: string): Promise<void> {
  const root = await page.evaluate(() => {
    const el = document.getElementById('root')!;
    return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth };
  });
  expect(root.scrollH - root.clientH, `${where} overflows the clipped root vertically`).toBeLessThanOrEqual(1);
  expect(root.scrollW - root.clientW, `${where} overflows the clipped root horizontally`).toBeLessThanOrEqual(1);
}

/**
 * The collapsed researcher panel sits fixed at the bottom left of every stage but the first and last.
 * On the 1152 px canvas the setup screens' buttons start under it, so a screen scrolled to its end
 * could put Back or Continue beneath the chip, where a tap opens the panel instead. Every control —
 * and the reading page's countdown — must stay clear of it, at the end of every scroll container.
 */
async function assertPanelClear(page: Page, where: string): Promise<void> {
  const hits = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid=researcher-panel-collapsed]') as HTMLElement | null;
    if (!chip) return [];
    const scrollers = (Array.from(document.querySelectorAll('#root *')) as HTMLElement[])
      .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2);
    const saved = scrollers.map((e) => e.scrollTop);
    for (const e of scrollers) e.scrollTop = e.scrollHeight;
    const c = chip.getBoundingClientRect();
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('#root button, #root input, #root [role=button], #root a, [data-testid=reading-countdown]')) as HTMLElement[]) {
      if (chip.contains(el) || el.closest('[data-testid^=researcher-panel]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) {
        out.push((el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40));
      }
    }
    scrollers.forEach((e, i) => { e.scrollTop = saved[i]; });
    return out;
  });
  expect(hits, `${where}: under the collapsed researcher panel`).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test(`every screen of a full sitting fits the clipped root — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    const visited = new Set<string>();
    for (let guard = 0; guard < 500; guard++) {
      const stage = await stageNow(page);
      // Let the screen settle (fonts, the fade-in on setup screens) before measuring it.
      await page.waitForTimeout(150);
      if ((await stageNow(page)) !== stage) continue;
      // Which sub-screen: a task's intro card and its stimulus page share a stage.
      const sub = await page.evaluate(() => {
        if (document.querySelector('[data-testid=reading-text]')) return 'page';
        if (document.querySelector('[data-testid=search-text]')) return 'excerpt';
        if (document.querySelector('[data-testid=mcq-box]')) return 'item';
        return 'card';
      });
      await assertRootFits(page, `${stage} (${sub})`);
      await assertPanelClear(page, `${stage} (${sub})`);
      visited.add(stage);
      if (await handleStage(page, stage)) break;
    }
    // The walk really did cover the sitting, or it proves nothing.
    for (const s of ['SESSION_INIT', 'CONSENT', 'PARTICIPANT_PROFILE', 'PREFLIGHT', 'COLOR_VISION',
      'CAMERA_SETUP', 'CALIBRATION', 'CVSQ_BASELINE', 'BASELINE_FATIGUE', 'INSTRUCTIONS', 'ADAPTATION',
      'READING_TASK', 'COMPREHENSION', 'DISPLAY_PERCEPTION', 'POST_FATIGUE', 'VISUAL_SEARCH',
      'REACTION_TIME', 'BREAK_SCREEN', 'CVSQ_END', 'NASA_TLX', 'SESSION_COMPLETE']) {
      expect(visited, `the walk never reached ${s}`).toContain(s);
    }
  });
}

/*
 * The camera path has screens the no-camera walk never shows: the preview, the calibration routine
 * and its result, and the camera self-test. Chromium's fake camera shows no face, so calibration and
 * the self-test fail, which is the path with the most text on screen.
 */
for (const vp of VIEWPORTS.filter((v) => v.height !== 713)) {
  test(`the camera set-up, calibration and self-test screens fit — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'CAMERA_SETUP');
    await assertRootFits(page, 'CAMERA_SETUP (notice)');
    // Check every screen the camera helper passes through, as it passes: a MutationObserver records
    // any moment the root overflows, which a check between steps could miss.
    await page.evaluate(() => {
      const w = window as unknown as { __overflow: string[] };
      w.__overflow = [];
      const root = document.getElementById('root')!;
      const check = () => {
        const over = root.scrollHeight - root.clientHeight;
        const overW = root.scrollWidth - root.clientWidth;
        if (over > 1 || overW > 1) {
          const stage = document.querySelector('[data-stage]')?.getAttribute('data-stage') ?? '?';
          const heading = (document.querySelector('h1, h2') as HTMLElement | null)?.innerText?.slice(0, 40) ?? '';
          w.__overflow.push(`${stage} "${heading}" +${over}px/+${overW}px`);
        }
      };
      new MutationObserver(() => requestAnimationFrame(check)).observe(root, { childList: true, subtree: true, characterData: true });
    });
    await throughCameraAndCalibration(page);
    await assertRootFits(page, 'after calibration');
    const overflow = await page.evaluate(() => (window as unknown as { __overflow: string[] }).__overflow);
    expect([...new Set(overflow)], 'a camera-path screen overflowed the clipped root').toEqual([]);
  });
}
