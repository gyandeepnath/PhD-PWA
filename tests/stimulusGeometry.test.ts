/**
 * The stimulus must differ between devices by uniform magnification and nothing else.
 *
 * That is what `stimulus_scale` claims. `01_session_info.csv` describes it as the visual-angle
 * factor, and the analysis codebook goes further: "Constant within a device; include it only if more
 * than one device was used." Both statements are only true if the layout is a SIMILARITY transform
 * of the design canvas — same shape, one scalar.
 *
 * It was not. `#root` is sized `calc(100% / var(--vl-scale))` in both axes while the scale is
 * `min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT)`, so one axis binds and the other over-fills: the root
 * box takes the DEVICE's aspect ratio, never the canvas's (1152/720 = 1.60 since the canvas was
 * re-based to the study tablet; 1194/834 = 1.43 before). Anything sized as a percentage of the root
 * then reflows by device at an unchanged `--vl-scale` and an unchanged glyph size — invisible in the
 * one covariate an analyst is told to use for exactly this.
 *
 * The reading passage was a percentage column. The reaction-time target was a percentage position
 * with a constant diameter. Both are now fixed in root pixels, and these tests hold them there: the
 * column is STIMULUS_COLUMN_PX wide, and since Round 66 the target sits at one of eight fixed
 * root-px offsets from the centre (lib/rtLocations.ts).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  computeScale, STIMULUS_COLUMN_PX, DESIGN_WIDTH, DESIGN_HEIGHT,
} from '@/lib/viewportScale';
import { RT_LOCATIONS } from '@/lib/rtLocations';
import { CONFIG } from '@/experiment/config';

/**
 * The reading column's former rule — 10% side margins, i.e. 80% of the root's width. Kept here only
 * to show that a percentage column varies by device; nothing in src/ sizes a stimulus this way now.
 */
const OLD_PERCENT_COLUMN = 0.8;

/** Tablets the study can plausibly run on, plus the design canvas and a large display. */
const DEVICES: [string, number, number][] = [
  ['design canvas', DESIGN_WIDTH, DESIGN_HEIGHT],
  ['Xiaomi Pad 6, bar hidden', 1152, 720],
  ['Xiaomi Pad 6, bar showing', 1152, 650],
  ['iPad 9.7', 1024, 768],
  ['Galaxy Tab', 1280, 800],
  ['1366x768 laptop', 1366, 768],
  ['2560x1600 display', 2560, 1600],
];

/** The root box in ROOT pixels: what `calc(100% / var(--vl-scale))` produces. */
const rootBox = (w: number, h: number) => {
  const s = computeScale(w, h);
  return { s, w: w / s, h: h / s };
};

describe('the root box is device-shaped — the fact everything here exists for', () => {
  it('does not preserve the design aspect ratio, on any real device but the canvas itself', () => {
    // Stated as a test rather than a comment because every fix below is only necessary while this
    // is true. If the root layout is ever changed to letterbox instead, this test fails and the
    // fixed-width columns can be reconsidered.
    const designAR = DESIGN_WIDTH / DESIGN_HEIGHT;
    const off = DEVICES
      .filter(([name]) => name !== 'design canvas')
      .map(([name, w, h]) => [name, rootBox(w, h)] as const)
      .filter(([, b]) => Math.abs(b.w / b.h - designAR) > 0.01);
    expect(off.length).toBeGreaterThan(0);
  });

  it('is never narrower or shorter than the design canvas on a device above the minimum', () => {
    // The fixed-width column and the target offsets both assume they fit. They do, because the scale is
    // the MINIMUM of the two ratios: w/s >= DESIGN_WIDTH and h/s >= DESIGN_HEIGHT follow directly.
    for (const [name, w, h] of DEVICES) {
      const b = rootBox(w, h);
      expect(b.w, `${name} root box is narrower than the canvas`).toBeGreaterThanOrEqual(DESIGN_WIDTH - 1e-6);
      expect(b.h, `${name} root box is shorter than the canvas`).toBeGreaterThanOrEqual(DESIGN_HEIGHT - 1e-6);
    }
  });
});

