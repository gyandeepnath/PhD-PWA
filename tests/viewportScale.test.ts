/**
 * The design canvas must fit the device, or controls become unreachable.
 *
 * theme.css scales #root by --vl-scale, and #root is overflow:hidden while body is
 * touch-action:none — both deliberate, so a stimulus screen cannot be scrolled mid-exposure. The
 * consequence is that anything past the viewport is not merely off-screen, it cannot be reached by
 * any gesture. --vl-scale was never computed by anything, so every device rendered at the design
 * size and a shorter tablet lost its Continue buttons outright.
 *
 * The Xiaomi Pad 6 case below is the device that found this.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  computeScale, isBelowMinimum, foldViewportFloor, resetViewportFloor, screenFill,
  DESIGN_WIDTH, DESIGN_HEIGHT, MIN_SCALE, MAX_SCALE, SCALE_STEP, OVERFILL_TOLERANCE,
  displayMode, isInstalledDisplay,
} from '@/lib/viewportScale';

describe('computeScale', () => {
  it('is 1 on the design canvas itself', () => {
    expect(computeScale(DESIGN_WIDTH, DESIGN_HEIGHT)).toBe(1);
  });

  it('FILLS a larger screen instead of drawing the canvas in its middle (Round 74)', () => {
    /*
     * The cap at 1 is gone. On the real tablet the investigator saw every task in the middle of the
     * screen with about a quarter of the width blank on each side: what a canvas capped at 1 looks
     * like on a viewport about 1920 CSS px wide. Each of these used to be exactly 1.
     */
    expect(computeScale(1920, 1200)).toBe(1.66);
    expect(computeScale(2560, 1600)).toBe(2.22);
    expect(computeScale(1600, 1000)).toBe(1.38);
    expect(computeScale(1280, 800)).toBe(1.12);
    // Another shape fits by its binding axis: 1920x1080 is height-bound.
    expect(computeScale(1920, 1080)).toBe(1.5);
  });

  it('fits the 16:10 canvas to within one step of a 16:10 screen, at every pixel ratio', () => {
    // The same 2880x1800 panel at the pixel ratios Android offers: the canvas spans the width each time.
    for (const dpr of [1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]) {
      const w = 2880 / dpr;
      const h = 1800 / dpr;
      const s = computeScale(w, h);
      expect(Math.abs(DESIGN_WIDTH * s - w), `dpr ${dpr}`).toBeLessThanOrEqual(DESIGN_WIDTH * SCALE_STEP);
      expect(DESIGN_WIDTH * s, `dpr ${dpr}`).toBeLessThanOrEqual(w * (1 + OVERFILL_TOLERANCE) + 1e-6);
    }
  });

  it('caps an absurdly large monitor, and only there', () => {
    expect(MAX_SCALE).toBe(3);
    expect(computeScale(5120, 2880)).toBe(MAX_SCALE);
    expect(computeScale(3456, 2160)).toBe(MAX_SCALE);
    expect(computeScale(3400, 2125)).toBeLessThan(MAX_SCALE);
  });

  it('draws a 1152x720 viewport at exactly 1, and 0.90 at 1152x650', () => {
    expect(computeScale(1152, 720)).toBe(1);
    expect(computeScale(1152, 650)).toBe(0.9);
    // Height is the binding constraint there, not width.
    expect(computeScale(1152, 650)).toBeLessThanOrEqual(650 / DESIGN_HEIGHT + 1e-9);
  });

  it('rounds to the NEAREST step, so a pixel short of a boundary is not a whole step smaller', () => {
    // A viewport reporting 1152x719 — a status-bar pixel, a fractional height rounded down — would
    // floor to 0.98 and shrink every glyph by 2% for one pixel. 713 is the shortest height that
    // still rounds to 1.0 (1% overfill); 712 would overfill by more and takes the step below.
    expect(computeScale(1152, 719)).toBe(1);
    expect(computeScale(1152, 713)).toBe(1);
    expect(computeScale(1152, 712)).toBe(0.98);
    expect(computeScale(1141, 720)).toBe(1);
    // The same rule above 1, where it used to be a floor: 1920x1199 is not a step below 1920x1200.
    expect(computeScale(1920, 1199)).toBe(computeScale(1920, 1200));
    expect(OVERFILL_TOLERANCE).toBe(0.01);
    expect(SCALE_STEP).toBe(0.02);
  });

  it('below 1, takes the step below when rounding up would overfill by more than the tolerance', () => {
    // raw 0.5113: the nearest step is 0.52, 1.7% over the fit; 0.50 is taken instead.
    expect(computeScale(589, 368.15)).toBe(0.5);
    // raw 0.5149: 0.52 is under 1% over, so it stands.
    expect(computeScale(593.2, 370.7)).toBe(0.52);
  });

  it('does not lose a whole step to floating point', () => {
    // 0.9 / 0.02 is 44.999... in IEEE doubles; floored, a viewport exactly nine-tenths of the
    // canvas came out at 0.88.
    expect(computeScale(1152, 648)).toBe(0.9);
    expect(computeScale(1036.8, 1000)).toBe(0.9);
  });

  it('fills and fits: within one step of the exact fit, and never more than 1% over it', () => {
    /*
     * The canvas is DESIGN x DESIGN laid out, then multiplied by s. Above the fit it overfills — the
     * root box is then a little smaller than the canvas — by at most OVERFILL_TOLERANCE, the slack
     * every screen is required to have (e2e/allScreensFit walks every screen at 1152x713, 1% over).
     * Below the fit it leaves part of the screen blank, by less than one step. The first bound fails
     * if the quantiser rounds UP (Math.ceil: 1152x721 overfills 1.9%) or loses the tolerance check
     * (589x368 overfills 1.7%); the second if it rounds DOWN by more than a step, or is capped again
     * (1920x1200 would be 0.67 under).
     */
    const viewports = [
      [1152, 650], [1152, 720], [1152, 719], [1152, 713], [1152, 721], [1080, 810], [1194, 834],
      [1280, 800], [1024, 768], [800, 600], [1366, 768], [2560, 1600], [1141, 720], [1920, 1200],
      [1600, 1000], [1920, 1080], [589, 368.15], [700, 437], [1440, 900], [2000, 1250], [1600, 1100],
    ];
    for (const [w, h] of viewports) {
      const s = computeScale(w, h);
      const raw = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
      if (s > MIN_SCALE && s < MAX_SCALE) {
        expect(s / raw, `${w}x${h}: overfills`).toBeLessThanOrEqual(1 + OVERFILL_TOLERANCE + 1e-9);
        expect(raw - s, `${w}x${h}: leaves more than a step blank`).toBeLessThan(SCALE_STEP + 1e-9);
      }
    }
  });

  it('absorbs a pixel or two of viewport jitter', () => {
    // Quantisation handles jitter only. The address bar is handled by the running floor below —
    // a 70px swing crosses any step boundary, so quantising alone would NOT have been enough.
    expect(computeScale(1152, 700)).toBe(computeScale(1152, 700.4));
    expect(computeScale(1920, 1140)).toBe(computeScale(1920, 1140.6));
  });

  it('is monotonic in viewport height, through 1 and beyond it', () => {
    let prev = 0;
    for (let h = 300; h <= 2000; h += 1) {
      const s = computeScale(4000, h);
      expect(s, `h ${h}`).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('never goes below the floor, because past it the stimulus is no longer fair', () => {
    expect(computeScale(320, 200)).toBe(MIN_SCALE);
    expect(computeScale(1, 1)).toBe(MIN_SCALE);
  });

  it('reports absence rather than inventing a scale from a nonsense viewport', () => {
    // A zero or non-finite measurement carries no information about the device; returning a
    // plausible-looking fraction would be a fabricated value.
    expect(computeScale(0, 0)).toBe(1);
    expect(computeScale(NaN, 800)).toBe(1);
    expect(computeScale(1194, Infinity)).toBe(1);
    expect(computeScale(-100, 800)).toBe(1);
  });
});

describe('screenFill — the applied scale against the full screen', () => {
  it('is 1 when the canvas fills the screen as the installed app does', () => {
    expect(screenFill(1.66, 1.66)).toBe(1);
    // A fitted viewport a step short of the screen is the screen.
    expect(screenFill(1.64, 1.66)).toBe(1);
  });

  it('is the ratio when a tab or a window makes the canvas smaller', () => {
    expect(screenFill(1.56, 1.66)).toBeCloseTo(0.9398, 3);
    expect(screenFill(0.9, 1)).toBeCloseTo(0.9, 9);
  });

  it('is null where the screen is not reported, never a guessed 1', () => {
    expect(screenFill(1.2, null)).toBeNull();
    expect(screenFill(1.2, 0)).toBeNull();
  });
});

describe('isBelowMinimum', () => {
  it('is false for real tablets, including the one that failed', () => {
    expect(isBelowMinimum(1152, 650)).toBe(false);
    expect(isBelowMinimum(1080, 810)).toBe(false);
    expect(isBelowMinimum(1194, 834)).toBe(false);
  });

  it('is true when even the floor cannot fit, so the operator is told instead of hunting a button', () => {
    expect(isBelowMinimum(400, 300)).toBe(true);
  });
});


describe('displayMode — is the app running installed and full-screen?', () => {
  /*
   * The protocol's sizes are the installed app's full screen. In a browser tab the address bar costs
   * part of the height, the canvas is fitted to the shorter box and every stimulus shrinks with it;
   * the pre-flight screen warns on anything but the installed launch, and the session records what it
   * saw.
   */
  const withMedia = (matching: string | null, fn: () => void) => {
    const had = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: matching != null && q === `(display-mode: ${matching})`, media: q }),
    });
    try { fn(); } finally {
      if (had) Object.defineProperty(window, 'matchMedia', had);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    }
  };

  it('reports the mode the browser matches', () => {
    withMedia('fullscreen', () => expect(displayMode()).toBe('fullscreen'));
    withMedia('standalone', () => expect(displayMode()).toBe('standalone'));
    withMedia('browser', () => expect(displayMode()).toBe('browser'));
  });

  it('counts only the chrome-free launches as installed', () => {
    expect(isInstalledDisplay('fullscreen')).toBe(true);
    expect(isInstalledDisplay('standalone')).toBe(true);
    expect(isInstalledDisplay('minimal-ui')).toBe(false);
    expect(isInstalledDisplay('browser')).toBe(false);
    expect(isInstalledDisplay(null)).toBe(false);
  });

  it('says null rather than inventing a mode the browser did not report', () => {
    withMedia(null, () => expect(displayMode()).toBeNull());
  });
});

