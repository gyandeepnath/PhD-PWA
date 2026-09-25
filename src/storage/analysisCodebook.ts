/**
 * What every column of the analysis dataset means, and how it should be used.
 *
 * A codebook is not documentation in the ordinary sense. Six months after collection, the person
 * running the model is choosing between `incomplete_blink_ratio` and `n_incomplete/n_blinks_total`,
 * deciding whether `polarity_c` is +0.5 for positive or for negative, and wondering whether a blank
 * cell means zero or means not-measured. Every one of those questions has a right answer that is
 * invisible in the data, and every one of them changes a result.
 *
 * `role` is the field that makes this actionable: it says what a column is FOR, so that outcomes,
 * design factors, covariates and quality flags cannot be confused for one another when a model is
 * specified. `missing` states what an empty cell means for that specific column, because the answer
 * genuinely differs — an empty `n_incomplete` means the camera was not running, an empty
 * `search_termination` means the block was never reached.
 */
import { PASSAGES } from '@/experiment/passages';
import { RATE_CORRECTION_NOTE } from '@/lib/signalDetection';
import { CONFIG } from '@/experiment/config';
import { ILLUMINATION, ILLUMINATION_LEVELS } from '@/experiment/illumination';

// The current protocol's single illumination level, for the prose below — derived, so it cannot say
// "300 lux" after the protocol changes. See docs/ILLUMINATION_AMENDMENT.md.
const LEVEL = ILLUMINATION[ILLUMINATION_LEVELS[0]];
const LEVEL_TEXT = `${LEVEL.level} (${LEVEL.target} lux, accepted ${LEVEL.min}-${LEVEL.max})`;
const MIXED_NOTE = 'IF analysis_join_issues.csv reports mixed_illumination_levels, this file pools data from '
  + 'an earlier protocol and the column is NOT constant: separate by protocol, or model it.';

export type ColumnRole =
  /** Identifies a row or a grouping level. Never a predictor. */
  | 'key'
  /** A manipulated independent variable. */
  | 'factor'
  /** Machine-readable coding of a factor, ready to drop into a model formula. */
  | 'coding'
  /** The primary outcome, or a component of it. */
  | 'primary'
  /** A secondary or exploratory outcome. */
  | 'secondary'
  /** Measured, not manipulated; a candidate covariate or nuisance term. */
  | 'covariate'
  /** Data quality. Use for sensitivity analyses and exclusions, never as an outcome. */
  | 'qc';

export interface AnalysisColumn {
  column: string;
  role: ColumnRole;
  unit: string;
  /** What an empty cell means for THIS column. */
  missing: string;
  description: string;
}

