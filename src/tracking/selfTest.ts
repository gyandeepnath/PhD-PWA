/**
 * The camera self-test: does the camera actually see this participant's blinks? — answered before the
 * first condition, in plain words, while something can still be done about it.
 *
 * WHY. The investigator asked how to know the blink measurement works. Nothing answered that until the
 * export was opened, after the participant had gone. Now, right after calibration, the participant blinks
 * once each time a dot flashes; each flash counts one blink beginning in the 1.2 s after it as its hit
 * (matchCues; 1.2 s either side before Round 82), and every other blink is an extra. With the frame rate and how much of the time a face
 * was in view, that is a verdict an operator can act on: reseat the participant, fix the light, or
 * accept and continue — and the result is exported with the sitting (selftest_* in
 * 01_session_info.csv) either way.
 *
 * The pass rule is an ENGINEERING check that the pipeline sees deliberate blinks, not a validation of the
 * incomplete-blink classifier (which no retrieved study has validated for this method; see
 * LITERATURE_VALIDATION.md). Deliberate blinks are complete and slow; spontaneous incomplete blinks are
 * harder. A pass means "the camera sees this person's eyes and their blinks", no more.
 *
 * Each attempt is reported criterion by criterion — each flash seen or not and how long after it the
 * blink began, the share of time the face was in view, the sampling rate and its tier — so an operator
 * can see which part failed and fix that part before trying again (CameraSelfTest.tsx).
 */
import { pipelineLimit, type PipelineLimit } from './pipelineStats';
import type { PipelineWindowFields } from '@/storage/types';
import { CONFIG } from '@/experiment/config';
import { FPS_GATE, fpsTier, type FpsTier } from './frameRateGate';

/**
 * The pass rule of Rounds 79-81, 'st-r2'; sittings before it were scored under 'st-r1', and from Round
 * 82 under 'st-r3' (SELF_TEST_RULE, below).
 *
 * WHY IT CHANGED. st-r1 failed any test whose face-solved rate, over the whole window, was under 25
 * frames a second. On the study tablet, whose camera delivers at most 23-25 (the investigator's report),
 * it therefore failed whatever the participant did, and every face-loss moment lowered the rate further
 * (it charged time without a face to the rate, as effective_fps does). The blinks themselves were seen.
 * st-r2 judges the rate by the frame-rate gate every other part of the app uses (fps-g2,
 * frameRateGate.ts): the eye's sampling rate while the face was seen, adequate at 20, reduced (a pass,
 * said so) from 15, a fail below. Every criterion is a time or a share, never a count of frames: the
 * matching window is 1.2 s either side of a flash, the hits are 80% of the flashes, the face must be in
 * view 90% of the time. And it runs on the mid-grey of the grey field (CONFIG.ADAPTATION_COLOR) rather
 * than a dark ground, so the camera sees the face lit as it will be during reading — under automatic
 * exposure a dark screen is the one that slows the camera most.
 */
export const SELF_TEST_RULE_R2 = 'st-r2';
/** The rule on sittings recorded before Round 79 (no `rule` on the record). */
export const SELF_TEST_RULE_V1 = 'st-r1';

/**
 * The pass rule from Round 82: 'st-r3'. Everything is st-r2's except WHICH BLINKS A FLASH CAN TAKE: a
 * blink beginning in the 1.2 s AFTER the flash, where st-r1 and st-r2 took one up to 1.2 s either side.
 *
 * WHY. A blink before a flash cannot be an answer to it, and the two-sided window let blinks the
 * participant would have made anyway pass the check. Simulated through the shipped aggregator,
 * classifier and scorer (docs/FPS_GATE_SIMULATION.md, "Blinks that answer no flash"; npm run
 * sim:selftest), a participant who ignored every flash and blinked only spontaneously passed st-r2 in
 * 16% of attempts at 15 blinks a minute and 40% at 20 (24 frames a second; the rates and the spacing of
 * the blinks are simulation assumptions — the one verified figure, 11.6 a minute while reading on a
 * computer, is Portello et al. 2013, ledger #2). Taking only blinks after the flash cuts that to 2% and
 * 8% (16% at 26 a minute), and in the same simulation a participant who blinks at every flash — with or
 * without spontaneous blinks besides — passes exactly as often as under st-r2. Nothing else
 * changed: the window is still 1.2 s long, still 4 of 5, still 90% face and the frame-rate gate — no
 * threshold was tuned to the simulation. It assumes the answer comes after the flash (the simulated
 * latency, 250-900 ms, is an assumption; no verified source gives it), so a participant who blinks
 * just BEFORE the flash, anticipating its steady 3-s rhythm, now misses it; the result then says so
 * (earlyLags), so the operator can ask them to wait for the flash.
 *
 * st-r2 sittings stay reproducible: matchCues and scoreSelfTest take the rule, and the export re-runs
 * the matching under the rule each sitting was scored with (01 selftest_rule).
 */