describe('foldViewportFloor — stability across an address-bar cycle', () => {
  beforeEach(() => resetViewportFloor());

  it('does not rescale the stimulus when the address bar hides mid-reading', () => {
    // The real sequence on a Xiaomi Pad 6: the page loads with the bar showing (650), the
    // participant starts reading, the bar slides away (720). Sizing for the moment would enlarge
    // the text under them. Sizing for the smallest seen does not.
    const withBar = foldViewportFloor(1152, 650);
    const barHidden = foldViewportFloor(1152, 720);
    expect(computeScale(barHidden.w, barHidden.h)).toBe(computeScale(withBar.w, withBar.h));
  });

  it('never oscillates: repeated address-bar cycles converge to one scale', () => {
    const scales = [650, 720, 650, 720, 700, 720].map((h) => {
      const f = foldViewportFloor(1152, h);
      return computeScale(f.w, f.h);
    });
    expect(new Set(scales).size).toBe(1);
  });

  it('is monotonically non-increasing within an orientation', () => {
    let prev = Infinity;
    for (const h of [720, 700, 650, 700, 720, 600]) {
      const f = foldViewportFloor(1152, h);
      const s = computeScale(f.w, f.h);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it('still shrinks when the viewport genuinely gets smaller than anything seen', () => {
    // Not shrinking here would push content back into the region no gesture can reach — the exact
    // failure this whole file exists to prevent.
    const a = foldViewportFloor(1152, 720);
    const b = foldViewportFloor(1152, 560);
    expect(computeScale(b.w, b.h)).toBeLessThan(computeScale(a.w, a.h));
  });

  it('starts over on an orientation change rather than inheriting the other shape', () => {
    foldViewportFloor(1152, 650);          // landscape
    const portrait = foldViewportFloor(720, 1152);
    // The landscape height of 650 must not constrain the portrait layout.
    expect(portrait).toEqual({ w: 720, h: 1152 });
  });

  it('ignores a nonsense measurement instead of poisoning the floor with it', () => {
    const good = foldViewportFloor(1152, 720);
    expect(foldViewportFloor(0, 0)).toEqual(good);
    expect(foldViewportFloor(NaN, 700)).toEqual(good);
  });
});

describe('a transient occlusion must not shrink the stimulus for the rest of the sitting', () => {
  beforeEach(() => resetViewportFloor());

  it('ignores the soft keyboard, which otherwise halves every reading exposure', () => {
    /*
     * The failure this prevents, measured before the fix: the participant-profile form opens the
     * soft keyboard, 1152x650 becomes 1152x300, the running minimum takes 300 — and because a
     * minimum never rises, the scale locked at MIN_SCALE and all ten reading exposures afterwards
     * rendered at HALF SIZE. Visual angle is a controlled variable in this study; halving it
     * silently because someone typed an age is a corrupted stimulus, not a cosmetic defect.
     */
    const before = foldViewportFloor(1152, 650);
    const scaleBefore = computeScale(before.w, before.h);

    foldViewportFloor(1152, 300);            // keyboard up
    const during = foldViewportFloor(1152, 300);
    expect(computeScale(during.w, during.h)).toBe(scaleBefore);

    foldViewportFloor(1152, 650);            // keyboard dismissed
    const after = foldViewportFloor(1152, 720);
    expect(computeScale(after.w, after.h),
      'the scale did not recover after the keyboard closed').toBe(scaleBefore);
    expect(computeScale(after.w, after.h)).toBeGreaterThan(MIN_SCALE);
  });

  it('still lowers the floor for a viewport that genuinely shrank', () => {
    // The occlusion guard must not become a blanket refusal to shrink: a real reduction still has
    // to be honoured, or content returns to the region no gesture can reach.
    const a = foldViewportFloor(1152, 720);
    const b = foldViewportFloor(1152, 560);
    expect(computeScale(b.w, b.h)).toBeLessThan(computeScale(a.w, a.h));
  });

  it('treats a narrow occlusion the same way as a short one', () => {
    const base = foldViewportFloor(1152, 720);
    const occluded = foldViewportFloor(400, 720);
    expect(occluded).toEqual(base);
  });

  it('re-establishes its reference on an orientation change', () => {
    foldViewportFloor(1152, 650);
    foldViewportFloor(1152, 300);        // keyboard, ignored
    resetViewportFloor();
    const portrait = foldViewportFloor(720, 1152);
    expect(portrait).toEqual({ w: 720, h: 1152 });
  });
});

/*
 * The three findings that made the scale unaccountable in the exported data, together: the
 * per-condition record, the operator warning that had no caller, and the CSS variables that looked
 * like a facility and were never written on the one device anyone would test on.
 */
describe('the scale is accountable in the data, not just applied to the screen', () => {
  const src = readFileSync(resolve(__dirname, '..', 'src/experiment/Experiment.tsx'), 'utf8');
  const vs = readFileSync(resolve(__dirname, '..', 'src/lib/viewportScale.ts'), 'utf8');
  const preflight = readFileSync(resolve(__dirname, '..', 'src/start/setupStages.tsx'), 'utf8');

  it('records the scale on every condition, not once at session creation', () => {
    // The session-level stamp happens inside beginSession, before the participant has touched the
    // tablet. The scale is still free to settle elsewhere afterwards — portrait setup screens, the
    // address bar dismissed — and it multiplies the stimulus text, so a stale value states the
    // wrong visual angle for all ten rows.
    const start = src.indexOf("await put('conditions', {");
    expect(start).toBeGreaterThan(-1);
    const write = src.slice(start, src.indexOf('});', start));
    expect(write).toMatch(/stimulus_scale: currentScale\(\)/);
    expect(write).toMatch(/layout_viewport: layoutViewport\(\)/);
  });

  it('warns the operator when the screen cannot fit the canvas at all', () => {
    // isBelowMinimum carried a comment saying "the operator needs to know rather than discover it
    // as a missing button" and had no caller anywhere in the app. Clipped content is not merely
    // off-screen: #root is overflow:hidden and body is touch-action:none, so it is unreachable.
    expect(preflight).toMatch(/isBelowMinimum\(\)/);
    expect(preflight).toContain('data-testid="layout-warning"');
  });

  it('no longer publishes CSS variables nothing reads', () => {
    // Written after the `if (next === applied) return`, so on any device whose initial scale is 1
    // they were never set at all — including the reference tablet.
    const code = vs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/--vl-vw|--vl-vh/);
    expect(code).toMatch(/--vl-scale/);
  });

  it('listens for the Screen Orientation API as well as the deprecated event', () => {
    // Listening only for window.orientationchange leaves a portrait floor in force after a rotation
    // on any browser that has dropped it — sizing the whole sitting for a shape the tablet is not in.
    expect(vs).toMatch(/screen\.orientation\?\.addEventListener\?\.\('change', onOrientation\)/);
  });

  it('does NOT reset the floor on visibilitychange, which would resize text under a reader', () => {
    // Tempting, and wrong: the floor is what stops the stimulus resizing mid-passage. Resetting it
    // lets the scale rise. The staleness it was meant to fix belongs on the condition record.
    const code = vs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/visibilitychange/);
  });
});

/*
 * A scale that locked small used to last until the app was killed. On the investigator's Xiaomi Pad 6
 * it sat at exactly MIN_SCALE — the consent column filled 28% of the screen — which also halved the
 * reading text. Now: re-measured at every screen outside a condition, frozen (never growing) inside
 * one, and blind to the keyboard.
 */
describe('the scale recovers from a lock, and never grows under a reader', () => {
  const setViewport = (w: number, h: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  };
  const reset = async () => {
    const m = await import('@/lib/viewportScale');
    m.setScaleFrozen(false);
    m.resetViewportFloor();
    (document.activeElement as HTMLElement | null)?.blur?.();
    return m;
  };

  it('a startup lock (floating window, then maximised) clears at the next screen', async () => {
    const m = await reset();
    setViewport(560, 340);                  // a floating window: below the floor, so clamped
    m.refitScale();
    expect(m.currentScale()).toBe(0.5);
    setViewport(1152, 720);
    m.remeasureScale();                    // same screen: the running minimum holds, as before
    expect(m.currentScale()).toBe(0.5);
    m.refitScale();                         // the next screen boundary
    expect(m.currentScale()).toBe(1);       // a 1152x720 viewport: the canvas exactly
    setViewport(1920, 1200);
    m.refitScale();
    expect(m.currentScale()).toBe(1.66);    // and a larger one is filled, not left at 1 (Round 74)
  });

  it('frozen: the scale never grows, and a genuine shrink is counted', async () => {
    /*
     * Starts where growth is possible. This test used to start at 1152x720, which after Round 63 was
     * scale 1.0 — then the cap — so "did not grow" was guaranteed by Math.min(1, …) alone and deleting
     * either freeze guard left it green (review of Round 63). At 1152x650 the scale is 0.90, and the
     * address bar hiding (1152x720) is exactly the growth the freeze exists to refuse mid-reading.
     * Round 74 removed the cap, so the same must hold above 1: see the next test.
     */
    const m = await reset();
    setViewport(1152, 650);
    m.refitScale();
    const start = m.currentScale();
    expect(start).toBe(0.9);
    m.setScaleFrozen(true);
    setViewport(1152, 720);                 // the address bar hides: room for 1.0
    m.refitScale();                         // refused while frozen …
    expect(m.layoutViewport()).toBe('1152x650'); // … so the floor it was fitted to is kept
    m.remeasureScale();
    expect(m.currentScale()).toBe(start);   // did not grow
    // An orientation event resets the floor even while frozen (resetViewportFloor is not gated, and
    // must not be: a portrait floor must not survive into landscape). The growth guard in apply() is
    // then the only thing between the reader and larger text.
    m.resetViewportFloor();
    m.remeasureScale();
    expect(m.currentScale()).toBe(start);   // still did not grow
    expect(m.rescalesWhileFrozen()).toBe(0);
    // A genuine shrink (not an occlusion: above 70% of the largest height seen).
    setViewport(1152, 620);
    m.remeasureScale();
    expect(m.currentScale()).toBeLessThan(start);
    expect(m.rescalesWhileFrozen()).toBe(1);
    m.setScaleFrozen(false);                // unfreezing re-measures
    expect(m.currentScale()).toBeCloseTo(m.freshScale(), 5);
  });

  it('frozen above 1: the address bar hiding on a large viewport does not enlarge the text', async () => {
    /*
     * Without the cap, the scale above 1 is as free to grow as it was below it. A tab on a viewport
     * 1920 wide with its address bar showing (1920x1130: 1.56) loses the bar mid-reading (1920x1200:
     * 1.66) — a 6% enlargement under a reader, refused by the same two guards.
     */
    const m = await reset();
    setViewport(1920, 1130);
    m.refitScale();
    const start = m.currentScale();
    expect(start).toBe(1.56);
    m.setScaleFrozen(true);
    setViewport(1920, 1200);
    m.refitScale();                         // refused while frozen
    expect(m.layoutViewport()).toBe('1920x1130');
    m.remeasureScale();
    expect(m.currentScale()).toBe(start);
    m.resetViewportFloor();                 // an orientation event: only apply()'s guard is left
    m.remeasureScale();
    expect(m.currentScale()).toBe(start);
    expect(m.rescalesWhileFrozen()).toBe(0);
    m.setScaleFrozen(false);                // the next screen boundary may grow it
    expect(m.currentScale()).toBe(1.66);
  });

  it('ignores measurements while a text field has focus (the soft keyboard)', async () => {
    const m = await reset();
    setViewport(1152, 720);
    m.refitScale();
    const before = m.currentScale();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    setViewport(1152, 300);
    m.remeasureScale();
    m.refitScale();
    expect(m.currentScale()).toBe(before);
    input.blur();
    input.remove();
  });

  it('the app freezes on condition screens and re-fits on every other screen', () => {
    const exp = readFileSync('src/experiment/Experiment.tsx', 'utf8');
    expect(exp).toMatch(/setScaleFrozen\(isInLoop\(machine\.stage\) \|\| machine\.stage === 'CALIBRATION'\)/);
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/if \(view\.mode !== 'experiment'\) refitScale\(\)/);
  });
});

describe('no raw viewport units in layouts', () => {
  it('no vh/vw in .tsx: they measure the raw screen, not the scaled canvas', () => {
    const hits = execSync("grep -rnE \"['\\\"(, ][0-9.]+(vh|vw)['\\\")]\" src --include=*.tsx || true", { encoding: 'utf8' }).trim();
    expect(hits, hits).toBe('');
  });
});
