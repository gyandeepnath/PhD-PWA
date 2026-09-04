/**
 * One analysis dataset from every session on the device.
 *
 * The per-session export is a faithful record of one sitting, and it is the right shape for
 * checking a sitting. It is the wrong shape for analysis: 130 participants over two sittings each
 * is 260 folders, and concatenating those by hand is where analysis errors are actually introduced
 * — a mis-sorted join, a participant counted twice, a sitting silently missing.
 *
 * This produces the modelling unit directly. One row per participant x condition-run, with the
 * design factors, the outcomes, the covariates and the quality flags already on it.
 *
 * THREE DECISIONS WORTH STATING.
 *
 * 1. THE PRIMARY OUTCOME IS EXPORTED AS COUNTS, NOT ONLY AS A RATIO. `n_incomplete` and
 *    `n_blinks_total` are the numerator and denominator of the incomplete-blink proportion. A
 *    proportion from 8 blinks and one from 60 are not the same measurement, and a Gaussian model of
 *    the naked ratio treats them as though they were. With counts the proportion can be modelled
 *    binomially, which weights each observation by the information it actually carries. The ratio is
 *    exported too, for description and for plots.
 *
 * 2. NOTHING IS DROPPED, EVER. Rows from participants with a broken join are present and marked, not
 *    removed. `analysable` and `exclusion_reason` say what the join check concluded, so a
 *    complete-case analysis is one filter away and the excluded rows remain inspectable. An exporter
 *    that silently dropped rows would make the dataset disagree with the participant log, and the
 *    disagreement would be discovered — if at all — long after the reason was forgotten.
 *
 * 3. CODING COLUMNS ARE PROVIDED BUT THE RAW LABELS ARE KEPT BESIDE THEM. `polarity` stays
 *    'positive'/'negative' AND appears as `polarity_c` in sum-to-zero coding, because the sign of a
 *    model coefficient is meaningless unless the coding is known, and reconstructing it from a
 *    factor level six months later is exactly the kind of avoidable error that changes a conclusion.
 */
import type { SessionBundle } from './gather';
import type { ExportFile } from './export';
import { toCsv, round } from './export';
import { checkJoin, type JoinIntegrity, type JoinExpectation } from './joinIntegrity';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { N_CONDITIONS } from '@/experiment/conditions';
import { QUESTIONS_PER_PASSAGE, PASSAGES } from '@/experiment/passages';
import { ANALYSIS_CODEBOOK } from './analysisCodebook';

const SITTINGS_PER_PARTICIPANT = 2;

/** Columns of the long analysis file, in the order they are written. */
export const ANALYSIS_LONG_COLUMNS = [
  // --- keys -------------------------------------------------------------------------------
  'participant_id', 'enrolment_number', 'session_id', 'session_index', 'row_id',
  // --- design factors ---------------------------------------------------------------------
  'illumination', 'illumination_lux_target', 'polarity', 'text_colour', 'condition_label',
  'polarity_c', 'illumination_c',
  // --- position and order, which carry fatigue and practice -------------------------------
  'session_position', 'global_position', 'position_c',
  'illumination_block', 'illumination_order_first', 'adaptation_ms_before', 'polarity_switched',
  'predecessor_condition_label',
  'passage_id', 'passage_repeat_number',
  // --- primary outcome, as counts and as a proportion -------------------------------------
  'n_incomplete', 'n_blinks_total', 'incomplete_blink_ratio',
  'blink_rate_per_min', 'observed_duration_ms', 'reading_time_ms', 'reading_speed_wpm',
  // --- secondary ocular -------------------------------------------------------------------
  'perclos_p80', 'blink_duration_mean_ms', 'mean_inter_blink_interval_ms',
  'head_pitch_mean', 'head_movement_std', 'off_axis_ratio',
  // --- subjective and performance ---------------------------------------------------------
  'fatigue_mean', 'fatigue_delta', 'comfort_score', 'clarity_score',
  'comprehension_correct', 'comprehension_items',
  'search_time_ms', 'search_accuracy', 'search_termination',
  'rt_mean_hits_ms', 'rt_median_hits_ms', 'd_prime', 'criterion', 'rt_lapses',
  // --- stimulus properties, as continuous predictors ---------------------------------------
  'wcag_contrast_ratio', 'michelson_contrast', 'below_wcag_aa',
  // --- participant covariates -------------------------------------------------------------
  'age', 'gender', 'daily_screen_hours', 'correction_type', 'cvd_status',
  'cvsq_baseline_total', 'caffeine_today', 'hours_since_sleep',
  // --- session covariates -----------------------------------------------------------------
  'ambient_lux_measured', 'lux_all_in_range', 'screen_luminance_cd_m2', 'stimulus_scale',
  // --- quality, for sensitivity analyses ---------------------------------------------------
  'camera_active', 'effective_fps', 'fps_adequate_for_ratio', 'face_presence_ratio',
  'gaze_calibrated', 'qc_overall', 'analysable', 'exclusion_reason',
] as const;

