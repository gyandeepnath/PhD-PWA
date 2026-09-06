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
    description: "This sitting's number for this participant. Always 1 under the standard protocol; 1 or 2 only when the ten conditions were split across two sittings for scheduling." },
  { column: 'row_id', role: 'key', unit: '-', missing: 'never empty',
    description: 'participant|session|condition. Stable and order-independent: use it to detect duplicates after any merge.' },

  // ---------------------------------------------------------------- design factors
  { column: 'illumination', role: 'factor', unit: 'moderate (constant)', missing: 'unassigned session',
    description: 'CONSTANT in this dataset: every sitting runs at 300 lux (band 250-350). Ambient illumination was a two-level session factor in an earlier version of the protocol; it was withdrawn because the ocular measures are camera-derived and, in a dim room, face illumination is confounded with polarity. The column is retained so pooled data remains separable and carries no variance here — do not enter it in a model.' },
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
    description: 'Sum-to-zero coding, dim = -0.5, moderate = +0.5. CONSTANT at +0.5 in this dataset: it is aliased with the intercept and MUST NOT be entered in a model. Retained only so this file can be pooled with earlier two-level data.' },
  { column: 'position_c', role: 'coding', unit: 'positions', missing: 'never empty',
    description: 'session_position centred on the mid-point of the sitting (4.5, since positions are 0-9), so the column has mean zero. Centring removes the correlation between the position term and the intercept, which is what keeps the intercept interpretable as the average condition.' },

  // ---------------------------------------------------------------- order and position
  { column: 'session_position', role: 'covariate', unit: '0-9', missing: 'never empty',
    description: 'Order within the sitting. Carries practice AND fatigue; the Williams square balances it across participants but it still belongs in the model as a nuisance term.' },
  { column: 'global_position', role: 'covariate', unit: '0-9', missing: 'illumination block not recorded',
    description: 'Order across the participant\u2019s whole protocol, 0-9. Derived from the recorded illumination_block, so it stays correct under a split sitting and against earlier two-block data (where the range was 0-19). Under the single-block protocol it is IDENTICAL to session_position — do not enter both.' },
  { column: 'illumination_block', role: 'covariate', unit: '0 (constant)', missing: 'never empty',
    description: 'CONSTANT in this dataset, since there is a single illumination level. Retained for separability against earlier two-level data.' },
  { column: 'illumination_order_first', role: 'covariate', unit: 'moderate (constant)', missing: 'unassigned',
    description: 'The counterbalancing assignment under the two-level protocol. CONSTANT here, since there is one level and no order to assign. No sequence effect is estimable. Retained for separability against earlier data.' },
  { column: 'adaptation_ms_before', role: 'covariate', unit: 'ms', missing: 'condition record absent',
    description: 'Grey-field adaptation that preceded this condition. Doubled on a polarity switch, so it is collinear with polarity_switched — include one or the other, not both.' },
  { column: 'polarity_switched', role: 'covariate', unit: 'boolean', missing: 'the first condition of the sitting, OR the condition immediately before this one was not recorded — check analysis_join_issues.csv for condition_position_gap on this session before reading an empty cell as a sitting boundary',
    description: 'Whether polarity changed from the previous condition. Empty on position 1 because there is no previous condition, which is not the same as false.' },
  { column: 'predecessor_condition_label', role: 'covariate', unit: '-', missing: 'no condition preceded this one in time, OR the one that did was not recorded — see condition_position_gap in analysis_join_issues.csv',
    description: 'The condition run immediately before this one. THE CARRYOVER TERM: first-order carryover is modelled by regressing on this. Empty means nothing preceded it — position 1 of a sitting, and therefore also every sitting boundary. Under the split protocol that boundary always falls between two conditions of the SAME COLOUR in OPPOSITE polarity, so those ten transitions are never observed adjacently and their carryover cannot be estimated. Check for structural zeros in the predecessor x condition table before fitting a carryover term.' },
  { column: 'passage_id', role: 'covariate', unit: 'index', missing: 'not recorded',
    description: 'Which reading passage. Decoupled from condition, so passage can carry its own random intercept and is not confounded with the display factors.' },
  { column: 'passage_repeat_number', role: 'qc', unit: 'count', missing: 'condition record absent',
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
  { column: 'fatigue_mean', role: 'secondary', unit: '0-100', missing: 'not completed',
    description: 'Mean of the five visual-fatigue VAS items for this condition.' },
  { column: 'fatigue_delta', role: 'secondary', unit: '0-100', missing: 'no baseline',
    description: "Change from this participant's own pre-session baseline. Prefer this to fatigue_mean when between-participant scale use is a concern." },
  { column: 'comfort_score', role: 'secondary', unit: '0-100', missing: 'not completed',
    description: 'Display comfort rating for this condition.' },
  { column: 'clarity_score', role: 'secondary', unit: '0-100', missing: 'not completed',
    description: 'Text clarity rating for this condition.' },
  { column: 'comprehension_correct', role: 'secondary', unit: 'count', missing: 'not completed',
    description: 'COUNT of correct items, not a proportion. Model binomially as cbind(comprehension_correct, comprehension_items - comprehension_correct). Counted from the item records, so it is an integer and the denominator is the items actually administered.' },
  { column: 'comprehension_items', role: 'secondary', unit: 'count', missing: 'no items recorded for this condition',
    description: 'Items actually ADMINISTERED for this condition — the denominator for comprehension_correct. Normally three; fewer if a condition was interrupted, which is why it is counted rather than assumed.' },
  { column: 'search_time_ms', role: 'secondary', unit: 'ms', missing: 'not completed',
    description: 'Visual-search duration. CENSORED when search_termination is the time cap: such rows are a lower bound, not a measurement, and pooling them untreated biases the mean downward.' },
  { column: 'search_accuracy', role: 'secondary', unit: '0-1', missing: 'not completed',
    description: 'Targets found over targets present.' },
  { column: 'search_termination', role: 'qc', unit: '-', missing: 'not completed',
    description: 'Whether the block ended by the participant finishing or by the 40 s cap. Decides whether search_time_ms is a measurement or a bound.' },
  { column: 'rt_mean_hits_ms', role: 'secondary', unit: 'ms', missing: 'no valid hits',
    description: 'Mean reaction time on correct go trials.' },
  { column: 'rt_median_hits_ms', role: 'secondary', unit: 'ms', missing: 'no valid hits',
    description: 'Median reaction time on correct go trials. More robust to lapses than the mean; report both.' },
  { column: 'd_prime', role: 'secondary', unit: 'z', missing: 'block not completed, OR one trial pool was empty so sensitivity was not estimable — d_prime_estimable in 09_rt_summary.csv separates the two',
    description: "Sensitivity on the go/no-go block. Check d_prime_se in 09_rt_summary.csv: with 20 go and 12 no-go trials a single block's d-prime is imprecise, and this column carries no indication of that on its own." },
  { column: 'criterion', role: 'secondary', unit: 'z', missing: 'block not completed',
    description: 'Response bias. A polarity effect on criterion without one on d_prime is a bias shift, not a sensitivity change — a distinction worth making explicitly.' },
  { column: 'rt_lapses', role: 'qc', unit: 'count', missing: 'block not completed',
    description: 'Responses slower than the lapse threshold. A proxy for disengagement in that block.' },

  // ---------------------------------------------------------------- stimulus properties
  { column: 'wcag_contrast_ratio', role: 'covariate', unit: 'ratio', missing: 'never empty',
    description: 'Text-to-background contrast. A CONTINUOUS alternative to the categorical colour factor: it lets an effect be attributed to contrast rather than to hue, which the ten-cell design alone cannot separate.' },
  { column: 'michelson_contrast', role: 'covariate', unit: '0-1', missing: 'condition record absent',
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
    description: 'Habitual-frame CVS-Q at the start of this sitting. SESSION-LEVEL, not a participant trait: it is measured, not fixed. One value per participant under the single-sitting protocol (two under a split, keyed by session_id), so it carries no within-participant variance and cannot serve as a within-subject covariate here.' },
  { column: 'caffeine_today', role: 'covariate', unit: 'boolean', missing: 'not asked',
    description: 'Caffeine on the day of THIS sitting, read from the session record rather than the participant record, which holds a sticky first-sitting copy that must NOT be used. Asked each sitting; under the single-sitting protocol that is once, so it varies BETWEEN participants only.' },
  { column: 'hours_since_sleep', role: 'covariate', unit: 'hours', missing: 'not asked',
    description: 'Hours awake at the start of THIS sitting, read from the session record. Session-level for the same reason as caffeine_today.' },

  // ---------------------------------------------------------------- session covariates
  { column: 'ambient_lux_measured', role: 'qc', unit: 'lux', missing: 'not measured',
    description: 'Measured illuminance at the eye at session start — the MANIPULATION CHECK for the single illumination level. Verify every sitting sits inside 250-350 lux; there is no illumination effect to interpret, only a constant to confirm.' },
  { column: 'lux_all_in_range', role: 'qc', unit: 'boolean', missing: 'no readings logged',
    description: 'Whether every logged reading fell inside the accepted band for the assigned level. False marks a protocol deviation on the room illuminance, which the protocol holds constant.' },
  { column: 'screen_luminance_cd_m2', role: 'covariate', unit: 'cd/m2', missing: 'not measured',
    description: 'Measured white-screen luminance. With ambient_lux_measured this gives the actual adaptation state rather than the nominal one.' },
  { column: 'stimulus_scale', role: 'covariate', unit: '0-1', missing: 'recorded before this was captured',
    description: 'The factor the interface and stimuli were rendered at. Below 1 means the text subtended a smaller visual angle than the design size. Constant within a device; include it only if more than one device was used.' },

  // ---------------------------------------------------------------- quality
  { column: 'camera_active', role: 'qc', unit: 'boolean', missing: 'no eye record',
    description: 'Whether tracking ran for this condition. False means every ocular column in the row is empty by cause, not by chance.' },
  { column: 'effective_fps', role: 'qc', unit: 'fps', missing: 'camera not running',
    description: 'Achieved tracking throughput.' },
  { column: 'fps_adequate_for_ratio', role: 'qc', unit: 'boolean', missing: 'camera not running',
    description: 'Whether the frame rate supports the primary outcome. Below the floor the sampled minimum EAR is biased UPWARD, so incomplete_blink_ratio is inflated — a directional bias, not symmetric noise. Rows are flagged and never dropped, because frame rate covaries with room brightness, which is held constant by protocol rather than manipulated: dropping them would still delete data non-randomly with respect to how well the camera saw each participant.' },
  { column: 'face_presence_ratio', role: 'qc', unit: '0-1', missing: 'camera not running',
    description: 'Proportion of samples with a face detected.' },
  { column: 'gaze_calibrated', role: 'qc', unit: 'boolean', missing: 'camera not running',
    description: 'Whether a real per-participant gaze mapping was fitted. False means gaze-derived columns are positional only.' },
  { column: 'qc_overall', role: 'qc', unit: 'good|warn|bad', missing: 'no eye record',
    description: 'Worst of the per-signal quality flags. Use for a pre-registered sensitivity analysis, not as a silent filter.' },
  { column: 'e2e_timing', role: 'qc', unit: 'boolean', missing: 'not recorded on this session',
    description: 'TRUE marks a test-harness session run with collapsed timing constants — a 150 ms reading floor instead of 20 s. Such a row is a test artefact and must never be pooled with collected data. Exported rather than filtered so the exclusion is yours and is visible; filter on it before any analysis.' },
  { column: 'session_status', role: 'qc', unit: 'in_progress|complete', missing: 'never empty',
    description: 'Whether the sitting ran to completion. An in-progress sitting contributes partial rows; inferred from the presence of an end time when the field itself predates the record.' },
  { column: 'withdrawn', role: 'qc', unit: 'boolean', missing: 'never empty',
    description: 'TRUE means the PARTICIPANT withdrew this sitting. Not a quality flag and not a judgement — a standing instruction. These rows must never be modelled, under any sensitivity analysis. They appear in the file only so the exclusion is auditable rather than silent, and the join check marks the participant unanalysable independently.' },
  { column: 'analysable', role: 'qc', unit: 'boolean', missing: 'never empty',
    description: 'The JOIN verdict for this participant, not a judgement about this row. False means the participant does not contribute a complete condition set — see analysis_join_report.csv. Filter on this for a complete-case analysis.' },
  { column: 'exclusion_reason', role: 'qc', unit: '-', missing: 'analysable rows',
    description: 'Semicolon-separated join issue codes. Empty when analysable is true.' },
];
