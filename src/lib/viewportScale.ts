/**
 * Drive the `--vl-scale` variable that theme.css is built around.
 *
 * WHY THIS FILE EXISTS. theme.css carries a five-point description of a root-scaling strategy:
 * `#root` is transformed by `scale(var(--vl-scale))` and its layout box expanded inversely so the
 * content fills the viewport afterwards. All of that was in place. Nothing ever set the variable —
 * it was declared as `1` and left there, so the app laid out at its design size on every device.
 *
 * `#root` also carries `overflow: hidden`, deliberately, so a stimulus screen cannot be scrolled
 * mid-exposure. Together those two facts mean a viewport shorter than the design canvas does not
 * merely clip: the clipped content is unreachable by any gesture, because `body` additionally sets
 * `touch-action: none`. On a Xiaomi Pad 6 in Chrome — about 1152x720 CSS pixels, and nearer 650
 * tall once the address bar is showing, against a design canvas 834 tall — the Continue buttons on
 * the setup screens were simply not on the screen and could not be scrolled to.
 *
 * VISUAL ANGLE. Scaling the root scales the stimulus text with it, which changes visual angle, so
 * this cannot be a silent cosmetic fix. Two things keep it honest:
 *
 *   - The scale never exceeds 1, so a larger screen renders at the design size rather than being
 *     magnified: the GLYPHS are identical on every device at or above the design canvas. This used
 *     to say the stimulus was identical, which was false — the root box takes the device's aspect
 *     ratio, so a percentage-sized layout reflows. See STIMULUS_COLUMN_PX at the foot of this file
 *     for the measurements and for what the stimulus screens now do instead.
 *   - `currentScale()` is recorded with the session, so a study run on a smaller tablet carries the
 *     factor its stimuli were actually presented at, instead of an unstated difference.
 *
 * STABILITY. Chrome on Android grows and shrinks the visual viewport by 60-70px as the address bar
 * hides and reveals, and rescaling on every one of those would resize the text a participant is
 * mid-sentence through. Quantising the scale is not enough to prevent that — a 70px swing crosses
 * any sane step boundary — so the scale is computed from the SMALLEST viewport seen so far in the
 * current orientation, not the current one.
 *
 * That choice has three properties worth stating. The layout always fits, because it is sized for
 * the worst case rather than the moment. The scale within an orientation can only ever decrease, so
 * it converges after the first address-bar cycle instead of oscillating. And when it does decrease
 * it is because the viewport genuinely shrank, which is precisely when NOT rescaling would push
 * content back into the unreachable region. The running minimum resets on an orientation change,
 * where the previous minimum carries no information about the new shape.
 */

/**
 * The design canvas the layouts were authored and tested against — iPad 11" landscape, the largest
 * viewport in the reachability suite. Screens narrower or shorter than this scale down to fit.
 */
export const DESIGN_WIDTH = 1194;
export const DESIGN_HEIGHT = 834;

/** Never scale below this. Past it the text is too small to be a fair stimulus; see clampNote(). */
export const MIN_SCALE = 0.5;

/**
 * Quantisation step. Rounds the scale down to a multiple of this so a pixel or two of viewport
 * jitter is absorbed. It is a tidiness measure, not the stability mechanism — that is the running
 * minimum below, because no step size survives a 70px address bar.
 */
const STEP = 0.02;

let applied = 1;

/**
 * The smallest viewport seen in the current orientation, and the orientation it belongs to.
 *
 * Sizing for this rather than for the current measurement is what keeps a stimulus from resizing
 * under a reader. Reset by `resetViewportFloor()` on an orientation change.
 */
let floorW = Infinity;
let floorH = Infinity;
let floorPortrait: boolean | null = null;
/** Largest viewport seen in this orientation, used to recognise a transient occlusion. */
let peakW = 0;
let peakH = 0;

/**
 * A measurement below this fraction of the largest seen in the same orientation is treated as a
 * TRANSIENT OCCLUSION rather than a real viewport change, and is not folded into the floor.
 *
 * The soft keyboard is the case that forced this. On the participant-profile form it takes roughly
 * half the screen: measured on a Xiaomi Pad 6, 1152x650 becomes 1152x300 while the keyboard is up.
 * Under a plain running minimum that is indistinguishable from a genuinely smaller device, so the
 * floor dropped to 300, the scale locked at MIN_SCALE, and — because the minimum never rises — every
 * one of the ten reading exposures afterwards rendered at HALF SIZE for the rest of the sitting.
 * The stimulus whose visual angle the study controls, halved, silently, by someone typing an age.
 *
 * 0.7 separates the two cases cleanly: an address bar costs about 10% of the height, a keyboard
 * about 55%. Nothing in between is expected, and a real device change arrives with an
 * orientationchange, which resets the reference.
 */
const OCCLUSION_FRACTION = 0.7;

/**
 * The scale that fits `w x h`, capped at 1 and floored at MIN_SCALE.
 *
 * Pure and exported so the arithmetic is testable without a DOM: the failure this file fixes was
 * invisible precisely because nothing tested it.
 */
