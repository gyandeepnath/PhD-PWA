/**
 * Referential-integrity audit of a session bundle.
 *
 * The export joins six child stores onto the condition table by `condition_id`, using a linear
 * `find` per store. That join is only sound if condition_id is unique and every child row points
 * at a real condition. Neither was ever verified, and the failure is silent in the worst way:
 * with two conditions sharing an id, BOTH receive the first one's measurements, so a display
 * condition is reported with another condition's blink rate, reaction times and ratings. Nothing
 * in the output looks wrong - the row counts are right and every cell is populated.
 *
 * This module states those assumptions explicitly and reports where they fail, so a dataset can be
 * checked before it is analysed rather than trusted because it parsed.
 *
 * Nothing here mutates or drops data. An integrity fault is reported, never silently repaired:
 * quietly de-duplicating would hide the upstream bug that produced the duplicate.
 */
import { QUESTIONS_PER_PASSAGE } from '@/experiment/passages';
import type { SessionBundle } from './gather';

export type IntegritySeverity = 'error' | 'warning' | 'info';

export interface IntegrityFinding {
  severity: IntegritySeverity;
  check: string;
  detail: string;
  /** Identifiers involved, so the finding can be traced back to specific records. */
  refs: string[];
}

export interface IntegrityReport {
  findings: IntegrityFinding[];
  errors: number;
  warnings: number;
  /** True when nothing of severity "error" was found - the dataset's joins are sound. */
  joins_sound: boolean;
}

/** Values appearing more than once, with their counts. */
function duplicates<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const seen = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Map([...seen].filter(([, n]) => n > 1));
}