interface RowContext {
  bundle: SessionBundle;
  analysable: boolean;
  exclusion: string;
  /** 0-based index of this sitting for the participant, by start time. */
  sittingIndex: number;
}

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Sum-to-zero coding: -0.5 / +0.5.
 *
 * Chosen over dummy coding because with an interaction in the model, a dummy-coded main effect is
 * the simple effect at the reference level of the other factor rather than an average effect — a
 * difference that has changed more than one published conclusion. Returns null for an unknown
 * level rather than defaulting to a side.
 */
function centreTwoLevel(value: string | null | undefined, negative: string, positive: string): number | null {
  if (value === negative) return -0.5;
  if (value === positive) return 0.5;
  return null;
}

/**
 * Build the long rows for one sitting.
 *
 * Every per-condition value comes from `buildConditionSummaries`, the SAME function the per-session
 * export uses, rather than being recomputed here. Two files that derive the same quantity by two
 * routes will eventually disagree, and the disagreement will be found during analysis, when nobody
 * remembers which route was right. The only things computed locally are the ones that do not exist
 * at session scope at all: position across both sittings, and the contrast coding.
 */
function buildLongRows(contexts: RowContext[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const ctx of contexts) {
    const { bundle: b } = ctx;
    const s = b.session;
    const p = b.participant;

    const summaries = buildConditionSummaries(b);
    const byId = new Map(b.conditions.map((c) => [c.condition_id, c]));
    const eyeById = new Map(b.eyeMetrics.map((r) => [r.condition_id, r]));
    const rtById = new Map(b.rtSummaries.map((r) => [r.condition_id, r]));
    const searchById = new Map(b.visualSearch.map((r) => [r.condition_id, r]));

    // The CVS-Q baseline is a participant-level trait covariate. The end-of-session score is an
    // OUTCOME and does not belong repeated on every condition row, where a model would treat one
    // measurement as ten.
    const cvsqBaseline = b.cvsq.find((c) => c.stage === 'baseline');

    const ordered = [...summaries].sort((a, c) => a.session_position - c.session_position);

    for (const sum of ordered) {
      const c = byId.get(sum.condition_id);
      const e = eyeById.get(sum.condition_id);
      const r = rtById.get(sum.condition_id);

      /*
       * Denominator of the primary outcome.
       *
       * Null unless every component is present. A partial sum would be a smaller denominator that
       * looks entirely real, which would overstate the precision of exactly the measurement the
       * study rests on — and in the direction that makes a result look stronger.
       */
      const nInc = numOrNull(e?.blink_count_incomplete);
      const nFull = numOrNull(e?.blink_count_full);
      const nMicro = numOrNull(e?.blink_count_micro);
      const nTotal = nInc != null && nFull != null && nMicro != null ? nInc + nFull + nMicro : null;

      const prev = ordered.find((x) => x.session_position === sum.session_position - 1);

      rows.push({
        participant_id: s.participant_id,
        enrolment_number: p?.enrolment_number ?? s.enrolment_number,
        session_id: s.session_id,
        session_index: s.session_index,
        // Stable and order-independent, so a re-merge cannot silently duplicate a row.
        row_id: `${s.participant_id}|${s.session_id}|${sum.condition_id}`,

        illumination: s.ambient_illumination_level,
        illumination_lux_target: s.ambient_illumination_level === 'dim' ? 10
          : s.ambient_illumination_level === 'moderate' ? 150 : null,
        polarity: sum.polarity,
        text_colour: sum.color_name,
        condition_label: sum.condition_label,
        polarity_c: centreTwoLevel(sum.polarity, 'negative', 'positive'),
        illumination_c: centreTwoLevel(s.ambient_illumination_level, 'dim', 'moderate'),

        session_position: sum.session_position,
        // Position across the WHOLE protocol: the second sitting continues the count rather than
        // restarting it, because cumulative fatigue does not reset between visits.
        global_position: sum.session_position + ctx.sittingIndex * N_CONDITIONS,
        position_c: sum.session_position - (N_CONDITIONS + 1) / 2,
        illumination_block: s.illumination_block,
        illumination_order_first: s.illumination_order_first,
        adaptation_ms_before: c?.adaptation_ms_before ?? null,
        // Adaptation was doubled on a polarity switch, so this is a covariate for any ocular
        // outcome. Derived once here rather than re-derived differently in each analysis.
        polarity_switched: prev ? prev.polarity !== sum.polarity : null,
        /*
         * The condition that immediately preceded this one IN TIME, or empty when nothing did.
         *
         * Empty marks a real discontinuity, and under the split protocol that discontinuity is
         * structural rather than incidental: a 5/5 split runs positions 0-4, then 5-9 days later,
         * so the 4->5 adjacency never occurs. In the Williams square that boundary pair always
         * differs by 5 in condition index, and c and c+5 are the same colour in opposite polarity
         * — so the split eliminates all ten same-colour polarity switches from the carryover
         * matrix, in every participant. This column is what makes that visible in the data instead
         * of leaving it to be inferred from conditions_per_session.
         */
        predecessor_condition_label: prev ? prev.condition_label : null,
        passage_id: sum.passage_id,
        passage_repeat_number: c?.passage_repeat_number ?? null,

        n_incomplete: nInc,
        n_blinks_total: nTotal,
        incomplete_blink_ratio: round(sum.incomplete_blink_ratio),
        blink_rate_per_min: round(sum.blink_rate),
        observed_duration_ms: e?.observed_duration_ms ?? null,
        reading_time_ms: sum.reading_time_ms,
        /*
         * Derived exactly as 02_conditions.csv derives it, from the passage's own word count.
         * Null when either the word count or the reading time is missing, rather than a plausible
         * number computed from half the inputs.
         */
        reading_speed_wpm: (() => {
          const words = sum.passage_id != null ? PASSAGES[sum.passage_id]?.wordCount ?? null : null;
          const ms = sum.reading_time_ms;
          return words != null && ms != null && ms > 0 ? Math.round(words / (ms / 60000)) : null;
        })(),

        perclos_p80: round(sum.perclos_p80),
        blink_duration_mean_ms: round(e?.blink_duration_mean_ms),
        mean_inter_blink_interval_ms: round(sum.mean_inter_blink_interval_ms),
        head_pitch_mean: round(e?.head_pitch_mean),
        head_movement_std: round(e?.head_movement_std),
        off_axis_ratio: round(sum.off_axis_ratio),

        fatigue_mean: round(sum.fatigue_mean),
        fatigue_delta: round(sum.fatigue_delta),
        comfort_score: sum.comfort_score,
        clarity_score: sum.clarity_score,
        comprehension_correct: sum.comprehension_correct,
        comprehension_items: QUESTIONS_PER_PASSAGE,
        search_time_ms: sum.search_time_ms,
        search_accuracy: round(sum.search_accuracy),
        // Whether the block ended by the participant finishing or by the 40 s cap. A time-capped
        // block censors search_time_ms, so this decides whether that row is a measurement or a bound.
        search_termination: searchById.get(sum.condition_id)?.termination_mode ?? null,
        rt_mean_hits_ms: round(sum.mean_rt_hits_ms),
        rt_median_hits_ms: round(r?.median_rt_hits_ms),
        d_prime: round(sum.d_prime),
        criterion: round(sum.criterion),
        rt_lapses: numOrNull(r?.lapse_count),

        wcag_contrast_ratio: round(sum.wcag_contrast_ratio),
        michelson_contrast: round(c?.michelson_contrast),
        below_wcag_aa: sum.below_wcag_aa,

        age: p?.age ?? null,
        gender: p?.gender ?? null,
        daily_screen_hours: p?.daily_screen_hours ?? null,
        correction_type: p?.correction_type ?? null,
        cvd_status: p?.cvd_status ?? null,
        cvsq_baseline_total: round(cvsqBaseline?.total_score),
        caffeine_today: p?.caffeine_today ?? null,
        hours_since_sleep: p?.hours_since_sleep ?? null,

        ambient_lux_measured: round(s.ambient_lux),
        lux_all_in_range: s.lux_all_in_range,
        screen_luminance_cd_m2: round(s.screen_white_luminance_cd_m2),
        stimulus_scale: round(s.stimulus_scale),

        camera_active: sum.camera_active,
        effective_fps: round(sum.effective_fps),
        fps_adequate_for_ratio: e?.fps_adequate_for_ratio ?? null,
        face_presence_ratio: round(sum.face_presence_ratio),
        gaze_calibrated: e?.gaze_calibrated ?? null,
        qc_overall: sum.qc.overall,
        analysable: ctx.analysable,
        exclusion_reason: ctx.exclusion,
      });
    }
  }

  return rows;
}

