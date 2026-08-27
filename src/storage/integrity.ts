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
  if ((bundle.tlx ?? []).length > 1) {
    add('error', 'one_tlx_per_session',
      `NASA-TLX is administered once per session; found ${bundle.tlx.length} records.`);
  }

  // ---- media must never exist without the grant that authorises it
  for (const m of bundle.media ?? []) {
    const grant = m.checkpoint === 'reading_segment' ? 'annotation_video' : 'setup_photos';
    if (!m.consent_snapshot?.[grant]) {
      add('error', 'media_requires_consent',
        `media ${m.media_id} (${m.checkpoint}) was retained without the ${grant} grant in its ` +
        `consent snapshot.`, [m.media_id]);
    }
  }

  const errors = f.filter((x) => x.severity === 'error').length;
  const warnings = f.filter((x) => x.severity === 'warning').length;
  return { findings: f, errors, warnings, joins_sound: errors === 0 };
}
