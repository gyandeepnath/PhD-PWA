import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil, assertStimulusFits, waitStageChange } from './helpers';
import { RT_LOCATIONS } from '../src/lib/rtLocations';

/**
 * The reading column must be the same width, in root pixels, on every device.
 *
 * `tests/stimulusGeometry.test.ts` proves the arithmetic. This proves the WIRING — that the rendered
 * DOM actually lays the passage out in a fixed column rather than a percentage of a root box that
 * takes the device's aspect ratio.
 *
 * The measurement is deliberately in ROOT pixels (dividing out `--vl-scale`), because root pixels
 * are the units the layout is authored in and the units line length is determined in. In CSS pixels
 * the column SHOULD differ between devices — that difference is the uniform magnification
 * `stimulus_scale` records and the study accepts. What must not differ is the number of characters
 * on a line, and that is a root-pixel quantity.
 *
 * Two viewports with deliberately different aspect ratios: 1152x720 is 1.60, 1024x768 is 1.33, and
 * the design canvas is 1.4317 — so a percentage column lands on three different widths and a fixed
 * one does not.
 */
const VIEWPORTS = [
  { name: 'Xiaomi Pad 6 landscape', width: 1152, height: 720 },
  { name: 'iPad 9.7 landscape', width: 1024, height: 768 },
];

async function columnWidthInRootPx(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const scale = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1;
    const root = document.getElementById('root')!;
    // The passage itself: the element whose width decides how many characters fit on a line.
    const para = root.querySelector('[data-testid=reading-text]') as HTMLElement | null;
    return {
      scale,
      rootW: root.clientHeight > 0 ? root.clientWidth : -1,
      columnW: para ? para.getBoundingClientRect().width / scale : -1,
    };
  });
}

test('the reading column is the same width in root pixels on differently-shaped devices', async ({ page }) => {
  const measured: { name: string; scale: number; rootW: number; columnW: number }[] = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'READING_TASK');
    // READING_TASK opens on its intro card; the passage itself is behind "Begin reading".
    const begin = page.getByRole('button', { name: /Begin reading/ });
    if (await begin.count()) await begin.first().click({ force: true });
    await page.locator('#root [data-testid=reading-text]').first().waitFor({ state: 'visible' });
    const m = await columnWidthInRootPx(page);
    expect(m.columnW, `no reading passage found at ${vp.name}`).toBeGreaterThan(0);
    measured.push({ name: vp.name, ...m });
  }

  // The premise: these two devices really do give differently-shaped root boxes, or the test is
  // asserting something that was never at risk.
  const shapes = measured.map((m) => (m.rootW / m.scale).toFixed(0));
  expect(new Set(shapes).size,
    'both viewports produced the same root box, so this test proves nothing').toBeGreaterThan(1);

  const [a, b] = measured;
  expect(
    Math.abs(a.columnW - b.columnW),
    `the passage is ${a.columnW.toFixed(0)} root px on ${a.name} but ${b.columnW.toFixed(0)} on `
    + `${b.name} — line length, and so reading rate, differs by device`,
  ).toBeLessThanOrEqual(1);
});

/*
 * ROUND 63 — the passage must not move when "Next page" unlocks (screen audit F3).
 *
 * The page is centred vertically in whatever box the header and footer leave. The footer used to be
 * about 23 px shorter while it held the countdown than once it held the button, so at 20 s the box
 * grew and the passage jumped up about 10 px — on every page, thirty times a sitting, inside the
 * blink window. The footer is now one height in both states; this pins it.
 *
 * The ?e2e floor is 150 ms, too short to catch the locked state reliably, so the page's animation
 * frames are HELD while the locked page is measured (the countdown is rAF-driven and cannot expire
 * without them), then released. Nothing about the layout depends on rAF.
 */
const TABLET = [
  { name: 'Xiaomi Pad 6, installed', width: 1152, height: 720 },
  { name: 'Xiaomi Pad 6, address bar showing', width: 1152, height: 650 },
];

