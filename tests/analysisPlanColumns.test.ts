/**
 * Every name the analysis plan puts in `code` is one the analyst can find (audit 86 D9).
 *
 * docs/ANALYSIS_PLAN.md promises in its header that "every column named here exists". §5 told the analyst
 * that `lux_all_in_range` flags a sitting outside the illumination band — a column no export file has
 * (01 and analysis_long call it `lux_logged_all_in_range`), and the very name that once stopped the R
 * template. §7 said the checksums are in `16_integrity_report.csv`, which has none. Nothing checked the
 * promise, so it drifted twice. This test is the check.
 *
 * A backticked snake_case name in the plan must be one of:
 *   - a column of a per-sitting file (the codebook) or of analysis_long.csv (its codebook);
 *   - an integrity or join check code (the codes the reports print);
 *   - a variable the R or Python template creates (an assignment in its code, not a comment);
 *   - one of the few names below that are neither, each with the reason it is allowed.
 * A name that no longer exists is told in plain text where the plan recounts its history.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CODEBOOK } from '@/storage/export';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Named in the plan, not a column, a check code or a template variable — and why each may be. */
const NOT_A_COLUMN: Record<string, string> = {
  exported_at: 'a key of export_manifest.json and analysis_manifest.json (§7 says the manifests carry it)',
  checksum_fnv1a: 'a key of each file entry in the two manifests (§7)',
  checksum_basis: 'a key of both manifests (§7)',
};

function columns(): Set<string> {
  const out = new Set<string>();
  for (const r of CODEBOOK) {
    const m = r.column.match(/^(.*?)(\d+)\.\.(\d+)$/);
    if (m) for (let i = Number(m[2]); i <= Number(m[3]); i++) out.add(`${m[1]}${i}`);
    else out.add(r.column);
  }
  for (const c of ANALYSIS_CODEBOOK) out.add(c.column);
  return out;
}

function checkCodes(): Set<string> {
  const out = new Set<string>();
  for (const f of ['src/storage/integrity.ts', 'src/storage/joinIntegrity.ts']) {
    for (const m of read(f).matchAll(/add\(\s*[^,()]+,\s*'([a-z][a-z0-9_]*)'/g)) out.add(m[1]);
    // Codes listed as data (the completeness exclusions, the blocking audit checks).
    for (const m of read(f).matchAll(/^\s*'([a-z][a-z0-9_]*_[a-z0-9_]+)',/gm)) out.add(m[1]);
  }
  return out;
}

/** Names a template assigns: `x <- `, `x = ` inside a call, `df$x <- `, Python `df["x"] = ` — never a comment. */
function templateVariables(): Set<string> {
  const out = new Set<string>();
  const code = (src: string, comment: RegExp) => src.split('\n').map((l) => l.replace(comment, '')).join('\n');
  const r = code(read('src/analysis/analysis_template.R'), /#.*$/);
  for (const m of r.matchAll(/(?:^|[\s(,$])([a-z][a-z0-9_]*)\s*(?:<-|=(?!=))/gm)) out.add(m[1]);
  const py = code(read('src/analysis/analysis_template.py'), /#.*$/);
  for (const m of py.matchAll(/\[\s*["']([a-z][a-z0-9_]*)["']\s*\]\s*=(?!=)/g)) out.add(m[1]);
  for (const m of py.matchAll(/(?:^|[\s(,])([a-z][a-z0-9_]*)\s*=(?!=)/gm)) out.add(m[1]);
  return out;
}

describe('the analysis plan names only what exists (audit 86 D9)', () => {
  const plan = read('docs/ANALYSIS_PLAN.md');
  const named = [...new Set([...plan.matchAll(/`([a-z][a-z0-9_]*_[a-z0-9_]+)`/g)].map((m) => m[1]))];

  it('finds the names it checks (the test is not vacuous)', () => {
    expect(named.length).toBeGreaterThan(100);
    expect(named).toContain('lux_logged_all_in_range');
  });

  it('every backticked name is a column, a check code, a template variable, or allowed with its reason', () => {
    const cols = columns();
    const codes = checkCodes();
    const vars = templateVariables();
    const unknown = named.filter((n) => !cols.has(n) && !codes.has(n) && !vars.has(n) && !(n in NOT_A_COLUMN));
    const where = unknown.map((n) => `${n} (line ${plan.split('\n').findIndex((l) => l.includes(`\`${n}\``)) + 1})`);
    expect(where).toEqual([]);
  });

  it('every name allowed by hand is still named in the plan, so the list cannot outlive its reason', () => {
    for (const n of Object.keys(NOT_A_COLUMN)) expect(named, n).toContain(n);
  });

  it('the illumination check names the column the export writes, and §7 says where the checksums are', () => {
    expect(plan).not.toMatch(/`lux_all_in_range`/);
    expect(plan).toMatch(/`lux_logged_all_in_range` flags those/);
    expect(plan).not.toMatch(/checksums in\s+`16_integrity_report\.csv`/);
  });
});
