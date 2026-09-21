/**
 * THE CODEBOOK DECLARES RANGES, AND SOMETHING HAS TO CHECK THEM.
 *
 * 21 columns declare a unit of '0-1', 12 declare '0-100', 9 declare '0-10', and 37 declare 'count'.
 * Nothing compared the data against those declarations. The export passes a value through unaltered —
 * which is the RIGHT behaviour, because clamping 1.8 to 1.0 would fabricate a measurement and this
 * export refuses to fabricate anywhere — but that leaves a promise in the codebook with nothing
 * keeping it. A corrupt store, a restored older-schema backup or a bad import can put
 * `incomplete_blink_ratio` at 1.8 or `hit_rate` at 2.5, and a model fitted on a proportion of 1.8
 * does not fail. It produces a number.
 *
 * `escapeCsv` already states the bargain for the neighbouring class: it blanks a non-finite value
 * rather than writing "NaN", and says that silence "is only tolerable because a count of how often it
 * happened travels in the manifest". These tests hold the range check to the same bargain.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildExportFiles, countOutOfDeclaredRange, rangeOfUnit, CODEBOOK } from '@/storage/export';
import { buildFixtureBundle, withFixtureMedia } from '@/sim/bundleFixture';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';
import { CONFIG } from '@/experiment/config';

describe('the declared-range unit parser', () => {
  it('reads the range forms this codebook actually uses', () => {
    expect(rangeOfUnit('0-1')).toEqual([0, 1]);
    expect(rangeOfUnit('0-100')).toEqual([0, 100]);
    expect(rangeOfUnit('0-9')).toEqual([0, 9]);
    expect(rangeOfUnit('ratio 1-21')).toEqual([1, 21]);
  });

  it('declines units that are dimensions rather than ranges', () => {
    // Treating 'ms' or 'lux' as a range would invent a bound the codebook never claimed.
    for (const u of ['ms', 'lux', 'count', 'degrees', '-', 'blinks/min', 'targets', undefined]) {
      expect(rangeOfUnit(u)).toBeNull();
    }
  });

  it("declines '1-n', which is an open-ended index and not a bounded range", () => {
    // trial_number and its kin are '1-n': the lower bound is real and the upper one is however many
    // there were. Reading that as a range would either invent an upper bound or, worse, parse 'n' as
    // NaN and silently compare every value against it.
    expect(rangeOfUnit('1-n')).toBeNull();
  });

  it('covers every unit in the codebook that states two numeric bounds', () => {
    // A new unit spelling the parser does not understand — '0..1', '0 to 1' — would make the range
    // check pass by examining nothing, which is the failure mode this whole audit keeps finding.
    const twoNumericBounds = [...new Set(CODEBOOK.map((c) => c.unit))]
      .filter((u): u is string => typeof u === 'string' && /^(?:ratio )?-?\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(u.trim()));
    expect(twoNumericBounds.length).toBeGreaterThanOrEqual(9);
    for (const u of twoNumericBounds) expect(rangeOfUnit(u)).not.toBeNull();
  });
});

describe('a clean export stays inside every range it declares', () => {
  it('reports zero out-of-range cells for the golden fixture', () => {
    const r = countOutOfDeclaredRange(buildExportFiles(withFixtureMedia(buildFixtureBundle())));
    expect(r.cells).toBe(0);
    expect(r.columns).toEqual([]);
  });

  it('carries the count in the manifest, beside non_finite_cells', () => {
    const files = buildExportFiles(withFixtureMedia(buildFixtureBundle()));
    const manifest = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    expect(manifest.out_of_declared_range_cells).toBe(0);
    expect(manifest.out_of_declared_range_columns).toEqual([]);
    // The neighbouring guarantee, so the pair cannot drift apart.
    expect(manifest.non_finite_cells).toBe(0);
  });
});

describe('an out-of-range value is passed through AND reported', () => {
  const corrupted = () => {
    const b = JSON.parse(JSON.stringify(buildFixtureBundle()));
    b.eyeMetrics[0].incomplete_blink_ratio = 1.8;   // declared 0-1 — the PRIMARY OUTCOME
    b.eyeMetrics[0].face_presence_ratio = -0.4;     // declared 0-1
    b.eyeMetrics[1].blink_count_full = -3;          // declared count
    b.rtSummaries[0].hit_rate = 2.5;                // declared 0-1
    return buildExportFiles(b);
  };

  it('does not silently clamp the value, because that would invent a measurement', () => {
    const files = corrupted();
    expect(files.find((f) => f.filename === '07_eye_metrics.csv')!.content).toContain('1.8');
  });

  it('counts every offending cell and names the column and the value', () => {
    const r = countOutOfDeclaredRange(corrupted());
    expect(r.cells).toBeGreaterThanOrEqual(4);
    const joined = r.columns.join('\n');
    expect(joined).toContain('incomplete_blink_ratio (declared 0-1, saw 1.8)');
    expect(joined).toContain('face_presence_ratio (declared 0-1, saw -0.4)');
    expect(joined).toContain('blink_count_full (declared count, saw -3)');
    expect(joined).toContain('hit_rate (declared 0-1, saw 2.5)');
  });

  it('follows the bad value into every file it propagates to', () => {
    // face_presence_ratio is injected once into 07_eye_metrics and also reaches 10_wide_summary.
    const cols = countOutOfDeclaredRange(corrupted()).columns.join('\n');
    expect(cols).toContain('07_eye_metrics.csv:face_presence_ratio');
    expect(cols).toContain('10_wide_summary.csv:face_presence_ratio');
  });

  it('rejects a negative count but accepts a legitimate zero', () => {
    // 0 blinks is a real, damning measurement; -3 is corruption. Conflating them would make the
    // check unusable on exactly the sittings that need reading most carefully.
    const b = JSON.parse(JSON.stringify(buildFixtureBundle()));
    b.eyeMetrics[0].blink_count_full = 0;
    b.eyeMetrics[0].blink_count_micro = 0;
    b.eyeMetrics[0].blink_count_incomplete = 0;
    expect(countOutOfDeclaredRange(buildExportFiles(b)).cells).toBe(0);
  });

  it('ignores empty cells, which absence checks already cover', () => {
    const b = JSON.parse(JSON.stringify(buildFixtureBundle()));
    b.eyeMetrics[0].face_presence_ratio = null;
    expect(countOutOfDeclaredRange(buildExportFiles(b)).cells).toBe(0);
  });
});

describe('the pooled analysis file is held to its own declarations too', () => {
  it('reports zero out-of-range cells, and says so in its own manifest', () => {
    // analysis_long.csv is the modelling unit. A bound it promises and does not keep is the one most
    // likely to reach a model, and it is documented by a DIFFERENT codebook keyed by column alone —
    // so a check that only covered the numbered bundle would leave it unguarded.
    const ds = buildAnalysisDataset([buildFixtureBundle()]);
    const manifest = JSON.parse(ds.files.find((f) => f.filename === 'analysis_manifest.json')!.content);
    expect(manifest.out_of_declared_range_cells).toBe(0);
    expect(manifest.out_of_declared_range_columns).toEqual([]);
    expect(manifest.non_finite_cells).toBe(0);
  });

  it('catches an out-of-range value in the pooled file', () => {
    const b = JSON.parse(JSON.stringify(buildFixtureBundle()));
    b.eyeMetrics[0].incomplete_blink_ratio = 1.8;
    const ds = buildAnalysisDataset([b]);
    const manifest = JSON.parse(ds.files.find((f) => f.filename === 'analysis_manifest.json')!.content);
    expect(manifest.out_of_declared_range_cells).toBeGreaterThan(0);
    expect(manifest.out_of_declared_range_columns.join('\n')).toContain('incomplete_blink_ratio');
  });
});

describe("the 'ratio' unit asserts a floor and not a ceiling", () => {
  it('accepts a ratio above 1, because eight real columns can legitimately exceed it', () => {
    /*
     * open_ear_measured, ear_baseline, ear_threshold_used, calibration_ear_baseline,
     * calibration_pitch_baseline_frac, face_size_ratio, rt_cv and inter_blink_interval_cv all
     * declare 'ratio'. An eye aspect ratio is a ratio of distances and a coefficient of variation is
     * sd/mean — both can exceed 1. Reading 'ratio' as 0-1 would invent a bound the codebook never
     * claimed and flag real data as corrupt.
     */
    const b = JSON.parse(JSON.stringify(buildFixtureBundle()));
    b.eyeMetrics[0].inter_blink_interval_cv = 1.7;
    expect(countOutOfDeclaredRange(buildExportFiles(b)).cells).toBe(0);
  });

  it('rejects a negative ratio, which is corruption rather than a measurement', () => {
    const b = JSON.parse(JSON.stringify(buildFixtureBundle()));
    b.eyeMetrics[0].open_ear_measured = -0.2;
    const r = countOutOfDeclaredRange(buildExportFiles(b));
    expect(r.cells).toBeGreaterThan(0);
    expect(r.columns.join('\n')).toContain('open_ear_measured (declared ratio, saw -0.2');
  });
});

