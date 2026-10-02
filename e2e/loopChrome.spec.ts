import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, handleStage, driveUntil, waitStageChange } from './helpers';

/**
 * The chrome inside a display — eyebrows, counters, the primary button, the Pause chip and the
 * researcher indicator — measured as rendered, on every screen of a display, at the study tablet's
 * viewports (screen audit F9, F10, F13-F17; audit round 65).
 *
 * tests/loopText.test.ts reads the sources for the same rules; this proves them on screen:
 *   - every word a participant can read is at least 16 design px, in full ink, at full opacity;
 *   - "Display k of N · Step j of 5" on the intro cards and the rating screens and nowhere else, the
 *     questions naming their step alone, and no step or display label on a reading page, the search
 *     excerpt or the reaction-time field;
 *   - one counter style, at the right-hand end of the column's header row;
 *   - one primary button: 56 design px tall, 17 px, centred on an intro card and at the content's
 *     right-hand edge everywhere else;
 *   - Pause: a 44 CSS px target in the top-left corner, touching nothing a participant reads or taps,
 *     at least 118 px from every dot position the reaction task's layout keeps, and never shown while
 *     reaction-time trials run (but shown on that task's instruction card);
 *   - the researcher panel: on every display screen a monochrome indicator in the screen's own ink,
 *     with no text, touching nothing; untappable except on reading and the grey field; not drawn at
 *     all while reaction-time trials run (but drawn on that task's instruction card); opened on a
 *     reading page, a strip held inside the footer row's free left part, clear of the countdown, the
 *     button and the passage;
 *   - all of it identical in the first and second display of the sitting, which differ only by
 *     condition (ink, ground) and passage.
 */

const VIEWPORTS = [
  { name: 'installed (1152x720)', width: 1152, height: 720 },
  { name: 'address bar showing (1152x650)', width: 1152, height: 650 },
];

/** The step each measured stage belongs to (experiment/taskSteps.tsx). */
const STEP: Record<string, number> = {
  READING_TASK: 1, COMPREHENSION: 2, DISPLAY_PERCEPTION: 3, POST_FATIGUE: 3, VISUAL_SEARCH: 4, REACTION_TIME: 5,
};
const LOOP = ['ADAPTATION', ...Object.keys(STEP)];
/** Where the panel may open: reading and the grey field. Everywhere else in a display it is locked. */
const PANEL_OPENS = new Set(['READING_TASK', 'ADAPTATION']);
/**
 * The reaction task's outer dot positions, as offsets from the fixation point at the root's centre
 * (coverage research 3.3: (310, 94), (842, 94), (310, 626), (842, 626) on the 1152x720 canvas), the
 * dot's diameter, and the clearance every chrome zone keeps from a dot.
 */
const RT_OUTER = [[-266, -266], [266, -266], [-266, 266], [266, 266]];
const RT_DOT_PX = 52;
const CHROME_CLEARANCE_PX = 118;
const COLUMN_PX = 1040;

type Box = { l: number; t: number; r: number; b: number };
interface Shot {
  stage: string; scale: number;
  /** A reading page still inside its minimum dwell: the countdown where the button will be. */
  locked: boolean; rootW: number; rootH: number;
  kind: 'card' | 'page' | 'item' | 'excerpt' | 'rating' | 'field' | 'grey';
  texts: { s: string; px: number; alpha: number; opacity: number; box: Box }[];
  controls: { s: string; box: Box }[];
  eyebrows: string[];
  allText: string;
  counter: { s: string; px: number; weight: string; family: string; box: Box } | null;
  buttons: { s: string; h: number; px: number; radius: string; family: string; box: Box }[];
  ratingBlock: Box | null;
  chip: { target: Box; targetCssH: number; face: Box; px: number; colour: string } | null;
  indicator: { box: Box; quiet: string | null; text: string; colours: string[]; pointer: string } | null;
}

