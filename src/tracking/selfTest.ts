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
 */
import { pipelineLimit, type PipelineLimit } from './pipelineStats';
import type { PipelineWindowFields } from '@/storage/types';

export const SELF_TEST = {
  CUES: 5,
  /** First cue after this, then one every CUE_EVERY_MS. */
  FIRST_CUE_MS: 2500,
  CUE_EVERY_MS: 3000,
  /** A blink whose onset is within this of a cue (either side) counts for that cue. */
  WINDOW_MS: 1200,
  /** Pass: at least this many of the cued blinks seen … */
  MIN_HITS: 4,
  /** … at a face-solved frame rate at least this (the tier gate used for blink rate) … */
  MIN_FPS: 25,
  /** … with a face in view at least this share of the time. */
  MIN_FACE: 0.9,
} as const;

export interface SelfTestResult {
  cued: number;
  detected: number;
  extra: number;
  fps: number | null;
  facePresence: number | null;
  pass: boolean;
  /** Plain-language reasons, empty on a pass. */
  reasons: string[];
  /** What the camera and the tracker did during the test; null where it was not measured. */
  pipeline: PipelineWindowFields | null;
  /** Which stage held the face-solved rate below MIN_FPS (pipelineStats.ts pipelineLimit). */
  limit: PipelineLimit;
}

const n0 = (x: number | null | undefined) => (x == null ? '—' : String(Math.round(x)));

/**
 * Why the frame rate was low, in words an operator can act on.
 *
 * The test said "close other apps and check the light" whatever the cause, and on the study tablet it
 * failed on frame rate every time with nobody able to say which of the two, if either, would help. The
 * camera and the tracker are now counted separately (pipelineStats.ts), so the reason names the stage
 * that was short, with its numbers, and the advice that fits it.
 */
export function fpsReason(
  faceFps: number | null,
  p: PipelineWindowFields | null,
  limit: PipelineLimit,
): string {
  const size = p?.camera_setting_width && p?.camera_setting_height ? ` at ${p.camera_setting_width}×${p.camera_setting_height}` : '';
  const face = `${faceFps == null ? 'no measurable' : Math.round(faceFps)} face frames per second, below ${SELF_TEST.MIN_FPS}`;
  switch (limit) {
    case 'camera':
      return `${face}: the CAMERA delivered only ${n0(p?.camera_fps_delivered)} frames per second${size} — the camera is the limit, not the processor. `
        + 'Give the face more light (tablet cameras slow down in dim light), keep bright light behind the participant out of the picture, '
        + 'and close any other app that may be using the camera';
    case 'tracker':
      return `${face}: the camera delivered ${n0(p?.camera_fps_delivered)} frames per second but the TRACKER processed only ${n0(p?.tracker_fps)}, `
        + `taking about ${n0(p?.process_ms_p50)} ms a frame (slowest 5%: ${n0(p?.process_ms_p95)} ms) — the tablet's processor is the limit, not the camera. `
        + 'Close other apps, plug in the charger and turn off battery saver, and let a hot tablet cool down; '
        + 'on the camera-setup screen, "Measure trackers" picks the fastest tracker for this tablet';
    case 'face':
      return `${face}: the tracker processed ${n0(p?.tracker_fps)} frames per second but found the face in only some of them — `
        + 'check seating, distance, the light on the face, glare on spectacles, and that nothing covers the face';
    case 'undetermined':
      return `${face}; this browser did not report how many frames the camera delivered, so camera and processor cannot be told apart — `
        + 'try more light on the face first, then close other apps and plug in the charger';
    default:
      return `the camera ran at ${faceFps == null ? 'no measurable' : Math.round(faceFps)} frames per second, below ${SELF_TEST.MIN_FPS} — close other apps and check the light`;
  }
}

/** Match blink onsets to cues: each cue takes at most one blink, the nearest within the window. */
export function scoreSelfTest(
  cueTimes: number[],
  blinkOnsets: number[],
  coverage: { fps: number | null; facePresence: number | null; pipeline?: PipelineWindowFields | null },
): SelfTestResult {
  const used = new Set<number>();
  let detected = 0;
  for (const c of cueTimes) {
    let best = -1;
    let bestD = Infinity;
    blinkOnsets.forEach((b, i) => {
      const d = Math.abs(b - c);
      if (!used.has(i) && d <= SELF_TEST.WINDOW_MS && d < bestD) { best = i; bestD = d; }
    });
    if (best >= 0) { used.add(best); detected++; }
  }
  const extra = blinkOnsets.length - used.size;
  const reasons: string[] = [];
  if (coverage.facePresence == null || coverage.facePresence < SELF_TEST.MIN_FACE) {
    reasons.push(`the face was in view only ${coverage.facePresence == null ? 'no' : Math.round(coverage.facePresence * 100) + '%'} of the time — check seating, distance and that nothing covers the camera`);
  }
  const pipeline = coverage.pipeline ?? null;
  const limit: PipelineLimit = pipeline
    ? pipelineLimit({
      cameraFps: pipeline.camera_fps_delivered ?? null,
      trackerFps: pipeline.tracker_fps ?? null,
      faceFps: coverage.fps,
      deliveredSource: pipeline.frame_count_source ?? null,
    }, SELF_TEST.MIN_FPS)
    : null;
  if (coverage.fps == null || coverage.fps < SELF_TEST.MIN_FPS) {
    reasons.push(fpsReason(coverage.fps, pipeline, limit));
  }
  if (detected < SELF_TEST.MIN_HITS) {
    reasons.push(`only ${detected} of ${cueTimes.length} blinks were seen — check lighting on the face and that the eyes are not in shadow or glare`);
  }
  return {
    cued: cueTimes.length, detected, extra, fps: coverage.fps, facePresence: coverage.facePresence,
    pass: reasons.length === 0, reasons, pipeline, limit,
  };
}
