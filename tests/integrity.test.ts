/**
 * The referential-integrity auditor.
 *
 * The export joins six child stores onto conditions by condition_id using a linear find. With a
 * duplicate id, BOTH conditions silently receive the first one's measurements and nothing in the
 * output looks wrong - the row counts are right and every cell is populated. These tests pin the
 * auditor that makes such a dataset announce itself.
 */
import { describe, it, expect } from 'vitest';
import { auditBundle } from '@/storage/integrity';
import { buildExportFiles } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { splitCsvRow } from './helpers/csv';
import { summariseRtBlock } from '@/lib/rtSummary';
import { checkJoin } from '@/storage/joinIntegrity';
import { makeRng } from '@/sim/rng';
import type { ReactionTrialRecord } from '@/storage/types';

const checks = (b: ReturnType<typeof buildFixtureBundle>) => auditBundle(b).findings.map((f) => f.check);

describe('a sound bundle passes cleanly', () => {
  it('reports no errors for the reference fixture', () => {
    const r = auditBundle(buildFixtureBundle());
    expect(r.errors, JSON.stringify(r.findings, null, 1)).toBe(0);
    expect(r.joins_sound).toBe(true);
  });

  it('stays sound for a coherent single-condition session', () => {
    const b = buildFixtureBundle();
    const keep = b.conditions[0].condition_id;
    b.conditions = b.conditions.slice(0, 1);
    // reactionTrials included: the audit now checks the trial store too, and trials left behind
    // by a trimmed condition list are orphans — which is precisely what it should report.
    for (const k of ['eyeMetrics', 'rtSummaries', 'reactionTrials', 'comprehension', 'visualSearch', 'perception'] as const) {
      (b[k] as { condition_id: string }[]) = (b[k] as { condition_id: string }[]).filter((x) => x.condition_id === keep);
    }
    b.fatigue = b.fatigue.filter((x) => x.stage === 'baseline' || x.condition_id === keep);
    expect(auditBundle(b).errors).toBe(0);
  });
});

/*
 * AN ANTICIPATION IS NOT A SUMMARY FAULT (Round 86, audit 86 D4).
 *
 * The task's summary counts as signal_trials the go trials it SCORED — hits plus misses, hit_rate's
 * denominator — and the codebook says so; the audit counted every go trial presented. So one go-dot
 * tapped faster than the 150 ms cutoff raised summary_matches_trials as an error, and that check is a
 * blocking one: the participant was dropped from every pre-registered model for a summary that was
 * right. The blocks here are summarised by the task's own function (lib/rtSummary.ts).
 */