/**
 * A CODEBOOK DESCRIPTION MUST NOT RESTATE A NUMBER THE CODE OWNS.
 *
 * The visual-search cap was raised from 40 s to 60 s. `PROTOCOL.md`, the analysis plan and the
 * on-screen instruction all followed — the last of those because it derives the number from the
 * constant. Four places restated it as prose and did not: both codebooks, an internal comment in the
 * pooled exporter, and the simulator's two literals.
 *
 * The one in `analysisCodebook.ts` was the worst of them, because `analysis_long.csv` is the file the
 * confirmatory analysis reads and the very next entry tells the analyst that time-capped rows are a
 * lower bound and must be censored. An analyst was being handed an explicit instruction to censor, at
 * a threshold 20 s below the real one. Blocks between 40 s and 60 s are not a rare tail — the timing
 * model puts search time at a mean of 30 s with an SD of 8, so 40 s is about +1.25 SD.
 *
 * The repo's own Round 14 note had already written the lesson down — "this project has TWO export
 * products with TWO codebooks" — and the 40 s text survived in both anyway. Hence a test rather than
 * a resolution to be careful.
 */
describe('codebook prose derives durations rather than restating them', () => {
  const sourceOf = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

  it('renders the cap the code actually uses, in both codebooks', () => {
    const seconds = CONFIG.VS_TIME_LIMIT_MS / 1000;
    expect(CODEBOOK.find((c) => c.column === 'search_time_ms')!.description)
      .toContain(`${seconds}-second limit`);
    const entry = ANALYSIS_CODEBOOK.find((c) => c.column === 'search_termination') as { description: string };
    expect(entry.description).toContain(`${seconds} s cap`);
  });

  it('leaves no stale 40-second literal anywhere in the storage layer or the simulator', () => {
    // 40 was the previous value. Any surviving copy of it is, by construction, a copy that did not
    // follow the change — which is exactly how this defect was created.
    for (const rel of [
      'src/storage/export.ts', 'src/storage/analysisCodebook.ts',
      'src/storage/analysisExport.ts', 'src/storage/types.ts', 'src/sim/participant.ts',
    ]) {
      const src = sourceOf(rel);
      expect(src).not.toMatch(/\b40[ -]s(?:econd)?\b/);
      expect(src).not.toMatch(/\b40000\b/);
    }
  });

  it('keeps the simulator censoring at the same cap the app enforces', () => {
    // The simulator is what the power and recovery analyses rest on, so a stale cap there is a stale
    // power estimate — a quieter failure than a wrong codebook and a harder one to notice.
    const src = sourceOf('src/sim/participant.ts');
    expect(src).toContain('CONFIG.VS_TIME_LIMIT_MS');
    expect(src).toMatch(/const searchCapMs = CONFIG\.VS_TIME_LIMIT_MS/);
  });
});