export const SELF_TEST_RULE = 'st-r3';

export const SELF_TEST = {
  CUES: 5,
  /** First cue after this, then one every CUE_EVERY_MS. */
  FIRST_CUE_MS: 2500,
  CUE_EVERY_MS: 3000,
  /**
   * How long the matching window is: from st-r3 a blink beginning up to this long AFTER a flash counts
   * for it; under st-r1 and st-r2, this long either side (cueWindow).
   */
  WINDOW_MS: 1200,
  /** Pass: at least this share of the cued blinks seen (4 of 5) … */
  MIN_HIT_SHARE: 0.8,
  /** … with a face in view at least this share of the time … */
  MIN_FACE: 0.9,
  /** … and the eye sampled at least at the gate's reduced floor (fps-g2 tier B; tier A is "working"). */
  MIN_FPS: FPS_GATE.REDUCED,
  /** The ground the test runs on: the grey field's #808080, the luminance every condition shares. */
  GROUND: CONFIG.ADAPTATION_COLOR,
} as const;

/** The matching window around a flash under `rule`, ms: before it and after it (see SELF_TEST_RULE). */
export function cueWindow(rule: string = SELF_TEST_RULE): { before: number; after: number } {
  return rule === SELF_TEST_RULE_V1 || rule === SELF_TEST_RULE_R2
    ? { before: SELF_TEST.WINDOW_MS, after: SELF_TEST.WINDOW_MS }
    : { before: 0, after: SELF_TEST.WINDOW_MS };
}

/** How many of `cues` flashes must be seen: the share, rounded up (4 of 5). */
export const minHits = (cues: number) => Math.ceil(SELF_TEST.MIN_HIT_SHARE * cues - 1e-9);

/** 'working' (tier A), 'reduced' (passes at tier B, said so), 'failed'. */
export type SelfTestVerdict = 'working' | 'reduced' | 'failed';

export interface SelfTestResult {
  /** SELF_TEST_RULE: absent on sittings scored before Round 79 (st-r1). */
  rule?: string;
  cued: number;
  detected: number;
  extra: number;
  /**
   * Face-solved frames per second over the whole window, face loss included (effectiveFps) — the rate
   * st-r1 judged. Kept, unchanged, so older and newer sittings can be compared; st-r2 judges samplingFps.
   */
  fps: number | null;
  /** The frame-rate gate's rate (fps-g2): samples per second while the face was seen. What st-r2 judges. */
  samplingFps?: number | null;
  tier?: FpsTier | null;
  verdict?: SelfTestVerdict;
  facePresence: number | null;
  pass: boolean;
  /** Plain-language reasons, empty on a pass. */
  reasons: string[];
  /** Plain-language notes that do not fail the test (a reduced frame rate, and which stage holds it). */
  notes?: string[];
  /** For each flash, ms from the flash to the blink matched to it (negative = before); null when none. */
  cueLags?: Array<number | null>;
  /**
   * st-r3: for each flash with no blink after it, the lag of a blink that began in the 1.2 s BEFORE it
   * and that no flash took (negative ms) — the participant blinked too early; null otherwise. Absent
   * under earlier rules, which counted such a blink.
   */
  earlyLags?: Array<number | null>;
  /** Which attempt this was in this run of the check (1 = first); set by the screen. */
  attempt?: number;
  /** The attempts before it in the same run of the check, oldest first; set by the screen. */
  earlier?: SelfTestAttemptSummary[];
  /** The ground the test was shown on. */
  ground?: string;
  /** What the camera and the tracker did during the test; null where it was not measured. */
  pipeline: PipelineWindowFields | null;
  /**
   * Which stage held the rate below the floor it missed (pipelineStats.ts pipelineLimit): the reduced
   * floor (15) on a fail, the adequate floor (20) on a reduced pass; null at tier A. Under st-r1 it was
   * the stage that held the face-solved rate below 25.
   */
  limit: PipelineLimit;
}