describe('a block with anticipations is audited by the task\'s own definition', () => {
  const NOW = { conditionsPerParticipant: 10, sittingsPerParticipant: 1, illuminationLevels: 1 };
  const summaryErrors = (b: ReturnType<typeof buildFixtureBundle>) =>
    auditBundle(b).findings.filter((f) => f.check === 'summary_matches_trials');
  /** Turn one trial of the first condition into an anticipation and re-summarise as the task does. */
  const anticipate = (b: ReturnType<typeof buildFixtureBundle>, from: ReactionTrialRecord['accuracy']) => {
    const cid = b.conditions[0].condition_id;
    const t = b.reactionTrials.find((r) => r.condition_id === cid && r.accuracy === from)!;
    Object.assign(t, { response_time_ms: 112, accuracy: 'anticipation', anticipatory: true });
    const i = b.rtSummaries.findIndex((r) => r.condition_id === cid);
    b.rtSummaries[i] = { ...b.rtSummaries[i], ...summariseRtBlock(b.reactionTrials.filter((r) => r.condition_id === cid)) };
    return b.rtSummaries[i];
  };

  it('raises nothing for a go-trial anticipation, and the participant stays analysable', () => {
    const b = buildFixtureBundle();
    const s = anticipate(b, 'hit');
    expect(s.anticipations).toBeGreaterThan(0);
    // The scored go trials, not the go trials presented.
    expect(s.signal_trials).toBe(s.hits + s.misses);
    expect(summaryErrors(b), JSON.stringify(summaryErrors(b))).toEqual([]);
    const v = checkJoin([b], NOW).participants[0];
    expect(v.excluded_by).not.toContain('audit_summary_matches_trials');
  });

  it('raises nothing for a no-go anticipation either', () => {
    const b = buildFixtureBundle();
    anticipate(b, 'correct_rejection');
    expect(summaryErrors(b)).toEqual([]);
  });

  it('never faults a summary the task itself would write, over many random blocks', () => {
    const rng = makeRng(86);
    for (let k = 0; k < 200; k++) {
      const b = buildFixtureBundle();
      const cid = b.conditions[0].condition_id;
      for (const t of b.reactionTrials.filter((r) => r.condition_id === cid)) {
        const responded = rng() < 0.7;
        const rt = responded ? Math.round(rng() * 900) : null;
        const ant = rt != null && rt < 150;
        Object.assign(t, {
          response_time_ms: rt, anticipatory: ant,
          accuracy: ant ? 'anticipation' : t.is_signal ? (responded ? 'hit' : 'miss') : (responded ? 'false_alarm' : 'correct_rejection'),
        });
      }
      const i = b.rtSummaries.findIndex((r) => r.condition_id === cid);
      b.rtSummaries[i] = { ...b.rtSummaries[i], ...summariseRtBlock(b.reactionTrials.filter((r) => r.condition_id === cid)) };
      expect(summaryErrors(b), `block ${k}`).toEqual([]);
    }
  });

  it('still faults a summary that miscounts its scored go trials', () => {
    const b = buildFixtureBundle();
    const s = anticipate(b, 'hit');
    s.signal_trials += 1; // the count of go trials PRESENTED: what the old check demanded
    expect(summaryErrors(b).map((f) => f.detail).join(' ')).toMatch(/signal_trials/);
  });
});

describe('the join key must be unique', () => {
  it('flags a duplicate condition_id and names both conditions', () => {
    const b = buildFixtureBundle();
    b.conditions[1] = { ...b.conditions[1], condition_id: b.conditions[0].condition_id };
    const r = auditBundle(b);
    expect(r.joins_sound).toBe(false);
    const f = r.findings.find((x) => x.check === 'condition_id_unique')!;
    expect(f).toBeDefined();
    expect(f.severity).toBe('error');
    expect(f.detail).toMatch(/receive the FIRST one/);
    expect(f.refs).toContain(b.conditions[0].condition_label);
  });

  it('flags a duplicate session_position, because it is a modelled covariate', () => {
    const b = buildFixtureBundle();
    b.conditions[1] = { ...b.conditions[1], session_position: b.conditions[0].session_position };
    expect(checks(b)).toContain('session_position_unique');
  });

  it('flags a repeated condition_label within one sitting', () => {
    const b = buildFixtureBundle();
    b.conditions[1] = { ...b.conditions[1], condition_label: b.conditions[0].condition_label };
    expect(checks(b)).toContain('condition_label_unique');
  });
});

describe('child rows must point at a real condition', () => {
  it('flags orphans in every child store', () => {
    for (const store of ['eyeMetrics', 'rtSummaries', 'comprehension', 'visualSearch', 'perception'] as const) {
      const b = buildFixtureBundle();
      const rows = b[store] as { condition_id: string }[];
      rows[0] = { ...rows[0], condition_id: 'ghost' };
      const f = auditBundle(b).findings.find((x) => x.check === 'no_orphan_records');
      expect(f, `${store} orphan not flagged`).toBeDefined();
    }
  });

  it('flags two child rows competing for one condition', () => {
    const b = buildFixtureBundle();
    b.eyeMetrics.push({ ...b.eyeMetrics[0] });
    const f = auditBundle(b).findings.find((x) => x.check === 'one_child_row_per_condition')!;
    expect(f).toBeDefined();
    expect(f.detail).toMatch(/takes the first and silently discards/);
  });

  it('flags a duplicated post-condition fatigue record', () => {
    const b = buildFixtureBundle();
    const post = b.fatigue.find((x) => x.stage === 'post_condition')!;
    b.fatigue.push({ ...post, fatigue_id: post.fatigue_id + '-dup' });
    expect(checks(b)).toContain('one_child_row_per_condition');
  });
});