/** Everything measured, in ROOT (design) px, so 1152x720 and 1152x650 compare directly. */
function measure(page: Page): Promise<Shot> {
  return page.evaluate(() => {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1;
    const box = (r: DOMRect) => ({ l: r.left / scale, t: r.top / scale, r: r.right / scale, b: r.bottom / scale });
    const skip = (el: Element) => !!el.closest('[data-testid^=researcher-panel], [data-testid=e2e-banner], [data-testid=pause-chip]');
    const root = document.getElementById('root')!;
    const opacityOf = (el: Element | null) => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
    const alphaOf = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m ? m[1].split(',') : []; return p.length === 4 ? parseFloat(p[3]) : 1; };

    const texts: Shot['texts'] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = (n.textContent ?? '').trim();
      const el = n.parentElement!;
      if (!s || skip(el)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const r = rg.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue;
      texts.push({ s: s.slice(0, 40), px: parseFloat(cs.fontSize), alpha: alphaOf(cs.color), opacity: opacityOf(el), box: box(r) });
    }
    const controls = (Array.from(root.querySelectorAll('button, input, [role=button]')) as HTMLElement[])
      .filter((e) => !skip(e) && e.getBoundingClientRect().width > 0)
      .map((e) => ({ s: (e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30), box: box(e.getBoundingClientRect()) }));

    const stage = document.querySelector('[data-stage]')?.getAttribute('data-stage') ?? '';
    const kind: Shot['kind'] = document.querySelector('[data-testid=task-intro]') ? 'card'
      : document.querySelector('[data-testid=reading-text]') ? 'page'
        : document.querySelector('[data-testid=mcq-box]') ? 'item'
          : document.querySelector('[data-testid=search-text]') ? 'excerpt'
            : stage === 'DISPLAY_PERCEPTION' || stage === 'POST_FATIGUE' ? 'rating'
              : stage === 'ADAPTATION' ? 'grey' : 'field';

    const counterEl = document.querySelector('[data-testid=reading-page-counter], [data-testid=mcq-counter], [data-testid=search-count]') as HTMLElement | null;
    const counter = counterEl ? (() => {
      const cs = getComputedStyle(counterEl);
      return { s: counterEl.textContent ?? '', px: parseFloat(cs.fontSize), weight: cs.fontWeight, family: cs.fontFamily, box: box(counterEl.getBoundingClientRect()) };
    })() : null;
    const buttons = (Array.from(root.querySelectorAll('[data-loop-primary]')) as HTMLElement[]).map((b) => {
      const cs = getComputedStyle(b);
      return { s: b.innerText.trim(), h: b.getBoundingClientRect().height / scale, px: parseFloat(cs.fontSize), radius: cs.borderTopLeftRadius, family: cs.fontFamily, box: box(b.getBoundingClientRect()) };
    });
    const eyebrowEls = Array.from(root.querySelectorAll('[data-testid=loop-eyebrow]')) as HTMLElement[];
    const ratingBlock = kind === 'rating' && eyebrowEls[0]?.parentElement ? box(eyebrowEls[0].parentElement.getBoundingClientRect()) : null;

    const chipEl = document.querySelector('[data-testid=pause-chip]') as HTMLElement | null;
    const faceEl = document.querySelector('[data-testid=pause-chip-face]') as HTMLElement | null;
    const chip = chipEl && faceEl ? {
      target: box(chipEl.getBoundingClientRect()), targetCssH: chipEl.getBoundingClientRect().height, face: box(faceEl.getBoundingClientRect()),
      px: parseFloat(getComputedStyle(faceEl).fontSize), colour: getComputedStyle(faceEl).color,
    } : null;

    const ind = document.querySelector('[data-testid=researcher-panel-collapsed]') as HTMLElement | null;
    const indicator = ind ? {
      box: box(ind.getBoundingClientRect()), quiet: ind.getAttribute('data-quiet'), text: ind.textContent ?? '', pointer: getComputedStyle(ind).pointerEvents,
      // Every colour the indicator paints: its border and each descendant's fill, border and text.
      colours: [ind, ...Array.from(ind.querySelectorAll('*'))].flatMap((e) => {
        const cs = getComputedStyle(e);
        const own = [cs.backgroundColor, cs.borderTopColor].concat(e.textContent ? [cs.color] : []);
        return own.filter((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
      }),
    } : null;

    return {
      stage, locked: !!document.querySelector('[data-testid=reading-countdown]'), scale, rootW: innerWidth / scale, rootH: innerHeight / scale, kind, texts, controls,
      eyebrows: eyebrowEls.map((e) => e.textContent ?? ''), allText: root.innerText, counter, buttons, ratingBlock, chip, indicator,
    } as Shot;
  });
}

const overlaps = (a: Box, b: Box, pad = 0) => a.l - pad < b.r && a.r + pad > b.l && a.t - pad < b.b && a.b + pad > b.t;
const round = (b: Box) => [b.l, b.t, b.r, b.b].map((v) => Math.round(v * 2) / 2);

/** Every rule, on one screen. `ink` is the condition's ink as the screen draws it. */
function check(m: Shot, stage: string, display: number, where: string): void {
  // F9: the floor, full ink, full opacity, for every word a participant can read.
  for (const t of m.texts) {
    expect(t.px, `${where}: "${t.s}" at ${t.px} px`).toBeGreaterThanOrEqual(16);
    expect(t.alpha, `${where}: "${t.s}" in translucent ink`).toBe(1);
    expect(t.opacity, `${where}: "${t.s}" at opacity ${t.opacity}`).toBe(1);
  }

  // F13b / F14: the step and display labels, where they belong and nowhere else.
  if (m.kind === 'card' || m.kind === 'rating') {
    expect(m.eyebrows, `${where}: one eyebrow`).toHaveLength(1);
    expect(m.eyebrows[0], where).toMatch(new RegExp(`^Display ${display} of 10 · Step ${STEP[stage]} of 5 · \\S`));
  } else if (m.kind === 'item') {
    expect(m.eyebrows, `${where}: one eyebrow`).toHaveLength(1);
    expect(m.eyebrows[0], where).toMatch(/^Step 2 of 5 · Questions/);
    expect(m.allText, where).not.toMatch(/Display \d+ of/);
  } else {
    expect(m.allText, `${where}: a step or display label on a stimulus screen`).not.toMatch(/Display \d+ of|Step \d of/);
  }

  // F13c: one counter, one style, at the right-hand end of the column's header row.
  const columnRight = (m.rootW + COLUMN_PX) / 2;
  if (m.kind === 'page' || m.kind === 'item' || m.kind === 'excerpt') {
    expect(m.counter, `${where}: counter`).not.toBeNull();
    const c = m.counter!;
    expect(c.s, where).toMatch(m.kind === 'page' ? /^Page \d of 3$/ : m.kind === 'item' ? /^Question \d of 3$/ : /^\d+ of \d+ found$/);
    expect([c.px, c.weight], where).toEqual([16, '500']);
    expect(Math.abs(c.box.r - columnRight), `${where}: counter not at the column's right edge`).toBeLessThanOrEqual(1);
  } else {
    expect(m.counter, `${where}: no counter here`).toBeNull();
  }

  // F17: one primary button and one position rule.
  if (m.kind !== 'field' && m.kind !== 'grey') expect(m.buttons.length, `${where}: primary button`).toBe(m.locked ? 0 : 1);
  for (const b of m.buttons) {
    expect(Math.abs(b.h - 56), `${where}: "${b.s}" is ${b.h} px tall`).toBeLessThanOrEqual(0.5);
    expect([b.px, b.radius], where).toEqual([17, '12px']);
    if (m.kind === 'card') expect(Math.abs((b.box.l + b.box.r) / 2 - m.rootW / 2), `${where}: "${b.s}" not centred`).toBeLessThanOrEqual(1);
    else if (m.kind === 'rating') expect(Math.abs(b.box.r - m.ratingBlock!.r), `${where}: "${b.s}" not at the block's right edge`).toBeLessThanOrEqual(1);
    else expect(Math.abs(b.box.r - columnRight), `${where}: "${b.s}" not at the column's right edge`).toBeLessThanOrEqual(1);
  }

  // Pause: offered on every screen of a display here (trials are checked separately), legible, a
  // 44 CSS px target, in the top-left corner, touching nothing, clear of every planned dot.
  expect(m.chip, `${where}: Pause`).not.toBeNull();
  const chip = m.chip!;
  expect(chip.targetCssH, `${where}: Pause target`).toBeGreaterThanOrEqual(43.5);
  expect(chip.px, where).toBeGreaterThanOrEqual(16);
  expect(chip.target.l < 12 && chip.target.t < 4, `${where}: Pause not in the top-left corner`).toBe(true);
  for (const x of [...m.texts, ...m.controls]) {
    expect(overlaps(chip.target, x.box), `${where}: Pause's target over "${x.s}"`).toBe(false);
    // And the visible outline keeps some ground round it.
    expect(overlaps(chip.face, x.box, 4), `${where}: Pause's outline within 4 px of "${x.s}"`).toBe(false);
  }
  const cx = m.rootW / 2; const cy = m.rootH / 2;
  for (const [dx, dy] of RT_OUTER) {
    const px = cx + dx; const py = cy + dy;
    const ddx = Math.max(chip.target.l - px, 0, px - chip.target.r);
    const ddy = Math.max(chip.target.t - py, 0, py - chip.target.b);
    expect(Math.hypot(ddx, ddy) - RT_DOT_PX / 2, `${where}: Pause within ${CHROME_CLEARANCE_PX} px of a dot`).toBeGreaterThanOrEqual(CHROME_CLEARANCE_PX);
  }

  // F10: the researcher indicator — the screen's own ink, no text, touching nothing.
  checkIndicator(m, stage, chip.colour, where);
}

function checkIndicator(m: Shot, stage: string, ink: string, where: string): void {
  expect(m.indicator, `${where}: researcher indicator`).not.toBeNull();
  const ind = m.indicator!;
  expect(ind.quiet, where).toBe('true');
  expect(ind.text, `${where}: text in the indicator`).toBe('');
  expect([...new Set(ind.colours)], `${where}: indicator colours`).toEqual([ink]);
  expect(ind.pointer, `${where}: indicator tappable?`).toBe(PANEL_OPENS.has(stage) ? 'auto' : 'none');
  for (const x of [...m.texts, ...m.controls]) {
    expect(overlaps(ind.box, x.box), `${where}: indicator over "${x.s}"`).toBe(false);
  }
}

const holdRaf = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __q: FrameRequestCallback[]; __real?: typeof requestAnimationFrame };
  w.__q = []; w.__real = w.__real ?? window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { w.__q.push(cb); return -w.__q.length; };
});
const releaseRaf = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __q: FrameRequestCallback[]; __real?: typeof requestAnimationFrame };
  if (!w.__real) return; window.requestAnimationFrame = w.__real; for (const cb of w.__q.splice(0)) w.__real(cb);
});

