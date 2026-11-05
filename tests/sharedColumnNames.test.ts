/**
 * One column name, one meaning, across the export (audit 86 D12).
 *
 * 10_wide_summary.csv and analysis_long.csv are both one row per condition-run, and an analyst will
 * join them. Both had a `comprehension_correct`: in 10 the PROPORTION of the items answered correctly
 * (0, 1/3, 2/3, 1), in analysis_long the COUNT (0-3), the numerator its codebook tells you to model
 * binomially. Each codebook stated its own unit, so neither file was wrong, but a join put 0.667 beside
 * 2 under one name — and reading the proportion as the count is the factor-of-three error that once
 * reached analysis_long itself (AUDIT_ROUND2). From Round 89 the per-sitting column is
 * `comprehension_proportion` (same values), and the summary field behind it carries the same name.
 *
 * The test is the verifier's own: build both files from one bundle, join them on the run, and require
 * every column the two share by name to carry the same value on every row. A shared name that holds a
 * different quantity in each file fails here, whatever the codebooks say.
 */
import { describe, it, expect } from 'vitest';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';

function parse(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** Same value, allowing for the rounding one file applies and the other does not (4 significant places). */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const x = Number(a);
  const y = Number(b);
  if (a === '' || b === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return Math.abs(x - y) <= 1e-4 * Math.max(1, Math.abs(x), Math.abs(y));
}

describe('a column name shared by 10_wide_summary.csv and analysis_long.csv means one thing (audit 86 D12)', () => {
  const bundle = buildFixtureBundle();
  const wide = parse(buildExportFiles(bundle).find((f) => f.filename === '10_wide_summary.csv')!.content);
  const long = parse(buildAnalysisDataset([bundle]).files.find((f) => f.filename === 'analysis_long.csv')!.content);
  const key = (r: Record<string, string>) => `${r.participant_id}|${r.session_index}|${r.session_position}`;

  it('joins every run of the sitting (the comparison is not vacuous)', () => {
    expect(wide.length).toBeGreaterThanOrEqual(8);
    const longByKey = new Map(long.map((r) => [key(r), r]));
    for (const w of wide) expect(longByKey.has(key(w)), key(w)).toBe(true);
    // The fixture holds comprehension scores that are neither 0 nor all correct, the case that differs.
    expect(wide.some((w) => w.comprehension_proportion !== '' && Number(w.comprehension_proportion) > 0 && Number(w.comprehension_proportion) < 1)).toBe(true);
  });

  it('every shared column carries the same value on every joined row', () => {
    const shared = Object.keys(wide[0]).filter((c) => c in long[0]);
    expect(shared.length).toBeGreaterThan(15);
    const longByKey = new Map(long.map((r) => [key(r), r]));
    const differ = new Set<string>();
    for (const w of wide) {
      const l = longByKey.get(key(w))!;
      for (const c of shared) if (!same(w[c], l[c])) differ.add(`${c} (10: ${w[c]} | long: ${l[c]})`);
    }
    expect([...differ]).toEqual([]);
  });

  it('the proportion is comprehension_proportion in 10, and analysis_long keeps the count it models', () => {
    const wideCols = CODEBOOK.filter((r) => r.file === '10_wide_summary.csv').map((r) => r.column);
    expect(wideCols).toContain('comprehension_proportion');
    expect(wideCols).not.toContain('comprehension_correct');
    const entry = CODEBOOK.find((r) => r.file === '10_wide_summary.csv' && r.column === 'comprehension_proportion')!;
    expect(entry.unit).toBe('0-1');
    expect(entry.description).toMatch(/Called comprehension_correct in this file before Round 89/);
    expect(ANALYSIS_CODEBOOK.find((c) => c.column === 'comprehension_correct')!.unit).toBe('count');
    // Values: the proportion in 10 is the count over the items in analysis_long, row by row.
    const longByKey = new Map(long.map((r) => [key(r), r]));
    for (const w of wide) {
      const l = longByKey.get(key(w))!;
      if (w.comprehension_proportion === '') { expect(l.comprehension_correct).toBe(''); continue; }
      expect(Number(w.comprehension_proportion)).toBeCloseTo(Number(l.comprehension_correct) / Number(l.comprehension_items), 9);
    }
  });
});
