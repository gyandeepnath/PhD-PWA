/**
 * One analysis dataset from every session on the device.
 *
 * The per-session export is a faithful record of one sitting, and it is the right shape for
 * checking a sitting. It is the wrong shape for analysis: 130 participants, one sitting each, is
 * 130 folders, and concatenating those by hand is where analysis errors are actually introduced
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
import { toCsv, round, fnv1a, beginNonFiniteCount, nonFiniteCellCount } from './export';
import {
  checkJoin, groupByProvenance, unresolvedParticipantKey,
  type JoinIntegrity, type JoinExpectation,
} from './joinIntegrity';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { N_CONDITIONS } from '@/experiment/conditions';
import { PASSAGES } from '@/experiment/passages';
import { ANALYSIS_CODEBOOK } from './analysisCodebook';
import { N_ILLUMINATION_BLOCKS, specFor } from '@/experiment/illumination';

/** Illumination blocks a participant completes — ONE under the current protocol. Runs = N x this. */
// Derived, never a literal: this used to be a hard-coded 2, which would have silently survived the
// switch to a single-level protocol and told every analyst the dataset held a crossover it does not.
const ILLUMINATION_LEVELS = N_ILLUMINATION_BLOCKS;

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
  'gaze_calibrated', 'qc_overall', 'e2e_timing', 'session_status', 'withdrawn',
  'analysable', 'exclusion_reason',
] as const;

interface RowContext {
  bundle: SessionBundle;
  /**
   * The grouping level these rows are written under.
   *
   * Not read off the session, because a session with no participant id would then write an EMPTY
   * grouping key — and two such sessions would share it, silently merging two people into one
   * random-intercept level. checkJoin assigns the stand-in key; it is used here so the long file,
   * the join report and the issues file all name the same thing.
   */
  participantKey: string;
  analysable: boolean;
  exclusion: string;
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
 * at session scope at all: position across the protocol, and the contrast coding.
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
    const compById = new Map<string, typeof b.comprehension>();
    for (const item of b.comprehension) {
      (compById.get(item.condition_id) ?? compById.set(item.condition_id, []).get(item.condition_id)!).push(item);
    }

    /*
     * THIS SITTING's baseline CVS-Q. It is NOT a participant-level trait, and an earlier version of
     * this comment said it was.
     *
     * CvsqRecord is keyed by session_id and CVSQ_BASELINE sits in the per-sitting setup order, so a
     * participant accumulates one baseline per sitting — two under the standard protocol, four under
     * the split — and they differ. Because sitting maps one-to-one onto illumination_block, any
     * within-participant drift here is perfectly aligned with the whole-plot contrast, and sitting
     * 2's baseline is measured AFTER sitting 1's ninety-minute exposure. Conditioning on it without
     * saying why absorbs part of the illumination effect the study exists to estimate.
     *
     * The end-of-session score is an OUTCOME and is deliberately not repeated on every condition
     * row, where a model would read one measurement as ten.
     */
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
        participant_id: ctx.participantKey,
        enrolment_number: p?.enrolment_number ?? s.enrolment_number,
        session_id: s.session_id,
        session_index: s.session_index,
        // Stable and order-independent, so a re-merge cannot silently duplicate a row.
        row_id: `${ctx.participantKey}|${s.session_id}|${sum.condition_id}`,

        illumination: s.ambient_illumination_level,
        /*
         * Read from the level's own spec, never a literal.
         *
         * These were hard-coded 10 and 150. When the protocol retargeted 'moderate' to 300 lux the
         * literal stayed, so every row of the study exported a nominal target of 150 beside a
         * measured 300 — and the codebook entry for this column tells the analyst to compare the
         * two to check the manipulation held. It would have read as a total failure of the
         * manipulation on every session. The rule this line broke is stated 130 lines above it:
         * derived, never a literal.
         */
        illumination_lux_target: specFor(s.ambient_illumination_level)?.target ?? null,
        polarity: sum.polarity,
        text_colour: sum.color_name,
        condition_label: sum.condition_label,
        polarity_c: centreTwoLevel(sum.polarity, 'negative', 'positive'),
        illumination_c: centreTwoLevel(s.ambient_illumination_level, 'dim', 'moderate'),