describe('coverage and session-level expectations', () => {
  it('warns when a whole store is absent, errors when only some conditions are missing', () => {
    const whole = buildFixtureBundle();
    whole.eyeMetrics = [];
    const wf = auditBundle(whole).findings.find((x) => x.check === 'complete_coverage')!;
    expect(wf.severity).toBe('warning');

    const partial = buildFixtureBundle();
    partial.eyeMetrics = partial.eyeMetrics.slice(0, 3);
    const pf = auditBundle(partial).findings.find((x) => x.check === 'complete_coverage')!;
    expect(pf.severity).toBe('error');
  });

  it('flags a missing baseline, which fatigue_delta is computed against', () => {
    const b = buildFixtureBundle();
    b.fatigue = b.fatigue.filter((x) => x.stage !== 'baseline');
    expect(checks(b)).toContain('one_baseline_fatigue');
  });

  it('warns when the CVS-Q change score cannot be formed', () => {
    const b = buildFixtureBundle();
    b.cvsq = b.cvsq.filter((c) => c.stage === 'baseline');
    expect(checks(b)).toContain('cvsq_pair_present');
  });

  it('flags more than one NASA-TLX per session', () => {
    const b = buildFixtureBundle();
    b.tlx.push({ ...b.tlx[0], tlx_id: 'second' });
    expect(checks(b)).toContain('one_tlx_per_session');
  });

  it('warns when one sitting holds ratings on two formats (Round 84)', () => {
    const b = buildFixtureBundle();
    expect(checks(b)).not.toContain('one_rating_format');
    b.fatigue = b.fatigue.map((f, i) => (i === 0 ? f : { ...f, slider_version: 'vas-v2' }));
    expect(checks(b)).toContain('one_rating_format');
    const finding = auditBundle(b).findings.find((x) => x.check === 'one_rating_format')!;
    expect(finding.severity).toBe('warning');
    expect(finding.detail).toMatch(/sl-v1, vas-v2/);
  });
});

describe('a session run under the test harness is not data', () => {
  /*
   * ?e2e collapses every protocol duration to a token value and changes nothing else, so the rows
   * are complete, plausible and exportable. A tablet left on a bookmarked ?e2e URL produces a
   * session indistinguishable from a real one except for this flag.
   */
  const auditWith = (e2e: boolean) => {
    const b = buildFixtureBundle();
    (b.session as { e2e_timing?: boolean }).e2e_timing = e2e;
    return auditBundle(b).findings.filter((x) => x.check === 'e2e_timing');
  };

  it('says nothing about a real session', () => {
    expect(auditWith(false)).toHaveLength(0);
  });

  it('is an ERROR, not a warning — there is no analysis such a row belongs in', () => {
    const found = auditWith(true);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
  });

  it('marks the bundle\'s joins unsound so a caller that checks only that flag still stops', () => {
    const b = buildFixtureBundle();
    (b.session as { e2e_timing?: boolean }).e2e_timing = true;
    expect(auditBundle(b).joins_sound).toBe(false);
  });
});

