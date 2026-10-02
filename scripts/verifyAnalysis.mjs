/**
 * Run the shipped analysis template against the export the app actually produces.
 *
 * WHY THIS EXISTS. `src/analysis/analysis_template.py` is shipped code that an analyst is told to
 * point at the exported bundle, and nothing had ever run it against one. It did not work. Its FIRST
 * operation — joining 10_wide_summary.csv onto 02_conditions.csv by condition_id — raised
 *
 *     ValueError: You are trying to merge on str and float64 columns for key 'condition_id'
 *
 * because the wide summary's header declared condition_id while its row objects omitted it, so
 * every row's join key was blank and pandas typed the all-empty column as float64. The template
 * carried an assert written to catch a bad join and never reached it. Twelve sections of
 * verifyExport passed the same bundle: they check that documented columns exist and that values are
 * in range, and an all-empty column exists and is trivially in range.
 *
 * So the unit and export suites can both be green while the analysis nobody has run is broken. This
 * closes that by running it.
 *
 * It asserted execution and the presence of the pre-registered sections, and nothing about the
 * numbers under them — so the Python comprehension model ran sign-inverted against R, and the Python
 * primary answered a different question from R's, with this gate green throughout. It now runs both
 * templates on ONE simulated cohort with known polarity effects (src/sim/analysisCohort.ts) and also
 * checks what can be checked without trusting a coefficient's size: that each template recovers the
 * simulated SIGN, that R and Python agree on it, that no design is rank deficient, and that both model
 * exactly the confirmatory and sensitivity sets the dashboard counts from the exporter's verdict.
 *
 * `analysis_template.R` IS run here now, and the gap this comment used to describe was not
 * hypothetical. The R template — the one docs/ANALYSIS_PLAN.md §5b calls the implementation of the
 * plan — did not run at all: it selected `lux_all_in_range` from 01_session_info.csv, where the
 * exporter writes `lux_logged_all_in_range`, and dplyr stopped at that join. Everything below it,
 * including the primary model, had never executed.
 *
 * The cohort is MULTI-PARTICIPANT for a reason worth stating: the per-session export is one folder
 * per sitting, so a single folder gives `(1 | participant_id)` a single level and glmer stops with
 * "grouping factors must have > 1 sampled level". A one-folder fixture could only ever test data
 * loading, never a model.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`   ${pass ? 'ok  ' : 'FAIL'}  ${label}${pass || !detail ? '' : ` — ${detail}`}`);
  if (!pass) failures++;
};

const py = ['python3', 'python'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
if (!py) {
  console.log('[verify-analysis] no python interpreter found — SKIPPED (not passed).');
  process.exit(0);
}
const deps = spawnSync(py, ['-c', 'import pandas, numpy, statsmodels'], { stdio: 'ignore' }).status === 0;
if (!deps) {
  console.log('[verify-analysis] pandas/numpy/statsmodels not installed — SKIPPED (not passed).');
  console.log('[verify-analysis] install them to check the template runs: pip install pandas numpy statsmodels scipy');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'visulab-analysis-'));
try {
  console.log('='.repeat(104));
  console.log('ANALYSIS TEMPLATE — the shipped Python template must run on the export the app writes');
  console.log('='.repeat(104));

  const run = (dataDir) => spawnSync(py, ['-c',
    `import sys; sys.path.insert(0, ${JSON.stringify(join(process.cwd(), 'src/analysis'))})\n`
    + `import analysis_template as t\nt.DATA_DIR = ${JSON.stringify(dataDir)}\nt.main()\n`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  /*
   * ONE SIMULATED COHORT, read by BOTH templates, written through the app's real writers.
   *
   * This used to be two trees of buildFixtureBundle() clones, and every clone kept the fixture's own
   * Williams row (enrolment 7): serial position and passage were aliased with condition, so the
   * primary model was not estimable at all. R reported a rank-deficient design; once the Python
   * primary sum-coded its colour factor its polarity standard error was 2.2e7, and this gate — which
   * asked only for a finite standard error above 1e-6 — stayed green. The outcomes were near-constant
   * too, so nothing could check that either template recovers the SIGN of an effect, which is the one
   * property ANALYSIS_PLAN.md §5b requires the two to share; the Python comprehension model had been
   * sign-inverted against R for exactly that reason.
   *
   * src/sim/analysisCohort.ts gives every participant the real counterbalancing for their enrolment,
   * seeded random outcomes with participant effects, and KNOWN polarity effects on the primary
   * outcome and on comprehension. One participant withdrew and one paused a run, so both templates
   * must apply the exporter's verdict. The pooled export sits beside the per-sitting folders, as the
   * analyst is told to lay them out, and the cohort tab's own count of the confirmatory and
   * sensitivity sets is written beside it, so the two templates and the dashboard can be held to the
   * same rows.
   *
   * One tree for both, deliberately: the templates must agree on the same data. The Python path still
   * does not depend on R being installed.
   */
  const SIM = { n: 24, seed: 20260402, polarityEffectOnIncomplete: 0.4, polarityEffectOnComprehension: 0.6, withdrawn: [5], pausedLast: [11] };
  // positive minus negative: negative polarity RAISES incomplete blinking; positive polarity RAISES comprehension.
  const EXPECTED_SIGN = { primary: -1, comprehension: 1 };
  const cohortDir = join(dir, 'cohort');
  mkdirSync(cohortDir, { recursive: true });
  const cohortDumper = join(dir, 'dumpCohort.ts');
  writeFileSync(cohortDumper, `
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildExportFiles } from ${JSON.stringify(join(process.cwd(), 'src/storage/export.ts'))};
import { buildAnalysisDataset } from ${JSON.stringify(join(process.cwd(), 'src/storage/analysisExport.ts'))};
import { simulateCohort } from ${JSON.stringify(join(process.cwd(), 'src/sim/analysisCohort.ts'))};
import { cohortSummary } from ${JSON.stringify(join(process.cwd(), 'src/dashboard/aggregate.ts'))};
import { N_CONDITIONS } from ${JSON.stringify(join(process.cwd(), 'src/experiment/conditions.ts'))};
const root = ${JSON.stringify(cohortDir)};
const bundles = simulateCohort(${JSON.stringify(SIM)});
for (const b of bundles) {
  const out = root + '/' + b.session.participant_id;
  mkdirSync(out, { recursive: true });
  for (const f of buildExportFiles(b)) writeFileSync(out + '/' + f.filename, f.content);
}
const ds = buildAnalysisDataset(bundles);
mkdirSync(root + '/_pooled', { recursive: true });
for (const f of ds.files) writeFileSync(root + '/_pooled/' + f.filename, f.content);
const s = cohortSummary(ds.files, ds.integrity, N_CONDITIONS);
writeFileSync(${JSON.stringify(join(dir, 'expected.json'))}, JSON.stringify({ confirmatory: s.confirmatory, sensitivity: s.sensitivity }));
`);
  execFileSync('npx', ['tsx', cohortDumper], { stdio: 'pipe' });
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  console.log(`         (cohort: ${SIM.n} participants; dashboard confirmatory set ${expected.confirmatory.rows} runs / `
    + `${expected.confirmatory.participants} participants, sensitivity set ${expected.sensitivity.rows} / ${expected.sensitivity.participants})`);

  /** The confirmatory and sensitivity counts a template printed, or null. */
  const setCounts = (text) => {
    const c = /CONFIRMATORY SET: (\d+) condition-runs from (\d+) participants/.exec(text);
    const s2 = /SENSITIVITY SET:\s+(\d+) condition-runs from (\d+) participants/.exec(text);
    return c && s2 ? { confirmatory: { rows: +c[1], participants: +c[2] }, sensitivity: { rows: +s2[1], participants: +s2[2] } } : null;
  };
  /** First coefficient on a row named `term` after `heading`, or NaN. */
  const coefAfter = (text, heading, term) => {
    const block = text.split(heading)[1] ?? '';
    const m = new RegExp(`^${term}\\s+(-?[\\d.]+(?:e[-+]?\\d+)?)`, 'm').exec(block);
    return m ? Number(m[1]) : NaN;
  };
  const pyDir = cohortDir;
  const r = run(pyDir);
  ok('the template runs to completion without raising', r.status === 0,
    (r.stderr || '').trim().split('\n').slice(-3).join(' | '));
  ok('a withdrawn participant is removed before any model, and counted',
    /withdrawn participants removed before modelling: 1\b/.test(r.stdout),
    'the template did not report removing the one withdrawn participant');
  ok('an unfinished condition-run is removed before any model, and counted',
    /unfinished condition-runs removed before modelling \(paused or interrupted\): 1\b/.test(r.stdout),
    'the template did not report removing the one paused condition');

  // The primary model must ESTIMATE, not merely print its heading. With a constant response every
  // coefficient came back zero to machine precision with NaN standard errors, and a title check
  // could not tell that apart from a real fit.
  const primaryBlock = `${r.stdout}`.split('PRIMARY: incomplete-blink ratio')[1] ?? '';
  const polarityRow = /^polarity_c\s+(-?[\d.]+(?:e[-+]?\d+)?)\s+(\S+)/m.exec(primaryBlock);
  ok('the primary model estimates a polarity coefficient', polarityRow != null,
    'no polarity_c row in the primary model output');
  if (polarityRow) {
    const coef = Number(polarityRow[1]);
    const se = Number(polarityRow[2]);
    ok('the polarity coefficient is not zero to machine precision',
      Number.isFinite(coef) && Math.abs(coef) > 1e-6, `coefficient was ${polarityRow[1]}`);
    // Bounded ABOVE as well as below. Above 1e-6 alone let a polarity standard error of 2.2e7 pass —
    // the signature of a design in which polarity is not identified. On the log-odds scale, with
    // two hundred condition-runs, anything near 1 is already a broken fit.
    ok('the polarity coefficient has a usable standard error',
      Number.isFinite(se) && se > 1e-6 && se < 1, `standard error was ${polarityRow[2]} — a saturated, constant or unidentified fit`);
    console.log(`         (polarity_c: coefficient ${polarityRow[1]}, standard error ${polarityRow[2]})`);
  }

  const out = `${r.stdout}\n${r.stderr}`;
  /*
   * THE EXPORTER'S VERDICT, APPLIED. The template used to drop withdrawn participants and unfinished
   * runs and nothing else; it now reads analysis_join_report.csv. Its confirmatory and sensitivity
   * sets must be the ones the dashboard's cohort tab counts from analysis_long.csv on the same data.
   */
  const pySets = setCounts(out);
  ok('the exclusions are counted per reason', /\[exclusion\] participant_withdrawn\s+10 condition-run/.test(out)
    && /\[exclusion\] condition_incomplete\s+10 condition-run/.test(out), 'no per-reason exclusion count');
  ok('the confirmatory and sensitivity sets are the ones the dashboard counts',
    JSON.stringify(pySets) === JSON.stringify(expected), `template ${JSON.stringify(pySets)} vs dashboard ${JSON.stringify(expected)}`);
  ok('the sensitivity set is refitted', out.includes('PRIMARY refit on the SENSITIVITY SET'), 'no sensitivity refit');
  // The simulated effects are known, so the signs are too. A sign-inverted model (the comprehension
  // GEE was one) or a different estimand would fail here, where a heading check cannot.
  const pyPrimary = coefAfter(out, 'PRIMARY: incomplete-blink ratio', 'polarity_c');
  const pyComp = coefAfter(out, 'Comprehension GEE', 'polarity_c');
  ok('the primary polarity coefficient has the simulated sign', Math.sign(pyPrimary) === EXPECTED_SIGN.primary, `got ${pyPrimary}`);
  ok('the comprehension polarity coefficient has the simulated sign', Math.sign(pyComp) === EXPECTED_SIGN.comprehension, `got ${pyComp}`);
  // The sections docs/ANALYSIS_PLAN.md names. Absence of one means an analyst ran the file and was
  // not given an outcome the plan requires — which is how the frame-rate sensitivity went missing.
  for (const [label, needle] of [
    ['the PRIMARY outcome is fitted', 'PRIMARY: incomplete-blink ratio'],
    ['as a binomial, not a Gaussian ratio', 'binomial GEE'],
    ['the frame-rate sensitivity is addressed', 'frame-rate adequacy on the primary-outcome rows'],
    ['the key secondary appears', 'CVS-Q'],
    ['reaction time is fitted', 'RT mixed model'],
    ['fatigue is fitted', 'Fatigue mixed model'],
    ['comprehension is fitted', 'Comprehension GEE'],
    ['a single illumination level is stated, not silently dropped', 'PROTOCOL NOTE'],
  ]) ok(label, out.includes(needle), `"${needle}" not in the output`);

  // The pre-registered codings, which the template silently did not use.
  ok('polarity enters sum-to-zero coded, not treatment coded', out.includes('polarity_c'),
    'no polarity_c term in any printed model');
  ok('no model prints a treatment-coded polarity term', !/C\(polarity\)/.test(out),
    'C(polarity) appears in a fitted model');
  /*
   * A boolean response is never modelled. read_csv types is_correct as bool, patsy expands it into
   * is_correct[False] and is_correct[True], and statsmodels takes the FIRST as the success: the
   * comprehension GEE modelled P(wrong answer), every coefficient sign-inverted against R, while this
   * gate checked only that the heading printed. The Dep. Variable line is what gives it away.
   */
  ok('no model\'s response is an expanded boolean (is_correct[False] would model the WRONG answers)',
    !/Dep\. Variable:[^\n]*\[False\]/.test(out), 'a Dep. Variable line carries [False]');
  const compBlock = out.split('Comprehension GEE')[1] ?? '';
  ok('the comprehension response is the 0/1 correct indicator',
    /Dep\. Variable:\s+is_correct\s/.test(compBlock), 'the comprehension Dep. Variable is not is_correct');
  /*
   * Colour is SUM-coded in the primary, so polarity_c is the average polarity effect R and the plan
   * test. Treatment-coded colour made it the achromatic simple effect — a different estimand under the
   * same name — and the coefficient table would show C(color_name)[T.blue] rows.
   */
  ok('the primary\'s colour term is sum-coded, so polarity_c is the AVERAGE polarity effect',
    /C\(color_name, Sum\)\[S\./.test(primaryBlock) && !/C\(color_name\)\[T\./.test(primaryBlock),
    'the primary carries treatment-coded colour rows');

  // And the sensitivity refit must actually fire when there is something to be sensitive to.
  const dir2 = join(dir, 'flagged');
  mkdirSync(dir2, { recursive: true });
  execFileSync('cp', ['-r', ...['.'].map(() => pyDir + '/.'), dir2]);
  const mark = spawnSync(py, ['-c',
    `import pandas as pd\n`
    + `p = ${JSON.stringify(join(dir2, 'P001', '07_eye_metrics.csv'))}\n`
    + `d = pd.read_csv(p)\nd.loc[d.index[:4], 'fps_adequate_for_ratio'] = False\nd.to_csv(p, index=False)\n`,
  ], { encoding: 'utf8' });
  ok('the fixture can be marked with inadequate frame rates', mark.status === 0, mark.stderr);
  const r2 = run(dir2);
  ok('with rows below the floor, the template still runs', r2.status === 0,
    (r2.stderr || '').trim().split('\n').slice(-3).join(' | '));
  ok('and refits on the adequately-sampled rows, as the plan requires',
    `${r2.stdout}`.includes('PRIMARY refit, adequately-sampled conditions ONLY'),
    'the pre-registered sensitivity refit did not run');
  // =========================================================================
  // The R template.
  // =========================================================================
  const rscript = spawnSync('Rscript', ['--version'], { stdio: 'ignore' }).status === 0 ? 'Rscript' : null;
  if (!rscript) {
    console.log('\n[verify-analysis] Rscript not found — the R template was SKIPPED (not passed).');
    console.log('[verify-analysis] install R and the template\'s packages to check it runs.');
  } else {
    const pkgProbe = spawnSync('Rscript', ['-e',
      'q(status = as.integer(!all(sapply(c("tidyverse","lme4","lmerTest","emmeans","performance"), requireNamespace, quietly = TRUE))))',
    ], { stdio: 'ignore' });
    if (pkgProbe.status !== 0) {
      console.log('\n[verify-analysis] R present but its packages are not — the R template was SKIPPED (not passed).');
      console.log('[verify-analysis] install.packages(c("tidyverse","lme4","lmerTest","emmeans","performance"))');
    } else {
      console.log('\n' + '='.repeat(104));
      console.log('ANALYSIS TEMPLATE (R) — the authoritative template must run on a MULTI-PARTICIPANT export');
      console.log('='.repeat(104));

      const rDir = cohortDir;

      // DATA_DIR is overridden from outside rather than by editing the shipped file, so what runs
      // here is byte-for-byte what the analyst is given.
      const rRun = spawnSync('Rscript', [join(process.cwd(), 'src/analysis/analysis_template.R')], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, VISULAB_DATA_DIR: rDir },
      });

      const rOut = `${rRun.stdout}\n${rRun.stderr}`;
      // A paused condition is not a measurement; the dataset above carries exactly one.
      ok('R: a withdrawn participant is removed before any model, and counted',
        /withdrawn participants removed before modelling: 1\b/.test(rOut),
        'the template did not report removing the one withdrawn participant');
      ok('R: an unfinished condition-run is removed before any model, and counted',
        /unfinished condition-runs removed before modelling \(paused or interrupted\): 1\b/.test(rOut),
        'the template did not report removing the one paused condition');
      ok('the R template runs to completion without raising', rRun.status === 0,
        (rRun.stderr || '').trim().split('\n').filter((l) => /^Error|^! /.test(l)).slice(-2).join(' | ')
          || (rRun.stderr || '').trim().split('\n').slice(-2).join(' | '));
      const rSets = setCounts(rOut);
      ok('R: the confirmatory and sensitivity sets are the ones the dashboard and Python count',
        JSON.stringify(rSets) === JSON.stringify(expected) && JSON.stringify(rSets) === JSON.stringify(pySets),
        `R ${JSON.stringify(rSets)}, Python ${JSON.stringify(pySets)}, dashboard ${JSON.stringify(expected)}`);
      ok('R: the sensitivity set is refitted', rOut.includes('PRIMARY refit on the SENSITIVITY SET'), 'no sensitivity refit');
      // ANALYSIS_PLAN.md §5b: the two toolchains must agree in SIGN. Checked against the simulated
      // sign, so agreement on a wrong answer fails too.
      const rPrimary = coefAfter(rOut, '=== PRIMARY: incomplete-blink ratio', 'polarity1');
      const rComp = coefAfter(rOut, 'Comprehension logistic mixed model', 'polarity1');
      ok('R and Python agree on the sign of the primary polarity effect, and it is the simulated sign',
        Math.sign(rPrimary) === EXPECTED_SIGN.primary && Math.sign(pyPrimary) === EXPECTED_SIGN.primary,
        `R ${rPrimary}, Python ${pyPrimary}`);
      ok('R and Python agree on the sign of the comprehension polarity effect, and it is the simulated sign',
        Math.sign(rComp) === EXPECTED_SIGN.comprehension && Math.sign(pyComp) === EXPECTED_SIGN.comprehension,
        `R ${rComp}, Python ${pyComp}`);
      console.log(`         (polarity: primary R ${rPrimary} / Python ${pyPrimary}; comprehension R ${rComp} / Python ${pyComp})`);
      // lme4's own message, not the template's explanatory text that mentions the phrase. The old
      // fixture tripped it on every run, and every marginal mean came back nonEst.
      ok('R: no model matrix is rank deficient', !/fixed-effect model matrix is rank deficient/.test(rOut)
        && !/nonEst/.test(rOut), 'lme4 dropped aliased columns, or emmeans reported nonEst');

      for (const [label, needle] of [
        ['the PRIMARY outcome is fitted', 'PRIMARY: incomplete-blink ratio'],
        ['the primary random structure is stated', 'PRIMARY MODEL RANDOM STRUCTURE'],
        ['overdispersion is checked, as the plan requires', 'OVERDISPERSION CHECK'],
        ['the dispersion verdict is carried to the top of the output', 'PRIMARY MODEL DISPERSION'],
        ['the frame-rate sensitivity is addressed', 'frame-rate adequacy'],
        ['reaction time is fitted', 'RT mixed model'],
        ['fatigue is fitted', 'Fatigue mixed model'],
        ['comprehension is fitted', 'Comprehension logistic mixed model'],
        ['the key secondary appears', 'CVS-Q'],
        ['the achromatic anchor is reported', 'Achromatic anchor'],
        // ANALYSIS_PLAN.md §5: "These are not optional and they come first." §5.1, §5.3, §5.4 and
        // §5.5 appeared nowhere in the R file, so conditions where the face left frame or where the
        // camera saw only part of the exposure entered the primary fit at full weight — which
        // dilutes a real effect toward null.
        ['the §5 quality checks run', 'QUALITY CHECKS'],
        ['§5.1 illumination constancy is reported', 'illumination constancy'],
        ['§5.3 participant presence is reported', 'participant present'],
        ['§5.4 exposure completeness is reported', 'exposure completeness'],
        // Per CONDITION, not study-wide. A study-wide rate says how often careless responding
        // happened; a per-row flag says which rows, which is the only form that can enter a
        // sensitivity analysis or be crossed with the design factors. It needed condition_id in
        // 12_quality_flags.csv, which that file did not carry.
        ['§5.5 careless responding is joined per condition', 'joined per condition on condition_id'],
        ['careless responding is crossed with the design', 'any careless flag, by polarity'],
        ['flagged rows are retained, not silently dropped', 'RETAINED'],
        // The interaction had no formal test: the line headed "the polarity x colour interaction"
        // called emmeans, which returns marginal MEANS — no contrast, no statistic, no p-value.
        ['the interaction is tested, not just described', 'OMNIBUS TEST'],
        ['the passage intercept ANALYSIS_PLAN.md §2 prescribes is in the structure', '(1 | passage)'],
        // Four of the seven §4 secondary outcomes were not modelled at all. They are
        // pre-registered, so an analyst running this file produced a thesis with four of its own
        // stated outcomes unanalysed.
        ['§4 reading speed is modelled', 'Reading speed (secondary'],
        ['§4 response bias is modelled separately from sensitivity', 'Response bias: criterion'],
        ['§4 sensitivity is modelled, not just averaged', 'Sensitivity: d-prime'],
        ['§4 visual search is modelled', 'Visual search (secondary'],
        ['the visual-search censoring rate is reported', 'right-censored'],
        // Uniform censoring biases every condition alike and a between-condition comparison partly
        // survives it. Censoring that VARIES by condition does not — the difference in mean search
        // time becomes partly a difference in how often the clock ran out, biased WITH the
        // hypothesis. So the breakdown matters more than the overall rate.
        ['censoring is broken down by condition, not just overall', 'censoring rate by condition'],
        // Quitting before every target is found is censoring too; the fixture carries such blocks.
        ['stopping early is counted as censoring, not as a completion', 'stopped early by the participant'],
        ['the censoring table carries the combined rate', 'pct_censored'],
        // Every threshold this file applies must say where it came from. Three were labelled and
        // four were bare literals, which is an inconsistency in the file's own standard: a number
        // that decides how a result is read has to be defensible and reproducible.
        ['analyst-chosen thresholds are still declared as such', 'ANALYST DEFAULT'],
        ['the spread in censoring across conditions is quantified', 'spread in censoring across conditions'],
        ['completion is offered as a censoring-immune outcome', 'completed within the window'],
        ['the uncensored fit declares its own downward bias', 'biased DOWNWARD'],
      ]) ok(`R: ${label}`, rOut.includes(needle), `"${needle}" not in the output`);

      // A threshold that is not in the protocol must say so where it is read, not only in a comment.
      const quitLine = /stopped early by the participant:\s*(\d+)/.exec(rOut);
      ok('R: the fixture\'s early-stopped searches are counted',
        quitLine != null && Number(quitLine[1]) > 0, quitLine ? `counted ${quitLine[1]}` : 'no count printed');
      ok('R: analyst-chosen QC thresholds are labelled as such',
        rOut.includes('ANALYST DEFAULT'), 'no threshold was marked as an analyst default');

      // The modelling frame must be one row per participant x condition. The fixture's condition ids
      // were shared across clones, so every join on condition_id matched twelve rows and the frame
      // came out twelve times too large — models fitting happily on data that repeated itself.
      const frameRows = /rows failing at least one §5 check:\s*\d+\/(\d+)/.exec(rOut);
      // Every participant's camera ran, so the ocular frame is the confirmatory set: complete cases
      // only. It used to be 109 = 120 less the withdrawn participant's ten and the one paused run —
      // the paused participant's nine finished runs were modelled, against ANALYSIS_PLAN.md §1's
      // complete-case rule. They are in the SENSITIVITY set now, and only there.
      ok('R: the modelling frame is one row per participant x condition of the CONFIRMATORY set',
        frameRows != null && Number(frameRows[1]) === expected.confirmatory.rows,
        `expected ${expected.confirmatory.rows} rows, got ${frameRows ? frameRows[1] : 'no match'}`);

      // The pre-registered coding. Treatment contrasts made the printed polarity row the effect in
      // ACHROMATIC TEXT ONLY, while the plan states H1's falsification rule on the average effect.
      ok('R: polarity is sum-to-zero coded, and says so',
        /sum-to-zero \+\/-0\.5/.test(rOut), 'the contrast-coding banner did not print');
      ok('R: main effects are declared as average effects',
        rOut.includes('AVERAGE effects, not simple effects'), 'the coding note did not print');

      // ANALYSIS_PLAN.md §4 specifies fatigue_delta; fatigue_mean is permitted only as a fallback,
      // and the fallback must announce itself rather than pass for the specified analysis.
      ok('R: fatigue uses the plan-specified response',
        /\[fatigue\] response: fatigue_delta/.test(rOut),
        'the fatigue model did not fit fatigue_delta');

      // §5.4 has to FIRE, not merely print. A check whose count is structurally always zero reads
      // exactly like a check that passed, and this one was in that state: the fixture's
      // observed_duration_ms was a hardcoded 178,000 ms against a ~61,000-72,000 ms reading time, so
      // the observed fraction sat near 2.7 and could never fall below any sane floor. The fixture is
      // coherent now, which makes a deliberately truncated copy a real test of the check.
      const shortDir = join(dir, 'r-short');
      execFileSync('cp', ['-r', rDir, shortDir], { stdio: 'pipe' });
      const shortFile = join(shortDir, 'P001', '07_eye_metrics.csv');
      const lines = readFileSync(shortFile, 'utf8').split('\n');
      const cols = lines[0].split(',');
      const obsIdx = cols.indexOf('observed_duration_ms');
      ok('the fixture exposes observed_duration_ms to truncate', obsIdx >= 0,
        '07_eye_metrics.csv has no observed_duration_ms column');
      if (obsIdx >= 0) {
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cells = lines[i].split(',');
          // Halve it: the camera saw half the exposure, and every RATE on the row still looks normal.
          cells[obsIdx] = String(Math.round(Number(cells[obsIdx]) / 2));
          lines[i] = cells.join(',');
        }
        writeFileSync(shortFile, lines.join('\n'));
        const shortRun = spawnSync('Rscript', [join(process.cwd(), 'src/analysis/analysis_template.R')], {
          encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, VISULAB_DATA_DIR: shortDir },
        });
        const shortOut = `${shortRun.stdout}\n${shortRun.stderr}`;
        ok('R: with a truncated exposure, the template still runs', shortRun.status === 0,
          (shortRun.stderr || '').trim().split('\n').filter((l) => /^Error/.test(l)).slice(-1).join(' | '));
        const flagged = /below 0\.9 \(ANALYST DEFAULT\):\s*(\d+)\//.exec(shortOut);
        ok('R: §5.4 detects a half-length exposure rather than reporting zero',
          flagged != null && Number(flagged[1]) === 10,
          `expected 10 flagged rows (one participant x ten conditions), got ${flagged ? flagged[1] : 'no match'}`);
        ok('R: the flagged rows are counted as failing a §5 check',
          /rows failing at least one §5 check:\s*10\//.test(shortOut),
          'the combined qc_clean flag did not pick them up');
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('='.repeat(104));
console.log(failures === 0
  ? 'PASS — the shipped analysis template runs on the app\'s own export and reports every required section'
  : `FAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