/** One earlier attempt in the same run of the check, as the result screen lists it and the record keeps it. */
export interface SelfTestAttemptSummary {
  verdict: SelfTestVerdict;
  cued: number;
  detected: number;
  samplingFps: number | null;
  facePresence: number | null;
}

/** The summary of a result kept when the operator tries again. */
export const attemptSummary = (r: SelfTestResult): SelfTestAttemptSummary => ({
  verdict: r.verdict ?? (r.pass ? 'working' : 'failed'),
  cued: r.cued,
  detected: r.detected,
  samplingFps: r.samplingFps ?? null,
  facePresence: r.facePresence,
});

const n0 = (x: number | null | undefined) => (x == null ? '—' : String(Math.round(x)));

/**
 * Why the frame rate was low, in words an operator can act on.
 *
 * The test said "close other apps and check the light" whatever the cause, and on the study tablet it
 * failed on frame rate every time with nobody able to say which of the two, if either, would help. The
 * camera and the tracker are now counted separately (pipelineStats.ts), so the reason names the stage
 * that was short, with its numbers, and the advice that fits it.
 *
 * THE TRACKER ADVICE IS NOT "SWITCH TRACKERS NOW". This screen runs inside a participant's sitting,
 * and a participant measured on two trackers is flagged in the data (the backends are not the same
 * instrument; trackerChoice.ts). So comparing the trackers again is advice for the bench, when the
 * check fails this way with every participant — the rule the operator manual gives — and it is not
 * offered at all when the tracker is frozen for the study (`trackerFrozen`, CONFIG.TRACKER_BACKEND):
 * the camera-setup screen then has no such button.
 */
export function fpsReason(
  faceFps: number | null,
  p: PipelineWindowFields | null,
  limit: PipelineLimit,
  trackerFrozen: boolean = CONFIG.TRACKER_BACKEND !== 'auto',
  floor: number = SELF_TEST.MIN_FPS,
): string {
  const size = p?.camera_setting_width && p?.camera_setting_height ? ` at ${p.camera_setting_width}×${p.camera_setting_height}` : '';
  const face = `${faceFps == null ? 'no measurable' : Math.round(faceFps)} face frames per second, below ${floor}`;
  switch (limit) {
    case 'camera':
      return `${face}: the CAMERA delivered only ${n0(p?.camera_fps_delivered)} frames per second${size}, and the tracker kept up with them `
        + `(${n0(p?.tracker_fps)} processed) — the camera is the limit. `
        + 'Give the face more light (tablet cameras slow down in dim light), keep bright light behind the participant out of the picture, '
        + 'and close any other app that may be using the camera';
    case 'camera_and_tracker':
      // Both short: more light alone cannot lift a rate the processor caps lower still (round 77).
      return `${face}: the camera delivered only ${n0(p?.camera_fps_delivered)} frames per second${size}, and the TRACKER processed only `
        + `${n0(p?.tracker_fps)} of them, taking about ${n0(p?.process_ms_p50)} ms a frame (slowest 5%: ${n0(p?.process_ms_p95)} ms) — `
        + 'BOTH the camera and the tablet\'s processor are short, and fixing the light alone will not be enough. '
        + 'Close other apps, plug in the charger and turn off battery saver, let a hot tablet cool down, and give the face more light'
        + (trackerFrozen
          ? ''
          : '. If it fails this way with every participant, compare the trackers again at the bench '
            + '(camera setup, "Measure trackers again") — not between one participant\'s sittings');
    case 'tracker':
      return `${face}: the camera delivered ${n0(p?.camera_fps_delivered)} frames per second but the TRACKER processed only ${n0(p?.tracker_fps)}, `
        + `taking about ${n0(p?.process_ms_p50)} ms a frame (slowest 5%: ${n0(p?.process_ms_p95)} ms) — the tablet's processor is the limit, not the camera. `
        + 'Close other apps, plug in the charger and turn off battery saver, and let a hot tablet cool down'
        + (trackerFrozen
          ? ''
          : '. If it fails this way with every participant, compare the trackers again at the bench '
            + '(camera setup, "Measure trackers again") — not between one participant\'s sittings');
    case 'face':
      return `${face}: the tracker processed ${n0(p?.tracker_fps)} frames per second but found the face in only some of them — `
        + 'check seating, distance, the light on the face, glare on spectacles, and that nothing covers the face';
    case 'undetermined':
      return `${face}; this browser did not report how many frames the camera delivered, so camera and processor cannot be told apart — `
        + 'try more light on the face first, then close other apps and plug in the charger';
    default:
      return `the camera ran at ${faceFps == null ? 'no measurable' : Math.round(faceFps)} frames per second, below ${floor} — close other apps and check the light`;
  }
}

