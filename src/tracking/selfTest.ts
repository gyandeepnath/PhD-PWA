/**
 * The camera self-test: does the camera actually see this participant's blinks? — answered before the
 * first condition, in plain words, while something can still be done about it.
 *
 * WHY. The investigator asked how to know the blink measurement works. Nothing answered that until the
 * export was opened, after the participant had gone. Now, right after calibration, the participant blinks
 * once each time a dot flashes; blinks the tracker found near a cue are hits, the rest extras. With the
 * frame rate and how much of the time a face was in view, that is a verdict an operator can act on:
 * reseat the participant, fix the light, or accept and continue — and the result is exported with the
 * sitting (selftest_* in 01_session_info.csv) either way.
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
 * The pass rule's version. 'st-r2' from Round 79; sittings before it were scored under 'st-r1'.
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
export const SELF_TEST_RULE = 'st-r2';
/** The rule on sittings recorded before Round 79 (no `rule` on the record). */
export const SELF_TEST_RULE_V1 = 'st-r1';

export const SELF_TEST = {
  CUES: 5,
  /** First cue after this, then one every CUE_EVERY_MS. */
  FIRST_CUE_MS: 2500,
  CUE_EVERY_MS: 3000,
  /** A blink whose onset is within this of a cue (either side) counts for that cue. */
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
 * Score one attempt (rule st-r2). Each cue takes at most one blink, the nearest whose onset is within
 * WINDOW_MS of it. Passes with at least MIN_HIT_SHARE of the cues seen, the face in view MIN_FACE of the
 * time, and the eye sampled at fps-g2 tier B or better (`samplingFps`, frameRateGate.ts). Tier B passes
 * as "reduced", with a note naming the stage that holds the rate; tier C, or no rate, fails.
 */
export function scoreSelfTest(
  cueTimes: number[],
  blinkOnsets: number[],
  coverage: { fps: number | null; samplingFps: number | null; facePresence: number | null; pipeline?: PipelineWindowFields | null },
): SelfTestResult {
  const used = new Set<number>();
  const cueLags: Array<number | null> = [];
  for (const c of cueTimes) {
    let best = -1;
    let bestD = Infinity;
    blinkOnsets.forEach((b, i) => {
      const d = Math.abs(b - c);
      if (!used.has(i) && d <= SELF_TEST.WINDOW_MS && d < bestD) { best = i; bestD = d; }
    });
    if (best >= 0) used.add(best);
    cueLags.push(best >= 0 ? Math.round(blinkOnsets[best] - c) : null);
  }
  const detected = used.size;
  const extra = blinkOnsets.length - used.size;
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
      + 'The check passes and blinks are measured; a reading at this rate is kept and flagged "reduced".'
      + (limit ? ` Why: ${fpsReason(rate, pipeline, limit, undefined, FPS_GATE.ADEQUATE)}.` : ''));
  }
  const need = minHits(cueTimes.length);
  if (detected < need) {
    reasons.push(`only ${detected} of ${cueTimes.length} blinks were seen (needs ${need}) — check lighting on the face and that the eyes are not in shadow or glare`);
  }
  const pass = reasons.length === 0;
  return {
    rule: SELF_TEST_RULE,
    cued: cueTimes.length, detected, extra, fps: coverage.fps, samplingFps: rate, tier,
    verdict: !pass ? 'failed' : tier === 'B' ? 'reduced' : 'working',
    facePresence: coverage.facePresence,
    pass, reasons, notes, cueLags, ground: SELF_TEST.GROUND, pipeline, limit,
  };
}
