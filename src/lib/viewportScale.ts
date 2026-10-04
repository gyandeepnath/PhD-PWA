/**
 * Drive the `--vl-scale` variable that theme.css is built around.
 *
 * WHY THIS FILE EXISTS. theme.css carries a five-point description of a root-scaling strategy:
 * `#root` is transformed by `scale(var(--vl-scale))` and its layout box resized inversely so the
 * content fills the viewport afterwards. All of that was in place. Nothing ever set the variable —
 * it was declared as `1` and left there, so the app laid out at its design size on every device.
 *
 * `#root` also carries `overflow: hidden`, deliberately, so a stimulus screen cannot be scrolled
 * mid-exposure. Together those two facts mean a viewport shorter than the design canvas does not
 * merely clip: the clipped content is unreachable by any gesture, because `body` additionally sets
 * `touch-action: none`. On a viewport shorter than the design canvas of the time (834 tall) the
 * Continue buttons on the setup screens were simply not on the screen and could not be scrolled to.
 *
 * FILL TO FIT (Round 74). The design canvas is now drawn to FIT the viewport in both directions —
 * scaled UP on a screen larger than it, as well as down on a smaller one — keeping its 16:10 shape.
 * Until Round 74 the scale was capped at 1 ("the app never magnifies above the design canvas"), and
 * Rounds 63-66 sized every layout against an ASSUMED tablet viewport of 1152x720 CSS px (a Xiaomi Pad
 * 6 at device pixel ratio 2.5) that was never measured on the device. That was a mistake. On the real
 * tablet the investigator reported the tasks, the reaction-time card, comprehension and the dashboard
 * sitting in the middle of the screen with about a quarter of the width blank on each side, while the
 * corner chrome (fixed to the viewport edges) reached the corners. That is what a capped canvas looks
 * like on a viewport wider than it: the 1040 px stimulus column on a viewport about 1920 CSS px wide
 * (device pixel ratio 1.5) covers 54% of it. The tablet's actual CSS viewport and pixel ratio were not
 * measured — the device box on the pre-flight screen now shows them — and the same cap would also
 * have drawn every stimulus about 40% smaller than the physical sizes the documentation stated.
 *
 * PHYSICAL SIZE, NOT CSS PIXELS. A CSS pixel has no fixed physical size: it is the panel's pixels
 * divided by whatever pixel ratio the browser chose, and the same tablet can report 1152 or 1920 CSS
 * px across depending on its display-size setting. Fitting the canvas to the screen makes one DESIGN
 * pixel a fixed fraction of the screen instead — on a 16:10 screen, 1/1152 of its width, so on the
 * study tablet's panel (manufacturer's figure: 2880 px at 309 ppi, 236.7 mm across) about 0.2055 mm
 * at any pixel ratio, in the installed full-screen app. That is the figure the protocol's visual
 * angles were written for. It is not ASSUMED in the data any more: the pre-flight screen has the
 * operator measure a bar of known design length with a ruler (lib/physicalCalibration.ts), which
 * gives the millimetres per CSS pixel of THIS screen, and every visual angle in the export is
 * computed from that measurement and `stimulus_scale` (the fallback, flagged, is the manufacturer's
 * figure).
 *
 * VISUAL ANGLE. Scaling the root scales the stimulus text with it, which changes visual angle, so
 * this cannot be a silent cosmetic fix. `currentScale()` is recorded with the session and on every
 * condition (`stimulus_scale`), so physical size = design px x stimulus_scale x mm per CSS px. A
 * screen of another aspect ratio is still fitted (the root box takes the device's shape, so a
 * percentage-sized layout would reflow — see STIMULUS_COLUMN_PX at the foot of this file for what the
 * stimulus screens do about that).
 *
 * STABILITY. Chrome on Android grows and shrinks the visual viewport as the address bar hides and
 * reveals, and rescaling on every one of those would resize the text a participant is mid-sentence
 * through. Quantising the scale is not enough to prevent that — the swing crosses any sane step
 * boundary — so the scale is computed from the SMALLEST viewport seen so far in the current
 * orientation, not the current one.
 *
 * That choice has three properties worth stating. The layout always fits, because it is sized for
 * the worst case rather than the moment. The scale can only decrease between resets, so it converges
 * after the first address-bar cycle instead of oscillating. And when it does decrease it is because
 * the viewport genuinely shrank, which is precisely when NOT rescaling would push content back into
 * the unreachable region. None of this depends on the cap that Round 74 removed: the floor, the
 * freeze and the refit below work the same above 1 as below it.
 *
 * WHEN THE MINIMUM RESETS — and why it has to. It used to reset only on an orientation change or a
 * full reload, so a single small reading lasted the whole sitting and every sitting after it. On the
 * investigator's Xiaomi Pad 6 the app ran at exactly MIN_SCALE (Round 56): opening the app in a
 * floating window and then maximising it, a startup frame that briefly reports a short viewport,
 * rotating with the keyboard up, or a split screen each lock the scale at or near 0.5, and nothing
 * let it rise again. Half the fitted size puts the reading text's x-height below the critical print
 * size for fluent reading (about 12 arcmin; Legge & Bigelow 2011, J Vis 11(5):8), so those sessions
 * presented a different stimulus.
 *
 * The rule now is FROZEN DURING A CONDITION, RE-MEASURED BETWEEN SCREENS OUTSIDE ONE. Every screen
 * change that is not a condition screen calls `refitScale()`, which forgets the minimum and measures
 * afresh — so a lock clears at the next setup screen, break or manager view instead of never. While a
 * condition runs (`setScaleFrozen(true)`) the scale can never GROW, so text never enlarges under a
 * reader; it may still shrink if the screen genuinely shrinks, so content stays reachable, and each
 * such change is counted (`rescalesWhileFrozen`) and recorded on the condition. Measurements taken
 * while a text field has focus are ignored outright: the soft keyboard is the commonest transient.
 */