for (const vp of TABLET) {
  test(`the reading passage does not move when Next page unlocks at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'READING_TASK');
    await page.evaluate(() => {
      const w = window as unknown as { __rafQ: FrameRequestCallback[]; __rafReal: typeof requestAnimationFrame };
      w.__rafQ = [];
      w.__rafReal = window.requestAnimationFrame.bind(window);
      // Negative ids, so a cancelAnimationFrame of a held frame can never cancel a real one.
      window.requestAnimationFrame = (cb) => { w.__rafQ.push(cb); return -w.__rafQ.length; };
    });
    await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
    await expect(page.getByText(/Please keep reading/)).toBeVisible();

    const measure = () => page.evaluate(() => {
      const block = document.querySelector('[data-testid=reading-block]') as HTMLElement;
      const box = document.querySelector('[data-testid=reading-text]') as HTMLElement;
      const footer = document.querySelector('[data-testid=reading-footer]') as HTMLElement;
      return {
        blockTop: block.getBoundingClientRect().top,
        boxHeight: box.getBoundingClientRect().height,
        footerHeight: footer.getBoundingClientRect().height,
      };
    });
    const locked = await measure();

    await page.evaluate(() => {
      const w = window as unknown as { __rafQ: FrameRequestCallback[]; __rafReal: typeof requestAnimationFrame };
      window.requestAnimationFrame = w.__rafReal;
      for (const cb of w.__rafQ.splice(0)) w.__rafReal(cb);
    });
    await expect(page.getByRole('button', { name: /Next page/ })).toBeVisible();
    const unlocked = await measure();

    expect(Math.abs(unlocked.footerHeight - locked.footerHeight),
      `the footer is ${locked.footerHeight.toFixed(1)} px locked and ${unlocked.footerHeight.toFixed(1)} px unlocked`)
      .toBeLessThanOrEqual(0.5);
    expect(Math.abs(unlocked.boxHeight - locked.boxHeight), 'the text box changed height at unlock')
      .toBeLessThanOrEqual(0.5);
    expect(Math.abs(unlocked.blockTop - locked.blockTop),
      `the passage moved ${(unlocked.blockTop - locked.blockTop).toFixed(1)} px when Next page unlocked`)
      .toBeLessThanOrEqual(0.5);
    await assertStimulusFits(page, 'reading-text');
  });

  /*
   * Visual-search word targets (screen audit F21). Each word was a bare inline span about 25 px tall
   * on a taller line pitch, so a tap in the band between two lines touched no word and was not
   * recorded at all, and the space spans beside short words caught taps at their edges. The word's
   * tap box is now padded vertically (no layout change) and the spaces take no pointer events.
   *
   * What "no dead band" means precisely: every point of the text area belongs to exactly one line
   * box, and the browser hit-tests a point only against that line's own boxes. So each word must
   * own a tile as tall as the line pitch — then the tiles of consecutive lines meet, and the only
   * points that answer to no word are the columns under the spaces. (Where exactly the line box sits
   * relative to the glyphs is the font's business, not ours, so the tile is found by scanning, not
   * assumed to be centred.) Checked with elementFromPoint, the browser's own hit test: every word's
   * tile at its centre column, and both side edges at mid-height.
   */
  test(`every search word answers a tap across the whole line, edges included, at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'VISUAL_SEARCH');
    await page.getByRole('button', { name: /Begin search/ }).click({ force: true });
    await page.locator('[data-testid=search-text] [data-word]').first().waitFor({ state: 'visible' });

    const r = await page.evaluate(() => {
      const out = { words: 0, pitch: 0, edgeMisses: [] as string[], shortTiles: [] as string[] };
      const hitWord = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-word]') ?? null;
      const box = document.querySelector('[data-testid=search-text]') as HTMLElement;
      // The line pitch in CSS px on screen: line-height times the root scale.
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1;
      const pitch = parseFloat(getComputedStyle(box).lineHeight) * scale;
      out.pitch = pitch;
      const STEP = 0.25;
      for (const w of [...box.querySelectorAll('[data-word]')] as HTMLElement[]) {
        const g = (w.firstElementChild as HTMLElement).getBoundingClientRect();   // the glyphs
        const cx = (g.left + g.right) / 2;
        const cy = (g.top + g.bottom) / 2;
        out.words += 1;
        // Side edges, at mid-height: the space beside the word must not take the tap.
        for (const x of [g.left + 1, g.right - 1]) if (hitWord(x, cy) !== w) out.edgeMisses.push(w.textContent ?? '');
        // The tile: the contiguous run of heights, through the glyphs, at which a tap reaches w.
        let top = cy; while (top - STEP > cy - pitch && hitWord(cx, top - STEP) === w) top -= STEP;
        let bottom = cy; while (bottom + STEP < cy + pitch && hitWord(cx, bottom + STEP) === w) bottom += STEP;
        if (bottom - top + STEP < pitch - 1) out.shortTiles.push(`${w.textContent} ${(bottom - top + STEP).toFixed(1)}px`);
      }
      return out;
    });
    expect(r.words).toBeGreaterThan(100);
    expect(r.pitch).toBeGreaterThan(20);
    expect(r.edgeMisses, 'a tap at the edge of these words did not reach them').toEqual([]);
    expect(r.shortTiles, `these words answer taps over less than the ${r.pitch.toFixed(1)} px line pitch, `
      + 'leaving a band between lines where a tap reaches no word').toEqual([]);

    // The padding is not layout: with it stripped, the excerpt sets identically — same box, same
    // position of every line — and with it, the excerpt still fits its box.
    const layoutWithAndWithout = await page.evaluate(() => {
      const block = document.querySelector('[data-testid=search-text]')!.firstElementChild as HTMLElement;
      const words = [...block.querySelectorAll('[data-word]')] as HTMLElement[];
      const snap = () => JSON.stringify([block.getBoundingClientRect().toJSON(),
        ...words.map((w) => { const g = (w.firstElementChild as HTMLElement).getBoundingClientRect(); return [g.left, g.top]; })]);
      const padded = snap();
      const saved = words.map((w) => w.style.padding);
      for (const w of words) w.style.padding = '0';
      const bare = snap();
      words.forEach((w, i) => { w.style.padding = saved[i]; });
      return { padded, bare };
    });
    expect(layoutWithAndWithout.padded).toBe(layoutWithAndWithout.bare);
    await assertStimulusFits(page, 'search-text');
  });

  /*
   * ROUND 66 — the reaction-time dots, where they really land (research round 62, section 3.3).
   *
   * tests/rtLocations.test.ts proves the arithmetic on the canvas; this proves the wiring on the
   * screen: that each dot is drawn at its location's offset from the fixation cross, that its edges
   * stay at least 60 px inside the screen, and that it keeps 118 px clear of the chrome — the Pause
   * chip's footprint at the top left (measured on the instruction card, where Pause is offered: it is
   * withdrawn during trials, but the clearance must not depend on that), the same footprint at the top
   * right where a trial counter used to sit, and the researcher indicator at the bottom left. At
   * 1152x650 (the address bar showing, scale 0.90) the same must hold with nothing clipped.
   *
   * The ?e2e block is 4 trials and 1 practice, laid out by quadrant in turn with the rings
   * alternating and the starting ring swapped on the next block, so the first two blocks of a sitting
   * visit all eight locations. Every dot is caught as it is inserted, by a MutationObserver, because
   * an e2e trial lasts 120 ms.
   */
  test(`every reaction-time dot clears the screen edges and the chrome at ${vp.name}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);

    const seen: { id: number; dot: number[]; cross: number[] | null; scale: number; vw: number; vh: number; chrome: Record<string, number[]> }[] = [];
    for (let blockNo = 0; blockNo < 2; blockNo++) {
      await driveUntil(page, 'REACTION_TIME');
      await page.getByRole('button', { name: /^Start/ }).waitFor();
      // The Pause chip as offered on the card: its footprint is the top-left zone the dots must clear.
      const pause = await page.evaluate(() => {
        const r = document.querySelector('[data-testid=pause-chip]')?.getBoundingClientRect();
        return r ? [r.left, r.top, r.right, r.bottom] : null;
      });
      expect(pause, 'Pause is offered on the reaction-time card').not.toBeNull();
      await page.evaluate((pauseRect) => {
        const w = window as unknown as { __rtDots: unknown[]; __rtObs?: MutationObserver };
        w.__rtDots = [];
        let cross: number[] | null = null;
        const rect = (el: Element | null) => {
          const r = el?.getBoundingClientRect();
          return r && r.width > 0 ? [r.left, r.top, r.right, r.bottom] : null;
        };
        w.__rtObs?.disconnect();
        w.__rtObs = new MutationObserver(() => {
          const c = rect(document.querySelector('[data-testid=rt-fixation]'));
          if (c) cross = [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];
          const dot = document.querySelector('[data-testid=rt-dot]');
          if (!dot || (dot as HTMLElement).dataset.seen) return;
          (dot as HTMLElement).dataset.seen = '1';
          const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1;
          const chrome: Record<string, number[]> = {};
          const panel = rect(document.querySelector('[data-testid^=researcher-panel]'));
          if (panel) chrome.researcher = panel;
          const livePause = rect(document.querySelector('[data-testid=pause-chip]'));
          chrome.pause = livePause ?? pauseRect;
          // Where the trial counter used to be: the Pause footprint, mirrored to the top right.
          chrome.topRight = [innerWidth - pauseRect[2], pauseRect[1], innerWidth - pauseRect[0], pauseRect[3]];
          w.__rtDots.push({
            id: Number((dot as HTMLElement).dataset.location), dot: rect(dot), cross, scale,
            vw: innerWidth, vh: innerHeight, chrome,
          });
        });
        w.__rtObs.observe(document.body, { childList: true, subtree: true });
      }, pause!);
      await page.getByRole('button', { name: /^Start/ }).click();
      await waitStageChange(page, 'REACTION_TIME');
      seen.push(...await page.evaluate(() => (window as unknown as { __rtDots: never[] }).__rtDots));
    }

    // Practice (1) + two scored blocks (4 each): all eight locations, each dot measured.
    expect(seen.length).toBe(9);
    expect(new Set(seen.map((d) => d.id)).size, 'the first two blocks should visit all eight locations').toBe(8);

    const gap = (a: number[], b: number[]) => Math.hypot(
      Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3]));
    for (const d of seen) {
      const loc = RT_LOCATIONS[d.id - 1];
      const [l, t, r, b] = d.dot;
      // Drawn at its offset from the cross, in root px.
      expect(d.cross, `location ${d.id}: no fixation cross before the dot`).not.toBeNull();
      expect(((l + r) / 2 - d.cross![0]) / d.scale, `location ${d.id} dx`).toBeCloseTo(loc.dx, 0);
      expect(((t + b) / 2 - d.cross![1]) / d.scale, `location ${d.id} dy`).toBeCloseTo(loc.dy, 0);
      // The cross is the screen's centre.
      expect(Math.abs(d.cross![0] - d.vw / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(d.cross![1] - d.vh / 2)).toBeLessThanOrEqual(1);
      // Edges: at least 60 px inside the screen, so nothing is clipped.
      const edge = Math.min(l, t, d.vw - r, d.vh - b);
      expect(edge, `location ${d.id}: dot edge ${edge.toFixed(1)} px from the screen edge`).toBeGreaterThanOrEqual(60);
      // Chrome: 118 px clear of each zone.
      expect(Object.keys(d.chrome)).toEqual(expect.arrayContaining(['researcher', 'pause', 'topRight']));
      for (const [name, zone] of Object.entries(d.chrome)) {
        expect(gap(d.dot, zone), `location ${d.id}: ${name} only ${gap(d.dot, zone).toFixed(1)} px away`).toBeGreaterThanOrEqual(118);
      }
    }
  });
}
