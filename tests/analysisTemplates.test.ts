/**
 * The analysis templates ship to the researcher, and nothing validated them.
 *
 * They are the files someone pastes into R and Python to produce the thesis results, and until this
 * test existed no part of the build looked at them at all — no unit test, no script, no lint. That
 * is how `ibr_logit` came to be used as the response variable in FIVE models in the R template while
 * being created nowhere: `object 'ibr_logit' not found`, five times, in a file that had evidently
 * never been run end to end.
 *
 * R cannot be executed here (no Rscript), so this is a static check. It is deliberately narrow —
 * it verifies that every name used in a model formula is either a column the exporter actually
 * writes, or something the template creates before use. That is the exact class of defect that got
 * through, and a narrow check that runs is worth more than a broad one that cannot.
 *
 * The codebook duplication checks are here for the same reason: three columns shipped TWO
 * conflicting definitions each — different role, different unit, different description — and the
 * export verifier's coverage check passed anyway, because it asked whether every documented column
 * exists, never whether any was documented twice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANALYSIS_LONG_COLUMNS } from '@/storage/analysisExport';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';
import { CODEBOOK } from '@/storage/export';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** Every column name the exporter can write, across the long file and every per-session CSV. */
const EXPORTED = new Set<string>([
  ...ANALYSIS_LONG_COLUMNS,
  ...ANALYSIS_CODEBOOK.map((c) => c.column),
  ...CODEBOOK.map((c) => c.column),
]);

/**
 * R syntax that appears inside formulas but is not a column: literals, operators the split leaves
 * behind, and the handful of functions the templates wrap terms in.
 */
const R_NON_COLUMNS = new Set([
  '', '.', '0', '1', 'cbind', 'log', 'scale', 'factor', 'as.formula', 'paste0', 'poly', 'I',
  'offset', 'log_contrast', 'si_term', 'change',
]);

/** Names the template itself creates: `x <- ...`, and `x = ...` inside a mutate()/summarise(). */
function namesCreatedIn(text: string): Set<string> {
  const made = new Set<string>();
  for (const m of text.matchAll(/^\s*([A-Za-z_.][\w.]*)\s*<-/gm)) made.add(m[1]);
  for (const m of text.matchAll(/\b([A-Za-z_.][\w.]*)\s*=\s*(?!=)/g)) made.add(m[1]);
  return made;
}

/**
 * Terms appearing in an R model formula, both sides of the `~`.
 *
 * Two passes, because string literals cut both ways here: `cat("Marginal means by polarity")` must
 * NOT be read as a formula, while `as.formula(paste0("mean_rt_hits_ms ~ ..."))` must be. So string
 * contents are parsed only when they themselves contain a `~`, and stripped otherwise.
 *
 * Function calls are excluded structurally — any name immediately followed by `(` — rather than by
 * a denylist, which would need extending every time the template gained a new call.
 */
function formulaTermsR(text: string): { term: string; line: number }[] {
  const out: { term: string; line: number }[] = [];

  const harvest = (fragment: string, line: number) => {
    const cleaned = fragment
      .replace(/\(1\s*\+?[^)]*\|[^)]*\)/g, ' ')        // random effects: (1 | g), (1 + x | g)
      .replace(/([A-Za-z_.][\w.]*)\s*\(/g, ' (');        // drop the callee of any call
    for (const raw of cleaned.split(/[~+*:,()|\s]+/)) {
      const t = raw.trim();
      if (!t || R_NON_COLUMNS.has(t)) continue;
      if (/^[\d.]+$/.test(t)) continue;
      if (!/^[a-z_][a-z0-9_]*$/i.test(t)) continue;
      out.push({ term: t, line });
    }
  };

  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    // Pass 1: strings that are themselves formulas (as.formula/paste0 construction).
    for (const m of line.matchAll(/"([^"]*~[^"]*)"/g)) harvest(m[1], i + 1);
    // Pass 2: the code with every string literal removed.
    const code = line.replace(/"[^"]*"/g, ' ').replace(/'[^']*'/g, ' ');
    if (code.includes('~')) harvest(code, i + 1);
  });
  return out;
}

describe('the R analysis template references only names that exist', () => {
  const text = src('src/analysis/analysis_template.R');
  const created = namesCreatedIn(text);

  it('uses no undefined symbol as a model term', () => {
    /*
     * The regression this test exists for. `ibr_logit` was the response in five models and was
     * created nowhere — the mutate that was supposed to build it makes only blink_total and
     * eff_fps_c. Nothing in the repository noticed, because nothing read this file.
     */
    const unknown = formulaTermsR(text)
      .filter(({ term }) => !EXPORTED.has(term) && !created.has(term));
    const summary = [...new Map(unknown.map((u) => [u.term, u])).values()]
      .map((u) => `${u.term} (first used at analysis_template.R:${u.line})`);
    expect(summary, 'a model formula names something that is neither an exported column nor created in the template').toEqual([]);
  });
});

describe('the Python analysis template references only names that exist', () => {
  const text = src('src/analysis/analysis_template.py');

  it('uses no undefined column in a patsy formula', () => {
    // patsy formulas are string literals; a name that is not a column raises at fit time, but a
    // one-level categorical silently contributes ZERO columns, which is why this file needs
    // checking statically rather than trusted to error.
    const created = new Set<string>();
    for (const m of text.matchAll(/^\s*([a-z_][\w]*)\s*=\s*(?!=)/gim)) created.add(m[1]);
    for (const m of text.matchAll(/\[["']([a-z_][\w]*)["']\]\s*=/gi)) created.add(m[1]);

    const unknown: string[] = [];
    for (const m of text.matchAll(/["']([^"']*~[^"']*)["']/g)) {
      for (const raw of m[1].split(/[~+*:,()\s]+/)) {
        const t = raw.trim().replace(/^C$/, '');
        if (!t || t === 'C' || t === '1' || t === '0') continue;
        if (/^[\d.]+$/.test(t)) continue;
        if (!/^[a-z_][a-z0-9_]*$/i.test(t)) continue;
        if (!EXPORTED.has(t) && !created.has(t)) unknown.push(t);
      }
    }
    expect([...new Set(unknown)], 'a patsy formula names a column the exporter does not write').toEqual([]);
  });
});

describe('no column is documented twice', () => {
  it('has one definition per column in the export codebook', () => {
    /*
     * Three columns shipped two CONFLICTING definitions each — 01_session_info/participant_id,
     * 01_session_info/session_index and 02_conditions/passage_id — disagreeing on role, unit and
     * description. Which one an analyst reads depends on how they parse the file. The export
     * verifier's 610 checks passed throughout: it asked whether documented columns exist, never
     * whether any was documented twice.
     */
    const seen = new Map<string, number>();
    for (const c of CODEBOOK) {
      const k = `${c.file}|${c.column}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it('has one definition per column in the analysis codebook', () => {
    const seen = new Map<string, number>();
    for (const c of ANALYSIS_CODEBOOK) seen.set(c.column, (seen.get(c.column) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it('documents every column the long analysis file actually writes', () => {
    const documented = new Set(ANALYSIS_CODEBOOK.map((c) => c.column));
    expect(ANALYSIS_LONG_COLUMNS.filter((c) => !documented.has(c))).toEqual([]);
  });
});
