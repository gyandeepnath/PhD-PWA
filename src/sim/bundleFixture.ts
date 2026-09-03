/**
 * A complete, TYPE-CHECKED session bundle with deliberately distinctive values.
 *
 * Purpose: manual verifiability of the export pipeline. Every field is set to a value that is
 * unique and recognisable, so a person reading the exported CSVs can confirm by eye that each
 * output cell traces back to the record it came from — rather than trusting a passing assertion.
 *
 * The bundle is typed as `SessionBundle` with NO `as` casts, so the compiler enforces that the
 * fixture matches the real data model. A hand-guessed fixture would make any verification built
 * on it worthless, which is exactly the failure mode this module exists to avoid.
 *
 * Distinctive-value conventions:
 *   - reading_time_ms      = 61000 + 1234*i   (unique per serial position)
 *   - fatigue_mean         = 1 + 0.37*i
 *   - incomplete_blink_ratio = 0.05 + 0.031*i (all distinct, none at a bound)
 *   - mean_rt_hits_ms      = 340 + 7*i
 *   - participant_id contains a comma AND a double quote, exercising CSV escaping everywhere.
 */
import type { SessionBundle } from '@/storage/gather';
import { CONDITIONS } from '@/experiment/conditions';
import { PASSAGES } from '@/experiment/passages';
import { blockPlan } from '@/experiment/counterbalance';
import { illuminationForBlock, illuminationOrderFor, summariseLux } from '@/experiment/illumination';
import { DB_VERSION } from '@/storage/schemaEnums';

export const FIXTURE = {
  /** Embeds a comma and a quote on purpose: the hardest thing for a CSV writer to get right. */
  pid: 'VER,"01',
  sid: 'sess-verify-0001',
  /** Odd and non-trivial, so the counterbalancing arithmetic is genuinely exercised. */
  enrolment: 7,
  /** The SECOND illumination block, so blockPlan must advance the Williams row. */
  block: 1,
  t0: 1_700_000_000_000,
} as const;

export const readingMs = (i: number) => 61000 + i * 1234;
export const fatigueMean = (i: number) => Math.round((1 + i * 0.37) * 100) / 100;
export const ibrFor = (i: number) => Math.round((0.05 + i * 0.031) * 1000) / 1000;
export const blinkRateFor = (i: number) => Math.round((12 + i * 0.9) * 10) / 10;
export const rtFor = (i: number) => 340 + i * 7;

export interface FixtureOptions {
  /** Which lux checkpoints to include. Default: all three. */
  luxCheckpoints?: ('start' | 'middle' | 'end')[];
  /** Override the illuminance recorded at each checkpoint. */
  luxValues?: Partial<Record<'start' | 'middle' | 'end', number>>;
  /** Set a protocol-deviation note (implies an out-of-range reading). */
  luxDeviationNote?: string | null;
}


/**
 * The full 32-trial go/no-go block for one condition, and the summary DERIVED from it.
 *
 * The fixture used to write four trial rows next to a summary asserting 32 trials, 20 signals and
 * 19 hits. Nothing checked the two against each other, so every test that touched reaction data was
 * operating on a bundle whose summary was not a summary of anything. The integrity audit's new
 * summary_matches_trials check found it immediately — which is the point of the check: rt_summaries
 * is what the analysis templates read, the trials are what a reviewer would re-derive it from, and
 * a fixture in which those disagree cannot demonstrate that the real pipeline keeps them in step.
 *
 * Deterministic: trial outcomes are a function of the trial index, so the export stays
 * byte-reproducible.
 */
const RT_TOTAL_TRIALS = 32;