/**
 * The design canvas the layouts are authored in: 1152x720 design px, 16:10 — the study tablet's shape
 * (a Xiaomi Pad 6 in landscape, 2880x1800). Since Round 74 it is NOT a claim about the tablet's CSS
 * viewport: the canvas is fitted to whatever viewport the browser reports, so on any 16:10 screen,
 * launched full-screen, it fills the screen edge to edge, and every size written in this codebase in
 * px is a DESIGN px — a fixed fraction (1/1152) of the screen's width. On the study tablet that is
 * about 0.2055 mm, so the protocol's 22 px reading text has an x-height of about 14.9 arcmin at 55 cm;
 * the session's own calibration says what it actually was.
 *
 * It used to be iPad 11" landscape, 1194x834 — the largest viewport in the reachability suite, not
 * the device the study runs on. That canvas is squarer than the tablet (1.43 against 1.60), so on a
 * 16:10 screen it was HEIGHT-bound and 29-37% of the width stood empty. Round 63 re-based it to
 * 1152x720 on the assumption that the tablet's viewport WAS 1152x720 CSS px, and kept the cap at 1;
 * Round 74 removed the cap (see the header).
 */
export const DESIGN_WIDTH = 1152;
export const DESIGN_HEIGHT = 720;

/** Never scale below this. Past it the text is too small to be a fair stimulus; see isBelowMinimum(). */
export const MIN_SCALE = 0.5;

/**
 * Never scale above this. Not a stimulus rule — the canvas is meant to fill the screen — only a stop
 * against an absurd size on a very large monitor: at 3 the canvas is 3456x2160 CSS px, larger than any
 * tablet's viewport. The study tablet's fit lies between 1 and about 2.5 whatever pixel ratio it
 * reports.
 */
export const MAX_SCALE = 3;

/**
 * Quantisation step. Rounds the scale to a multiple of this so a pixel or two of viewport jitter is
 * absorbed. It is a tidiness measure, not the stability mechanism — that is the running minimum
 * below, because no step size survives a 70px address bar.
 */
export const SCALE_STEP = 0.02;

