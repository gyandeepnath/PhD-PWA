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