export function auditBundle(bundle: SessionBundle): IntegrityReport {
  const f: IntegrityFinding[] = [];
  const add = (severity: IntegritySeverity, check: string, detail: string, refs: string[] = []) =>
    f.push({ severity, check, detail, refs });

  const conditions = bundle.conditions ?? [];
  const validIds = new Set(conditions.map((c) => c.condition_id));

  // ---- the join key must be unique, or every join is ambiguous
  const dupIds = duplicates(conditions, (c) => c.condition_id);
  for (const [id, n] of dupIds) {
    const labels = conditions.filter((c) => c.condition_id === id).map((c) => c.condition_label);
    add('error', 'condition_id_unique',
      `condition_id "${id}" appears ${n} times (${labels.join(', ')}). Every child store joins on ` +
      `this key, so all ${n} conditions receive the FIRST one's measurements.`, [id, ...labels]);
  }

  // ---- serial position is a modelled covariate; a duplicate makes it wrong for both rows
  const dupPos = duplicates(conditions, (c) => String(c.session_position));
  for (const [pos, n] of dupPos) {
    add('error', 'session_position_unique',
      `session_position ${pos} appears ${n} times. Serial position is a covariate in the model; ` +
      `duplicates misstate the order effect for every affected condition.`, [pos]);
  }

  // ---- labels should not repeat within a sitting
  const dupLabels = duplicates(conditions, (c) => c.condition_label);
  for (const [label, n] of dupLabels) {
    add('error', 'condition_label_unique',
      `condition_label "${label}" appears ${n} times in one sitting.`, [label]);
  }

  // ---- child rows must point at a real condition
  const childStores: [string, { condition_id: string }[]][] = [
    ['eye_metrics', bundle.eyeMetrics ?? []],
    ['rt_summaries', bundle.rtSummaries ?? []],
    ['visual_search', bundle.visualSearch ?? []],
    ['display_perception', bundle.perception ?? []],
  ];
  for (const [name, rows] of childStores) {
    const orphans = rows.filter((r) => r.condition_id && !validIds.has(r.condition_id));
    if (orphans.length) {
      add('error', 'no_orphan_records',
        `${name}: ${orphans.length} row(s) reference a condition_id that does not exist in this ` +
        `session. They are exported but join to nothing, so their measurements are invisible to ` +
        `any per-condition analysis.`, orphans.slice(0, 5).map((o) => o.condition_id));
    }
    const dup = duplicates(rows.filter((r) => validIds.has(r.condition_id)), (r) => r.condition_id);
    for (const [id, n] of dup) {
      add('error', 'one_child_row_per_condition',
        `${name}: ${n} rows for condition_id "${id}". The join takes the first and silently ` +
        `discards the rest.`, [id]);
    }
  }

  // ---- comprehension is one row per ITEM, so the cardinality rule is the item count, not one.
  // A condition carrying two rows where the passage defines three means an item was lost between
  // the participant answering it and the row being written, which no downstream check would
  // notice: the proportion would simply be computed over a smaller denominator and look valid.
  {
    const rows = bundle.comprehension ?? [];
    const orphans = rows.filter((r) => r.condition_id && !validIds.has(r.condition_id));
    if (orphans.length) {
      add('error', 'no_orphan_records',
        `comprehension: ${orphans.length} row(s) reference a condition_id that does not exist in ` +
        `this session. They are exported but join to nothing.`, orphans.slice(0, 5).map((o) => o.condition_id));
    }
    const byCondition = new Map<string, typeof rows>();
    for (const r of rows.filter((x) => validIds.has(x.condition_id))) {
      const list = byCondition.get(r.condition_id) ?? [];
      list.push(r);
      byCondition.set(r.condition_id, list);
    }
    for (const [id, list] of byCondition) {
      if (list.length !== QUESTIONS_PER_PASSAGE) {
        add('error', 'comprehension_item_count',
          `comprehension: condition "${id}" has ${list.length} item(s) where the passage defines ` +
          `${QUESTIONS_PER_PASSAGE}. Accuracy for this condition would be computed over the wrong ` +
          `denominator.`, [id]);
      }
      for (const [idx, n] of duplicates(list, (r) => String(r.question_index))) {
        add('error', 'comprehension_item_unique',
          `comprehension: condition "${id}" records item ${idx} ${n} times, which double-counts ` +
          `that answer in the per-condition proportion.`, [id]);
      }
      for (const r of list) {
        if (r.question_index < 0 || r.question_index >= QUESTIONS_PER_PASSAGE) {
          add('error', 'comprehension_item_range',
            `comprehension: condition "${id}" records item index ${r.question_index}, outside the ` +
            `0..${QUESTIONS_PER_PASSAGE - 1} range the passage defines.`, [id]);
        }
      }
    }
    const missingComp = conditions.filter((c) => !byCondition.has(c.condition_id));
    if (missingComp.length) {
      add('warning', 'measurement_coverage',
        `comprehension: ${missingComp.length} condition(s) recorded no comprehension item at all.`,
        missingComp.slice(0, 5).map((c) => c.condition_label));
    }
  }

  // ---- post-condition fatigue is one per condition
  const post = (bundle.fatigue ?? []).filter((x) => x.stage === 'post_condition' && x.condition_id);
  for (const [id, n] of duplicates(post, (x) => String(x.condition_id))) {
    add('error', 'one_child_row_per_condition',
      `fatigue_scores: ${n} post_condition rows for condition_id "${id}". The join takes the ` +
      `first and silently discards the rest.`, [id]);
  }
  const orphanFatigue = post.filter((x) => !validIds.has(String(x.condition_id)));
  if (orphanFatigue.length) {
    add('error', 'no_orphan_records',
      `fatigue_scores: ${orphanFatigue.length} post_condition row(s) reference an unknown condition.`,
      orphanFatigue.slice(0, 5).map((o) => String(o.condition_id)));
  }

  // ---- coverage: a condition that ran should have produced measurements
  for (const [name, rows] of childStores) {
    const covered = new Set(rows.map((r) => r.condition_id));
    const missing = conditions.filter((c) => !covered.has(c.condition_id));
    if (missing.length) {
      add(missing.length === conditions.length ? 'warning' : 'error', 'complete_coverage',
        `${name}: no row for ${missing.length}/${conditions.length} condition(s)` +
        (missing.length === conditions.length ? ' (the whole store is absent for this session)' : ''),
        missing.slice(0, 5).map((c) => c.condition_label));
    }
  }

  // ---- session-level expectations
  const baseline = (bundle.fatigue ?? []).filter((x) => x.stage === 'baseline');
  if (baseline.length !== 1 && conditions.length > 0) {
    add(baseline.length === 0 ? 'error' : 'warning', 'one_baseline_fatigue',
      `expected exactly one baseline fatigue record, found ${baseline.length}. ` +
      `fatigue_delta is computed against it.`);
  }
  const cvsqStages = new Set((bundle.cvsq ?? []).map((c) => c.stage));
  if (conditions.length > 0 && !(cvsqStages.has('baseline') && cvsqStages.has('session_end'))) {
    add('warning', 'cvsq_pair_present',
      `the key secondary outcome is the CVS-Q CHANGE score, which needs both a baseline and a ` +
      `session_end record; found: ${[...cvsqStages].join(', ') || 'neither'}.`);
  }
  // Presence is not enough: the change score needs exactly ONE row per stage. Two session_end rows
  // — which a crash between the closing CVS-Q and the NASA-TLX used to produce — make the key
  // secondary outcome ambiguous, and whichever row a join picks is the post-rest one.
  for (const stage of ['baseline', 'session_end'] as const) {
    const n = (bundle.cvsq ?? []).filter((c) => c.stage === stage).length;
    if (n > 1) {
      add('error', 'one_cvsq_per_stage',
        `${n} CVS-Q records for stage "${stage}"; exactly one is expected. The CVS-Q change score ` +
        `is the key secondary outcome and cannot be computed unambiguously from duplicates.`);
    }
  }

  if ((bundle.tlx ?? []).length > 1) {
    add('error', 'one_tlx_per_session',
      `NASA-TLX is administered once per session; found ${bundle.tlx.length} records.`);
  }

  // ---- reaction TRIALS: the largest store, and the only trial-level observation in the study
  //
  // Nothing checked it. It is the one store whose rows the analysis JSON deliberately drops (it
  // keeps only reaction_trials_count), so a fault here survives every other check: the per-condition
  // rt_summaries row is computed from the trials at collection time, exported, and then agrees with
  // itself for ever after, whatever the trials underneath it say. An analyst who re-derives d' or a
  // median RT from 08_reaction_trials.csv would get a different answer from 09_rt_summary.csv and
  // have no way to tell which is right.
  {
    const trials = bundle.reactionTrials ?? [];
    const summaries = bundle.rtSummaries ?? [];

    for (const [id, n] of duplicates(trials, (r) => r.trial_id)) {
      add('error', 'trial_id_unique',
        `reaction_trials: trial_id "${id}" appears ${n} times. A duplicated trial is counted ${n} ` +
        `times in every rate derived from the trials.`, [id]);
    }

    const orphanTrials = trials.filter((r) => r.condition_id && !validIds.has(r.condition_id));
    if (orphanTrials.length) {
      add('error', 'no_orphan_records',
        `reaction_trials: ${orphanTrials.length} trial(s) reference a condition_id that does not ` +
        `exist in this session, so they belong to no display condition.`,
        [...new Set(orphanTrials.map((o) => o.condition_id))].slice(0, 5));
    }

    // Trial numbering must be a complete 1..N run within each condition. A gap means a trial was
    // lost between the participant responding and the row being written, and every rate for that
    // condition is then computed over a smaller denominator and looks perfectly valid.
    const byCond = new Map<string, typeof trials>();
    for (const r of trials.filter((x) => validIds.has(x.condition_id))) {
      const list = byCond.get(r.condition_id) ?? [];
      list.push(r);
      byCond.set(r.condition_id, list);
    }
    for (const [id, list] of byCond) {
      for (const [num, n] of duplicates(list, (r) => String(r.trial_number))) {
        add('error', 'trial_number_unique',
          `reaction_trials: condition "${id}" records trial_number ${num} ${n} times.`, [id]);
      }
      const nums = new Set(list.map((r) => r.trial_number));
      const missing = [];
      for (let i = 1; i <= list.length; i++) if (!nums.has(i)) missing.push(i);
      if (missing.length) {
        add('error', 'trial_sequence_complete',
          `reaction_trials: condition "${id}" has ${list.length} trials but its numbering is not a ` +
          `complete 1..${list.length} run (missing ${missing.slice(0, 5).join(', ')}). Trials were ` +
          `lost, and every rate for this condition is computed over the wrong denominator.`, [id]);
      }

      // A response time on a trial with no response, or a missing one on a trial that had a
      // response, means accuracy and RT disagree about what happened.
      for (const r of list) {
        const responded = r.response_time_ms != null;
        const claimsResponse = r.accuracy === 'hit' || r.accuracy === 'false_alarm';
        if (claimsResponse && !responded) {
          add('error', 'trial_internally_consistent',
            `reaction_trials: trial ${r.trial_id} is scored "${r.accuracy}" but carries no response ` +
            `time. One of the two is wrong.`, [r.trial_id]);
        }
        if (responded && r.response_time_ms !== null && !Number.isFinite(r.response_time_ms)) {
          add('error', 'trial_rt_finite',
            `reaction_trials: trial ${r.trial_id} has a non-finite response time.`, [r.trial_id]);
        }
        if (r.is_signal !== (r.trial_category === 'signal')) {
          add('error', 'trial_category_consistent',
            `reaction_trials: trial ${r.trial_id} has is_signal=${r.is_signal} but ` +
            `trial_category="${r.trial_category}".`, [r.trial_id]);
        }
      }
    }

    // ---- the summary must be a true summary of the trials it claims to summarise
    //
    // This is the check that matters most. rt_summaries is what the analysis templates read; the
    // trials are what a reviewer would re-derive it from. If they disagree, the published numbers
    // are not the numbers in the data.
    for (const s of summaries) {
      if (!validIds.has(s.condition_id)) continue;
      const list = byCond.get(s.condition_id) ?? [];
      if (!list.length) {
        add('error', 'summary_has_trials',
          `rt_summaries: condition "${s.condition_id}" has a summary row but no trials. Its hit ` +
          `rate, d' and RT cannot be checked against anything.`, [s.condition_id]);
        continue;
      }
      if (s.total_trials !== list.length) {
        add('error', 'summary_matches_trials',
          `rt_summaries: condition "${s.condition_id}" reports total_trials=${s.total_trials} but ` +
          `${list.length} trial rows exist. Every rate in the summary is over the wrong denominator.`,
          [s.condition_id]);
      }
      const signals = list.filter((r) => r.is_signal).length;
      if (s.signal_trials !== signals) {
        add('error', 'summary_matches_trials',
          `rt_summaries: condition "${s.condition_id}" reports signal_trials=${s.signal_trials} but ` +
          `${signals} trials are signals. The hit rate and d' are computed over the wrong base.`,
          [s.condition_id]);
      }
      const hits = list.filter((r) => r.accuracy === 'hit').length;
      if (s.hits !== hits) {
        add('error', 'summary_matches_trials',
          `rt_summaries: condition "${s.condition_id}" reports hits=${s.hits} but ${hits} trials are ` +
          `scored as hits.`, [s.condition_id]);
      }
      const fa = list.filter((r) => r.accuracy === 'false_alarm').length;
      if (s.false_alarms !== fa) {
        add('error', 'summary_matches_trials',
          `rt_summaries: condition "${s.condition_id}" reports false_alarms=${s.false_alarms} but ` +
          `${fa} trials are scored as false alarms.`, [s.condition_id]);
      }
    }

    // A condition that ran the RT block but wrote no trials at all.
    if (summaries.length || trials.length) {
      const missing = conditions.filter((c) => !byCond.has(c.condition_id));
      if (missing.length) {
        add(missing.length === conditions.length ? 'warning' : 'error', 'complete_coverage',
          `reaction_trials: no trial rows for ${missing.length}/${conditions.length} condition(s)` +
          (missing.length === conditions.length ? ' (the whole store is absent for this session)' : ''),
          missing.slice(0, 5).map((c) => c.condition_label));
      }
    }
  }

  // ---- ocular data must never exist without the grant that authorises it
  //
  // The camera_metrics grant was recorded and exported but enforced nowhere, so a session could
  // ship consent_camera_metrics=false beside ten rows of real blink data. The app now gates the
  // camera on the grant; this is the check that says so in the data, for any session collected
  // before that gate existed or by a build that regresses it.
  {
    const granted = bundle.session?.media_consent?.camera_metrics === true;
    const measured = (bundle.eyeMetrics ?? []).filter((e) => e.camera_active);
    if (!granted && measured.length) {
      add('error', 'ocular_requires_consent',
        `${measured.length} condition(s) recorded camera-active ocular measurements, but this ` +
        `session's camera_metrics consent grant is not present. The primary outcome was measured ` +
        `on a participant who did not consent to that measurement.`,
        measured.slice(0, 5).map((e) => e.condition_id));
    }
  }

  /*
   * Media must never exist without the grant that authorises it — checked BOTH ways.
   *
   * The snapshot check answers "was this lawfully captured?". The current-consent check answers
   * "is it lawfully still held?", and only the first existed. The asymmetry sat twelve lines from
   * the ocular check above, which reads current consent and always did. Once a grant can be
   * withdrawn, the second question is the one an auditor actually asks.
   */
  for (const m of bundle.media ?? []) {
    const grant = m.checkpoint === 'reading_segment' ? 'annotation_video' : 'setup_photos';
    if (!m.consent_snapshot?.[grant]) {
      add('error', 'media_requires_consent',
        `media ${m.media_id} (${m.checkpoint}) was retained without the ${grant} grant in its ` +
        `consent snapshot.`, [m.media_id]);
    } else if (bundle.session?.media_consent?.[grant] !== true) {
      add('error', 'media_grant_withdrawn',
        `media ${m.media_id} (${m.checkpoint}) is still held although the ${grant} grant is no ` +
        `longer in force. It was lawfully captured and must now be destroyed: use the session's ` +
        `media revocation, not Purge, which would also discard the consented research data.`,
        [m.media_id]);
    }
  }

  /*
   * A permission that was granted but could not be exercised.
   *
   * Setup photographs are captured from the camera stream, and the camera path is skipped outright
   * when camera_metrics is declined — that refusal is enforced, not merely recorded, which is
   * correct. The consequence is that a participant who declines blink measurement but agrees to be
   * photographed has ticked a box the app can never act on: captureMedia finds no media source and
   * returns silently.
   *
   * The export then reads consent_setup_photos=true beside media_items_retained=0 and an empty
   * media inventory — the identical signature to a camera that failed, a toBlob that returned null,
   * or an operator who skipped the closing photograph. Setup-proof coverage is therefore missing
   * NON-RANDOMLY, precisely for the participants who have no ocular data to corroborate the setup
   * by other means, and nothing in the dataset says so.
   *
   * Failing closed is the right direction. Failing closed SILENTLY is the defect, and it is fixed
   * here rather than by capturing the photograph anyway: no new column is needed, because the state
   * is already fully determined by two consent flags that both ship.
   */
  const consent = bundle.session?.media_consent;
  if (consent?.setup_photos === true && consent?.camera_metrics !== true) {
    add('warning', 'grant_not_exercisable',
      'setup_photos was granted but camera_metrics was declined. Setup photographs are captured '
      + 'from the camera stream, so the camera path is skipped and NO photograph was ever possible '
      + 'for this session. The absence is a consequence of the consent combination, not a capture '
      + 'failure — do not read it as one.');
  }

  const errors = f.filter((x) => x.severity === 'error').length;
  const warnings = f.filter((x) => x.severity === 'warning').length;
  return { findings: f, errors, warnings, joins_sound: errors === 0 };
}