export const ANALYSIS_CODEBOOK: AnalysisColumn[] = [
  // ---------------------------------------------------------------- keys
  { column: 'participant_id', role: 'key', unit: '-', missing: 'never empty',
    description: 'The grouping level for every random intercept. One person, all of their condition-runs.' },
  { column: 'enrolment_number', role: 'key', unit: 'index', missing: 'no participant record',
    description: 'Drives the Williams row and the illumination order. Two participants sharing one is a design fault, flagged in analysis_join_issues.csv.' },
  { column: 'session_id', role: 'key', unit: '-', missing: 'never empty',
    description: 'One sitting. Nest this inside participant_id if a session-level random effect is wanted.' },
  { column: 'session_index', role: 'key', unit: 'index', missing: 'never empty',
    description: "1-based count of this participant's sittings (recycle bin excluded) at the moment this one started. 1 for a single sitting; above 1 for the second half of a split, a sitting started after an abandoned one, or an authorised re-run (see protocol_pass). NOT unique within a participant if a sitting was binned when a later one started — key on session_id, never on this." },
  { column: 'row_id', role: 'key', unit: '-', missing: 'never empty',
    description: 'participant|session|condition. Stable and order-independent: use it to detect duplicates after any merge.' },

  // ---------------------------------------------------------------- design factors
  { column: 'illumination', role: 'factor', unit: `${LEVEL.level} (constant under the current protocol)`, missing: 'unassigned session',
    description: `Under the current protocol every sitting runs at ${LEVEL_TEXT}, so the column is constant and must not be entered in a model. Ambient illumination was a two-level session factor in an earlier version of the protocol; it was withdrawn because the ocular measures are camera-derived and, in a dim room, face illumination is confounded with polarity. The column is retained so pooled data remains separable. ${MIXED_NOTE}` },
  { column: 'illumination_lux_target', role: 'factor', unit: 'lux', missing: 'unassigned session',
    description: 'The nominal target for the level. The MEASURED value is ambient_lux_measured; use that to check the manipulation actually held.' },
  { column: 'polarity', role: 'factor', unit: 'positive|negative', missing: 'never empty',
    description: 'Positive = dark text on light ground. A within-sitting factor.' },
  { column: 'text_colour', role: 'factor', unit: '-', missing: 'never empty',
    description: 'Five levels, crossed with polarity to give the ten conditions. Within-sitting.' },
  { column: 'condition_label', role: 'factor', unit: '-', missing: 'never empty',
    description: 'The polarity x colour cell, e.g. P3 or N5.' },

  // ---------------------------------------------------------------- coding
  { column: 'polarity_c', role: 'coding', unit: '-0.5|+0.5', missing: 'unknown level',
    description: 'Sum-to-zero coding, negative = -0.5, positive = +0.5. Use THIS in a model with interactions: with dummy coding a main effect is the simple effect at the other factor\'s reference level, not an average effect.' },
  { column: 'illumination_c', role: 'coding', unit: '-0.5|+0.5', missing: 'unknown level',
    description: `Sum-to-zero coding, dim = -0.5, moderate = +0.5. Under the current protocol it is constant, aliased with the intercept, and MUST NOT be entered in a model. Retained only so this file can be pooled with earlier two-level data. ${MIXED_NOTE}` },
  { column: 'position_c', role: 'coding', unit: 'positions', missing: 'never empty',
    description: 'session_position minus 4.5, the mid-point of the ten-condition block. Its mean is zero over participants who completed the block; centring removes the correlation between the position term and the intercept, which keeps the intercept interpretable as the average condition. Under a SPLIT the first sitting holds only -4.5..-0.5 and the second only +0.5..+4.5, so position_c is aligned with session_id: a sitting-level random effect then competes with the position term for the same variance.' },

  // ---------------------------------------------------------------- order and position
  { column: 'session_position', role: 'covariate', unit: '0-9', missing: 'never empty',
    description: 'Order within the sitting. Carries practice AND fatigue; the Williams square balances it across participants but it still belongs in the model as a nuisance term.' },
  { column: 'global_position', role: 'covariate', unit: 'positions', missing: 'illumination block not recorded (records from before it was kept)',
    description: 'Order across the participant\u2019s illumination blocks: session_position + 10 x illumination_block. 0-9 under the current single-block protocol, where it is IDENTICAL to session_position — do not enter both; 0-19 in earlier two-block data. It restarts on an authorised re-run of the protocol, so a re-run participant has two passes at 0-9: read protocol_pass to tell them apart.' },
  { column: 'illumination_block', role: 'covariate', unit: 'block', missing: 'records from before it was kept',
    description: `0 on every sitting under the current single-level protocol. Retained for separability against earlier two-level data (0 or 1 there). ${MIXED_NOTE}` },
  { column: 'illumination_order_first', role: 'covariate', unit: 'level', missing: 'unassigned',
    description: `The counterbalancing assignment under the two-level protocol. Constant (${LEVEL.level}) under the current protocol, since there is one level and no order to assign, and no sequence effect is estimable. Retained for separability against earlier data. ${MIXED_NOTE}` },
  { column: 'adaptation_ms_before', role: 'covariate', unit: 'ms', missing: 'recorded before this was kept',
    description: 'Grey-field adaptation that preceded this condition, in ms of visible grey. PARTICIPANT-PACED: Continue is offered after 30 s and the field ends by itself at 60 s (120 s across a polarity switch), so the length reflects the participant as well as the protocol. Model it as a covariate or report its distribution by condition; a sensitivity analysis dropping short fields is reasonable. It is no longer collinear with polarity_switched. Rows from earlier builds ran a fixed 60 s or 120 s.' },
  { column: 'adaptation_ended_by', role: 'qc', unit: 'participant|timer', missing: 'fixed-length field (earlier build), or no field before this condition',
    description: 'Whether the participant tapped Continue after the minimum, or the grey field reached its maximum.' },
  { column: 'polarity_switched', role: 'covariate', unit: 'boolean', missing: 'the first condition of the sitting, OR the condition immediately before this one was not recorded — check analysis_join_issues.csv for condition_position_gap on this session before reading an empty cell as a sitting boundary',
    description: 'Whether polarity changed from the previous condition. Empty on position 1 because there is no previous condition, which is not the same as false.' },
  { column: 'predecessor_condition_label', role: 'covariate', unit: '-', missing: 'no condition preceded this one in time, OR the one that did was not recorded — see condition_position_gap in analysis_join_issues.csv',
    description: 'The condition run immediately before this one. THE CARRYOVER TERM: first-order carryover is modelled by regressing on this. Empty means nothing preceded it — position 1 of a sitting, and therefore also every sitting boundary. Under the split protocol that boundary always falls between two conditions of the SAME COLOUR in OPPOSITE polarity, so those ten transitions are never observed adjacently and their carryover cannot be estimated. Check for structural zeros in the predecessor x condition table before fitting a carryover term.' },
  { column: 'passage_id', role: 'covariate', unit: 'index', missing: 'not recorded',
    description: 'Which reading passage. PASSAGE x POSITION is uniform across the cohort; passage x CONDITION is NOT - each condition meets three of the ten passages twice as often as the other seven. Carry the passage random intercept, and do not assume passage is balanced against the display factors. Was previously described as decoupled from condition, which was wrong. Original note follows: not confounded with the display factors.' },
  { column: 'passage_repeat_number', role: 'qc', unit: 'count', missing: 'recorded before this was kept',
    description: 'How many times this participant has now seen this passage. Anything above 1 means re-reading, which affects comprehension and reading speed.' },

  // ---------------------------------------------------------------- primary outcome
  { column: 'n_incomplete', role: 'primary', unit: 'count', missing: 'camera not running',
    description: 'NUMERATOR of the primary outcome: blinks that crossed the registration threshold without reaching full closure.' },
  { column: 'n_blinks_total', role: 'primary', unit: 'count', missing: 'any component missing',
    description: 'DENOMINATOR: incomplete + full + micro. Model the primary outcome as cbind(n_incomplete, n_blinks_total - n_incomplete) in a binomial mixed model. This weights each observation by the information it carries; a ratio from 8 blinks and one from 60 are not the same measurement.' },
  { column: 'incomplete_blink_ratio', role: 'primary', unit: '0-1', missing: 'camera not running',
    description: 'The proportion itself, for description and plots. Prefer the counts for inference: a Gaussian model of this column treats an 8-blink and a 60-blink observation as equally precise.' },
  { column: 'blink_rate_per_min', role: 'secondary', unit: 'blinks/min', missing: 'camera not running',
    description: 'Spontaneous blink rate during the reading exposure. Computed over observed_duration_ms, not wall clock.' },
  { column: 'observed_duration_ms', role: 'qc', unit: 'ms', missing: 'camera not running',
    description: 'Milliseconds of the exposure the camera actually saw. COMPARE WITH reading_time_ms: a large shortfall means every rate in the row describes only the fraction that was observed, and the rates themselves look entirely normal.' },
  { column: 'reading_time_ms', role: 'secondary', unit: 'ms', missing: 'not recorded',
    description: 'Time on the reading task, excluding time the app was hidden.' },
  { column: 'reading_speed_wpm', role: 'secondary', unit: 'words/min', missing: 'word count or time missing',
    description: "Passage word count over reading time. Derived identically to 02_conditions.csv." },

  // ---------------------------------------------------------------- secondary ocular
  { column: 'perclos_p80', role: 'secondary', unit: '0-1', missing: 'camera not running',
    description: 'Proportion of observed time with eye openness below 80% of the calibrated baseline.' },
  { column: 'blink_duration_mean_ms', role: 'secondary', unit: 'ms', missing: 'camera not running',
    description: 'Mean duration of detected blinks.' },
  { column: 'mean_inter_blink_interval_ms', role: 'secondary', unit: 'ms', missing: 'fewer than two blinks',
    description: 'Mean interval between blink onsets.' },
  { column: 'head_pitch_mean', role: 'covariate', unit: 'degrees', missing: 'camera not running',
    description: "Head pitch relative to the participant's own calibrated frontal posture, not a population mean." },
  { column: 'head_movement_std', role: 'covariate', unit: 'degrees', missing: 'camera not running',
    description: 'Postural instability during the exposure.' },
  { column: 'off_axis_ratio', role: 'qc', unit: '0-1', missing: 'camera not running',
    description: 'Proportion of samples with the head turned far enough that EAR is unreliable. High values undermine the primary outcome for that row.' },

  // ---------------------------------------------------------------- subjective and performance
  /*
   * 0-10, NOT 0-100. The instrument's sliders are max={10}. These two entries said 0-100 while the
   * same quantity is documented 0-10 in both of export.ts's entries for it — and they sit directly
   * above comfort_score and clarity_score, which genuinely ARE 0-100, inviting an analyst to read
   * all four on one scale and to report a fatigue effect an order of magnitude too small.
   */
  { column: 'fatigue_mean', role: 'secondary', unit: '0-10', missing: 'not completed',
    description: 'Mean of the five visual-fatigue VAS items for this condition.' },
  { column: 'fatigue_delta', role: 'secondary', unit: '-10-10', missing: 'no baseline',
    description: "SIGNED change from this sitting's own pre-exposure baseline: fatigue_mean minus the baseline mean, so positive is worse than at baseline and negative is better. It was declared '0-10', which made every improvement over baseline count as an out-of-range cell in the manifest. Prefer this to fatigue_mean when between-participant scale use is a concern." },
  { column: 'comfort_score', role: 'secondary', unit: '0-100', missing: 'not completed',
    description: 'Display comfort rating for this condition.' },
  { column: 'clarity_score', role: 'secondary', unit: '0-100', missing: 'not completed',
    description: 'Text clarity rating for this condition.' },
  { column: 'comprehension_correct', role: 'secondary', unit: 'count', missing: 'not completed',
    description: 'COUNT of correct items, not a proportion. Model binomially as cbind(comprehension_correct, comprehension_items - comprehension_correct). Counted from the item records, so it is an integer and the denominator is the items actually administered.' },
  { column: 'comprehension_items', role: 'secondary', unit: 'count', missing: 'no items recorded for this condition',
    description: 'Items actually ADMINISTERED for this condition — the denominator for comprehension_correct. Normally three; fewer if a condition was interrupted, which is why it is counted rather than assumed.' },
  { column: 'search_time_ms', role: 'secondary', unit: 'ms', missing: 'not completed',
    description: 'Visual-search duration. A MEASUREMENT only when search_termination is voluntary_full. At time_limit the clock ran out, and at voluntary_early the participant stopped before finding every target: in both the time to find them all was not observed, so the row is right-censored, a lower bound. Pooling censored rows untreated biases the mean downward, and giving up early is plausibly commoner in the hardest conditions.' },
  { column: 'search_accuracy', role: 'secondary', unit: '0-1', missing: 'not completed',
    description: `Targets found over targets present ON THE SEARCH SCREEN — a one-screen excerpt of the passage, at the reading font size, where its target is densest. Target counts differ by passage (${Math.min(...PASSAGES.map((p) => p.searchTargetCount))} to ${Math.max(...PASSAGES.map((p) => p.searchTargetCount))}), by investigator decision, so this is not directly comparable across passages: carry passage_id as a random effect rather than treating rows as equally difficult.` },
  { column: 'search_d_prime', role: 'secondary', unit: "d'", missing: 'not completed',
    description: `PREFER THIS TO search_accuracy as the search outcome. Sensitivity over words-as-trials: hits are target words tapped, false alarms are non-target words tapped, and the correct-rejection pool is the rest of the passage. search_accuracy ignores false detections entirely, so a participant who taps indiscriminately finds every target in seconds and scores 1.0 on it with no quality flag raised; d-prime does not reward that. ${RATE_CORRECTION_NOTE}` },
  { column: 'search_d_prime_se', role: 'qc', unit: "d'", missing: 'search_d_prime blank, or recorded before it was kept',
    description: 'Standard error of search_d_prime. The target pool is a handful of words, so it is large and passage-dependent: weight search_d_prime by its inverse, as the plan does for the reaction-time d-prime.' },
  { column: 'search_false_detections', role: 'secondary', unit: 'count', missing: 'not completed',
    description: 'Non-target words tapped, counted once per word. A rise with stable search_accuracy is a criterion shift rather than a sensitivity change, and a large value beside a high search_accuracy and a short search_time_ms is the signature of tapping indiscriminately.' },
  { column: 'search_termination', role: 'qc', unit: 'voluntary_full|voluntary_early|time_limit', missing: 'not completed',
    description: `How the block ended: voluntary_full (every target found), voluntary_early (the participant tapped Done first), or time_limit (the ${CONFIG.VS_TIME_LIMIT_MS / 1000} s cap). Only voluntary_full makes search_time_ms a measurement; the other two make it a lower bound.` },
  { column: 'rt_mean_hits_ms', role: 'secondary', unit: 'ms', missing: 'no valid hits',
    description: 'Mean reaction time on correct go trials.' },
  { column: 'rt_median_hits_ms', role: 'secondary', unit: 'ms', missing: 'no valid hits',
    description: 'Median reaction time on correct go trials. More robust to lapses than the mean; report both.' },
  { column: 'd_prime', role: 'secondary', unit: 'z', missing: 'block not completed, OR one trial pool was empty so sensitivity was not estimable — d_prime_estimable in 09_rt_summary.csv separates the two',
    description: `Sensitivity on the go/no-go block. Check d_prime_se in 09_rt_summary.csv: with 20 go and 12 no-go trials a single block's d-prime is imprecise, and this column carries no indication of that on its own. ${RATE_CORRECTION_NOTE}` },
  { column: 'criterion', role: 'secondary', unit: 'z', missing: 'block not completed',
    description: 'Response bias. A polarity effect on criterion without one on d_prime is a bias shift, not a sensitivity change — a distinction worth making explicitly.' },
  { column: 'rt_lapses', role: 'qc', unit: 'count', missing: 'block not completed',
    description: 'Responses slower than the lapse threshold. A proxy for disengagement in that block.' },

  // ---------------------------------------------------------------- stimulus properties
  { column: 'wcag_contrast_ratio', role: 'covariate', unit: 'ratio', missing: 'never empty',
    description: 'Text-to-background contrast. A CONTINUOUS alternative to the categorical colour factor: it lets an effect be attributed to contrast rather than to hue, which the ten-cell design alone cannot separate.' },
  { column: 'michelson_contrast', role: 'covariate', unit: '0-1', missing: 'recorded before this was kept',
    description: 'Alternative contrast metric. Use one or the other, not both — they are near-collinear.' },
  { column: 'below_wcag_aa', role: 'covariate', unit: 'boolean', missing: 'never empty',
    description: 'Whether the pairing fails the WCAG AA threshold. Useful for an accessibility-framed contrast rather than a colour-by-colour one.' },

  // ---------------------------------------------------------------- participant covariates
  { column: 'age', role: 'covariate', unit: 'years', missing: 'no participant record', description: 'Participant age in whole years. Eligibility restricts this to 18-35, so its range is narrow and it is unlikely to carry much variance in this sample.' },
  { column: 'gender', role: 'covariate', unit: '-', missing: 'no participant record', description: 'Self-reported gender. Recorded for sample description; not a hypothesised moderator, so include it as a covariate only with a stated reason.' },
  { column: 'daily_screen_hours', role: 'covariate', unit: 'hours', missing: 'no participant record',
    description: 'Habitual daily screen exposure.' },
  { column: 'correction_type', role: 'covariate', unit: '-', missing: 'no participant record',
    description: 'None, glasses or contacts. Contact lens wear is an established influence on ocular-surface outcomes and should be tested as a covariate on the blink measures.' },
  { column: 'cvd_status', role: 'covariate', unit: '-', missing: 'no participant record',
    description: "Colour-vision status. RELEVANT TO THE COLOUR FACTOR SPECIFICALLY: the app's own screen has no published operating characteristics and is a covariate and a flag, never a basis for exclusion." },
  { column: 'cvsq_baseline_total', role: 'covariate', unit: 'score', missing: 'baseline not completed',
    description: 'Habitual-frame CVS-Q at the start of this sitting. SESSION-LEVEL, not a participant trait: it is measured, not fixed, and constant within a sitting. One value per participant for a single sitting. Under a SPLIT there are two, keyed by session_id, and they can differ — the second is measured after the first half\'s exposure — and they line up exactly with positions 0-4 versus 5-9. Do not use it as a within-participant covariate: it would absorb part of the position and fatigue effect.' },
  { column: 'caffeine_today', role: 'covariate', unit: 'boolean', missing: 'not asked',
    description: 'Caffeine on the day of THIS sitting, read from the session record rather than the participant record, which holds a sticky first-sitting copy that must NOT be used. Asked each sitting; under the single-sitting protocol that is once, so it varies BETWEEN participants only.' },
  { column: 'hours_since_sleep', role: 'covariate', unit: 'hours', missing: 'not asked',
    description: 'Hours awake at the start of THIS sitting, read from the session record. Session-level for the same reason as caffeine_today.' },

  // ---------------------------------------------------------------- session covariates
  { column: 'ambient_lux_measured', role: 'qc', unit: 'lux', missing: 'not measured',
    description: `Measured illuminance at the eye at session start — the MANIPULATION CHECK for the illumination level. Under the current protocol verify every sitting sits inside ${LEVEL.min}-${LEVEL.max} lux; there is no illumination effect to interpret, only a constant to confirm.` },
  { column: 'lux_logged_all_in_range', role: 'qc', unit: 'boolean', missing: 'no readings logged, or the level is unknown, so the check could not be made',
    description: 'Whether every LOGGED reading fell inside the accepted band for the assigned level. False marks a protocol deviation on the room illuminance. It says nothing about readings that were never taken: read lux_complete beside it. Named as in 01_session_info.csv; this file used to call it lux_all_in_range, and a sitting with only the start reading logged read TRUE.' },
  { column: 'lux_complete', role: 'qc', unit: 'boolean', missing: 'never empty',
    description: 'Whether all three checkpoint readings (start, middle, end) were logged. FALSE means illuminance was not verified throughout the sitting, whatever lux_logged_all_in_range says.' },
  { column: 'screen_luminance_cd_m2', role: 'covariate', unit: 'cd/m2', missing: 'not measured',
    description: 'Measured white-screen luminance. With ambient_lux_measured this gives the actual adaptation state rather than the nominal one.' },
  { column: 'stimulus_scale', role: 'covariate', unit: '0-1', missing: 'recorded before this was captured',
    description: 'The factor the interface and stimuli were rendered at WHEN THIS CONDITION STARTED. Below 1 means the text subtended a smaller visual angle than the design size. It can change within a sitting (the address bar, the orientation, the stand), which the per-sitting audit warns about; this column used to repeat the session\'s stamp from before the participant touched the tablet. Blank on rows recorded before it was captured per condition.' },

  // ---------------------------------------------------------------- quality
  { column: 'camera_active', role: 'qc', unit: 'boolean', missing: 'no eye record',
    description: 'Whether tracking ran for this condition. False means every ocular column in the row is empty by cause, not by chance.' },
  { column: 'camera_inactive_reason', role: 'qc', unit: 'lost|not_running', missing: 'camera running, no eye record, or recorded before the column existed',
    description: 'Why camera_active is FALSE: lost = the camera had been running in this sitting and stopped (track ended or frames stopped); not_running = it was not running and had not been lost since this stretch of the sitting began (declined, denied, unavailable, or not restarted on a resume). A camera lost part-way through a sitting leaves the remaining rows missing for a known cause; this is what tells them apart from a participant who declined.' },
  { column: 'effective_fps', role: 'qc', unit: 'fps', missing: 'camera not running',
    description: 'Achieved sampling rate of the EAR series — face-solved frames per second, not the camera frame rate. This is what fps_adequate_for_ratio gates on.' },
  { column: 'fps_adequate_for_ratio', role: 'qc', unit: 'boolean', missing: 'camera not running',
    description: 'Whether the frame rate supports the primary outcome. Below the floor the sampled minimum EAR is biased UPWARD, so incomplete_blink_ratio is inflated — a directional bias, not symmetric noise. Rows are flagged and never dropped, because frame rate covaries with room brightness, which is held constant by protocol rather than manipulated: dropping them would still delete data non-randomly with respect to how well the camera saw each participant.' },
  { column: 'face_presence_ratio', role: 'qc', unit: '0-1', missing: 'camera not running',
    description: 'Proportion of samples with a face detected.' },
  { column: 'gaze_calibrated', role: 'qc', unit: 'boolean', missing: 'camera not running',
    description: 'Whether a real per-participant gaze mapping was fitted. False means gaze-derived columns are positional only.' },
  { column: 'gaze_trust', role: 'qc', unit: 'good|thin|unusable', missing: 'camera not running, or no calibration resolvable for the row',
    description: 'How much evidence the gaze fit rests on. good = two thirds of the nine targets were tracked through at least half their dwell; thin = it cleared the acceptance bar on very little data; unusable = the fit was rejected. FILTER GAZE MEASURES ON THIS, not on gaze_calibrated: that flag is TRUE for both good and thin, and a thin fit produces thresholds closer to noise than to measurement. Per ROW: the calibration this condition was measured under (a sitting holds several when calibration was retried or the sitting resumed). Blank when the camera was not running, or when an older row cannot be matched to a calibration unambiguously.' },
  { column: 'gaze_targets_well_covered', role: 'qc', unit: 'targets', missing: 'camera not running, or no calibration resolvable for the row',
    description: 'How many of the nine calibration targets were tracked through at least half their dwell, as opposed to merely registering at all. The evidence behind gaze_trust, from the same per-row calibration.' },
  { column: 'sitting_split_reason', role: 'covariate', missing: 'single sitting, or not recorded', unit: '-',
    description: "Why the researcher split this participant's conditions across two sittings; blank for a single sitting. READ IT BEFORE POOLING. The structure is an operator choice made per participant, so if splits were granted because someone looked tired then fatigue exposure varies between people for a reason correlated with the outcome — which makes this a covariate rather than a free choice. A logistical reason is harmless; a clinical one is not, and only the recorded text distinguishes them." },
  { column: 'qc_overall', role: 'qc', unit: 'good|warn|bad', missing: 'no eye record',
    description: 'Worst of the per-signal quality flags. Use for a pre-registered sensitivity analysis, not as a silent filter.' },
  { column: 'e2e_timing', role: 'qc', unit: 'boolean', missing: 'not recorded on this session',
    description: 'TRUE marks a test-harness session run with collapsed timing constants — a 150 ms reading floor instead of 20 s. Such a row is a test artefact and must never be pooled with collected data. Exported rather than filtered so the exclusion is yours and is visible; filter on it before any analysis.' },
  { column: 'session_status', role: 'qc', unit: 'in_progress|complete', missing: 'never empty',
    description: 'Whether the sitting ran to completion. An in-progress sitting contributes partial rows; inferred from the presence of an end time when the field itself predates the record.' },
  { column: 'withdrawn', role: 'qc', unit: 'boolean', missing: 'never empty',
    description: 'TRUE means the PARTICIPANT withdrew from the study — in this sitting or any other of theirs in the dataset, so every row of theirs carries it. Not a quality flag and not a judgement — a standing instruction. These rows must never be modelled, under any sensitivity analysis. They appear in the file only so the exclusion is auditable rather than silent, and the join check marks the participant unanalysable independently.' },
  { column: 'protocol_pass', role: 'qc', unit: 'count', missing: 'recorded before this was kept',
    description: 'Complete passes through the ten conditions this participant had already finished when this sitting began. 0 for every sitting of the study as designed. 1 or more is an authorised REPEAT: every passage re-read, every search repeated, every question seen again, so reading, comprehension and search on those rows are second exposures. Decide which pass is authoritative before modelling; global_position restarts on each pass.' },
  { column: 'repeat_run_note', role: 'qc', unit: 'text', missing: 'not a repeat (protocol_pass 0)',
    description: 'The researcher\'s written reason for re-running a participant who had completed the protocol, required by the console before a repeat can start.' },
  { column: 'condition_complete', role: 'qc', unit: 'boolean', missing: 'never empty',
    description: "TRUE when this condition-run FINISHED — its reaction-time block completed. FALSE for a condition that was paused, crashed or abandoned part-way: the Pause dialog tells the operator such a condition 'will be restarted on resume', and if the sitting was never resumed its partial rows remain. They are real data and are kept, because a paused condition's reading exposure may be usable ocular data in a sensitivity analysis, but THE ROW IS NOT A MEASUREMENT OF ITS CONDITION: later stages are empty, and the ones present describe a run that did not end. Always filter on this before modelling. analysable is FALSE on every such row." },
  { column: 'attempt_number', role: 'qc', unit: 'count', missing: 'row written before this was recorded',
    description: 'How many times this condition was started, counting this run. 1 for a clean run. Above 1 means the condition was restarted after an interruption, so the participant had already read this passage, seen the comprehension questions and searched for this target: reading_time_ms, reading_speed_wpm, comprehension_correct and search_time_ms are SECOND-EXPOSURE values. The ocular outcome is a fresh exposure but not a naive one. Model this or exclude these rows in a sensitivity analysis; passage_repeat_number does not cover it.' },
  { column: 'condition_interrupted', role: 'qc', unit: 'boolean', missing: 'never empty',
    description: 'TRUE when, somewhere in this condition, the app was backgrounded, the tablet was held in portrait, or the camera-lost notice was up, for more than 2 s. All three stop the participant responding while the timed tasks keep running, so reaction-time misses, lapses and search time on this row include time the participant could not act. Recorded, not dropped; use it to define a sensitivity analysis.' },
  { column: 'analysable', role: 'qc', unit: 'boolean', missing: 'never empty',
    description: 'FALSE when the participant does not contribute a complete set of FINISHED condition-runs (see analysis_join_report.csv), and always FALSE on a row whose own condition_complete is FALSE. Only finished runs count toward the set: a sitting paused in its last condition used to pass this check, because the paused condition had a row. Filter on this for a complete-case analysis.' },
  { column: 'exclusion_reason', role: 'qc', unit: '-', missing: 'analysable rows',
    description: 'Semicolon-separated issue codes: the participant-level join codes, plus condition_incomplete on a row whose own run did not finish. Empty when analysable is true.' },
];