export function computeScale(w: number, h: number): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  const raw = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  // Never magnify: a bigger screen shows the design size, so the stimulus matches every other
  // device at or above the canvas.
  const capped = Math.min(1, raw);
  const quantised = Math.floor(capped / STEP) * STEP;
  return Math.max(MIN_SCALE, Math.min(1, Number(quantised.toFixed(4))));
}

/**
 * The viewport to measure.
 *
 * `visualViewport` is the honest answer on mobile Chrome — it excludes the address bar and any
 * on-screen keyboard, which is the space the participant can actually see and touch. It is what
 * `window.innerHeight` fails to report while the address bar is showing.
 */
function measure(): { w: number; h: number } {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv && vv.width > 0 && vv.height > 0) return { w: vv.width, h: vv.height };
  return { w: window.innerWidth, h: window.innerHeight };
}

/** The factor currently applied. Record this with the session; see the visual-angle note above. */
export function currentScale(): number {
  return applied;
}

/**
 * The viewport the current scale was computed from, as "WxH" in CSS pixels.
 *
 * Distinct from `screen.width`/`screen.height`, which describe the physical panel and are the same
 * whether or not the browser's address bar is eating 70px of it. This is the box the layout was
 * actually fitted to.
 */
export function layoutViewport(): string {
  const w = Number.isFinite(floorW) ? floorW : measure().w;
  const h = Number.isFinite(floorH) ? floorH : measure().h;
  return `${Math.round(w)}x${Math.round(h)}`;
}

/**
 * Forget the running minimum. Called on an orientation change, where a portrait minimum says
 * nothing useful about the landscape shape that follows.
 */
export function resetViewportFloor(): void {
  floorW = Infinity;
  floorH = Infinity;
  floorPortrait = null;
  peakW = 0;
  peakH = 0;
}

/**
 * Fold a measurement into the running minimum and return the dimensions to size for.
 *
 * Exported for testing: the oscillation this prevents is invisible in a unit test of computeScale
 * alone, because the bug lives in the sequence of measurements, not in any one of them.
 */
export function foldViewportFloor(w: number, h: number): { w: number; h: number } {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: floorW, h: floorH };
  }
  /*
   * Occlusion is checked BEFORE the orientation test, and that order is load-bearing.
   *
   * The orientation test is `h > w`, and a narrow occlusion can flip it: 1152x720 landscape with a
   * side panel covering it reads as 400x720, which is "portrait", which resets the floor entirely.
   * A soft keyboard does the same thing in the other axis on a nearly-square viewport. Classifying
   * a covered viewport as a rotation discards the real orientation's history on the strength of a
   * transient.
   */
  /*
   * A rotation swaps the dimensions; an occlusion shrinks one and leaves the other. Both are large
   * changes, so size alone cannot tell them apart — 720x1152 after 1152x650 is a rotation, while
   * 400x720 after 1152x720 is a panel covering the side. Checking for the swap first is what keeps
   * the occlusion guard from swallowing a genuine rotation.
   *
   * `orientationchange` also calls resetViewportFloor() and is the authoritative signal; this is
   * the fallback for platforms that resize without firing it.
   */
  const swapped = peakW > 0 && peakH > 0
    && Math.abs(w - peakH) / peakH < 0.15
    && Math.abs(h - peakW) / peakW < 0.15;

  if (!swapped && peakW > 0 && peakH > 0
      && (h < peakH * OCCLUSION_FRACTION || w < peakW * OCCLUSION_FRACTION)) {
    return {
      w: Number.isFinite(floorW) ? floorW : w,
      h: Number.isFinite(floorH) ? floorH : h,
    };
  }

  const portrait = h > w;
  if (floorPortrait !== portrait) {
    // A new orientation: start over rather than inheriting the other shape's history.
    floorPortrait = portrait;
    floorW = w;
    floorH = h;
    peakW = w;
    peakH = h;
    return { w, h };
  }

  peakW = Math.max(peakW, w);
  peakH = Math.max(peakH, h);

  floorW = Math.min(floorW, w);
  floorH = Math.min(floorH, h);
  return { w: floorW, h: floorH };
}

/**
 * True when the viewport is so small that even MIN_SCALE cannot fit the design canvas, so content
 * is being clipped despite scaling. The operator needs to know rather than discover it as a
 * missing button.
 *
 * This had no production caller for a while: the sentence above described a warning nobody was
 * shown, and a sitting whose screens were clipped exported byte-identically to a clean one. It is
 * now checked on the pre-flight screen, which reports it and lets the session run — the same rule
 * the typeface check follows.
 *
 * In the exported data the signature is `stimulus_scale == MIN_SCALE`: the scale is clamped there,
 * so a row at exactly 0.5 is a row that did not fit.
 */
export function isBelowMinimum(w = measure().w, h = measure().h): boolean {
  return Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT) < MIN_SCALE;
}