/**
 * The researcher strip opened on a locked reading page and again once Next has unlocked: inside the
 * footer row's free left part, clear of the countdown, the button and the passage.
 */
async function checkStrip(page: Page, where: string): Promise<void> {
  const boxes = () => page.evaluate(() => {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1;
    const b = (s: string) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left / scale, t: r.top / scale, r: r.right / scale, b: r.bottom / scale }; };
    return {
      strip: b('[data-testid=researcher-panel-strip]'), footer: b('[data-testid=reading-footer]'), text: b('[data-testid=reading-text]'),
      countdown: b('[data-testid=reading-countdown]'), button: b('[data-testid=reading-footer] [data-loop-primary]'),
    };
  });
  const verify = async (state: string) => {
    const x = await boxes();
    expect(x.strip, `${where} (${state}): strip`).not.toBeNull();
    const s = x.strip!;
    // Inside the footer's row: below its rule and its 12 px gap, and no lower than the row's foot.
    expect(s.t, `${where} (${state}): strip rises out of the footer row`).toBeGreaterThanOrEqual(x.footer!.t + 1 + 12 - 0.5);
    expect(s.b, where).toBeLessThanOrEqual(x.footer!.b + 0.5);
    expect(overlaps(s, x.text!), `${where} (${state}): strip over the passage`).toBe(false);
    if (x.countdown) expect(overlaps(s, x.countdown), `${where} (${state}): strip over the countdown`).toBe(false);
    if (x.button) expect(overlaps(s, x.button), `${where} (${state}): strip over the button`).toBe(false);
    return x;
  };
  await page.getByTestId('researcher-panel-collapsed').click();
  const locked = await verify('locked');
  expect(locked.countdown, `${where}: the page was meant to be locked`).not.toBeNull();
  await releaseRaf(page);
  await page.getByRole('button', { name: /Next page/ }).waitFor();
  const open = await verify('unlocked');
  expect(open.button, where).not.toBeNull();
  await page.getByTestId('researcher-panel-strip').click();
  await expect(page.getByTestId('researcher-panel-strip')).toHaveCount(0);
}

