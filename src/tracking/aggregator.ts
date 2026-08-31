/**
 * Per-condition frame aggregator. Ingests per-frame tracking samples during a task and produces a
 * single EyeMetricsRecord on finalize. Computes the defensible primary metrics (full-blink rate,
 * incomplete-blink ratio, within-task bins) and keeps the sub-Nyquist tiers as flagged diagnostics.
 */
import { mean, stdPopulation } from '@/lib/stats';
import {
  classifyBlinks,
  summariseBlinks,
  blinkRatePerMinute,
  effectiveFps,
  fpsAdequateForTiers,
  fpsAdequateForRatio,
  observedDurationMs,
  computeClosureMetrics,
  interBlinkInterval,
  type EarSample,
  type BlinkEvent,
} from './blink';
import type { HeadPose } from './headPose';
import type { GazeZone } from './gaze';
import { classifyLighting } from './lighting';
import type { EyeMetricsRecord } from '@/storage/types';

export interface FrameSample {
  t_ms: number;
  ear: number;
  pose: HeadPose;
  zone: GazeZone;
  isCenter: boolean;
  offAxis: boolean;
  facePresent: boolean;
  faceSize: number;
  /** Mean frame luminance (0-255), null when not sampled this frame. */
  luma: number | null;
}

/** Simple centered-ish moving average to damp single-frame head-pose noise. */
function smooth(xs: number[], window = 5): number[] {
  if (xs.length === 0) return xs;
  const half = Math.floor(window / 2);
  return xs.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(xs.length - 1, i + half);
    const win = xs.slice(lo, hi + 1);
    // A smoothing window can be empty only if the caller passed a degenerate range; return the
    // original sample rather than NaN so one bad index cannot blank the whole smoothed series.
    return win.length ? mean(win) : xs[i];
  });
}

export class EyeMetricsAggregator {
  private ear: EarSample[] = [];
  private pitch: number[] = [];
  private yaw: number[] = [];
  private roll: number[] = [];
  private zones: GazeZone[] = [];
  private centerCount = 0;
  private offAxisCount = 0;
  private faceSizes: number[] = [];
  private framesTotal = 0;
  private facesDetected = 0;
  private frameTimes: number[] = [];
  private lumas: number[] = [];

  ingest(f: FrameSample): void {
    this.framesTotal++;
    if (Number.isFinite(f.t_ms)) this.frameTimes.push(f.t_ms);
    if (f.luma != null && Number.isFinite(f.luma)) this.lumas.push(f.luma);
    if (!f.facePresent) return;
    this.facesDetected++;
    // Every numeric channel is filtered on the way in, not on the way out.
    //
    // luma was already guarded here; pose and face size were not, which was an inconsistency
    // rather than a decision. MediaPipe emits NaN for any of them when a frame is only partially
    // solved, and a NaN pose survived smoothing (a window of NaNs averages to NaN) to produce a
    // NaN head_pitch_mean, head_yaw_mean, head_roll_mean and postural_load for the whole
    // condition. Dropping the bad sample costs one frame; keeping it cost the entire summary.
    // BOTH fields, not just the EAR. A sample with a good EAR and a NaN timestamp cannot be placed
    // in the series: it has no position for the within-condition bins, no interval for the gap
    // detector, and it poisons the frame-rate estimate that now derives from these timestamps.
    if (Number.isFinite(f.ear) && Number.isFinite(f.t_ms)) this.ear.push({ t_ms: f.t_ms, ear: f.ear });
    if (Number.isFinite(f.pose.pitch)) this.pitch.push(f.pose.pitch);
    if (Number.isFinite(f.pose.yaw)) this.yaw.push(f.pose.yaw);
    if (Number.isFinite(f.pose.roll)) this.roll.push(f.pose.roll);
    this.zones.push(f.zone);
    if (f.isCenter) this.centerCount++;
    if (f.offAxis) this.offAxisCount++;
    if (Number.isFinite(f.faceSize)) this.faceSizes.push(f.faceSize);
  }

  private zoneTransitions(): number {
    let t = 0;
    for (let i = 1; i < this.zones.length; i++) if (this.zones[i] !== this.zones[i - 1]) t++;
    return t;
  }