        session_position: sum.session_position,
        // Position across the WHOLE protocol: a split sitting continues the count rather than
        // restarting it, because cumulative fatigue does not reset between visits.
        /*
         * Derived from the RECORDED illumination_block, not from this session's position in a
         * time-sorted list.
         *
         * session_position is already block-global (0..9 across both halves of a split sitting), so
         * multiplying a separate sitting counter on top double-counted: a 4-sitting split protocol
         * produced 0-4, 15-19, 20-24, 35-39 instead of 0-19. The positional index was also wrong
         * whenever start-time order disagreed with block order, putting illumination_block=0 beside
         * global_position=10-19 in the same row, and it silently returned 0 — a confident "first
         * sitting" — for any session whose participant could not be resolved.
         */
        global_position: Number.isFinite(s.illumination_block)
          ? sum.session_position + s.illumination_block * N_CONDITIONS
          : null,
        /*
         * session_position is 0-BASED (0..9; see ConditionRecord in types.ts), so the mid-point is
         * (N-1)/2 = 4.5, not (N+1)/2 = 5.5. Centring on 5.5 left the column with a mean of -1.0
         * instead of 0, so it stayed correlated with the intercept — which is precisely the
         * correlation the codebook claims centring removes. Every "effect at the average condition"
         * was being reported one full condition further down the fatigue gradient than stated.
         */
        position_c: sum.session_position - (N_CONDITIONS - 1) / 2,
        illumination_block: s.illumination_block,
        illumination_order_first: s.illumination_order_first,
        adaptation_ms_before: c?.adaptation_ms_before ?? null,
        /*
         * Adaptation was doubled on a polarity switch, so this is a covariate for any ocular
         * outcome. Derived once here rather than re-derived differently in each analysis.
         *
         * `prev` is the row at session_position - 1 EXACTLY, never the nearest earlier one. Where a
         * condition is missing from the data the participant still saw whatever ran in its place,
         * so the polarity of the row two places back is not the polarity this row was switched
         * from; comparing across the hole would put a confident true/false on a comparison nobody
         * made. Empty is the honest answer, and it is the same empty the codebook reads as 'first
         * condition of the sitting' — so checkJoin raises `condition_position_gap` naming every
         * sitting with a hole in it and every row whose empty cell must not be read that way. Two
         * different absences cannot share one encoding silently; here they share it loudly.
         */
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
        /*
         * A COUNT, not a proportion.
         *
         * buildConditionSummaries returns comprehension_correct as a PROPORTION (0, 1/3, 2/3, 1),
         * which is right for its own display purposes and wrong here: the codebook nominates this
         * column as the numerator for a binomial model against comprehension_items. Exporting the
         * proportion under that description would have an analyst compute
         * cbind(0.667, 3 - 0.667) — arithmetic on two different scales, silently.
         *
         * Counted from the records rather than multiplied back out of the proportion, so no float
         * rounding sits between the answer sheet and the number modelled. The denominator is the
         * items actually ADMINISTERED for this condition, which is not necessarily the nominal
         * three if a condition was interrupted.
         */
        comprehension_correct: (() => {
          const items = compById.get(sum.condition_id) ?? [];
          return items.length > 0 ? items.filter((i) => i.is_correct).length : null;
        })(),
        comprehension_items: (() => {
          const items = compById.get(sum.condition_id) ?? [];
          return items.length > 0 ? items.length : null;
        })(),
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
        /*
         * From the SESSION, not the participant record.
         *
         * types.ts documents the participant copy as the FIRST sitting's values, sticky, and says
         * analyses needing these as covariates must read the session's. Reading the participant
         * copy made the column participant-constant: measured across four sittings whose true
         * values were false/true/false/true, every row exported `true`. A within-participant
         * covariate with zero within-participant variance drops silently out of any within-subject
         * term, and sitting 2's actual state — the reason it is collected per sitting — never
         * reaches a model. No fallback to the participant copy, which would reintroduce exactly
         * that.
         */
        caffeine_today: s.caffeine_today ?? null,
        hours_since_sleep: s.hours_since_sleep ?? null,