/**
 * The reaction-time block from its Start: no Pause and no researcher indicator while trials run (both
 * return once they are over and only the save is left), and no counter or any other words in the
 * field but the task's own messages.
 *
 * The indicator is not drawn at all during the trials: the screen's ink is the go-target's colour, so
 * an indicator in it was a target-coloured mark in the periphery for the whole block (audit round 68).
 */
async function runReactionBlock(page: Page, where: string, ink: string): Promise<void> {
  await page.getByRole('button', { name: /^Start/ }).click();
  let trialSamples = 0;
  for (let i = 0; i < 2000; i++) {
    const s = await page.evaluate(() => {
      const root = document.getElementById('root')!;
      const panel = document.querySelector('[data-testid^=researcher-panel]') as HTMLElement | null;
      const words = root.innerText.replace(panel?.innerText ?? '', '').trim();
      const ind = panel ? [panel, ...Array.from(panel.querySelectorAll('*'))].flatMap((e) => {
        const cs = getComputedStyle(e);
        return [cs.backgroundColor, cs.borderTopColor].filter((c) => c !== 'rgba(0, 0, 0, 0)');
      }) : [];
      return {
        stage: document.querySelector('[data-stage]')?.getAttribute('data-stage'),
        pause: !!document.querySelector('[data-testid=pause-chip]'), panel: !!panel, words, ind, indText: panel?.textContent ?? '',
      };
    });
    if (s.stage !== 'REACTION_TIME') {
      expect(trialSamples, `${where}: no sample was taken while the trials ran`).toBeGreaterThan(0);
      return;
    }
    const saving = /Block complete/.test(s.words);
    if (!saving) {
      trialSamples += 1;
      expect(s.pause, `${where}: Pause offered while trials run ("${s.words}")`).toBe(false);
      expect(s.panel, `${where}: researcher indicator drawn while trials run ("${s.words}")`).toBe(false);
    } else if (s.panel) {
      // Back while the results save: the same quiet indicator as on every other display screen.
      expect(s.indText, `${where}: text in the indicator while saving`).toBe('');
      expect([...new Set(s.ind)], `${where}: indicator colours while saving`).toEqual([ink]);
    }
    expect(s.words, `${where}: a trial counter in the field`).not.toMatch(/\d+\s*\/\s*\d+|\d+ of \d+/);
    await page.waitForTimeout(10);
  }
  throw new Error(`${where}: the reaction-time block never ended`);
}

