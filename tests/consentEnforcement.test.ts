/**
 * Consent, enforced rather than merely recorded; and the measures that must report absence.
 *
 * Two of these were the worst defects found in the whole audit, and they share a shape: a value
 * that says something true about the protocol while the code does something else, with nothing
 * downstream able to tell the difference.
 *
 *   - The camera-measurement grant was written to the session, exported as a column, and read by
 *     nothing. A participant who declined it was shown "Enable camera" on the very next screen.
 *   - The row written when the camera was NOT running reported the primary outcome as 0 rather
 *     than as missing — the cleanest possible result, manufactured from no observation at all.
 */
import { describe, it, expect } from 'vitest';
import { disabledEyeMetrics } from '@/tracking/aggregator';
import { auditBundle } from '@/storage/integrity';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { isAnnotationSubsample, ANNOTATION_SUBSAMPLE_MODULUS } from '@/experiment/counterbalance';
import { buildExportFiles } from '@/storage/export';
import { splitCsvRow } from './helpers/csv';

describe('a condition with no camera reports absence, not zero', () => {
  it('nulls every blink count and rate', () => {
    const e = disabledEyeMetrics('cond-1', 'sess-1');
    expect(e.camera_active).toBe(false);
    // The primary outcome above all: a 0 here reads as "blinked perfectly in this condition".
    expect(e.incomplete_blink_ratio).toBeNull();
    expect(e.blink_rate).toBeNull();
    expect(e.blink_rate_full).toBeNull();
    expect(e.blink_rate_micro).toBeNull();
    expect(e.blink_count_full).toBeNull();
    expect(e.blink_count_micro).toBeNull();
    expect(e.long_closure_count).toBeNull();
    expect(e.long_closure_total_ms).toBeNull();
  });

  it('exports the absence as an empty cell, not as 0', () => {
    const b = buildFixtureBundle();
    const bundle = {
      ...b,
      eyeMetrics: b.eyeMetrics.map((e, i) =>
        i === 0 ? disabledEyeMetrics(e.condition_id, e.session_id) : e),
    };
    const csv = buildExportFiles(bundle).find((f) => f.filename === '07_eye_metrics.csv')!.content;
    const lines = csv.split('\n');
    const head = splitCsvRow(lines[0]);
    const idIdx = head.indexOf('condition_id');
    const cells = lines.slice(1)
      .map(splitCsvRow)
      .find((r) => r[idIdx] === b.eyeMetrics[0].condition_id)!;
    expect(cells).toBeDefined();
    expect(cells[head.indexOf('camera_active')]).toBe('false');
    expect(cells[head.indexOf('incomplete_blink_ratio')]).toBe('');
    expect(cells[head.indexOf('blink_rate')]).toBe('');
  });
});

describe('the camera-measurement grant is enforced, and its breach is auditable', () => {
  it('reports ocular data recorded without the grant', () => {
    const b = buildFixtureBundle();
    const refused = {
      ...b,
      session: {
        ...b.session,
        media_consent: { camera_metrics: false, setup_photos: false, annotation_video: false, granted_at: null },
      },
    };
    const r = auditBundle(refused);
    const f = r.findings.find((x) => x.check === 'ocular_requires_consent');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(r.joins_sound).toBe(false);
  });

  it('raises nothing when the grant is present', () => {
    const r = auditBundle(buildFixtureBundle());
    expect(r.findings.find((x) => x.check === 'ocular_requires_consent')).toBeUndefined();
  });

  it('raises nothing when the grant is absent AND no ocular data was collected', () => {
    // The supported path: a participant declines, everything else still runs.
    const b = buildFixtureBundle();
    const declined = {
      ...b,
      session: {
        ...b.session,
        media_consent: { camera_metrics: false, setup_photos: false, annotation_video: false, granted_at: null },
      },
      eyeMetrics: b.eyeMetrics.map((e) => disabledEyeMetrics(e.condition_id, e.session_id)),
    };
    expect(auditBundle(declined).findings.find((x) => x.check === 'ocular_requires_consent')).toBeUndefined();
  });
});

describe('the annotation validation subsample is pre-specified, not chosen at the bench', () => {
  it('selects roughly the 20 participants the protocol specifies, out of 145 enrolled', () => {
    const selected = Array.from({ length: 145 }, (_, i) => i + 1).filter(isAnnotationSubsample);
    expect(selected.length).toBeGreaterThanOrEqual(18);
    expect(selected.length).toBeLessThanOrEqual(24);
  });

  it('spreads the subsample evenly across all ten Williams condition orders', () => {
    // A subsample concentrated on a few orders would estimate criterion validity on a biased slice
    // of the design.
    const rows = new Map<number, number>();
    for (let n = 1; n <= 145; n++) {
      if (!isAnnotationSubsample(n)) continue;
      const row = (n - 1) % 10;
      rows.set(row, (rows.get(row) ?? 0) + 1);
    }
    expect(rows.size).toBe(10);
    expect(Math.max(...rows.values()) - Math.min(...rows.values())).toBeLessThanOrEqual(1);
  });

  it('is a pure function of the enrolment number, so it cannot vary by operator', () => {
    expect(isAnnotationSubsample(1)).toBe(true);
    expect(isAnnotationSubsample(1 + ANNOTATION_SUBSAMPLE_MODULUS)).toBe(true);
    expect(isAnnotationSubsample(2)).toBe(false);
    expect(isAnnotationSubsample(0)).toBe(false);
    expect(isAnnotationSubsample(NaN)).toBe(false);
  });
});

describe('the CVS-Q change score cannot be computed from duplicates', () => {
  it('reports a second session_end row', () => {
    const b = buildFixtureBundle();
    const dup = {
      ...b,
      cvsq: [...b.cvsq, { ...b.cvsq.find((c) => c.stage === 'session_end')!, cvsq_id: 'cvsq-end-2', total_score: 3 }],
    };
    const f = auditBundle(dup).findings.find((x) => x.check === 'one_cvsq_per_stage');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });
});