describe('the tablet must have stayed in front of the participant', () => {
  const auditAway = (hiddenMs?: number, events?: number) => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.slice(0, 1);
    Object.assign(b.conditions[0], { condition_hidden_ms: hiddenMs, condition_hidden_events: events });
    return auditBundle(b).findings.filter((x) => x.check === 'condition_uninterrupted');
  };

  it('says nothing about a condition the participant sat through', () => {
    expect(auditAway(0, 0)).toHaveLength(0);
  });

  it('says nothing for rows recorded before this was captured', () => {
    expect(auditAway(undefined, undefined)).toHaveLength(0);
  });

  it('warns about a brief absence — a notification taking the screen', () => {
    const found = auditAway(1_500, 1);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
  });

  it('errors when the tablet was away long enough to void the timing measures', () => {
    // Ten seconds of a throttled tab spans a large part of a reaction-time block, whose trials are
    // one second each with one-second response windows.
    const found = auditAway(45_000, 2);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
    expect(found[0].detail).toMatch(/2 interruptions/);
  });
});

describe('the stimulus must have been the same size throughout a sitting', () => {
  /*
   * stimulus_scale multiplies the stimulus text, so it IS the visual angle a condition was
   * presented at. Within one sitting the tablet does not change shape and it should be one number —
   * but the running viewport minimum drops when the viewport genuinely shrinks, which on an
   * un-installed browser means the address bar appearing partway through. Conditions either side of
   * that are not the same stimulus, and reading rate moves with visual angle.
   */
  const atScales = (...scales: (number | undefined)[]) => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.slice(0, scales.length);
    b.conditions.forEach((c, i) => { (c as { stimulus_scale?: number }).stimulus_scale = scales[i]; });
    return auditBundle(b).findings.filter((f) => f.check === 'stimulus_scale_stable');
  };

  it('says nothing when every condition was presented at the same scale', () => {
    expect(atScales(0.86, 0.86, 0.86)).toHaveLength(0);
  });

  it('reports a sitting whose scale changed partway through', () => {
    const found = atScales(1, 1, 0.76);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
    expect(found[0].detail).toMatch(/24%/);           // (1 - 0.76) / 1
  });

  it('says nothing for rows recorded before the scale was captured', () => {
    expect(atScales(undefined, undefined)).toHaveLength(0);
  });
});

describe('every display should have run in the installed app', () => {
  /*
   * The session row holds pre-flight's display_mode only. A sitting checked as installed could be
   * resumed in a Chrome tab and finished at scale 0.90 with nothing asked, the session still saying
   * fullscreen (review of Round 63). The per-condition column is the only place a later launch shows,
   * and nothing read it.
   */
  const withModes = (...rows: [string | null | undefined, boolean | null | undefined][]) => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.slice(0, rows.length);
    b.conditions.forEach((c, i) => {
      if (rows[i][0] !== undefined) c.display_mode = rows[i][0];
      if (rows[i][1] !== undefined) c.display_mode_acknowledged = rows[i][1];
    });
    return auditBundle(b).findings.filter((f) => f.check === 'display_mode_installed');
  };

  it('says nothing when every condition ran in the installed app', () => {
    expect(withModes(['fullscreen', false], ['standalone', false])).toHaveLength(0);
  });

  it('warns about the conditions resumed in a tab, and names them', () => {
    const found = withModes(['fullscreen', false], ['browser', true], ['browser', true]);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
    expect(found[0].detail).toMatch(/^2 condition\(s\) ran outside the installed/);
    expect(found[0].detail).toMatch(/display_mode: browser/);
    expect(found[0].detail).not.toMatch(/NOT acknowledged/);
    expect(found[0].refs).toHaveLength(2);
  });

  it('says when a launch was not acknowledged, and counts an unreported mode as unconfirmed', () => {
    const found = withModes(['browser', false], [null, true]);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toMatch(/browser, not reported/);
    expect(found[0].detail).toMatch(/1 of them started in a launch the operator had NOT acknowledged/);
  });

  it('does not judge rows from builds before display_mode was recorded', () => {
    expect(withModes([undefined, undefined], [undefined, undefined])).toHaveLength(0);
  });

  it('exports the acknowledgement per condition, blank on older rows', () => {
    const b = buildFixtureBundle();
    b.conditions[0].display_mode = 'browser';
    b.conditions[0].display_mode_acknowledged = true;
    b.conditions[1].display_mode = 'fullscreen';
    b.conditions[1].display_mode_acknowledged = false;
    const csv = buildExportFiles(b).find((f) => f.filename.endsWith('02_conditions.csv'))!.content;
    const [head, ...lines] = csv.trim().split(/\r?\n/);
    const cols = splitCsvRow(head);
    const at = (row: string, col: string) => splitCsvRow(row)[cols.indexOf(col)];
    expect(cols).toContain('display_mode_acknowledged');
    const byId = (id: string) => lines.find((l) => l.includes(id))!;
    expect(at(byId(b.conditions[0].condition_id), 'display_mode')).toBe('browser');
    expect(at(byId(b.conditions[0].condition_id), 'display_mode_acknowledged')).toBe('true');
    expect(at(byId(b.conditions[1].condition_id), 'display_mode_acknowledged')).toBe('false');
    expect(at(byId(b.conditions[2].condition_id), 'display_mode_acknowledged')).toBe('');
  });
});

