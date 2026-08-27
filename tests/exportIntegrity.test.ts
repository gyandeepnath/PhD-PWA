/**
 * Export integrity invariants.
 *
 * The human-facing counterpart is `scripts/verifyExport.ts`, which prints the tables so a person
 * can confirm alignment by eye. This file locks the invariants that script established so they
 * cannot regress silently.
 */
import { describe, it, expect } from 'vitest';
import { buildExportFiles, CODEBOOK, safeFilePart, round, escapeCsv } from '@/storage/export';
import { buildFixtureBundle, readingMs, fatigueMean, ibrFor, rtFor } from '@/sim/bundleFixture';
import { CONDITIONS } from '@/experiment/conditions';
import { PASSAGES } from '@/experiment/passages';
import { LUX_CHECKPOINTS } from '@/experiment/illumination';

/** Independent RFC-4180 parser — deliberately not the export's own writer logic. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function table(csv: string) {
  const p = parseCsv(csv);
  const headers = p[0] ?? [];
  return { headers, rows: p.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))), raw: p };
}
const filesOf = (o = {}) => new Map(buildExportFiles(buildFixtureBundle(o)).map((f) => [f.filename, f.content]));

describe('export: structural integrity', () => {
  it('emits every row with exactly as many fields as its header', () => {
    for (const [name, content] of filesOf()) {
      if (!name.endsWith('.csv')) continue;
      const t = table(content);
      const n = t.headers.length;
      for (const [i, r] of t.raw.slice(1).entries()) {
        expect(r.length, `${name} data row ${i + 1}`).toBe(n);
      }
    }
  });

  it('never duplicates a column name within a file', () => {
    for (const [name, content] of filesOf()) {
      if (!name.endsWith('.csv')) continue;
      const h = table(content).headers;
      expect(new Set(h).size, `${name} headers`).toBe(h.length);
    }
  });

  it('round-trips a participant id containing a comma and a quote', () => {
    const t = table(filesOf().get('01_session_info.csv')!);
    expect(t.rows[0].participant_id).toBe('VER,"01');
  });

  it('emits numerically-prefixed files in lexicographic order', () => {
    const n = [...filesOf().keys()].filter((f) => /^\d\d_/.test(f));
    expect(n).toEqual([...n].sort());
  });
});

describe('export: filename portability', () => {
  it('produces no filename containing a character illegal on Windows', () => {
    // A participant id is constrained at entry, but an imported or hand-edited record is not, and
    // a filename containing " or , breaks ZIP extraction and Windows saves outright.
    for (const name of filesOf().keys()) {
      // eslint-disable-next-line no-control-regex
      expect(name, `filename ${JSON.stringify(name)}`).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);
    }
  });

  it('sanitises pathological ids without producing an empty name', () => {
    expect(safeFilePart('VER,"01')).toBe('VER_01');
    expect(safeFilePart('../../etc/passwd')).not.toContain('/');
    expect(safeFilePart('...')).toBe('unknown');
    expect(safeFilePart('')).toBe('unknown');
    expect(safeFilePart('a'.repeat(200)).length).toBeLessThanOrEqual(32);
  });
});

describe('export: lux checkpoint completeness', () => {
  it('reports how many checkpoints exist rather than implying all were taken', () => {
    for (const cps of [['start'], ['start', 'end'], ['start', 'middle', 'end']] as const) {
      const t = table(filesOf({ luxCheckpoints: [...cps] }).get('01_session_info.csv')!);
      const r = t.rows[0];
      expect(r.lux_n_readings).toBe(String(cps.length));
      expect(r.lux_checkpoints_logged).toBe(cps.join('+'));
      expect(r.lux_complete).toBe(String(cps.length === LUX_CHECKPOINTS.length));
    }
  });

  it('leaves an unrecorded checkpoint EMPTY rather than defaulting it', () => {
    const r = table(filesOf({ luxCheckpoints: ['start'] }).get('01_session_info.csv')!).rows[0];
    expect(r.lux_start).not.toBe('');
    expect(r.lux_middle).toBe('');
    expect(r.lux_end).toBe('');
  });

  it('separates range compliance from completeness', () => {
    // The old single lux_all_in_range flag read "true" for a session verified once at the start,
    // which an analyst would take as verified throughout. Both facts are now separate columns.
    const r = table(filesOf({ luxCheckpoints: ['start'] }).get('01_session_info.csv')!).rows[0];
    expect(r.lux_logged_all_in_range).toBe('true');
    expect(r.lux_complete).toBe('false');
  });

  it('carries a protocol-deviation note through to the export', () => {
    const r = table(filesOf({ luxValues: { start: 400 }, luxDeviationNote: 'lamp failed, used ceiling light' })
      .get('01_session_info.csv')!).rows[0];
    expect(r.lux_deviation_note).toBe('lamp failed, used ceiling light');
    expect(r.lux_logged_all_in_range).toBe('false');
  });
});

describe('export: condition reference table', () => {
  it('lists every canonical condition, in canonical order, regardless of what ran', () => {
    for (const bundleOpts of [{}, {}]) {
      const t = table(filesOf(bundleOpts).get('00_condition_reference.csv')!);
      expect(t.rows.map((r) => r.condition_label)).toEqual(CONDITIONS.map((c) => c.label));
    }
  });

  it('stays complete for a split sitting and flags which conditions ran', () => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.slice(0, 5);
    b.session.conditions_per_session = 5;
    const t = table(buildExportFiles(b).find((f) => f.filename === '00_condition_reference.csv')!.content);
    expect(t.rows).toHaveLength(CONDITIONS.length);
    expect(t.rows.filter((r) => r.ran_in_this_session === 'true')).toHaveLength(5);
  });
});

describe('export: derived values trace to source', () => {
  it('derives reading_speed_wpm from the DERIVED passage word count', () => {
    const b = buildFixtureBundle();
    const t = table(buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!.content);
    b.conditions.forEach((c, i) => {
      const words = PASSAGES[c.passage_id].wordCount;
      expect(t.rows[i].reading_speed_wpm).toBe(String(Math.round(words / (readingMs(i) / 60000))));
    });
  });

  it('lands every cross-store join on the right condition', () => {
    const b = buildFixtureBundle();
    const t = table(buildExportFiles(b).find((f) => f.filename === '10_wide_summary.csv')!.content);
    b.conditions.forEach((c, i) => {
      const r = t.rows.find((x) => x.condition_label === c.condition_label)!;
      expect(r, c.condition_label).toBeDefined();
      expect(Number(r.fatigue_mean)).toBeCloseTo(fatigueMean(i), 4);
      expect(r.mean_rt_hits_ms).toBe(String(rtFor(i)));
      expect(r.color_name).toBe(c.color_name);
    });
  });

  it('carries the primary outcome through unaltered', () => {
    const b = buildFixtureBundle();
    const t = table(buildExportFiles(b).find((f) => f.filename === '07_eye_metrics.csv')!.content);
    b.conditions.forEach((c, i) => {
      const r = t.rows.find((x) => x.condition_id === c.condition_id)!;
      expect(Number(r.incomplete_blink_ratio)).toBe(ibrFor(i));
    });
  });

  it('presents floats without IEEE-754 noise', () => {
    const t = table(filesOf().get('10_wide_summary.csv')!);
    for (const r of t.rows) {
      for (const col of ['fatigue_mean', 'fatigue_delta']) {
        const v = r[col];
        if (v === '') continue;
        expect(v, `${col}=${v}`).not.toMatch(/\d{8,}/);
      }
    }
    const tlx = table(filesOf().get('14_nasa_tlx.csv')!).rows[0];
    expect(tlx.raw_tlx).not.toMatch(/\d{8,}/);
  });

  it('round() leaves non-numbers and non-finite values untouched', () => {
    expect(round(0.1 + 0.2)).toBe(0.3);
    expect(round(null)).toBe(null);
    expect(round('abc')).toBe('abc');
    expect(round(NaN)).toBeNaN();
    expect(round(Infinity)).toBe(Infinity);
  });
});

describe('export: NASA-TLX', () => {
  it('reverses Performance exactly once and averages the load-aligned columns', () => {
    const r = table(filesOf().get('14_nasa_tlx.csv')!).rows[0];
    expect(Number(r.performance) + Number(r.performance_load)).toBe(100);
    const mean = ['mental_demand', 'physical_demand', 'temporal_demand', 'performance_load', 'effort', 'frustration']
      .map((k) => Number(r[k])).reduce((a, b) => a + b, 0) / 6;
    expect(Number(r.raw_tlx)).toBeCloseTo(mean, 2);
  });
});

describe('export: codebook', () => {
  it('documents only columns that are actually exported', () => {
    const F = filesOf();
    for (const entry of CODEBOOK) {
      const content = F.get(entry.file);
      expect(content, `codebook references ${entry.file}`).toBeDefined();
      const headers = table(content!).headers;
      if (entry.column.includes('..')) {
        const stem = entry.column.split('_')[0];
        expect(headers.some((h) => h.startsWith(stem + '_')), `${entry.file} has ${stem}_*`).toBe(true);
      } else {
        expect(headers, `${entry.file}.${entry.column}`).toContain(entry.column);
      }
    }
  });

  it('documents the primary outcome, both IVs and the completeness flag', () => {
    const has = (f: string, c: string) => CODEBOOK.some((e) => e.file === f && e.column === c);
    expect(has('07_eye_metrics.csv', 'incomplete_blink_ratio')).toBe(true);
    expect(has('01_session_info.csv', 'ambient_illumination_level')).toBe(true);
    expect(has('01_session_info.csv', 'lux_complete')).toBe(true);
    expect(has('00_condition_reference.csv', 'polarity')).toBe(true);
    expect(has('00_condition_reference.csv', 'color_name')).toBe(true);
  });

  it('gives every entry a unit and a non-trivial description', () => {
    for (const e of CODEBOOK) {
      expect(e.unit, `${e.file}.${e.column} unit`).toBeTruthy();
      expect(e.description.length, `${e.file}.${e.column} description`).toBeGreaterThan(20);
      // 'meta' covers descriptive context that is recorded and reported but never modelled
      // (device, timestamps, media properties). Keeping it distinct from 'covariate' stops such
      // columns being swept into a model just because they are numeric.
      expect(['iv', 'dv', 'primary', 'covariate', 'qc', 'id', 'provenance', 'meta']).toContain(e.role);
    }
  });
});

describe('export: no non-finite value can reach a CSV cell', () => {
  it('renders NaN and Infinity as the empty missing-marker, never as a literal', () => {
    // R's read_csv coerces "NaN" to NA and "Infinity" to Inf, so a literal would vanish into the
    // analysis rather than being noticed.
    expect(escapeCsv(NaN)).toBe('');
    expect(escapeCsv(Infinity)).toBe('');
    expect(escapeCsv(-Infinity)).toBe('');
    expect(escapeCsv(0)).toBe('0');
    expect(escapeCsv(-0)).toBe('0');
  });

  it('contains no "NaN" or "Infinity" token anywhere in the exported bundle', () => {
    for (const [name, content] of filesOf()) {
      expect(content, `${name} contains a non-finite literal`).not.toMatch(/(^|[,\n"])(NaN|-?Infinity)([,\n"]|$)/);
    }
  });

  it('reports a zero non-finite-cell count for a clean bundle', () => {
    const files = buildExportFiles(buildFixtureBundle());
    const manifest = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    expect(manifest.non_finite_cells).toBe(0);
  });

  it('counts and empties a deliberately poisoned value instead of leaking it', () => {
    const b = buildFixtureBundle();
    // Simulate an upstream fault that produced a NaN.
    (b.eyeMetrics[0] as { blink_rate: number }).blink_rate = NaN;
    const files = buildExportFiles(b);
    const manifest = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    expect(manifest.non_finite_cells).toBeGreaterThan(0);
    const eye = files.find((f) => f.filename === '07_eye_metrics.csv')!.content;
    expect(eye).not.toMatch(/NaN/);
  });
});