describe('reading line length is the same on every device', () => {
  it('is a constant number of root pixels, so characters per line do not vary', () => {
    /*
     * Before: the column was `padding: 56px 10% 3%` on a full-width root, i.e. 0.8 x rootWidth.
     * Measured against the old design canvas's 955 px that gave +12.2% characters per line at
     * 1152x720, +27.0% at 1152x650, and +114% at 2560x1600 — where stimulus_scale reads 1.00, the
     * same as the design canvas. Line length is a first-order determinant of reading rate and
     * regression frequency, and both are dependent variables here.
     */
    const oldColumns = new Set<number>();
    for (const [name, w, h] of DEVICES) {
      const b = rootBox(w, h);
      oldColumns.add(Math.round(b.w * OLD_PERCENT_COLUMN));
      const newColumn = Math.min(STIMULUS_COLUMN_PX, b.w);   // maxWidth: 100%
      expect(newColumn, `${name}`).toBe(STIMULUS_COLUMN_PX);
    }
    // Sanity: the percentage rule really would vary across these devices, or this test proves nothing.
    expect(oldColumns.size).toBeGreaterThan(1);
  });

  it('is stated, not derived from the canvas, and fits the canvas with margins either side', () => {
    /*
     * It used to be round(DESIGN_WIDTH * 0.8). Re-basing the canvas to the tablet (1194 -> 1152)
     * would have narrowed the line to 922 px without anyone deciding it. The column is a stimulus
     * parameter, so it is written out: 1040 root px, 90% of the tablet's width, 22.0 deg at 55 cm.
     */
    expect(STIMULUS_COLUMN_PX).toBe(1040);
    expect(STIMULUS_COLUMN_PX).not.toBe(Math.round(DESIGN_WIDTH * OLD_PERCENT_COLUMN));
    // Room for the in-loop Pause chip at the far left (x 12 to ~60): the margin is (1152-1040)/2.
    expect((DESIGN_WIDTH - STIMULUS_COLUMN_PX) / 2).toBeGreaterThanOrEqual(56);
  });

  it('scales with --vl-scale and only with it, which is what stimulus_scale records', () => {
    // The column in CSS pixels is the covariate's whole story now: one scalar per device.
    const cssWidth = (w: number, h: number) => STIMULUS_COLUMN_PX * computeScale(w, h);
    for (const [name, w, h] of DEVICES) {
      expect(cssWidth(w, h) / computeScale(w, h), name).toBeCloseTo(STIMULUS_COLUMN_PX, 6);
    }
  });

  it('is set at the protocol typography: 22 px, line height 1.4', () => {
    // Research round 62, recommendation R-A: the TRUE 22 px (not enlarged), 1.4 so that the three
    // existing pages fit the 720 px screen. Changing either is a protocol change, not a tweak.
    expect(CONFIG.READING_FONT_SIZE_PX).toBe(22);
    expect(CONFIG.READING_LINE_HEIGHT).toBe(1.4);
  });
});

