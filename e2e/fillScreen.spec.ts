import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, handleStage, assertStimulusFits } from './helpers';
import { computeScale, DESIGN_WIDTH, DESIGN_HEIGHT, SCALE_STEP, STIMULUS_COLUMN_PX } from '../src/lib/viewportScale';

/**
 * The layout FILLS the screen it is shown on, and every stimulus still fits (Round 74).
 *
 * The investigator, on the real tablet: "both sides of the contents have about 25% blank space, while
 * tasks, reaction trials, comprehension, dashboards etc are only in the centre, even though the back
 * and home buttons use the corners". Rounds 63-66 measured every layout at 1152x720 — a viewport
 * ASSUMED for the tablet and never read off it — and the scale was capped at 1, so on any viewport with
 * more CSS pixels than that the 1152x720 canvas sat in the middle: the 1040 px column covers 54% of a
 * 1920 px width. Every suite here ran at 1152x720, 1152x650 or 1280x800, where the cap hardly shows.
 *
 * So this walks the first display of a sitting — reading, comprehension, search, the reaction-time
 * dots — at six viewports, from the one assumed before to a 2560x1600 desktop, and on each requires:
 * the scale is the fitted one; the canvas spans the screen within one step on its binding axis; on a
 * 16:10 screen the stimulus column covers at least 85% of the width; and every stimulus fits.
 */
const VIEWPORTS = [
  { w: 1152, h: 720, name: '1152x720 (the viewport Rounds 63-66 assumed)' },
  { w: 1152, h: 650, name: '1152x650 (the same, address bar showing)' },
  { w: 1280, h: 800, name: '1280x800' },
  { w: 1600, h: 1000, name: '1600x1000 (a 16:10 tablet at pixel ratio 1.8)' },
  { w: 1920, h: 1200, name: '1920x1200 (the study tablet at pixel ratio 1.5)' },
  { w: 2560, h: 1600, name: '2560x1600' },
];

const is1610 = (w: number, h: number) => Math.abs(w / h - DESIGN_WIDTH / DESIGN_HEIGHT) < 1e-9;

async function scaleNow(page: Page): Promise<number> {
  return page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1);
}

/** Width of a stimulus box in CSS px, and the viewport's. */
async function widthOf(page: Page, testId: string): Promise<{ box: number; vw: number }> {
  return page.evaluate((id) => ({
    box: document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect().width,
    vw: innerWidth,
  }), testId);
}

for (const vp of VIEWPORTS) {
  test(`the layout fills ${vp.name}, and every stimulus fits`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/?e2e=1');
    await page.waitForTimeout(300);

    // ---- the scale is the fitted one, and the canvas spans the screen on its binding axis
    const scale = await scaleNow(page);
    expect(scale, 'the applied scale is computeScale of this viewport').toBe(computeScale(vp.w, vp.h));
    const widthBound = vp.w / DESIGN_WIDTH <= vp.h / DESIGN_HEIGHT;
    const span = widthBound ? DESIGN_WIDTH * scale : DESIGN_HEIGHT * scale;
    const side = widthBound ? vp.w : vp.h;
    const step = (widthBound ? DESIGN_WIDTH : DESIGN_HEIGHT) * SCALE_STEP;
    expect(Math.abs(span - side), `the canvas spans ${span.toFixed(0)} of ${side} px`).toBeLessThanOrEqual(step);
    if (is1610(vp.w, vp.h)) {
      expect(Math.abs(DESIGN_WIDTH * scale - vp.w), '16:10: the canvas width is the screen width within a step')
        .toBeLessThanOrEqual(DESIGN_WIDTH * SCALE_STEP);
    }
    // The root box covers the viewport exactly: nothing is letterboxed or clipped.
    const root = await page.evaluate(() => { const r = document.getElementById('root')!.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    expect(root[0]).toBe(0);
    expect(root[1]).toBe(0);
    expect(Math.abs(root[2] - vp.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(root[3] - vp.h)).toBeLessThanOrEqual(1);
    // The landing page's build line is on screen.
    const stamp = await page.getByTestId('build-stamp').boundingBox();
    expect(stamp && stamp.y + stamp.height <= vp.h + 0.5, 'the build line is on screen').toBe(true);

    // ---- one display: every stimulus fits, and on 16:10 covers the screen's width
    await startNewExperiment(page);
    const measured = new Set<string>();
    const column = async (testId: string) => {
      const { box, vw } = await widthOf(page, testId);
      // The column is STIMULUS_COLUMN_PX design px, drawn at the scale.
      expect(Math.abs(box - STIMULUS_COLUMN_PX * scale), `${testId}: ${box.toFixed(0)} CSS px wide`).toBeLessThanOrEqual(1.5);
      if (is1610(vp.w, vp.h)) {
        expect(box / vw, `${testId} covers ${(100 * box / vw).toFixed(0)}% of the width`).toBeGreaterThanOrEqual(0.85);
      }
      measured.add(testId);
    };
    let dots: { rect: number[]; scale: number; vw: number; vh: number }[] = [];
    for (let guard = 0; guard < 400; guard++) {
      const stage = await stageNow(page);
      if (stage === 'READING_TASK' && !measured.has('reading-text') && await page.getByTestId('reading-text').count()) {
        await assertStimulusFits(page, 'reading-text');
        await column('reading-text');
      }
      if (stage === 'COMPREHENSION' && !measured.has('mcq-box') && await page.getByTestId('mcq-box').count()) {
        await assertStimulusFits(page, 'mcq-box');
        await column('mcq-box');
      }
      if (stage === 'VISUAL_SEARCH' && !measured.has('search-text') && await page.getByTestId('search-text').count()) {
        await assertStimulusFits(page, 'search-text');
        await column('search-text');
      }
      if (stage === 'REACTION_TIME') {
        // Every dot, caught as it is inserted (an e2e trial lasts about 120 ms).
        await page.evaluate(() => {
          const w = window as unknown as { __dots: unknown[]; __obs?: MutationObserver };
          w.__dots = [];
          w.__obs?.disconnect();
          w.__obs = new MutationObserver(() => {
            const dot = document.querySelector('[data-testid=rt-dot]') as HTMLElement | null;
            if (!dot || dot.dataset.fillSeen) return;
            dot.dataset.fillSeen = '1';
            const r = dot.getBoundingClientRect();
            w.__dots.push({
              rect: [r.left, r.top, r.right, r.bottom], vw: innerWidth, vh: innerHeight,
              scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1,
            });
          });
          w.__obs.observe(document.body, { childList: true, subtree: true });
        });
        await handleStage(page, stage);
        dots = await page.evaluate(() => (window as unknown as { __dots: never[] }).__dots);
        break;
      }
      await handleStage(page, stage);
    }
    expect([...measured].sort()).toEqual(['mcq-box', 'reading-text', 'search-text']);

    // ---- the reaction-time dots: inside the screen, clear of its edges
    expect(dots.length, 'no reaction-time dot was seen').toBeGreaterThanOrEqual(4);
    for (const d of dots) {
      const [l, t, r, b] = d.rect;
      const edge = Math.min(l, t, d.vw - r, d.vh - b);
      // At least 55 design px from every edge (68 on the 1152x720 canvas; the root box can be up to 1%
      // smaller than the canvas, see OVERFILL_TOLERANCE).
      expect(edge / d.scale, `a dot ${edge.toFixed(1)} CSS px from the edge`).toBeGreaterThanOrEqual(55);
    }
  });
}