export interface AnalysisDataset {
  files: ExportFile[];
  integrity: JoinIntegrity;
  rowCount: number;
}

/**
 * Build the pooled dataset from every gathered session.
 *
 * The join is checked first and its verdict is carried onto every row, so a dataset can never be
 * produced whose provenance is unstated.
 */
export function buildAnalysisDataset(
  bundles: SessionBundle[],
  expect: JoinExpectation = {
    conditionsPerParticipant: N_CONDITIONS * SITTINGS_PER_PARTICIPANT,
    sittingsPerParticipant: SITTINGS_PER_PARTICIPANT,
  },
): AnalysisDataset {
  const integrity = checkJoin(bundles, expect);
  const verdict = new Map(integrity.participants.map((p) => [p.participant_id, p]));

  // Sitting index by start time, so `global_position` reflects the order actually run rather than
  // the order the records happened to be stored in.
  const orderByParticipant = new Map<string, string[]>();
  for (const p of integrity.participants) orderByParticipant.set(p.participant_id, p.session_ids);

  const contexts: RowContext[] = bundles.map((b) => {
    const v = verdict.get(b.session.participant_id);
    const ids = orderByParticipant.get(b.session.participant_id) ?? [];
    return {
      bundle: b,
      analysable: v?.analysable ?? false,
      exclusion: v?.excluded_by.join(';') ?? 'participant_not_resolved',
      sittingIndex: Math.max(0, ids.indexOf(b.session.session_id)),
    };
  });

  const rows = buildLongRows(contexts);

  const files: ExportFile[] = [
    {
      // Written first so it is the first thing opened. Which column is an outcome, which is a
      // covariate, and what an empty cell means are all invisible in the data itself.
      filename: 'analysis_codebook.csv',
      mime: 'text/csv',
      content: toCsv(['column', 'role', 'unit', 'missing', 'description'],
        ANALYSIS_CODEBOOK as unknown as Record<string, unknown>[]),
    },
    {
      filename: 'analysis_long.csv',
      mime: 'text/csv',
      content: toCsv([...ANALYSIS_LONG_COLUMNS], rows),
    },
    {
      filename: 'analysis_join_report.csv',
      mime: 'text/csv',
      content: toCsv(
        ['participant_id', 'enrolment_number', 'sittings', 'session_ids', 'illumination_levels',
          'condition_runs', 'analysable', 'excluded_by'],
        integrity.participants.map((p) => ({
          participant_id: p.participant_id,
          enrolment_number: p.enrolment_number,
          sittings: p.session_ids.length,
          session_ids: p.session_ids.join(';'),
          illumination_levels: p.illumination_levels.map((l) => l ?? 'unknown').join(';'),
          condition_runs: p.condition_runs,
          analysable: p.analysable,
          excluded_by: p.excluded_by.join(';'),
        })),
      ),
    },
    {
      filename: 'analysis_join_issues.csv',
      mime: 'text/csv',
      content: toCsv(
        ['severity', 'code', 'participant_id', 'session_id', 'detail'],
        integrity.issues as unknown as Record<string, unknown>[],
      ),
    },
  ];

  return { files, integrity, rowCount: rows.length };
}