/**
 * The three questions, each measured as it comes and again once an answer is chosen: the chosen
 * option is marked by reversing it — filled with the ink, its words in the ground — never by a tint
 * (at 8% alpha it was 1.04:1 off the ground on N2), and everything else on the screen is unchanged.
 */
async function answerItems(page: Page, display: number, where: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('mcq-option').first().waitFor();
    const before = await measure(page);
    check(before, 'COMPREHENSION', display, `${where} → question ${i + 1}`);
    await page.getByTestId('mcq-option').nth(1).click();
    const after = await measure(page);
    check(after, 'COMPREHENSION', display, `${where} → question ${i + 1}, answered`);
    const { look, ground } = await page.evaluate(() => ({
      look: (Array.from(document.querySelectorAll('[data-testid=mcq-option]')) as HTMLElement[])
        .map((o) => { const cs = getComputedStyle(o); return { bg: cs.backgroundColor, fg: cs.color, border: cs.borderTopColor }; }),
      ground: getComputedStyle(document.querySelector('[data-testid=mcq-box]')!.parentElement!).backgroundColor,
    }));
    const ink = look[0].border;
    expect(look[1], `${where} → question ${i + 1}: the chosen answer`).toEqual({ bg: ink, fg: ground, border: ink });
    for (const j of [0, 2, 3]) expect(look[j], `${where} → question ${i + 1}: an unchosen answer`).toEqual({ bg: 'rgba(0, 0, 0, 0)', fg: ink, border: ink });
    // Nothing moved: the item's block is where it was before the tap.
    expect(after.texts.map((t) => round(t.box)), `${where} → question ${i + 1}: the item moved on answering`)
      .toEqual(before.texts.map((t) => round(t.box)));
    const last = i === 2;
    const q = await page.getByTestId('mcq-question').textContent();
    await page.getByTestId('mcq-submit').click();
    if (last) { await waitStageChange(page, 'COMPREHENSION'); return; }
    await page.waitForFunction((prev) => document.querySelector('[data-testid="mcq-question"]')?.textContent !== prev, q);
  }
}