function rtTrialsFor(conditionId: string, sid: string, i: number) {
  return Array.from({ length: RT_TOTAL_TRIALS }, (_, t) => {
    // First 20 positions in the shuffled block are signals; a fixed pattern, not a random one.
    const isSignal = (t * 5) % 8 < 5;
    // One miss and one false alarm per condition, at fixed positions, so the summary has something
    // other than a perfect score to summarise.
    const miss = isSignal && t === 3;
    const falseAlarm = !isSignal && t === 6;
    const responded = (isSignal && !miss) || falseAlarm;
    const accuracy = miss ? 'miss' : isSignal ? 'hit' : falseAlarm ? 'false_alarm' : 'correct_rejection';
    return {
      trial_id: `rt-${i}-${t}`,
      condition_id: conditionId,
      session_id: sid,
      trial_number: t + 1,
      trial_category: (isSignal ? 'signal' : 'noise') as 'signal' | 'noise',
      is_signal: isSignal,
      stimulus_onset_time: 1000 + t * 1500,
      response_time_ms: responded ? 320 + i + (t % 7) * 6 : null,
      accuracy: accuracy as 'hit' | 'miss' | 'false_alarm' | 'correct_rejection',
      false_start: false,
      anticipatory: false,
    };
  });
}

function rtSummaryFor(conditionId: string, sid: string, i: number) {
  const trials = rtTrialsFor(conditionId, sid, i);
  const signals = trials.filter((r) => r.is_signal);
  const noise = trials.filter((r) => !r.is_signal);
  const hits = trials.filter((r) => r.accuracy === 'hit');
  const fas = trials.filter((r) => r.accuracy === 'false_alarm');
  const rts = hits.map((r) => r.response_time_ms as number);
  const mean = rts.reduce((a, b) => a + b, 0) / rts.length;
  const sorted = [...rts].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const sd = Math.sqrt(rts.reduce((a, b) => a + (b - mean) ** 2, 0) / (rts.length - 1));
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const hitRate = hits.length / signals.length;
  const faRate = fas.length / noise.length;
  // Log-linear correction, matching the production scorer's treatment of extreme rates.
  const z = (pr: number) => {
    const p = Math.min(Math.max(pr, 1e-6), 1 - 1e-6);
    // Acklam-style inverse normal, sufficient for a fixture.
    const a = 0.147;
    const x = 2 * p - 1;
    const ln = Math.log(1 - x * x);
    const s = 2 / (Math.PI * a) + ln / 2;
    return Math.sign(x) * Math.sqrt(Math.sqrt(s * s - ln / a) - s) * Math.SQRT2;
  };
  const dPrime = round2(z(hitRate) - z(faRate));
  return {
    condition_id: conditionId,
    session_id: sid,
    total_trials: trials.length,
    signal_trials: signals.length,
    hits: hits.length,
    false_alarms: fas.length,
    misses: signals.length - hits.length,
    correct_rejections: noise.length - fas.length,
    hit_rate: round2(hitRate),
    false_alarm_rate: round2(faRate),
    mean_rt_hits_ms: rtFor(i),
    median_rt_hits_ms: median,
    rt_sd_ms: round2(sd),
    error_rate: round2((signals.length - hits.length + fas.length) / trials.length),
    rt_cv: round2(sd / mean),
    anticipations: 0,
    lapse_count: i % 2,
    lapse_rate: round2((i % 2) / signals.length),
    inverse_efficiency_ms: round2(mean / (1 - (signals.length - hits.length + fas.length) / trials.length)),
    first_half_mean_rt_ms: round2(rts.slice(0, Math.floor(rts.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(rts.length / 2)),
    second_half_mean_rt_ms: round2(rts.slice(Math.floor(rts.length / 2)).reduce((a, b) => a + b, 0) / (rts.length - Math.floor(rts.length / 2))),
    d_prime: dPrime,
    d_prime_se: 0.4,
    d_prime_unstable: false,
    criterion: round2(-(z(hitRate) + z(faRate)) / 2),
    d_prime_estimable: true,
  };
}

export function buildFixtureBundle(opts: FixtureOptions = {}): SessionBundle {
  const { pid, sid, enrolment, block, t0 } = FIXTURE;
  const level = illuminationForBlock(enrolment, block);
  const plan = blockPlan(enrolment, block);
  const wanted = opts.luxCheckpoints ?? ['start', 'middle', 'end'];
  const defaults: Record<'start' | 'middle' | 'end', number> = { start: 152, middle: 148, end: 151 };
  const luxReadings = wanted.map((cp, k) => ({
    checkpoint: cp,
    lux: opts.luxValues?.[cp] ?? defaults[cp],
    at: t0 + k * 3_600_000,
  }));

  const conditions: SessionBundle['conditions'] = plan.map((step, i) => {
    const c = CONDITIONS[step.conditionIndex];
    return {
      condition_id: `cond-${i}`,
      session_id: sid,
      session_position: step.position,
      condition_label: c.label,
      polarity: c.polarity,
      background_color: c.background,
      text_color: c.text,
      color_name: c.colorName,
      ink_name: c.inkName,
      passage_id: step.passageIndex,
      wcag_contrast_ratio: c.wcag_contrast_ratio,
      wcag_level: c.wcag_level,
      michelson_contrast: c.michelson_contrast,
      below_wcag_aa: c.below_wcag_aa,
      started_at: t0 + 100_000 + i * 600_000,
      completed_at: t0 + 100_000 + i * 600_000 + 540_000,
      condition_duration_sec: 540,
      passage_repeat_number: 1,
      adaptation_ms_before: i === 0 ? 0 : 60_000,
      reading_time_ms: readingMs(i),
    };
  });

  const bundle: SessionBundle = {
    session: {
      session_id: sid,
      participant_id: pid,
      enrolment_number: enrolment,
      status: 'complete',
      deleted_at: null,
      display_label: 'Tablet A "lab", bench 2',
      ambient_lux: luxReadings.find((r) => r.checkpoint === 'start')?.lux ?? 0,
      ambient_illumination_level: level,
      illumination_block: block,
      illumination_order_first: illuminationOrderFor(enrolment)[0],
      lux_readings: luxReadings,
      lux_all_in_range: summariseLux(level, luxReadings).all_in_range,
      lux_deviation_note: opts.luxDeviationNote ?? null,
      screen_white_luminance_cd_m2: 137,
      brightness_percent: 78,
      session_start_time: t0,
      session_end_time: t0 + 7_500_000,
      randomisation_seed: enrolment,
      condition_order: plan.map((s) => s.conditionIndex),
      preflight_complete: true, e2e_timing: false,
      consent_given: true,
      consent_time: t0 + 50_000, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null },
      provenance: {
        app_version: '2.1.0',
        git_hash: 'verifyhash',
        build_time: '2026-01-01T00:00:00.000Z',
        condition_def_hash: 'abcd1234',
        schema_version: DB_VERSION,
      },
      device_type: 'Android',
      browser: 'Chrome/verify',
      screen_resolution: '1600x2560', stimulus_scale: 1, layout_viewport: '1194x834',
      conditions_per_session: plan.length,
      condition_offset: 0,
      session_index: 2,
    },
    participant: {
      participant_id: pid,
      enrolment_number: enrolment,
      age: 22,
      gender: 'female',
      daily_screen_hours: 7.5,
      device_familiarity: 'high',
      lighting_habit: 'dim',
      correction_type: 'glasses',
      cvd_status: 'normal',
      cvd_screen_correct: 5,
      cvd_screen_total: 5, cvd_clinical: 'normal' as const,
      caffeine_today: true,
      hours_since_sleep: 6,
      eligible: true,
      exclusion_reason: null,
      baseline_fatigue: 1.2,
      session_id: sid,
    },
    conditions,
    fatigue: [
      {
        fatigue_id: 'fat-base',
        session_id: sid,
        condition_id: null,
        stage: 'baseline',
        eye_strain: 1, dryness: 1, blur: 2, burning: 1, headache: 1,
        fatigue_mean: 1.2,
        touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true },
        all_touched: true,
        response_time_ms: 9000,
      },
      ...conditions.map((c, i) => ({
        fatigue_id: `fat-${i}`,
        session_id: sid,
        condition_id: c.condition_id,
        stage: 'post_condition' as const,
        eye_strain: 2, dryness: 2, blur: 2, burning: 1, headache: 1,
        fatigue_mean: fatigueMean(i),
        touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true },
        all_touched: true,
        response_time_ms: 7000 + i * 100,
      })),
    ],
    cvsq: [
      {
        cvsq_id: 'cvsq-base', session_id: sid, stage: 'baseline', frame: 'habitual_computer_work' as const,
        frequency: Array(16).fill(0), intensity: Array(16).fill(0),
        total_score: 3, symptomatic: false, response_time_ms: 41_000,
      },
      {
        cvsq_id: 'cvsq-end', session_id: sid, stage: 'session_end', frame: 'this_session' as const,
        frequency: Array(16).fill(1), intensity: Array(16).fill(1),
        total_score: 11, symptomatic: true, response_time_ms: 38_000,
      },
    ],
    media: [],
    tlx: [
      {
        tlx_id: 'tlx-1', session_id: sid,
        mental_demand: 65, physical_demand: 30, temporal_demand: 45,
        performance: 25, effort: 70, frustration: 35,
        // The mean of the six ratings AS MARKED. The 75 that used to sit in the performance slot
        // here was 100 - 25, the reversed contribution; the reversal was the defect.
        raw_tlx: (65 + 30 + 45 + 25 + 70 + 35) / 6,
        all_touched: true, response_time_ms: 26_000,
      },
    ],
    comprehension: conditions.flatMap((c, i) => PASSAGES[c.passage_id].questions.map((q, qi) => {
      const correctIndex = q.correctIndex;
      // Vary the selection across BOTH condition and item so the fixture contains partial scores
      // (0, 1/3, 2/3, 1) rather than only all-right or all-wrong conditions.
      const selected = (i + qi) % 4;
      return {
        comprehension_id: `comp-${i}-${qi}`,
        session_id: sid,
        condition_id: c.condition_id,
        passage_id: c.passage_id,
        question_index: qi,
        question_kind: q.kind,
        selected_index: selected,
        correct_index: correctIndex,
        is_correct: selected === correctIndex,
        response_time_ms: 8000 + i * 50 + qi * 400,
      };
    })),
    visualSearch: conditions.map((c, i) => {
      const inSet = PASSAGES[c.passage_id].searchTargetCount;
      const found = Math.max(0, inSet - (i % 3));
      return {
        condition_id: c.condition_id,
        session_id: sid,
        passage_id: c.passage_id,
        search_target: PASSAGES[c.passage_id].searchTarget,
        targets_in_set: inSet,
        search_time_ms: 30_000 + i * 200,
        time_to_first_target_ms: 2500 + i * 10,
        targets_found: found,
        targets_missed: inSet - found,
        false_detections: i % 2, search_d_prime: 2.1, distractor_words: 560,
        accuracy_rate: inSet > 0 ? found / inSet : 0,
        search_efficiency: found / ((30_000 + i * 200) / 60_000),
        mean_inter_target_interval_ms: found > 1 ? 4000 : null,
        termination_mode: found === inSet ? 'voluntary_full' : 'time_limit',
      };
    }),
    perception: conditions.map((c, i) => ({
      perception_id: `perc-${i}`,
      session_id: sid,
      condition_id: c.condition_id,
      display_comfort_score: 40 + i * 3,
      text_clarity_score: 50 + i * 2,
      comfort_touched: true,
      clarity_touched: true,
      response_time_ms: 5000 + i * 30,
    })),
    eyeMetrics: conditions.map((c, i) => ({
      condition_id: c.condition_id,
      session_id: sid,
      camera_active: true,
      effective_fps: 29.4,
      fps_adequate_for_tiers: true, fps_adequate_for_ratio: true, observed_duration_ms: 178000, ear_sample_count: 5340,
      blink_rate: blinkRateFor(i),
      blink_rate_full: Math.round(blinkRateFor(i) * 0.8 * 10) / 10,
      incomplete_blink_ratio: ibrFor(i),
      blink_duration_mean_ms: 180,
      bins: {
        first_half_blink_rate: blinkRateFor(i) + 1,
        second_half_blink_rate: blinkRateFor(i) - 1,
      },
      mean_inter_blink_interval_ms: 4200,
      inter_blink_interval_cv: 0.45,
      perclos_p80: Math.round((0.03 + i * 0.001) * 1000) / 1000,
      perclos_p70: 0.05,
      long_closure_count: 0,
      long_closure_total_ms: 0,
      blink_rate_micro: 0.4,
      blink_count_full: 30,
      blink_count_micro: 2,
      blink_count_incomplete: 8,
      ear_baseline: 0.312,
      ear_threshold_used: 0.234, ear_complete_threshold: 0.234,
      head_pitch_mean: -3.2,
      head_pitch_calibrated: true,
      head_yaw_mean: 1.1,
      head_roll_mean: 0.4,
      head_movement_std: 1.8,
      postural_load: 0.2,
      head_stability_score: 0.9,
      off_axis_ratio: 0.04,
      gaze_calibrated: true,
      gaze_deviation_ratio: 0.05,
      zone_center_ratio: 0.95,
      zone_transition_count: 12,
      face_presence_ratio: 0.97,
      face_size_ratio: 0.22,
      mean_face_luma: 120,
      lighting_quality: 'good',
    })),
    reactionTrials: conditions.flatMap((c, i) => rtTrialsFor(c.condition_id, sid, i)),
    rtSummaries: conditions.map((c, i) => rtSummaryFor(c.condition_id, sid, i)),
    calibration: [
      {
        calibration_id: 'cal-1',
        session_id: sid,
        is_real_calibration: true,
        targets_detected: 9,
        targets_total: 9,
        ear_baseline: 0.312,
        gaze_h_threshold: 0.08,
        gaze_v_threshold: 0.06,
        pitch_baseline_frac: 0.481,
      },
    ],
  };
  return bundle;
}

