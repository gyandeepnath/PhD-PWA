/**
 * Fuzz / stress harness — exercises the pure pipeline with degenerate and "unnatural" inputs across
 * many random iterations, asserting (a) nothing throws and (b) output invariants hold. Catches the
 * kind of edge-case crashes that only appear in odd field scenarios (no trials, all-miss conditions,
 * empty/NaN sensor streams, partial sessions, extreme enrolment numbers, empty exports).
 *
 * Run: `npm run fuzz [iterations]`. Used both as a CI test (tests/fuzz.test.ts) and a long background
 * soak. Returns a list of failures (empty = clean).
 */
import { makeRng, type Rng } from './rng';
import { N_CONDITIONS } from '@/experiment/conditions';
import { N_PASSAGES } from '@/experiment/passages';
import { conditionOrderFor, passageForCondition, sessionPlan, blockPlan } from '@/experiment/counterbalance';
import { illuminationOrderFor, illuminationForBlock, N_ILLUMINATION_BLOCKS } from '@/experiment/illumination';
import { computeSdt } from '@/lib/signalDetection';
import { classifyBlinks, summariseBlinks, effectiveFps, baselineEar, type EarSample, type Point } from '@/tracking/blink';
import { estimateHeadPose } from '@/tracking/headPose';
import { fitGazeCalibration, GAZE_TARGETS } from '@/tracking/gazeCalibration';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { buildExportFiles } from '@/storage/export';
import { wcagContrastRatio } from '@/lib/contrast';
import type { SessionBundle } from '@/storage/gather';
import type { Provenance } from '@/storage/types';

export interface FuzzFailure {
  check: string;
  iteration: number;
  detail: string;
}

const isFinitePos = (x: number | null) => x == null || (Number.isFinite(x) && x >= 0);
const inUnit = (x: number | null) => x == null || (Number.isFinite(x) && x >= -0.0001 && x <= 1.0001);

/** Adversarial free-text fragments injected into export fields to attack CSV escaping. */
const TORTURE = ['a,b', 'q"q', 'l\nf', 'c\rr', 'crlf\r\n', '=cmd', '😀', '""', ',,', '日本'];