for (const vp of VIEWPORTS) {
  test(`the chrome inside a display is legible, in place, and the same in every condition — ${vp.name}`, async ({ page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'ADAPTATION');

    let display = 0;
    let ink = '';
    let stripChecked = false;
    let lastKey = '';
    const seen = new Set<string>();
    /** Chrome geometry by screen, from the first display, to compare the second against. */
    const geometry = new Map<string, unknown>();
    const same = (key: string, value: unknown, where: string) => {
      if (!geometry.has(key)) geometry.set(key, value);
      else expect(value, `${where}: differs between displays`).toEqual(geometry.get(key));
    };

    for (let guard = 0; guard < 400; guard++) {
      const stage = await stageNow(page);
      await page.waitForTimeout(120);
      if ((await stageNow(page)) !== stage) continue;
      // Two displays: the first break comes after the second.
      if (stage === 'BREAK_SCREEN') break;
      if (!LOOP.includes(stage)) { await handleStage(page, stage); continue; }
      const m = await measure(page);
      // The grey field moves on by itself in the e2e timings: a measurement that straddled the change
      // is of no screen in particular.
      if (m.stage !== stage || (await stageNow(page)) !== stage) continue;
      const key = `${stage}:${m.kind}`;
      if (key === 'READING_TASK:card' && lastKey !== key) display += 1;
      lastKey = key;
      const where = `display ${display} ${stage} (${m.kind}) at ${vp.name}`;
      check(m, stage, display, where);
      if (m.chip) ink = m.chip.colour;
      seen.add(key);

      // Identical across displays: the chip and the indicator everywhere; the header, counter and
      // button rows of the stimulus pages; the whole of a rating screen's chrome.
      same(`chip`, { target: round(m.chip!.target), face: round(m.chip!.face) }, where);
      same(`indicator`, round(m.indicator!.box), where);
      if (m.kind === 'page' || m.kind === 'excerpt') {
        same(`${m.kind}:counter`, [Math.round(m.counter!.box.r), Math.round(m.counter!.box.t)], where);
        // Height, right edge and row: the label differs ("Next page", "I've finished reading").
        const b = m.buttons[0].box;
        same(`${m.kind}:button`, [Math.round(b.t), Math.round(b.r), Math.round(b.b)], where);
      }
      if (m.kind === 'item') same('item:counter-right', Math.round(m.counter!.box.r), where);
      if (m.kind === 'rating') same(`rating:${stage}`, { block: round(m.ratingBlock!), button: round(m.buttons[0].box) }, where);
      if (m.kind === 'card') same(`card:button`, [Math.round(m.buttons[0].h), Math.round((m.buttons[0].box.l + m.buttons[0].box.r) / 2)], where);

      // The first reading page: open the researcher strip while the page is locked and once unlocked.
      if (stage === 'READING_TASK' && m.kind === 'card' && !stripChecked) {
        await holdRaf(page);
        await page.getByRole('button', { name: /Begin reading/ }).click();
        await page.getByTestId('reading-countdown').waitFor();
        check(await measure(page), stage, display, `${where} → page 1, locked`);
        await checkStrip(page, `${where} → page 1`);
        stripChecked = true;
        continue;
      }
      if (stage === 'REACTION_TIME' && m.kind === 'card') {
        await runReactionBlock(page, where, ink);
        continue;
      }
      if (stage === 'COMPREHENSION') {
        await answerItems(page, display, where);
        continue;
      }
      await handleStage(page, stage);
    }

    // The walk did meet every kind of screen in a display, or it proves nothing.
    expect(display, 'two displays walked').toBe(2);
    for (const k of ['READING_TASK:card', 'READING_TASK:page', 'COMPREHENSION:item', 'DISPLAY_PERCEPTION:rating',
      'POST_FATIGUE:rating', 'VISUAL_SEARCH:card', 'VISUAL_SEARCH:excerpt', 'REACTION_TIME:card']) {
      expect(seen, `never measured ${k}`).toContain(k);
    }
    expect(stripChecked).toBe(true);
  });
}