/**
 * Which stage holds a REDUCED rate, in one phrase. A reduced rate passes, so it gets the stage and the
 * first thing to try, not the full advice a fail gets (fpsReason): the numbers are on the line above it.
 */
export function limitShort(limit: PipelineLimit, p: PipelineWindowFields | null): string | null {
  switch (limit) {
    case 'camera':
      return `the camera delivered only ${n0(p?.camera_fps_delivered)} frames a second — more light on the face`;
    case 'camera_and_tracker':
      return `the camera delivered ${n0(p?.camera_fps_delivered)} frames a second and the tracker processed ${n0(p?.tracker_fps)} — more light on the face, and close other apps and charge the tablet`;
    case 'tracker':
      return `the tracker processed only ${n0(p?.tracker_fps)} of the camera's ${n0(p?.camera_fps_delivered)} frames a second — close other apps, charge the tablet, let it cool`;
    case 'face':
      return 'the face was found in too few of the frames — seating, the light on the face, glare on spectacles';
    case 'undetermined':
      return 'this browser does not say whether the camera or the processor is short — try more light on the face first';
    default:
      return null;
  }
}

/**
 * Which blink each flash took — the matching the test is scored on. The flashes are taken in the order
 * they were shown; each takes the blink whose onset is nearest to it inside its window (cueWindow: from
 * st-r3 the 1.2 s after it; under st-r1 and st-r2 the 1.2 s either side), among the blinks no earlier
 * flash took (an exact tie goes to the earlier blink). So a flash counts ONE blink at most, and a second
 * blink near the same flash is an extra even when it is inside the window. Every blink no flash took is
 * an extra. Returns, for each cue in order, the index into `blinkOnsets` of its blink, or -1.
 *
 * At the real timing (a flash every CUE_EVERY_MS, 3 s, against a window of 1.2 s) a blink is within the
 * window of one flash at most, so this is simply: for each flash, the nearest blink in its window. The
 * order matters only when two flashes come closer than the window: the collapsed timings of the test
 * harness, or a screen that stalled and delayed a flash (a late frame delays a flash, never skips it).
 *
 * One function for the score and for the export (07b_blink_events.csv cue_matched, re-run under the rule
 * the sitting was scored with), so the file marks exactly the blinks that made selftest_detected.
 */
export function matchCues(cueTimes: number[], blinkOnsets: number[], rule: string = SELF_TEST_RULE): number[] {
  const w = cueWindow(rule);
  const used = new Set<number>();
  return cueTimes.map((c) => {
    let best = -1;
    let bestD = Infinity;
    blinkOnsets.forEach((b, i) => {
      const lag = b - c;
      const d = Math.abs(lag);
      if (!used.has(i) && lag >= -w.before && lag <= w.after && d < bestD) { best = i; bestD = d; }
    });
    if (best >= 0) used.add(best);
    return best;
  });
}

/**
 * Score one attempt (rule st-r3 by default; `rule` 'st-r2' re-scores an attempt exactly as st-r2 did).
 * Each cue takes at most one blink (matchCues). Passes with at least MIN_HIT_SHARE of the cues seen,
 * the face in view MIN_FACE of the time, and the eye sampled at fps-g2 tier B or better (`samplingFps`,
 * frameRateGate.ts). Tier B passes as "reduced", with a note naming the stage that holds the rate;
 * tier C, or no rate, fails.
 */
