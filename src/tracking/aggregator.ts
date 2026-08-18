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
    if (Number.isFinite(f.ear)) this.ear.push({ t_ms: f.t_ms, ear: f.ear });
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

  private binnedBlinkRates(events: BlinkEvent[], durationMs: number) {
    if (durationMs <= 0) return { first_half_blink_rate: null, second_half_blink_rate: null };
    const mid = durationMs / 2;
    const first = events.filter((e) => e.onset_ms < mid).length;
    const second = events.filter((e) => e.onset_ms >= mid).length;
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
    const durationMs =
      this.ear.length > 0 ? this.ear[this.ear.length - 1].t_ms - this.ear[0].t_ms : 0;
    // No fabricated fallback. A null baseline means calibration did not produce one, and
    // substituting a population-typical 0.3 produced blink metrics indistinguishable from a
    // properly calibrated run. classifyBlinks() returns no events for a null baseline, and
    // summariseBlinks() then reports a null ratio rather than a clean-looking zero.
    const baseline = args.baselineEarValue;
    const events = classifyBlinks(this.ear, baseline);
    const blink = summariseBlinks(events, durationMs);
    const fps = effectiveFps(this.frameTimes);
    const bins = this.binnedBlinkRates(events, durationMs);
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

      head_pitch_mean: this.pitch.length ? mean(sPitch) : 0,
      head_pitch_calibrated: args.headPitchCalibrated,
      head_yaw_mean: this.yaw.length ? mean(sYaw) : 0,
      head_roll_mean: this.roll.length ? mean(sRoll) : 0,
      head_movement_std: movementStd,
      postural_load: posturalLoad,
      head_stability_score: 1 / (1 + movementStd),
      off_axis_ratio: this.facesDetected > 0 ? this.offAxisCount / this.facesDetected : 0,

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
export function disabledEyeMetrics(conditionId: string, sessionId: string): EyeMetricsRecord {
  return {
    condition_id: conditionId,
    session_id: sessionId,
    camera_active: false,
    effective_fps: null,
    fps_adequate_for_tiers: false,
    blink_rate: 0,
    blink_rate_full: 0,
    incomplete_blink_ratio: 0,
    blink_duration_mean_ms: null,
    bins: { first_half_blink_rate: null, second_half_blink_rate: null },
    mean_inter_blink_interval_ms: null,
    inter_blink_interval_cv: null,
    perclos_p80: null,
    perclos_p70: null,
    long_closure_count: 0,
    long_closure_total_ms: 0,
    blink_rate_micro: 0,
    blink_count_full: 0,
    blink_count_micro: 0,
    blink_count_incomplete: 0,
    ear_baseline: null,
    ear_threshold_used: null,
    head_pitch_mean: 0,
    head_pitch_calibrated: false,
    head_yaw_mean: 0,
    head_roll_mean: 0,
    head_movement_std: 0,
    postural_load: 0,
    head_stability_score: 0,
    off_axis_ratio: 0,
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