/**
 * How far the rounded scale may EXCEED the exact fit, as a fraction of it. The scale is rounded to the
 * NEAREST step, not down: rounding down left up to a whole step of the screen blank (8 px of a 1920 px
 * width at 1.66), and on a viewport a pixel short of a step boundary — a status-bar pixel, a fractional
 * visual viewport rounded down — it shrank every glyph by a step for a one-pixel difference. Rounding
 * up overfills by at most half a step, which above a scale of 1 is under 1% of the viewport; below 1 it
 * could reach 2%, so there the step below is taken instead whenever rounding up would overfill by more
 * than this. 1% is the slack every screen is required to have: e2e/allScreensFit.spec.ts walks every
 * screen at 1152x713, where the canvas (scale 1.0) overfills by exactly that much.
 *
 * It replaces SNAP_TO_ONE, a 1% band that rounded up to 1.0 only — the same rule, applied at the one
 * scale that used to be the maximum.
 */
export const OVERFILL_TOLERANCE = 0.01;

let applied = 1;

/** True while a condition is on screen. See the header: the scale may shrink but never grow. */
let frozen = false;
/** How many times the scale changed while frozen, since the last freeze. */
let frozenRescales = 0;
/** Set by installViewportScale so refitScale can re-apply outside a resize event. */
let scheduleApply: (() => void) | null = null;

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
 * half the screen: 1152x650 became 1152x300 while the keyboard was up, in the CSS pixels then assumed
 * for the Xiaomi Pad 6 (Round 74: the tablet's real viewport was never measured; the fractions are
 * what matter here, and they do not depend on it).
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
 * The scale that fits the design canvas to `w x h`: the nearest SCALE_STEP to the exact fit, never
 * more than OVERFILL_TOLERANCE above it, within [MIN_SCALE, MAX_SCALE].
 *
 * Pure and exported so the arithmetic is testable without a DOM: the failure this file fixes was
 * invisible precisely because nothing tested it — and so was the cap that Round 74 removed, which
 * every test asserted as a virtue ("never magnifies") on viewports nobody had measured.
 */
export function computeScale(w: number, h: number): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  const raw = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  // The nearest step. Math.round is safe here where Math.floor was not: 0.9 / 0.02 is 44.999... in
  // IEEE doubles, which floored a viewport exactly nine-tenths of the canvas a whole step too small;
  // rounding it gives 45.
  let quantised = Math.round(raw / SCALE_STEP) * SCALE_STEP;
  // Rounding up may overfill by half a step. Above 1 that is under 1%; below it, it is not, and the
  // step below is taken instead. See OVERFILL_TOLERANCE.
  if (quantised > raw * (1 + OVERFILL_TOLERANCE) + 1e-9) quantised -= SCALE_STEP;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(quantised.toFixed(4))));
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
 * so a row at exactly 0.5 did not fit — or, in builds before refitScale existed, had locked small on a
 * screen that could have shown it larger.
 */
export function isBelowMinimum(w = measure().w, h = measure().h): boolean {
  return Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT) < MIN_SCALE;
}

/** How the app is being displayed: the CSS `display-mode` the browser reports. */
export type DisplayMode = 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';

/**
 * The display mode, or null where the browser cannot say.
 *
 * WHY THE PRE-FLIGHT SCREEN ASKS. The canvas is fitted to the viewport, and the protocol's stimulus
 * sizes are those of the installed app's full screen. In a Chrome tab the address bar takes part of
 * the height, the canvas is fitted to the shorter box, and every stimulus is drawn that much smaller
 * — about a tenth, if the bar is 70 of 720 CSS px; the real figure on the study tablet was not
 * measured (`screenFill()` reports it live) — with nothing on the screen to say so. It is also
 * unstable: the bar can hide and reappear, so a tab can present different sizes to different
 * sittings. `vite.config.ts` installs the app with `display: 'fullscreen'`, so "launched
 * from the home-screen icon" is exactly `fullscreen` (`standalone` where a platform declines
 * full-screen but still drops the browser chrome); anything else is a tab or a window, and the
 * operator is told before the participant sees a stimulus.
 *
 * Read from matchMedia, most specific first, because a browser matches only the mode it is in.
 * iPadOS Safari predates the media feature on some versions and exposes `navigator.standalone`
 * instead. Null — not "browser" — when neither is available: a mode that was not reported must not
 * be recorded as one that was.
 */