/** Strict RFC-4180 parser (unquoted \n = row end). Used to prove no column drift in exports. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '', inQ = false;
  let row: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function maybeWeird(rng: Rng): number {
  const r = rng();
  if (r < 0.1) return NaN;
  if (r < 0.2) return -randInt(rng, 1, 1000);
  if (r < 0.3) return 1e9 * rng();
  return randInt(rng, 0, 50);
}

const PROV: Provenance = { app_version: 'fuzz', git_hash: 'f', build_time: 't', condition_def_hash: 'h', schema_version: 7 };

/** Run `iterations` fuzz cycles. Returns any invariant/throw failures found. */
export function runFuzz(iterations: number, seed = 1): FuzzFailure[] {
  const rng = makeRng(seed);
  const failures: FuzzFailure[] = [];
  const fail = (check: string, i: number, detail: string) => failures.push({ check, iteration: i, detail });
  const guard = (check: string, i: number, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      fail(check, i, (e as Error).message);
    }
  };

  for (let i = 0; i < iterations; i++) {
    // 1) Counterbalancing with extreme enrolment numbers.
    guard('counterbalance', i, () => {
      const enrol = maybeWeird(rng);
      const order = conditionOrderFor(enrol);
      if (order.length !== N_CONDITIONS || order.some((x) => x < 0 || x >= N_CONDITIONS || !Number.isInteger(x)))
        fail('counterbalance', i, `bad order for enrol=${enrol}: ${order}`);
      const p = passageForCondition(randInt(rng, -5, 12), enrol);
      if (!(p >= 0 && p < N_PASSAGES)) fail('counterbalance', i, `bad passage ${p}`);
      sessionPlan(enrol);
      // The illumination factor must survive the same degenerate enrolment numbers.
      const order2 = illuminationOrderFor(enrol);
      if (order2.length !== N_ILLUMINATION_BLOCKS || new Set(order2).size !== N_ILLUMINATION_BLOCKS)
        fail('counterbalance', i, `bad illumination order for enrol=${enrol}: ${order2}`);
      for (let b = -3; b < 5; b++) {
        const lvl = illuminationForBlock(enrol, b);
        if (lvl !== 'dim' && lvl !== 'moderate')
          fail('counterbalance', i, `bad illumination level ${lvl} for enrol=${enrol} block=${b}`);
      }
      const bp = blockPlan(enrol, randInt(rng, -3, 5));
      if (bp.length !== N_CONDITIONS) fail('counterbalance', i, `bad blockPlan length ${bp.length}`);
    });

    // 2) Signal detection with degenerate trial counts (incl. zero, all-hit, all-miss).
    guard('sdt', i, () => {
      const hits = randInt(rng, 0, 30);
      const misses = randInt(rng, 0, 30);
      const fa = randInt(rng, 0, 30);
      const cr = randInt(rng, 0, 30);
      const r = computeSdt({ hits, misses, falseAlarms: fa, correctRejections: cr });
      if (!Number.isFinite(r.d_prime)) fail('sdt', i, `d' not finite (${hits}/${misses}/${fa}/${cr})`);
      if (!Number.isFinite(r.d_prime_se) || r.d_prime_se < 0) fail('sdt', i, `SE bad: ${r.d_prime_se}`);
      if (!inUnit(r.hit_rate) || !inUnit(r.false_alarm_rate)) fail('sdt', i, 'rate out of [0,1]');
    });

    // 3) Blink classification on empty / NaN / negative / huge EAR streams.
    guard('blink', i, () => {
      const n = randInt(rng, 0, 60);
      const samples: EarSample[] = Array.from({ length: n }, (_, k) => ({
        t_ms: k * randInt(rng, 0, 100),
        ear: maybeWeird(rng) / 100,
      }));
      const base = baselineEar(samples.map((s) => s.ear));
      const events = classifyBlinks(samples, base);
      const dur = samples.length ? samples[samples.length - 1].t_ms : 0;
      const s = summariseBlinks(events, dur);
      if (!isFinitePos(s.blink_rate) || !isFinitePos(s.blink_rate_full)) fail('blink', i, 'blink rate not finite/>=0');
      if (!inUnit(s.incomplete_blink_ratio)) fail('blink', i, `incomplete ratio ${s.incomplete_blink_ratio}`);
      effectiveFps(samples.map((s) => s.t_ms));
    });

    // 4) Gaze calibration with random/degenerate samples.
    guard('gaze', i, () => {
      const byTarget: Record<string, { h: number; v: number }[]> = {};
      for (const t of GAZE_TARGETS) {
        const k = randInt(rng, 0, 3);
        byTarget[t.id] = Array.from({ length: k }, () => ({ h: maybeWeird(rng) / 10, v: maybeWeird(rng) / 10 }));
      }
      const cal = fitGazeCalibration(byTarget);
      if (!Number.isFinite(cal.hThreshold) || cal.hThreshold <= 0) fail('gaze', i, `hThreshold ${cal.hThreshold}`);
    });

    // 5) Aggregation + export on a partial/sparse bundle (missing records, empty conditions).
    guard('export', i, () => {
      const nConds = randInt(rng, 0, N_CONDITIONS);
      const bundle = makePartialBundle(rng, nConds);
      const summaries = buildConditionSummaries(bundle);
      if (summaries.length !== nConds) fail('export', i, `summaries ${summaries.length} != ${nConds}`);
      for (const s of summaries) {
        if (!inUnit(s.search_accuracy)) fail('export', i, `acc ${s.search_accuracy}`);
        if (!isFinitePos(s.mean_rt_hits_ms)) fail('export', i, `rt ${s.mean_rt_hits_ms}`);
        // Engagement scoring must stay bounded and self-consistent on degenerate inputs.
        if (!inUnit(s.quality_score)) fail('export', i, `quality_score ${s.quality_score}`);
        if (!['good', 'warn', 'bad'].includes(s.engagement)) fail('export', i, `engagement ${s.engagement}`);
      }
      const files = buildExportFiles(bundle);
      if (!files.some((f) => f.filename === 'export_manifest.json')) fail('export', i, 'no manifest');
      // Every CSV must at least have a header line.
      for (const f of files) if (f.content.length === 0) fail('export', i, `empty file ${f.filename}`);
      // CSV integrity: with adversarial free text in the bundle, every row must still parse to
      // exactly the header's column count (no delimiter/newline leaks).
      for (const f of files.filter((f) => f.filename.endsWith('.csv'))) {
        const parsed = parseCsv(f.content);
        const cols = parsed[0].length;
        for (let r = 1; r < parsed.length; r++)
          if (parsed[r].length !== cols)
            fail('export', i, `${f.filename} row ${r} has ${parsed[r].length}/${cols} cols`);
      }
    });

    // 6) Head pose on degenerate / extreme landmark arrays — must stay finite, never throw.
    guard('headpose', i, () => {
      const lm: Point[] = Array.from({ length: 478 }, () => ({ x: maybeWeird(rng) / 100, y: maybeWeird(rng) / 100 }));
      const pose = estimateHeadPose(lm);
      // NaN landmarks may legitimately yield NaN pose, but finite landmarks must yield finite pose.
      const allFinite = lm.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (allFinite && !(Number.isFinite(pose.pitch) && Number.isFinite(pose.yaw) && Number.isFinite(pose.roll)))
        fail('headpose', i, `non-finite pose from finite landmarks: ${JSON.stringify(pose)}`);
    });
  }

  return failures;
}