  /**
   * Blink rate in the first and second halves of the exposure.
   *
   * `originMs` is the timestamp of the FIRST sample in the condition, and it is required, not
   * optional. A blink's `onset_ms` is copied from `EarSample.t_ms`, which is `performance.now()` —
   * milliseconds since the PAGE LOADED, not since the condition started. `durationMs` is a span.
   * Comparing the two directly is comparing an absolute clock to a relative one.
   *
   * The consequence was total and silent. By the first reading exposure — after consent, profile,
   * Ishihara, camera setup, a nine-point calibration and two baseline questionnaires —
   * performance.now() is already several hundred thousand milliseconds, while `mid` is about
   * 90,000. So `onset_ms < mid` was false for every blink in every condition of every real run:
   * first_half_blink_rate was exactly 0 and second_half_blink_rate was exactly double the true
   * rate. The codebook sells the pair as evidence of within-condition drift, so the thesis would
   * have reported a 100% within-condition rise in blink rate from a floor of zero, in 100% of
   * rows, entirely an artefact of the clock origin.
   *
   * Every fixture and unit test started its clock at 0, which is why nothing caught it.
   */
  private binnedBlinkRates(events: BlinkEvent[], durationMs: number, originMs: number) {
    if (durationMs <= 0) return { first_half_blink_rate: null, second_half_blink_rate: null };
    const mid = durationMs / 2;
    const rel = (e: BlinkEvent) => e.onset_ms - originMs;
    const first = events.filter((e) => rel(e) < mid).length;
    const second = events.filter((e) => rel(e) >= mid).length;
    return {
      first_half_blink_rate: blinkRatePerMinute(first, mid),
      second_half_blink_rate: blinkRatePerMinute(second, durationMs - mid),
    };
  }

  /** Produce the record. `baselineEarValue` comes from calibration. */
  finalize(args: {
    conditionId: string;
    sessionId: string;
    cameraActive: boolean;
    baselineEarValue: number | null;
    earThresholdUsed: number | null;
    gazeCalibrated: boolean;
    /** True when head pitch was measured against the participant's calibrated frontal baseline. */
    headPitchCalibrated: boolean;
  }): EyeMetricsRecord {
    /**
     * Two different durations, because they answer two different questions.
     *
     * `spanMs` is wall-clock first-to-last, and is what the within-condition halves are split on:
     * the bins are about WHEN in the exposure a blink happened.
     *
     * `observedMs` excludes every dropout, and is the denominator for every RATE. Charging
     * unobserved time to a rate made a tracking failure look exactly like the effect under study —
     * a face present for half the exposure halved the apparent blink rate, and a reduced blink rate
     * is this protocol's own marker of visual fatigue.
     */
    const spanMs =
      this.ear.length > 0 ? this.ear[this.ear.length - 1].t_ms - this.ear[0].t_ms : 0;
    const observedMs = observedDurationMs(this.ear);
    const durationMs = observedMs;
    // No fabricated fallback. A null baseline means calibration did not produce one, and
    // substituting a population-typical 0.3 produced blink metrics indistinguishable from a
    // properly calibrated run. classifyBlinks() returns no events for a null baseline, and
    // summariseBlinks() then reports a null ratio rather than a clean-looking zero.
    const baseline = args.baselineEarValue;
    const events = classifyBlinks(this.ear, baseline);
    const blink = summariseBlinks(events, durationMs);
    /**
     * Measured on the EAR SERIES, not on the frame loop.
     *
     * effectiveFps(this.frameTimes) counted every frame the pipeline processed, including those in
     * which no face was found and no EAR sample was produced. So a condition where the face was
     * detected in half the frames still reported ~30 fps and satisfied the primary outcome's
     * frame-rate gate, while the measurement series behind the ratio was actually sampled at ~15.
     * The gate has to describe the series it is gating.
     */
    const fps = effectiveFps(this.ear.map((s) => s.t_ms));
    // The origin of the condition's own clock, not zero: see binnedBlinkRates.
    const originMs = this.ear.length ? this.ear[0].t_ms : 0;
    const bins = this.binnedBlinkRates(events, spanMs, originMs);
    const closure = computeClosureMetrics(this.ear, baseline, events);
    const ibi = interBlinkInterval(events);

    const sPitch = smooth(this.pitch);
    const sYaw = smooth(this.yaw);
    const sRoll = smooth(this.roll);
    const movementStd =
      (stdPopulation(sPitch) + stdPopulation(sYaw) + stdPopulation(sRoll)) / 3;
    // A condition with no captured frames leaves every pose array empty. mean([]) is NaN, and the
    // three NaNs used to average into a NaN postural_load that then serialised into the CSV.
    const absMean = (xs: number[]) => (xs.length ? mean(xs.map(Math.abs)) : 0);
    const posturalLoad = (absMean(sPitch) + absMean(sYaw) + absMean(sRoll)) / 3;

    return {
      condition_id: args.conditionId,
      session_id: args.sessionId,
      camera_active: args.cameraActive,
      effective_fps: fps,
      fps_adequate_for_tiers: fpsAdequateForTiers(fps),
      fps_adequate_for_ratio: fpsAdequateForRatio(fps),

      blink_rate: blink.blink_rate,
      blink_rate_full: blink.blink_rate_full,
      incomplete_blink_ratio: blink.incomplete_blink_ratio,
      blink_duration_mean_ms: blink.blink_duration_mean_ms,
      bins,
      mean_inter_blink_interval_ms: ibi.mean_inter_blink_interval_ms,
      inter_blink_interval_cv: ibi.inter_blink_interval_cv,
      perclos_p80: closure.perclos_p80,
      perclos_p70: closure.perclos_p70,
      long_closure_count: closure.long_closure_count,
      long_closure_total_ms: closure.long_closure_total_ms,

      blink_rate_micro: blink.blink_rate_micro,
      blink_count_full: blink.blink_count_full,
      blink_count_micro: blink.blink_count_micro,
      blink_count_incomplete: blink.blink_count_incomplete,

      ear_baseline: args.baselineEarValue,
      ear_threshold_used: args.earThresholdUsed,

      /**
       * Null, not zero, when the face was never found.
       *
       * A condition in which the camera ran but no face was ever detected used to report
       * head_pitch_mean 0, head_movement_std 0 and — worst — head_stability_score exactly 1.0: the
       * best possible score, meaning a perfectly still participant, produced by observing nobody.
       * camera_active was true and face_presence_ratio was 0, so the row looked like a real
       * measurement to anything that did not additionally check the presence ratio.
       */
      head_pitch_mean: this.pitch.length ? mean(sPitch) : null,
      head_pitch_calibrated: args.headPitchCalibrated,
      head_yaw_mean: this.yaw.length ? mean(sYaw) : null,
      head_roll_mean: this.roll.length ? mean(sRoll) : null,
      head_movement_std: this.pitch.length ? movementStd : null,
      postural_load: this.pitch.length ? posturalLoad : null,
      head_stability_score: this.pitch.length ? 1 / (1 + movementStd) : null,
      off_axis_ratio: this.facesDetected > 0 ? this.offAxisCount / this.facesDetected : null,

      gaze_calibrated: args.gazeCalibrated,
      gaze_deviation_ratio:
        this.facesDetected > 0 ? 1 - this.centerCount / this.facesDetected : 0,
      zone_center_ratio: this.facesDetected > 0 ? this.centerCount / this.facesDetected : 0,
      zone_transition_count: this.zoneTransitions(),

      face_presence_ratio: this.framesTotal > 0 ? this.facesDetected / this.framesTotal : 0,
      face_size_ratio: this.faceSizes.length ? mean(this.faceSizes) : 0,

      mean_face_luma: this.lumas.length ? mean(this.lumas) : null,
      lighting_quality: this.lumas.length ? classifyLighting(mean(this.lumas)) : null,
    };
  }
}

