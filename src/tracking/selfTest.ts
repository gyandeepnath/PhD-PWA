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
}

/** Match blink onsets to cues: each cue takes at most one blink, the nearest within the window. */
export function scoreSelfTest(
  cueTimes: number[],
  blinkOnsets: number[],
  coverage: { fps: number | null; facePresence: number | null },
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
  if (coverage.fps == null || coverage.fps < SELF_TEST.MIN_FPS) {
    reasons.push(`the camera ran at ${coverage.fps == null ? 'no measurable' : Math.round(coverage.fps)} frames per second, below ${SELF_TEST.MIN_FPS} — close other apps and check the light`);
  }
  if (detected < SELF_TEST.MIN_HITS) {
    reasons.push(`only ${detected} of ${cueTimes.length} blinks were seen — check lighting on the face and that the eyes are not in shadow or glare`);
  }
  return { cued: cueTimes.length, detected, extra, fps: coverage.fps, facePresence: coverage.facePresence, pass: reasons.length === 0, reasons };
}