export function scoreSelfTest(
  cueTimes: number[],
  blinkOnsets: number[],
  coverage: { fps: number | null; samplingFps: number | null; facePresence: number | null; pipeline?: PipelineWindowFields | null },
  rule: string = SELF_TEST_RULE,
): SelfTestResult {
  const matched = matchCues(cueTimes, blinkOnsets, rule);
  const cueLags = matched.map((i, k) => (i >= 0 ? Math.round(blinkOnsets[i] - cueTimes[k]) : null));
  const detected = matched.filter((i) => i >= 0).length;
  /*
   * st-r3 counts only blinks after a flash. A flash missed because the blink came just BEFORE it (the
   * participant anticipated the steady rhythm) is named as such, so the operator can say "wait for the
   * flash" rather than look for a camera fault. Only blinks no flash took are offered.
   */
  const taken = new Set(matched.filter((i) => i >= 0));
  const earlyLags = cueWindow(rule).before === 0
    ? matched.map((i, k) => {
      if (i >= 0) return null;
      let lag: number | null = null;
      blinkOnsets.forEach((b, j) => {
        const l = b - cueTimes[k];
        if (!taken.has(j) && l < 0 && l >= -SELF_TEST.WINDOW_MS && (lag == null || l > lag)) lag = l;
      });
      return lag == null ? null : Math.round(lag);
    })
    : undefined;
  const extra = blinkOnsets.length - detected;
  const reasons: string[] = [];
  const notes: string[] = [];
  if (coverage.facePresence == null || coverage.facePresence < SELF_TEST.MIN_FACE) {
    reasons.push(`the face was in view only ${coverage.facePresence == null ? 'no' : Math.round(coverage.facePresence * 100) + '%'} of the time (needs ${Math.round(SELF_TEST.MIN_FACE * 100)}%) — check seating, distance and that nothing covers the camera`);
  }
  const pipeline = coverage.pipeline ?? null;
  const rate = coverage.samplingFps;
  const tier = fpsTier(rate);
  /*
   * Which stage holds the rate under the floor it MISSED: the reduced floor on a fail, the adequate
   * floor on a reduced pass. One floor for both would misname the stage — a test failing at 12 face
   * frames a second with the camera at 18 is short of 15 because the face was found in too few frames,
   * not because of the camera, though 18 is short of 20.
   */
  const missed = tier == null || tier === 'C' ? SELF_TEST.MIN_FPS : tier === 'B' ? FPS_GATE.ADEQUATE : null;
  const limit: PipelineLimit = pipeline && missed != null
    ? pipelineLimit({
      cameraFps: pipeline.camera_fps_delivered ?? null,
      trackerFps: pipeline.tracker_fps ?? null,
      faceFps: rate,
      deliveredSource: pipeline.frame_count_source ?? null,
    }, missed)
    : null;
  if (tier == null || tier === 'C') {
    reasons.push(fpsReason(rate, pipeline, limit));
  } else if (tier === 'B') {
    notes.push(`Reduced frame rate: the eye was sampled ${Math.round(rate!)} times a second (${FPS_GATE.ADEQUATE} or more is adequate). `
      + 'The check passes and blinks are measured; a reading at this rate is kept and flagged "reduced".');
    const why = limitShort(limit, pipeline);
    if (why) notes.push(`Why: ${why}.`);
  }
  const need = minHits(cueTimes.length);
  if (detected < need) {
    const early = (earlyLags ?? []).filter((x) => x != null).length;
    reasons.push(early > 0
      ? `only ${detected} of ${cueTimes.length} blinks came after a flash (needs ${need}); ${early === 1 ? 'one blink' : `${early} blinks`} came just before a flash instead — ask the participant to wait for each flash, then blink`
      : `only ${detected} of ${cueTimes.length} blinks were seen (needs ${need}) — check lighting on the face and that the eyes are not in shadow or glare`);
  }
  const pass = reasons.length === 0;
  return {
    rule,
    cued: cueTimes.length, detected, extra, fps: coverage.fps, samplingFps: rate, tier,
    verdict: !pass ? 'failed' : tier === 'B' ? 'reduced' : 'working',
    facePresence: coverage.facePresence,
    pass, reasons, notes, cueLags, ...(earlyLags ? { earlyLags } : {}), ground: SELF_TEST.GROUND, pipeline, limit,
  };
}