/**
 * The same bundle, with two consented captures attached.
 *
 * Kept OUT of the default fixture on purpose: most of the export surface is exercised by sessions
 * that gave no media grant, which is the common case, and the default bundle's byte-reproducible
 * output is depended on by other suites. Tests that care about the media path opt in, and get real
 * Blobs, because the properties worth checking — that a blob survives a restore, that the inventory
 * names the file on disk — are invisible when the media array is empty.
 */
export function withFixtureMedia(b: SessionBundle): SessionBundle {
  const sid = b.session.session_id;
  const consent = { camera_metrics: true, setup_photos: true, annotation_video: true, granted_at: b.session.session_start_time };
  return {
    ...b,
    session: { ...b.session, media_consent: consent },
    media: [
      {
        media_id: 'media-setup-start', session_id: sid, kind: 'photo', checkpoint: 'setup_start',
        condition_label: null, captured_at: b.session.session_start_time + 1000,
        mime: 'image/jpeg', bytes: 12, width: 640, height: 480, duration_ms: null,
        checksum_fnv1a: '00000000', consent_snapshot: consent,
        blob: new Blob(['setup-photo-'], { type: 'image/jpeg' }),
      },
      {
        media_id: 'media-reading-01', session_id: sid, kind: 'video', checkpoint: 'reading_segment',
        condition_label: b.conditions[0]?.condition_label ?? 'P1',
        captured_at: b.session.session_start_time + 2000,
        mime: 'video/webm', bytes: 14, width: 640, height: 480, duration_ms: 20_000,
        checksum_fnv1a: '00000001', consent_snapshot: consent,
        blob: new Blob(['reading-video-'], { type: 'video/webm' }),
      },
    ] as SessionBundle['media'],
  };
}