describe('media can never exist without its grant', () => {
  it('flags a retained file whose consent snapshot does not authorise it', () => {
    const b = buildFixtureBundle();
    b.media = [{
      media_id: 'm1', session_id: b.session.session_id, participant_id: b.session.participant_id,
      kind: 'photo', checkpoint: 'session_start', condition_label: null,
      captured_at: 1, mime: 'image/jpeg', bytes: 10, width: 1, height: 1, duration_ms: null,
      checksum_fnv1a: 'aaaaaaaa',
      consent_snapshot: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: 1 },
      blob: new Blob([]),
    }];
    const f = auditBundle(b).findings.find((x) => x.check === 'media_requires_consent')!;
    expect(f).toBeDefined();
    expect(f.severity).toBe('error');
  });
});

describe('the report reaches the export', () => {
  it('emits a findings file and a manifest flag for a damaged bundle', () => {
    const b = buildFixtureBundle();
    b.conditions[1] = { ...b.conditions[1], condition_id: b.conditions[0].condition_id };
    const files = buildExportFiles(b);
    const report = files.find((f) => f.filename === '16_integrity_report.csv')!;
    expect(report.content).toMatch(/condition_id_unique/);
    const m = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    expect(m.integrity.joins_sound).toBe(false);
    expect(m.integrity.errors).toBeGreaterThan(0);
  });

  it('states plainly that all checks passed for a clean bundle', () => {
    const files = buildExportFiles(buildFixtureBundle());
    const report = files.find((f) => f.filename === '16_integrity_report.csv')!;
    expect(report.content).toMatch(/all_checks_passed/);
    const m = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    expect(m.integrity.joins_sound).toBe(true);
  });
});

describe('one face tracker per sitting (round 75)', () => {
  it('is silent when every row was measured on the same tracker, or rows predate the column', () => {
    const b = buildFixtureBundle();
    expect(checks(b)).not.toContain('tracker_consistent');
    b.eyeMetrics.forEach((e) => { e.tracker_backend = 'tasks-cpu'; });
    expect(checks(b)).not.toContain('tracker_consistent');
  });

  it('warns, naming the conditions, when the tracker changed inside the sitting', () => {
    const b = buildFixtureBundle();
    b.eyeMetrics.forEach((e, i) => { e.tracker_backend = i < 2 ? 'tasks-gpu' : 'legacy'; });
    const f = auditBundle(b).findings.find((x) => x.check === 'tracker_consistent');
    expect(f?.severity).toBe('warning');
    expect(f?.detail).toMatch(/legacy, tasks-gpu/);
    expect(f?.refs.length).toBe(b.eyeMetrics.length);
  });

  it('a sitting begun before 2.3.0 and resumed after it: the blank rows were the legacy tracker', () => {
    const b = buildFixtureBundle();
    b.eyeMetrics.forEach((e, i) => { e.camera_active = true; if (i >= 2) e.tracker_backend = 'tasks-cpu'; else delete e.tracker_backend; });
    const f = auditBundle(b).findings.find((x) => x.check === 'tracker_consistent');
    expect(f?.detail).toMatch(/legacy, tasks-cpu/);
    // A camera-off row was measured by no tracker, so it neither adds one nor is referenced.
    b.eyeMetrics.forEach((e, i) => { if (i < 2) e.camera_active = false; });
    expect(checks(b)).not.toContain('tracker_consistent');
  });
});