export function displayMode(): DisplayMode | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia === 'function') {
    for (const m of ['fullscreen', 'standalone', 'minimal-ui', 'browser'] as const) {
      if (window.matchMedia(`(display-mode: ${m})`).matches) return m;
    }
  }
  const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { standalone?: boolean } : null;
  if (nav && typeof nav.standalone === 'boolean') return nav.standalone ? 'standalone' : 'browser';
  return null;
}

/** True when the app runs without browser chrome: the installed, home-screen launch. */
export function isInstalledDisplay(mode: DisplayMode | null = displayMode()): boolean {
  return mode === 'fullscreen' || mode === 'standalone';
}

/**
 * True while an editable element has focus: the soft keyboard is up, or about to be. A measurement
 * taken now describes the keyboard, not the screen, and is ignored rather than folded into the floor.
 */
function editableFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * Freeze (a condition is on screen) or unfreeze the scale. Unfreezing is a screen boundary outside
 * any stimulus, so it also re-measures from scratch; see refitScale.
 */
export function setScaleFrozen(next: boolean): void {
  if (next === frozen) {
    if (!next) refitScale();
    return;
  }
  frozen = next;
  if (next) {
    frozenRescales = 0;
    return;
  }
  refitScale();
}

/** Scale changes since the last freeze — recorded on the condition as stimulus_scale_changes. */
export function rescalesWhileFrozen(): number {
  return frozenRescales;
}

/**
 * Forget the running minimum and measure again — at a screen boundary outside any condition, or when
 * the operator taps "Re-fit screen". Ignored while frozen: a stimulus must not resize because someone
 * navigated. This is what lets a scale that locked small (a floating window, a bad startup frame, a
 * rotation with the keyboard up) come back at the next screen instead of never.
 */
export function refitScale(): void {
  if (frozen) return;
  resetViewportFloor();
  if (scheduleApply) scheduleApply();
  else if (typeof window !== 'undefined' && typeof document !== 'undefined') apply();
}

/**
 * The scale this screen would get if measured fresh, ignoring the running minimum. The pre-flight
 * check compares it with the applied scale to catch a lock the operator cannot otherwise see.
 */
export function freshScale(): number {
  const m = measure();
  return computeScale(m.w, m.h);
}

/**
 * The scale the WHOLE SCREEN would give — the installed app's full-screen launch — from
 * `screen.width x screen.height`, taken in the viewport's orientation (Chrome on Android swaps them
 * on rotation, other browsers do not). Null where the browser reports no screen.
 *
 * The installed app is what the protocol's stimulus sizes are written for, so this is the yardstick
 * the applied scale is judged against: in a browser tab the address bar makes the viewport shorter
 * than the screen, the canvas is fitted to the smaller box, and the ratio of the two scales is how
 * much smaller every stimulus is drawn. Before Round 74 the yardstick was 1.0 — the scale on an
 * ASSUMED 1152x720 viewport — which a screen of any other size in CSS pixels made meaningless.
 */
export function screenFitScale(): number | null {
  if (typeof screen === 'undefined' || typeof window === 'undefined') return null;
  const sw = screen.width;
  const sh = screen.height;
  if (!(sw > 0 && sh > 0)) return null;
  const m = measure();
  const landscape = m.w >= m.h;
  const w = landscape ? Math.max(sw, sh) : Math.min(sw, sh);
  const h = landscape ? Math.min(sw, sh) : Math.max(sw, sh);
  return computeScale(w, h);
}

/**
 * The applied scale as a fraction of the full-screen one (`screenFitScale`): 1 when the canvas fills
 * the screen as the installed app would, less in a tab, a split screen or a floating window. Null
 * where the screen is not reported. Values within one SCALE_STEP of 1 are reported as 1 — a fitted
 * viewport a few pixels short of the screen (a rounded fractional height) is the full screen.
 */
export function screenFill(applied = currentScale(), full = screenFitScale()): number | null {
  if (full == null || !(full > 0) || !(applied > 0)) return null;
  if (applied >= full - SCALE_STEP - 1e-9) return 1;
  return applied / full;
}

/** Measure and apply now, outside a resize event. Exported for tests and for one-off callers. */
export function remeasureScale(): void {
  apply();
}