function apply(): void {
  const seen = measure();
  const { w, h } = foldViewportFloor(seen.w, seen.h);
  const next = computeScale(w, h);
  if (next === applied) return;
  applied = next;
  document.documentElement.style.setProperty('--vl-scale', String(next));
  /*
   * `--vl-vw` and `--vl-vh` used to be published here, described as a facility a layout could react
   * to without re-measuring. Nothing ever read them — and they were written AFTER the
   * `if (next === applied) return` above, so on any device whose initial scale is 1 they were never
   * written at all. A screen authored against `var(--vl-vh)` would therefore have got an empty
   * value on the reference tablet: the one device where anyone would have tested it.
   *
   * They are gone rather than fixed. The layout problem they were meant to serve is solved properly
   * by STIMULUS_COLUMN_PX and STIMULUS_BOX at the foot of this file, which make the stimulus
   * geometry device-independent instead of inviting each screen to react to the viewport itself.
   */
}

/**
 * Start keeping `--vl-scale` in step with the viewport. Returns a teardown function.
 *
 * Called once from main.tsx before React renders, so the first paint is already at the right scale
 * rather than reflowing under the participant.
 */
export function installViewportScale(): () => void {
  apply();

  let frame = 0;
  const schedule = () => {
    // Coalesce bursts: an orientation change fires several of these in a row.
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      apply();
    });
  };

  const onOrientation = () => {
    resetViewportFloor();
    schedule();
  };

  window.addEventListener('resize', schedule);
  /*
   * BOTH orientation signals, because `window.orientationchange` is deprecated and the Screen
   * Orientation API is what replaces it. Listening only for the old one leaves the floor carrying a
   * portrait minimum into landscape on any browser that has dropped it, which sizes the whole
   * sitting for a shape the tablet is no longer in.
   *
   * resetViewportFloor is idempotent, so both firing is harmless.
   */
  window.addEventListener('orientationchange', onOrientation);
  screen.orientation?.addEventListener?.('change', onOrientation);
  window.visualViewport?.addEventListener('resize', schedule);

  /*
   * DELIBERATELY NOT visibilitychange. It is tempting — a tablet that slept while the address bar
   * was showing keeps the smaller scale afterwards, and resetting on wake would let it recover.
   *
   * But the floor is the mechanism that stops the stimulus resizing under a reader, and resetting
   * it lets the scale RISE. A participant who is mid-passage when the operator switches apps and
   * back would watch the text grow: precisely the failure this design exists to prevent, introduced
   * by a fix for a smaller one. Keeping the smaller scale is the design working — it sizes for the
   * worst case seen, so the layout always fits. What that cost was an export whose stimulus_scale
   * was stamped once at session start and never revisited, and that is fixed where it belongs, on
   * the condition record.
   */

  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', onOrientation);
    screen.orientation?.removeEventListener?.('change', onOrientation);
    window.visualViewport?.removeEventListener('resize', schedule);
  };
}

/**
 * The width of a text column that is identical on every device, in root pixels.
 *
 * WHY THIS IS NEEDED. The root transform is NOT a similarity transform of the design canvas, and
 * that was not obvious. `#root` is sized `calc(100% / var(--vl-scale))` in both axes while the scale
 * is `min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT)` — one axis binds and the other over-fills, so the
 * root box takes the DEVICE's aspect ratio, never the canvas's 1194/834. A layout that sizes itself
 * as a percentage of the root therefore gets a different number of characters per line on every
 * differently-shaped screen, at the same `--vl-scale`, at the same glyph size.
 *
 * Measured, with the reading passage's 10% side margins:
 *
 *   1194x834 (design)   scale 1.00   root 1194 wide   column  955 px   baseline
 *   1152x720 (Xiaomi)   scale 0.86   root 1340 wide   column 1072 px   +12.2% characters per line
 *   1152x650 (bar up)   scale 0.76   root 1516 wide   column 1213 px   +27.0%
 *   2560x1600           scale 1.00   root 2560 wide   column 2048 px   +114%
 *
 * The last row is the one that matters most, because the header of this file used to claim the
 * opposite: "A larger screen renders at the design size rather than being magnified, so the stimulus
 * is identical on every device at or above the design canvas." The glyphs are identical there. The
 * line is more than twice as long. Line length is a first-order determinant of reading rate and
 * regression frequency, and reading rate and ocular behaviour are dependent variables here — so this
 * was an uncontrolled difference in the stimulus, invisible in `stimulus_scale`, which reads 1.00 on
 * both of those devices.
 *
 * Fixing the column in root pixels restores the property the design assumes: every device presents
 * the same layout, differing only by the uniform magnification `--vl-scale` records. The space left
 * over is filled by the condition's own background, so nothing about it is visible to a participant.
 */
export const STIMULUS_COLUMN_PX = Math.round(DESIGN_WIDTH * 0.8);

/**
 * The box a stimulus is positioned within, in root pixels — the design canvas itself.
 *
 * Used by the reaction-time task, where the target's position is a percentage and its diameter is a
 * constant. Resolving those percentages against the device-shaped root box made the target's
 * eccentricity, and so its size-to-eccentricity ratio, vary by device: 0.148 on the design canvas,
 * 0.136 at 1152x720, 0.123 at 1152x650, 0.071 at 2560x1600. Simple reaction time and detection
 * sensitivity are both monotone in eccentricity, so that entered the data as device-driven variance
 * in a dependent variable with no column identifying it.
 */
export const STIMULUS_BOX = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT } as const;