describe('the stored blinks are the blinks the summary counted (round 78)', () => {
  const finding = (b: ReturnType<typeof buildFixtureBundle>, check: string) => auditBundle(b).findings.find((x) => x.check === check);
  const blinkChecks = ['blink_events_match_summary', 'ear_trace_matches_summary', 'blink_events_orphan', 'blink_events_coverage', 'selftest_events_match', 'blink_fit_matches_summary'];

  it('is silent for the fixture, whose records were built through the real aggregator', () => {
    const b = buildFixtureBundle();
    expect(b.ocularEvents!.filter((o) => o.window === 'reading')).toHaveLength(b.conditions.length);
    expect(checks(b).filter((c) => blinkChecks.includes(c))).toEqual([]);
  });

  it('is silent for a sitting with no blink records at all (before schema 10)', () => {
    const b = buildFixtureBundle();
    b.ocularEvents = [];
    expect(checks(b).filter((c) => blinkChecks.includes(c))).toEqual([]);
  });

  it('warns when a condition lists a different number of blinks than 07 counts, and names the condition', () => {
    const b = buildFixtureBundle();
    const o = b.ocularEvents!.find((r) => r.window === 'reading')!;
    o.events.pop();
    const f = finding(b, 'blink_events_match_summary');
    expect(f?.severity).toBe('warning');
    expect(f?.refs).toEqual([o.condition_id]);
    expect(f?.detail).toMatch(/07_eye_metrics is unaffected/);
  });

  it('warns when a blink changed tier but the total did not', () => {
    const b = buildFixtureBundle();
    const o = b.ocularEvents!.find((r) => r.window === 'reading' && r.events.some((e) => e.tier === 'full'))!;
    o.events.find((e) => e.tier === 'full')!.tier = 'incomplete';
    expect(finding(b, 'blink_events_match_summary')?.refs).toEqual([o.condition_id]);
  });

  it('warns when the record has blinks but the row has no blink measure (no baseline)', () => {
    const b = buildFixtureBundle();
    const eye = b.eyeMetrics[0];
    Object.assign(eye, { blink_count_full: null, blink_count_micro: null, blink_count_incomplete: null });
    expect(finding(b, 'blink_events_match_summary')?.detail).toMatch(/none \(no blink measure\)/);
  });

  it('warns when the fitted-minimum count recounted from 07b differs from 07 (Round 79)', () => {
    const b = buildFixtureBundle();
    const eye = b.eyeMetrics[2];
    expect(eye.blink_count_incomplete_fit).not.toBeNull();
    eye.blink_count_incomplete_fit = (eye.blink_count_incomplete_fit ?? 0) + 1;
    const f = finding(b, 'blink_fit_matches_summary');
    expect(f?.severity).toBe('warning');
    expect(f?.refs).toEqual([eye.condition_id]);
    expect(f?.detail).toMatch(/primary count is unaffected/);
    // A record made before Round 79 carries no fit: nothing to compare, nothing said.
    const old = buildFixtureBundle();
    for (const o of old.ocularEvents!) { delete o.fit_rule_version; for (const e of o.events) delete e.min_ratio_fit; }
    expect(checks(old)).not.toContain('blink_fit_matches_summary');
  });

  it('warns when the trace has a different number of measured frames than ear_sample_count', () => {
    const b = buildFixtureBundle();
    b.eyeMetrics[1].ear_sample_count += 1;
    expect(finding(b, 'ear_trace_matches_summary')?.refs).toEqual([b.eyeMetrics[1].condition_id]);
  });

  it('warns about a record for a condition the sitting does not have', () => {
    const b = buildFixtureBundle();
    const o = b.ocularEvents![0];
    o.condition_id = 'cond-elsewhere';
    o.record_id = 'cond-elsewhere';
    expect(finding(b, 'blink_events_orphan')?.refs).toEqual(['cond-elsewhere']);
    // ...and the condition that lost its record is then reported as uncovered.
    expect(finding(b, 'blink_events_coverage')?.refs).toEqual([b.conditions[0].condition_id]);
  });

  it('holds the self-test record to the self-test result: cued + extra blinks', () => {
    const b = buildFixtureBundle();
    expect(b.session.camera_selftest).toMatchObject({ detected: 5, extra: 1 });
    b.session.camera_selftest = { ...b.session.camera_selftest!, extra: 0 };
    expect(finding(b, 'selftest_events_match')?.detail).toMatch(/lists 6 self-test blink\(s\).*scored 5 \(5 cued \+ 0 extra\)/);
    delete b.session.camera_selftest;
    expect(finding(b, 'selftest_events_match')?.detail).toMatch(/is missing/);
    // Never mistaken for a condition: it raises neither the orphan nor the coverage check.
    expect(checks(b)).not.toContain('blink_events_orphan');
  });

  it('re-runs the test\'s own matching on the stored times: it must count selftest_detected (round 81)', () => {
    // The same 6 blinks, but scored as 4 hits + 2 extras: the total agrees, the matching does not.
    const b = buildFixtureBundle();
    b.session.camera_selftest = { ...b.session.camera_selftest!, detected: 4, extra: 2 };
    const f = finding(b, 'selftest_events_match');
    expect(f?.severity).toBe('warning');
    expect(f?.detail).toMatch(/finds a blink for 5 of 5 flashes, but the self-test result in 01_session_info is 4 of 5/);
    // A flash time lost from the record is caught the same way.
    const c = buildFixtureBundle();
    c.ocularEvents!.find((o) => o.window === 'selftest')!.cues!.pop();
    expect(finding(c, 'selftest_events_match')?.detail).toMatch(/4 of 4 flashes/);
  });

  it('only ever warns: the main analysis does not read these files', () => {
    const b = buildFixtureBundle();
    b.ocularEvents!.forEach((o) => { o.events = []; });
    b.eyeMetrics[0].ear_sample_count += 1;
    const r = auditBundle(b);
    expect(r.findings.filter((f) => blinkChecks.includes(f.check)).length).toBeGreaterThan(0);
    expect(r.findings.filter((f) => blinkChecks.includes(f.check)).every((f) => f.severity === 'warning')).toBe(true);
  });

  /*
   * Round 81. The pooled analysis set keeps only errors, so it skips this section (blinkRecords:
   * false). That is safe only while the section raises nothing but warnings: on a sitting damaged in
   * every way the section looks for AND in ways other sections treat as errors, the errors with and
   * without it must be the same list.
   */
  it('can be skipped without losing an error: the errors are the same with and without it', () => {
    const b = buildFixtureBundle();
    b.ocularEvents!.forEach((o) => { o.events = []; });
    b.ocularEvents![0].condition_id = 'cond-elsewhere';
    b.eyeMetrics[1].ear_sample_count += 1;
    b.session.camera_selftest = { ...b.session.camera_selftest!, extra: 9 };
    b.eyeMetrics[2].calibration_id = 'no-such-calibration';
    const full = auditBundle(b);
    const skipped = auditBundle(b, { blinkRecords: false });
    expect(full.findings.filter((f) => blinkChecks.includes(f.check)).length).toBeGreaterThanOrEqual(4);
    expect(skipped.findings.filter((f) => blinkChecks.includes(f.check))).toEqual([]);
    const errors = (r: typeof full) => r.findings.filter((f) => f.severity === 'error');
    expect(errors(full).length).toBeGreaterThan(0);
    expect(errors(skipped)).toEqual(errors(full));
  });
});
