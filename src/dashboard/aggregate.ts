/**
 * Per-condition aggregation. Joins conditions with RT/fatigue/search/perception/eye/comprehension
 * records into one row per condition (ordered by serial position). Used by both the dashboard
 * charts/tables and the wide-format CSV, so the numbers are guaranteed consistent.
 */
import type { SessionBundle } from '@/storage/gather';

export type QcFlag = 'good' | 'warn' | 'bad';

export interface ConditionSummary {
  condition_id: string;
  condition_label: string;
  session_position: number;
  polarity: 'positive' | 'negative';
  color_name: string;
  passage_id: number | null;
  wcag_contrast_ratio: number;
  wcag_level: string;
  below_wcag_aa: boolean;

  // Reaction time
  mean_rt_hits_ms: number | null;
  hit_rate: number | null;
  false_alarm_rate: number | null;
  d_prime: number | null;
  d_prime_se: number | null;
  d_prime_unstable: boolean;
  flanker_congruency_effect_ms: number | null;

  // Fatigue
  fatigue_mean: number | null;
  fatigue_delta: number | null;
  eye_strain: number | null;
  dryness: number | null;
  blur: number | null;
  burning: number | null;
  headache: number | null;

  // Comprehension
  comprehension_correct: number | null;
  comprehension_rt_ms: number | null;

  // Visual search
  search_time_ms: number | null;
  search_accuracy: number | null;
  search_efficiency: number | null;
  false_detections: number | null;
  targets_found: number | null;
  targets_in_set: number | null;

  // Perception
  comfort_score: number | null;
  clarity_score: number | null;

  // Eye metrics + QC
  camera_active: boolean;
  blink_rate: number | null;
  blink_rate_full: number | null;
  incomplete_blink_ratio: number | null;
  effective_fps: number | null;
  fps_adequate_for_tiers: boolean;
  face_presence_ratio: number | null;
  off_axis_ratio: number | null;
  zone_center_ratio: number | null;
  qc: { facePresence: QcFlag; fps: QcFlag; offAxis: QcFlag; overall: QcFlag };
}

function flag(value: number | null, good: number, warn: number, higherIsBetter = true): QcFlag {
  if (value == null) return 'bad';
  if (higherIsBetter) return value >= good ? 'good' : value >= warn ? 'warn' : 'bad';
  return value <= good ? 'good' : value <= warn ? 'warn' : 'bad';
}

const worst = (flags: QcFlag[]): QcFlag =>
  flags.includes('bad') ? 'bad' : flags.includes('warn') ? 'warn' : 'good';

export function baselineFatigueMean(bundle: SessionBundle): number | null {
  const b = bundle.fatigue.find((f) => f.stage === 'baseline');
  return b ? b.fatigue_mean : null;
}

export function buildConditionSummaries(bundle: SessionBundle): ConditionSummary[] {
  const baseline = baselineFatigueMean(bundle);

  return bundle.conditions.map((c) => {
    const rt = bundle.rtSummaries.find((r) => r.condition_id === c.condition_id);
    const fat = bundle.fatigue.find((f) => f.condition_id === c.condition_id && f.stage === 'post_condition');
    const comp = bundle.comprehension.find((x) => x.condition_id === c.condition_id);
    const vs = bundle.visualSearch.find((v) => v.condition_id === c.condition_id);
    const perc = bundle.perception.find((p) => p.condition_id === c.condition_id);
    const eye = bundle.eyeMetrics.find((e) => e.condition_id === c.condition_id);

    const cameraActive = eye?.camera_active ?? false;
    const facePresence = cameraActive ? (eye?.face_presence_ratio ?? null) : null;
    const fps = cameraActive ? (eye?.effective_fps ?? null) : null;
    const offAxis = cameraActive ? (eye?.off_axis_ratio ?? null) : null;

    const facePresenceFlag: QcFlag = cameraActive ? flag(facePresence, 0.8, 0.5) : 'warn';
    const fpsFlag: QcFlag = cameraActive ? flag(fps, 25, 15) : 'warn';
    const offAxisFlag: QcFlag = cameraActive ? flag(offAxis, 0.2, 0.4, false) : 'warn';

    return {
      condition_id: c.condition_id,
      condition_label: c.condition_label,
      session_position: c.session_position,
      polarity: c.polarity,
      color_name: c.color_name,
      passage_id: c.passage_id,
      wcag_contrast_ratio: c.wcag_contrast_ratio,
      wcag_level: c.wcag_level,
      below_wcag_aa: c.below_wcag_aa,

      mean_rt_hits_ms: rt?.mean_rt_hits_ms ?? null,
      hit_rate: rt?.hit_rate ?? null,
      false_alarm_rate: rt?.false_alarm_rate ?? null,
      d_prime: rt?.d_prime ?? null,
      d_prime_se: rt?.d_prime_se ?? null,
      d_prime_unstable: rt?.d_prime_unstable ?? false,
      flanker_congruency_effect_ms: rt?.flanker_congruency_effect_ms ?? null,

      fatigue_mean: fat?.fatigue_mean ?? null,
      fatigue_delta: fat && baseline != null ? fat.fatigue_mean - baseline : null,
      eye_strain: fat?.eye_strain ?? null,
      dryness: fat?.dryness ?? null,
      blur: fat?.blur ?? null,
      burning: fat?.burning ?? null,
      headache: fat?.headache ?? null,

      comprehension_correct: comp ? (comp.is_correct ? 1 : 0) : null,
      comprehension_rt_ms: comp?.response_time_ms ?? null,

      search_time_ms: vs?.search_time_ms ?? null,
      search_accuracy: vs?.accuracy_rate ?? null,
      search_efficiency: vs?.search_efficiency ?? null,
      false_detections: vs?.false_detections ?? null,
      targets_found: vs?.targets_found ?? null,
      targets_in_set: vs?.targets_in_set ?? null,

      comfort_score: perc?.display_comfort_score ?? null,
      clarity_score: perc?.text_clarity_score ?? null,

      camera_active: cameraActive,
      blink_rate: eye?.blink_rate ?? null,
      blink_rate_full: eye?.blink_rate_full ?? null,
      incomplete_blink_ratio: eye?.incomplete_blink_ratio ?? null,
      effective_fps: fps,
      fps_adequate_for_tiers: eye?.fps_adequate_for_tiers ?? false,
      face_presence_ratio: facePresence,
      off_axis_ratio: offAxis,
      zone_center_ratio: cameraActive ? (eye?.zone_center_ratio ?? null) : null,
      qc: {
        facePresence: facePresenceFlag,
        fps: fpsFlag,
        offAxis: offAxisFlag,
        overall: worst([facePresenceFlag, fpsFlag, offAxisFlag]),
      },
    };
  });
}

/** Mean across non-null values; null when none. */
export function meanOrNull(xs: (number | null)[]): number | null {
  const vals = xs.filter((x): x is number => x != null);
  return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
}