        ambient_lux_measured: round(s.ambient_lux),
        lux_all_in_range: s.lux_all_in_range,
        screen_luminance_cd_m2: round(s.screen_white_luminance_cd_m2),
        stimulus_scale: round(s.stimulus_scale),

        /*
         * NO EYE RECORD IS NOT THE SAME AS "THE CAMERA DID NOT RUN".
         *
         * These two read through the condition summary, which substitutes for a missing eye record:
         * camera_active defaults to false and every quality flag is forced to 'warn', so qc_overall
         * came out 'warn' whatever had happened. That is right for the dashboard, which needs
         * something to colour, and wrong here. A condition abandoned before endCondition() writes
         * its eye row has no ocular record at all, and the file was asserting two facts about it:
         * that tracking ran and did not see a face (indistinguishable from a participant who
         * declined the camera) and that its data quality had been assessed and was merely
         * questionable. An analyst filtering `qc_overall != 'bad'` kept a row with no ocular
         * measurement in it.
         *
         * The codebook already gives both columns the missing-value meaning 'no eye record' — a
         * state the writer could not produce, so the codebook described a cell that could not
         * exist. Gated on the eye record itself, empty now means exactly what it says, and false
         * still means the record exists and says tracking did not run.
         */
        camera_active: e ? sum.camera_active : null,
        effective_fps: round(sum.effective_fps),
        fps_adequate_for_ratio: e?.fps_adequate_for_ratio ?? null,
        face_presence_ratio: round(sum.face_presence_ratio),
        gaze_calibrated: e?.gaze_calibrated ?? null,
        qc_overall: e ? sum.qc.overall : null,
        /*
         * A test-harness session carries collapsed timing constants — a 150 ms reading floor
         * instead of 20 s — so its rows are not measurements of anything. The per-session codebook
         * already says such a row "must never be pooled with collected data", and 01_session_info
         * carries both of these; the pooled file, the one people actually model from, carried
         * neither. Exported rather than filtered, because this file's rule is that nothing is
         * dropped: the analyst filters, and can see what they filtered.
         *
         * `status` can be undefined on a record written before the field existed, so an unfinished
         * sitting is inferred from the absence of an end time rather than left blank.
         */
        e2e_timing: s.e2e_timing ?? null,
        session_status: s.status ?? (s.session_end_time ? 'complete' : 'in_progress'),
        // A withdrawal is not a data-quality flag, it is a standing instruction. Present so the
        // exclusion is auditable; the row must never be modelled.
        withdrawn: s.withdrawn_at != null,
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
 * The join is checked first and its verdict is carried onto every row, so no row can be modelled
 * without the exporter's conclusion about whether it may be.
 *
 * THIS SENTENCE USED TO SAY that a dataset "can never be produced whose provenance is unstated",
 * and nothing here stated any provenance at all. Four CSVs went out with no build, no commit, no
 * hash of the condition table and no checksum — while the per-session export beside it carried all
 * of that in export_manifest.json. Two years of collection can span several builds, and a re-export
 * could not be shown to be byte-identical to the file the reported numbers came from. The claim was
 * not merely unsupported, it was the opposite of what the code did, and the file it was written in
 * is the only one the confirmatory analysis reads. `analysis_manifest.json` now makes it true.
 */
export function buildAnalysisDataset(
  bundles: SessionBundle[],
  expect?: JoinExpectation,
): AnalysisDataset {
  /*
   * How many sittings a complete participant has depends on the protocol they were run under.
   *
   * Hard-coding two marked EVERY participant unanalysable the moment the split protocol was used:
   * a split runs one illumination block as two sittings of five, so a complete participant has
   * four. The expectation is therefore read from the sessions themselves — conditions_per_session
   * is recorded on each — rather than assumed. Total condition-runs is the invariant that does not
   * change: ten conditions under each of two illumination levels, however they are packaged.
   */
  const resolved: JoinExpectation = expect ?? (() => {
    const perSitting = bundles
      .map((b) => b.session.conditions_per_session)
      .filter((n): n is number => Number.isFinite(n) && n > 0);
    const cps = perSitting.length > 0 ? Math.min(...perSitting) : N_CONDITIONS;
    const total = N_CONDITIONS * ILLUMINATION_LEVELS;
    return {
      conditionsPerParticipant: total,
      sittingsPerParticipant: Math.max(1, Math.round(total / cps)),
      illuminationLevels: N_ILLUMINATION_BLOCKS,
    };
  })();

  const integrity = checkJoin(bundles, resolved);
  const verdict = new Map(integrity.participants.map((p) => [p.participant_id, p]));

  const contexts: RowContext[] = bundles.map((b) => {
    // The same stand-in key checkJoin used, so a session with no participant id resolves to its own
    // join verdict instead of falling through to the generic fallback and writing an empty group.
    const key = b.session.participant_id || unresolvedParticipantKey(b.session.session_id);
    const v = verdict.get(key);
    return {
      bundle: b,
      participantKey: key,
      analysable: v?.analysable ?? false,
      exclusion: v?.excluded_by.join(';') ?? 'participant_not_resolved',
    };
  });

  // Bracket the CSV writes: escapeCsv() blanks any non-finite number it meets, and the count of how
  // many it blanked is the only trace that leaves. Reset here so the manifest reports THIS
  // dataset's cells rather than a total carried over from an earlier per-session export.
  beginNonFiniteCount();
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

  /*
   * WHAT PRODUCED THIS DATASET, AND PROOF IT IS THE ONE THAT WAS ANALYSED.
   *
   * Mirrors export_manifest.json in the per-session bundle, which had all of this while the pooled
   * file — the one the thesis is actually modelled from — had none of it.
   *
   * Three things it has to answer, none of which any of the four CSVs can:
   *
   *  - WHICH INSTRUMENT. `builds` lists every distinct build stamp with the session_ids it
   *    collected, so a row is attributable to a build through its session_id. More than one entry
   *    means the file pools across a change to the instrument; checkJoin raises
   *    `mixed_build_provenance` so it is visible in the issues file too rather than only here.
   *  - WHETHER THIS IS THE SAME FILE. Per-file byte counts and FNV-1a checksums, so the dataset the
   *    reported numbers came from can be shown to be byte-identical to a later re-export. The
   *    manifest cannot checksum itself, so it is built last and lists only the four data files.
   *  - WHETHER ANYTHING WAS SILENTLY BLANKED. `non_finite_cells` must be 0; anything else means a
   *    NaN or Infinity reached the CSV boundary and was written as empty, and the columns that
   *    produced it have to be found before the file is modelled.
   *
   * exported_at lives here and NOT in any data file, for the reason given in export.ts: a
   * timestamp inside the data would make identical data produce different bytes, and the checksums
   * would then certify nothing.
   */
  const manifest = {
    exported_at: new Date().toISOString(),
    builds: groupByProvenance(bundles),
    dataset: {
      sessions: bundles.length,
      rows: rows.length,
      participants_total: integrity.total_participants,
      participants_analysable: integrity.analysable_participants,
      join_clean: integrity.clean,
      blocking_issue_codes: [...new Set(
        integrity.issues.filter((i) => i.severity === 'blocking').map((i) => i.code),
      )],
      warning_issue_codes: [...new Set(
        integrity.issues.filter((i) => i.severity === 'warning').map((i) => i.code),
      )],
    },
    non_finite_cells: nonFiniteCellCount(),
    files: files.map((f) => ({
      filename: f.filename, bytes: f.content.length, checksum_fnv1a: fnv1a(f.content),
    })),
  };
  files.push({
    filename: 'analysis_manifest.json',
    mime: 'application/json',
    content: JSON.stringify(manifest, null, 2),
  });

  return { files, integrity, rowCount: rows.length };
}