/** A sparse bundle with `nConds` conditions and randomly-present child records. */
function makePartialBundle(rng: Rng, nConds: number): SessionBundle {
  const sid = 'F';
  const torture = () => TORTURE[Math.floor(rng() * TORTURE.length)];
  const conditions = Array.from({ length: nConds }, (_, k) => ({
    condition_id: `c${k}`, session_id: sid, session_position: k, condition_label: `C${k + 1}`,
    polarity: (k % 2 ? 'negative' : 'positive') as 'positive' | 'negative',
    background_color: '#FFFFFF', text_color: '#000000', color_name: rng() < 0.5 ? 'black' : torture(), ink_name: rng() < 0.5 ? 'black' : torture(), passage_id: k % N_PASSAGES,
    wcag_contrast_ratio: wcagContrastRatio('#FFFFFF', '#000000'), wcag_level: 'AAA' as const,
    michelson_contrast: 1, below_wcag_aa: false, started_at: 1, completed_at: rng() < 0.5 ? 2 : null,
    condition_duration_sec: 1, adaptation_ms_before: 0, reading_time_ms: null
  }));
  const has = () => rng() < 0.6;
  return {
    session: {
      session_id: sid, participant_id: 'PF', enrolment_number: 1, status: 'complete', deleted_at: null,
      display_label: rng() < 0.5 ? null : torture(), ambient_lux: 350, ambient_illumination_level: null, illumination_block: 0, illumination_order_first: 'dim' as const, lux_readings: [], lux_all_in_range: null, lux_deviation_note: null, screen_white_luminance_cd_m2: null, brightness_percent: null,
      session_start_time: 1, session_end_time: 2, randomisation_seed: 1,
      condition_order: conditions.map((c) => c.session_position), preflight_complete: true,
      consent_given: true, consent_time: 1, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null }, provenance: PROV, device_type: torture(), browser: torture(), screen_resolution: '1x1',
      conditions_per_session: 8, condition_offset: 0, session_index: 1,
    },
    participant: undefined,
    conditions,
    fatigue: rng() < 0.5 ? [{ fatigue_id: 'b', session_id: sid, condition_id: null, stage: 'baseline', eye_strain: 0, dryness: 0, blur: 0, burning: 0, headache: 0, fatigue_mean: 0, touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true }, all_touched: true, response_time_ms: maybeWeird(rng) * 100 }] : [],
    media: [],
    tlx: [],
    cvsq: [],
    comprehension: [],
    visualSearch: conditions.filter(has).map((c) => ({
      condition_id: c.condition_id, session_id: sid, passage_id: c.passage_id, search_target: 'x',
      targets_in_set: randInt(rng, 0, 12), search_time_ms: randInt(rng, 0, 40000), time_to_first_target_ms: null,
      targets_found: randInt(rng, 0, 12), targets_missed: 0, false_detections: 0,
      accuracy_rate: rng(), search_efficiency: rng() * 30, mean_inter_target_interval_ms: null,
      termination_mode: 'time_limit' as const,
    })),
    perception: [],
    eyeMetrics: conditions.filter(has).map((c) => ({
      condition_id: c.condition_id, session_id: sid, camera_active: rng() < 0.5, effective_fps: rng() < 0.5 ? null : rng() * 40,
      fps_adequate_for_tiers: false, blink_rate: rng() * 30, blink_rate_full: rng() * 30, incomplete_blink_ratio: rng(),
      blink_duration_mean_ms: null, bins: { first_half_blink_rate: null, second_half_blink_rate: null },
      mean_inter_blink_interval_ms: rng() < 0.5 ? null : rng() * 10000, inter_blink_interval_cv: rng() < 0.5 ? null : rng(),
      perclos_p80: rng() < 0.5 ? null : rng(), perclos_p70: rng() < 0.5 ? null : rng(),
      long_closure_count: randInt(rng, 0, 3), long_closure_total_ms: rng() * 2000,
      blink_rate_micro: 0, blink_count_full: 0,
      blink_count_micro: 0, blink_count_incomplete: 0, ear_baseline: null, ear_threshold_used: null,
      head_pitch_mean: 0, head_pitch_calibrated: rng() < 0.5, head_yaw_mean: 0, head_roll_mean: 0, head_movement_std: 0, postural_load: 0,
      head_stability_score: 0, off_axis_ratio: rng(), gaze_calibrated: false, gaze_deviation_ratio: rng(),
      zone_center_ratio: rng(), zone_transition_count: 0, face_presence_ratio: rng(), face_size_ratio: 0,
      mean_face_luma: rng() < 0.5 ? null : rng() * 255, lighting_quality: null,
    })),
    reactionTrials: [],
    rtSummaries: conditions.filter(has).map((c) => {
      const r = computeSdt({ hits: randInt(rng, 0, 24), misses: randInt(rng, 0, 24), falseAlarms: randInt(rng, 0, 24), correctRejections: randInt(rng, 0, 24) });
      return {
        condition_id: c.condition_id, session_id: sid, total_trials: 48, signal_trials: 24, hits: 0,
        false_alarms: 0, misses: 0, correct_rejections: 0, hit_rate: r.hit_rate, false_alarm_rate: r.false_alarm_rate,
        error_rate: rng(), rt_cv: rng() < 0.5 ? null : rng(), anticipations: 0, lapse_count: 0, lapse_rate: rng(), inverse_efficiency_ms: rng() < 0.5 ? null : randInt(rng, 200, 1200), first_half_mean_rt_ms: null, second_half_mean_rt_ms: null,
        mean_rt_hits_ms: rng() < 0.5 ? null : randInt(rng, 200, 900), median_rt_hits_ms: null, rt_sd_ms: null,
        d_prime: r.d_prime, d_prime_se: r.d_prime_se, d_prime_unstable: r.d_prime_unstable, criterion: r.criterion,
      };
    }),
    calibration: rng() < 0.5 ? [{ calibration_id: 'cal', session_id: sid, is_real_calibration: rng() < 0.5, targets_detected: randInt(rng, 0, 9), targets_total: 9, ear_baseline: rng() < 0.5 ? null : rng(), gaze_h_threshold: null, gaze_v_threshold: null, pitch_baseline_frac: rng() < 0.5 ? null : rng() }] : [],
  };
}