/** Zeroed metrics for when the camera is denied/failed (matches the original disabledMetrics). */
/**
 * The row written for a condition in which the camera was not running.
 *
 * Every count and rate here is NULL, not 0. This module's own contract, stated in blink.ts and
 * enforced by tests/noFabrication.test.ts, is that a function given input carrying no information
 * reports absence and never a plausible number — and a zero incomplete-blink ratio is the most
 * plausible number there is. It reads as "this participant blinked perfectly in this condition",
 * the cleanest possible result, manufactured from nothing. Ten of them, for a participant who
 * declined the camera or whose session was resumed without it, pull every condition mean toward
 * zero in an analysis that filters on nothing but the outcome column.
 *
 * camera_active=false is not a sufficient guard on its own: it puts the burden on every downstream
 * consumer to remember to filter, and the app's own dashboard did not.
 */
export function disabledEyeMetrics(conditionId: string, sessionId: string): EyeMetricsRecord {
  return {
    condition_id: conditionId,
    session_id: sessionId,
    camera_active: false,
    effective_fps: null,
    fps_adequate_for_tiers: false,
    fps_adequate_for_ratio: false,
    blink_rate: null,
    blink_rate_full: null,
    incomplete_blink_ratio: null,
    blink_duration_mean_ms: null,
    bins: { first_half_blink_rate: null, second_half_blink_rate: null },
    mean_inter_blink_interval_ms: null,
    inter_blink_interval_cv: null,
    perclos_p80: null,
    perclos_p70: null,
    long_closure_count: null,
    long_closure_total_ms: null,
    blink_rate_micro: null,
    blink_count_full: null,
    blink_count_micro: null,
    blink_count_incomplete: null,
    ear_baseline: null,
    ear_threshold_used: null,
    head_pitch_mean: null,
    head_pitch_calibrated: false,
    head_yaw_mean: null,
    head_roll_mean: null,
    head_movement_std: null,
    postural_load: null,
    head_stability_score: null,
    off_axis_ratio: null,
    gaze_calibrated: false,
    gaze_deviation_ratio: 0,
    zone_center_ratio: 0,
    zone_transition_count: 0,
    face_presence_ratio: 0,
    face_size_ratio: 0,
    mean_face_luma: null,
    lighting_quality: null,
  };
}