function apply(): void {
  if (editableFocused()) return;
  const seen = measure();
  const { w, h } = foldViewportFloor(seen.w, seen.h);
  const next = computeScale(w, h);
  if (next === applied) return;
  // Never GROW under a reader. The floor only falls between resets, and resets are refused while
  // frozen, so this is belt and braces.
  if (frozen && next > applied) return;
  if (frozen) frozenRescales += 1;
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
   * by STIMULUS_COLUMN_PX at the foot of this file and by the reaction-time targets' fixed root-px
   * offsets (lib/rtLocations.ts), which make the stimulus geometry device-independent instead of
   * inviting each screen to react to the viewport itself.
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
  scheduleApply = schedule;
  // A keyboard closing is a blur, not always a resize: re-measure when focus leaves a field, so a
  // measurement skipped while typing is taken once the field is done with.
  const onFocusOut = () => { schedule(); };
  document.addEventListener('focusout', onFocusOut);

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
    scheduleApply = null;
    document.removeEventListener('focusout', onFocusOut);
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
 * root box takes the DEVICE's aspect ratio, never the canvas's. A layout that sizes itself as a
 * percentage of the root therefore gets a different number of characters per line on every
 * differently-shaped screen, at the same `--vl-scale`, at the same glyph size.
 *
 * Measured, with the reading passage's former 10% side margins, on the 1194x834 canvas of the time:
 *
 *   1194x834 (design)   scale 1.00   root 1194 wide   column  955 px   baseline
 *   1152x720 (Xiaomi)   scale 0.86   root 1340 wide   column 1072 px   +12.2% characters per line
 *   1152x650 (bar up)   scale 0.76   root 1516 wide   column 1213 px   +27.0%
 *   2560x1600           scale 1.00   root 2560 wide   column 2048 px   +114%
 *
 * (The "Xiaomi" rows are the viewport then ASSUMED for the study tablet; see the header.) On the
 * 1152x720 canvas with the Round 63 cap at 1, the same percentage column would have run 922 px at
 * 1152x720, 1024 with the address bar up (+11%) and 2048 on a 2560x1600 display (+122%): the
 * device-shaped root box is a property of the scaler, not of any one canvas. Fitting in both
 * directions (Round 74) makes the root box the canvas itself, within a step, on every 16:10 screen —
 * 1152 design px wide at 1152x720, 1920x1200 and 2560x1600 alike — but a screen of another shape still
 * gets a root of its own shape (1024x768 at 0.88: 1164x873 design px), so the column stays fixed.
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
 *
 * WHY 1040, AND WHY IT IS WRITTEN OUT. It used to be `round(DESIGN_WIDTH * 0.8)`, which was 955 on
 * the old canvas — and would have silently become 922 when the canvas was re-based to the tablet,
 * a narrower line nobody decided on. The column is a stimulus parameter, so it is stated, not
 * derived: 1040 root px is 90% of the canvas's width (56 px either side) — and so, since Round 74, of
 * any 16:10 screen the installed app fills; on the study tablet's panel (236.7 mm across,
 * manufacturer's figure) 213.7 mm = 22.0 deg at 55 cm — about 104 characters of the 22 px Roboto
 * passage per line (91-112; measured in the browser). It was chosen
 * with the 1.4 line height so that each of a passage's existing three pages fits one screen with at
 * least 48 px to spare, without re-paginating the corpus or enlarging the type. The line is longer
 * than the 95 characters it replaced — a judgement, not a measured optimum — and it is the same in
 * all ten conditions, so it cannot confound a condition contrast. It must fit the canvas, which
 * tests/stimulusGeometry.test.ts asserts.
 */
export const STIMULUS_COLUMN_PX = 1040;

/*
 * STIMULUS_BOX used to be declared here: the design canvas, as the box the reaction-time target was
 * positioned within by percentage, because a percentage of the device-shaped root box had made the
 * target's eccentricity vary by device (measured on the 1194x834 canvas of the time: dot size per
 * unit eccentricity 0.148 on the canvas, 0.136 at 1152x720, 0.123 at 1152x650, 0.071 at 2560x1600).
 * Since Round 66 the target sits at one of eight FIXED offsets in root px from the centre
 * (lib/rtLocations.ts), which no box can change, so the box had no user left and is gone.
 */