describe('the reaction-time target sits in a device-independent field', () => {
  const { RT_DOT_PX } = CONFIG;
  // The rule it replaced: a percentage position, x 25..75 and y 28..72, of whatever box it was in.
  const OLD_MAX_X_PCT = 25;
  const OLD_MAX_Y_PCT = 22;
  const oldRatio = (boxW: number, boxH: number) =>
    RT_DOT_PX / Math.hypot((OLD_MAX_X_PCT / 100) * boxW, (OLD_MAX_Y_PCT / 100) * boxH);

  it('is drawn at a fixed root-px offset from the cross, in the full-root field the cross is centred in', () => {
    /*
     * What makes its eccentricity device-independent is how it is DRAWN, so this reads the task's
     * source: the trial field is the full root (fixed, inset 0) and centres the cross; the dot is
     * absolutely placed in that same field at 50% plus its location's whole-root-px offset, centred on
     * that point, at RT_DOT_PX. A percentage of any box anywhere in that, or a box other than the
     * field, would put the device's aspect ratio back into the offset. (This replaced a check that
     * divided the dot by its eccentricity at each device's scale: the scale cancelled, and it could
     * not fail.) e2e/stimulusGeometry.spec.ts measures the drawn dot against the drawn cross.
     */
    const src = readFileSync(resolve(__dirname, '..', 'src/tasks/ReactionTimeTask.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const field = src.match(/onPointerDown=\{handleResponse\}\s*style=\{\{([^}]*)\}\}/)?.[1] ?? '';
    expect(field).toMatch(/position: 'fixed', inset: 0\b/);
    expect(field).toMatch(/alignItems: 'center', justifyContent: 'center'/);
    const dotStyle = src.match(/data-testid="rt-dot"[\s\S]*?style=\{\{([\s\S]*?)\}\}/)?.[1] ?? '';
    expect(dotStyle).toMatch(/position: 'absolute', left: `calc\(50% \+ \$\{t!\.location\.dx\}px\)`, top: `calc\(50% \+ \$\{t!\.location\.dy\}px\)`/);
    expect(dotStyle).toMatch(/transform: 'translate\(-50%, -50%\)', width: dot, height: dot\b/);
    expect(src).toMatch(/const dot = CONFIG\.RT_DOT_PX;/);
    // The only percentages in the dot's placement are the field's centre and the dot's own centring
    // (and its round corners, which place nothing).
    expect(dotStyle.replace(/borderRadius: '50%'/, '').match(/-?\d+%/g)).toEqual(['50%', '50%', '-50%', '-50%']);
    // Whole root px, so a dot never lands on a fractional pixel at scale 1.
    for (const l of RT_LOCATIONS) {
      expect(Number.isInteger(l.dx) && Number.isInteger(l.dy), `location ${l.id}`).toBe(true);
    }
  });

  it('lands inside the root box, 60 root px or more from every edge, on every device', () => {
    // The root is centred on the screen and never smaller than the canvas (above), so a dot that
    // clears the canvas's edges clears every device's.
    for (const [name, w, h] of DEVICES) {
      const b = rootBox(w, h);
      for (const l of RT_LOCATIONS) {
        const cx = b.w / 2 + l.dx;
        const cy = b.h / 2 + l.dy;
        const margin = Math.min(cx, b.w - cx, cy, b.h - cy) - RT_DOT_PX / 2;
        expect(margin, `${name}, location ${l.id}`).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('really did vary under the percentage rule against the root box, or the fix is solving nothing', () => {
    const seen = new Set(DEVICES.map(([, w, h]) => {
      const b = rootBox(w, h);
      return oldRatio(b.w, b.h).toFixed(4);
    }));
    expect(seen.size, 'the ratio was already constant, so this fix is unnecessary').toBeGreaterThan(1);
  });
});

/**
 * `min-h-screen` on a condition-coloured screen is a polarity confound, and it has happened.
 *
 * ROUND 62: it was also why the operator screens could not be scrolled. The dashboard and the
 * session manager were min-h-screen boxes with no scroll container inside a root that clips, so
 * everything below the first screen — the QC tables, the later session rows, the recycle bin — was
 * unreachable; the break, colour-vision, landing and resuming screens centred 50-80 px above the
 * middle of the tablet. All of them now use `.screen` with their own scroll container, and the
 * allowlist is down to the one full-viewport overlay.
 *
 * `min-h-screen` is `min-height: 100vh`. `vh` measures the raw viewport, while #root's height is
 * `calc(100% / var(--vl-scale))` — inside a scaled root those are different boxes, so a screen sized
 * in vh does not fill the one it is laid out in. What shows through the shortfall is the cream page
 * behind it. On a positive-polarity condition (dark ink on light) nobody can see it; on a negative
 * one (light ink on near-black) it is a bright band at the edge of the display, present in exactly
 * half the conditions of the study, on the factor the study is about. theme.css documents `.screen`
 * as the replacement and the four stimulus stages were converted — but nothing stopped the next
 * screen being written from any of the eight files below, which still use it.
 *
 * This is a ratchet, not a ban. The existing uses are all cream-on-cream or `fixed inset-0`, where
 * the shortfall shows cream against cream and nothing is visible. A NEW one has to be justified
 * here, in front of the reason, rather than copied in.
 */
describe('the .screen convention has a guard, not just a comment', () => {
  /** Each entry: why this file may keep `min-h-screen`. A stimulus screen can never be on this list. */
  const ALLOWED: Record<string, string> = {
    'src/components/ErrorBoundary.tsx': 'fixed inset-0 over the whole viewport; no condition colour, nothing to scroll',
  };

  const root = resolve(__dirname, '..');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });

  it('no screen outside the allowlist sizes itself in viewport units', () => {
    const offenders = walk(join(root, 'src'))
      .map((p) => [relative(root, p).split('\\').join('/'), readFileSync(p, 'utf8')] as const)
      // The className, not the word — VisualSearchTask explains in a comment why it does NOT use it.
      .filter(([, src]) => /className=(?:"|'|\{`)[^"'`]*\bmin-h-screen\b/.test(src))
      .map(([rel]) => rel)
      .filter((rel) => !(rel in ALLOWED));
    expect(offenders, 'a new min-h-screen: if this screen ever shows a condition colour it is a '
      + 'polarity-confounded band. Use .screen, or add it to ALLOWED with the reason it is safe.')
      .toEqual([]);
  });

  it('the operator screens that grow with the study scroll internally', () => {
    // The session list grows by a row per sitting and the QC tab by a row per condition: both have
    // to be scroll containers of their own, or what does not fit is out of reach of any gesture.
    for (const [rel, testid] of [
      ['src/dashboard/Dashboard.tsx', 'dashboard-scroll'],
      ['src/start/SessionManager.tsx', 'manager-scroll'],
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toMatch(new RegExp(`data-testid="${testid}" className="screen scrollable`));
      expect(src, `${rel} has no "More below" cue`).toMatch(/<ScrollCue \/>/);
    }
  });

  it('the allowlist has no stale entries, so it cannot quietly become a blanket exemption', () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const p = join(root, rel);
      return !existsSync(p) || !/className=(?:"|'|\{`)[^"'`]*\bmin-h-screen\b/.test(readFileSync(p, 'utf8'));
    });
    expect(stale, 'these files no longer use min-h-screen; drop them from ALLOWED').toEqual([]);
  });
});
