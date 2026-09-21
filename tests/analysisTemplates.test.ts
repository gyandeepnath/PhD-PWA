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
  // `frame$column <- ...` creates a usable model term just as surely as a bare assignment; the
  // logit-transformed PERCLOS response is built that way and was reported as undefined.
  for (const m of text.matchAll(/\$([A-Za-z_.][\w.]*)\s*<-/g)) made.add(m[1]);
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

/**
 * Column references checked against THE FILE THEY ARE READ FROM, not against the union.
 *
 * The formula check above is deliberately narrow, and a defect walked straight through the gap it
 * leaves. `analysis_template.R` selected `lux_all_in_range` from `01_session_info.csv`, where the
 * exporter writes `lux_logged_all_in_range`; `dplyr::select()` raises on a missing column, so the
 * R template stopped at the join and fitted nothing at all.
 *
 * Two structural reasons it passed. The `EXPORTED` set above is the UNION of every file's columns,
 * and `lux_all_in_range` is real — it exists in `analysis_long.csv`, a different export product. And
 * the harvester reads model formulas only, never `select()` arguments, so the reference was never
 * examined in the first place.
 *
 * This check closes both: it binds each data frame to the CSV it was read from and requires every
 * selected column to exist in THAT file.
 */
describe('R template column references resolve in the file they are read from', () => {
  const r = src('src/analysis/analysis_template.R');

  /**
   * `name <- read_export("NN_file.csv")`, and the older
   * `name <- read_csv(file.path(DATA_DIR, "NN_file.csv"))` it replaced. Both forms are matched so
   * that this check does not quietly stop finding anything the next time the loader is reshaped —
   * which is exactly what happened when pooling across participant folders was introduced, and is
   * what the "binds every data frame" assertion below exists to catch.
   */
  const frames = new Map<string, string>();
  for (const m of r.matchAll(/([A-Za-z_.][\w.]*)\s*<-\s*read_export\(\s*"([^"]+)"/g)) frames.set(m[1], m[2]);
  for (const m of r.matchAll(/([A-Za-z_.][\w.]*)\s*<-\s*read_csv\(\s*file\.path\(\s*DATA_DIR\s*,\s*"([^"]+)"/g)) {
    frames.set(m[1], m[2]);
  }

  /** Columns the exporter actually writes into one numbered file. */
  const columnsOf = (filename: string) =>
    new Set(CODEBOOK.filter((c) => c.file === filename).map((c) => c.column));

  /** Argument list of a call, respecting nested parentheses. */
  function argsAt(text: string, openParen: number): string {
    let depth = 0;
    for (let i = openParen; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(openParen + 1, i); }
    }
    return '';
  }

  it('binds every data frame to a numbered export file', () => {
    // If the read block is ever rewritten in a way this parser cannot see, the check below would
    // silently pass by having nothing to check. Fail loudly instead.
    expect(frames.size).toBeGreaterThanOrEqual(8);
    for (const file of frames.values()) expect(columnsOf(file).size).toBeGreaterThan(0);
  });

  it('selects no column that its source file does not contain', () => {
    const problems: string[] = [];
    for (const [frame, file] of frames) {
      const cols = columnsOf(file);
      const created = namesCreatedIn(r);
      for (const m of r.matchAll(new RegExp(`\\b${frame}\\s*%>%\\s*(?:\\n\\s*)?select\\s*\\(`, 'g'))) {
        const open = m.index! + m[0].length - 1;
        for (const raw of argsAt(r, open).split(',')) {
          const arg = raw.trim().replace(/^-/, '');
          // Skip helpers (anything called), renames, and empties.
          if (!arg || arg.includes('(') || arg.includes('=') || arg.includes('"')) continue;
          if (!/^[A-Za-z_.][\w.]*$/.test(arg)) continue;
          if (created.has(arg)) continue;
          if (!cols.has(arg)) problems.push(`${file}: select(${arg}) — not a column of that file`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * EVERY NUMERIC THRESHOLD IN THE R TEMPLATE MUST DECLARE ITS PROVENANCE.
 *
 * Three of the QC bounds carried a label saying whether the value came from the protocol or was an
 * analyst's choice, and four others were bare literals at their use sites — the dispersion refit
 * trigger, the censoring-spread warning, the completion-informative band and the PERCLOS logit
 * squeeze. That is an inconsistency in the file's own standard, and it matters for a specific
 * reason: a number that decides how a result is READ cannot be defended in a viva or reproduced by
 * anyone else unless it says where it came from.
 *
 * The lux band was worse than unlabelled — it was DUPLICATED. This file hardcoded 250 and 350 while
 * src/experiment/illumination.ts defines the same band, so the two could drift; and this project has
 * already been bitten by exactly that, when an end-to-end helper's hardcoded lux literal silently
 * put every test out of range after the protocol retargeted its illuminance.
 */
describe('the R template declares where each of its thresholds came from', () => {
  const r = () => src('src/analysis/analysis_template.R');

  it('names every threshold instead of leaving it a bare literal at the use site', () => {
    const src_ = r();
    for (const name of [
      'QC_FACE_PRESENCE_MIN', 'QC_OFF_AXIS_MAX', 'QC_EXPOSURE_MIN_FRAC',
      'DISPERSION_REFIT_AT', 'CENSOR_SPREAD_WARN_PP', 'COMPLETION_INFORMATIVE',
      'PERCLOS_LOGIT_SQUEEZE',
    ]) {
      expect(src_).toContain(name);
      // Defined once and then USED — a constant nothing reads is decoration.
      expect(src_.split(name).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('marks each one as protocol-derived or as an analyst choice', () => {
    // The distinction is the point: a value from the protocol is defensible by citation, and one
    // chosen by the analyst has to be visible so it can be argued with and changed deliberately.
    const src_ = r();
    expect(src_).toMatch(/QC_FACE_PRESENCE_MIN[^\n]*PROTOCOL/);
    expect(src_).toMatch(/DISPERSION_REFIT_AT[^\n]*PROTOCOL/);
    for (const name of ['QC_OFF_AXIS_MAX', 'QC_EXPOSURE_MIN_FRAC', 'CENSOR_SPREAD_WARN_PP',
      'COMPLETION_INFORMATIVE', 'PERCLOS_LOGIT_SQUEEZE']) {
      expect(src_).toMatch(new RegExp(name + '[^\\n]*ANALYST DEFAULT'));
    }
  });

  it('does not re-derive the accepted illuminance band the app already owns', () => {
    /*
     * The app defines the band in src/experiment/illumination.ts and writes its own verdict into
     * lux_logged_all_in_range. Reading the flag cannot drift; re-deriving the band can.
     */
    const src_ = r();
    const bandLiteralInCode = /^[^#\n]*\b(?:250|350)\b/m.test(src_);
    expect(bandLiteralInCode).toBe(false);
    expect(src_).toContain('lux_logged_all_in_range');
  });
});

/**
 * THE TWO TOOLCHAINS MUST COMPUTE THE SAME COVARIATE.
 *
 * `analysis_long.csv` centres `position_c` on `(N_CONDITIONS - 1) / 2` — the DESIGN's last position.
 * The Python template centred on `session_position.max() / 2`, the position this dataset happens to
 * contain, while its own comment claimed the two codings were "kept identical". They agree only when
 * the data includes position 9: a cohort in which no participant reached the last condition centres
 * at 4.0 in one place and 4.5 in the other, so the covariate both files call position_c is not the
 * same covariate. It also drifts with the dataset rather than the protocol, so re-running the same
 * analysis after adding one participant can move it.
 *
 * ANALYSIS_PLAN.md §5b requires the two toolchains to agree in sign and in significance. They cannot
 * be compared at all if a shared covariate is defined differently in each.
 */
describe('position_c is centred on the design, not on the data', () => {
  it('does not centre the Python template on the observed maximum', () => {
    const py = src('src/analysis/analysis_template.py');
    expect(py).not.toMatch(/session_position"\]\.max\(\)\s*\/\s*2/);
    expect(py).toMatch(/\(n_conditions - 1\)\s*\/\s*2/);
  });

  it('takes the condition count from the export that states it, counting DISTINCT conditions', () => {
    /*
     * load() pools every participant folder, so counting ROWS of the reference file gave 120 for a
     * 12-participant cohort — a centring constant of 59.5, which drove the GEE's standard errors to
     * NaN. The gate's own "usable standard error" assertion caught it.
     */
    const py = src('src/analysis/analysis_template.py');
    expect(py).toContain('00_condition_reference.csv');
    expect(py).toMatch(/nunique\(\)/);
  });

  it('matches the definition the pooled exporter uses', () => {
    // The source of truth both are meant to agree with.
    const exporter = src('src/storage/analysisExport.ts');
    expect(exporter).toMatch(/position_c: sum\.session_position - \(N_CONDITIONS - 1\) \/ 2/);
  });
});
