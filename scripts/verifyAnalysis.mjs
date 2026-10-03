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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

const startedAt = Date.now();
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
/*
 * R is detected up front, because every template run is launched before any is read (below).
 */
let rReady = false;
let rSkipReason = '';
if (spawnSync('Rscript', ['--version'], { stdio: 'ignore' }).status !== 0) {
  rSkipReason = 'Rscript not found — the R template was SKIPPED (not passed).\n[verify-analysis] install R and the template\'s packages to check it runs.';
} else if (spawnSync('Rscript', ['-e',
  'q(status = as.integer(!all(sapply(c("tidyverse","lme4","lmerTest","emmeans","performance"), requireNamespace, quietly = TRUE))))',
], { stdio: 'ignore' }).status !== 0) {
  rSkipReason = 'R present but its packages are not — the R template was SKIPPED (not passed).\n[verify-analysis] install.packages(c("tidyverse","lme4","lmerTest","emmeans","performance"))';
} else {
  rReady = true;
}

/*
 * EVERY TEMPLATE RUN AT ONCE, a few at a time. Run one after another the gate took three minutes,
 * almost all of it R, which fits the main cohort and its truncated copy in about a minute each; the
 * hostile cohorts are seconds apiece. The runs share nothing (each reads its own folder), so they are
 * launched together on a pool sized to the machine, longest first, and only READ in the order the
 * checks below are written. The output is the same; the wall time is about that of the longest run.
 *
 * BLAS threads are pinned to one per process. numpy and R would otherwise each start one per core,
 * and a pool of processes each running a pool of threads is slower than either alone.
 */
const POOL = Math.max(2, Math.min(6, availableParallelism()));
const ONE_THREAD = { OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' };
const queue = [];
let active = 0;
const pump = () => {
  while (active < POOL && queue.length > 0) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
};
const launch = (cmd, args, env = {}) => new Promise((resolve) => {
  queue.push(() => new Promise((done) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...ONE_THREAD, ...env } });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (e) => { resolve({ status: -1, stdout, stderr: `${stderr}\n${e}` }); done(); });
    child.on('close', (status) => { resolve({ status, stdout, stderr }); done(); });
  }));
  pump();
});
// DATA_DIR is overridden from outside rather than by editing the shipped file, so what runs here is
// byte-for-byte what the analyst is given.
const launchPy = (dataDir) => launch(py, ['-c',
  `import sys; sys.path.insert(0, ${JSON.stringify(join(process.cwd(), 'src/analysis'))})\n`
  + `import analysis_template as t\nt.DATA_DIR = ${JSON.stringify(dataDir)}\nt.main()\n`,
]);
const launchR = (dataDir) => launch('Rscript', [join(process.cwd(), 'src/analysis/analysis_template.R')], { VISULAB_DATA_DIR: dataDir });

const dir = mkdtempSync(join(tmpdir(), 'visulab-analysis-'));
try {
  console.log('='.repeat(104));
  console.log('ANALYSIS TEMPLATE — the shipped Python template must run on the export the app writes');
  console.log('='.repeat(104));

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
  const SIM = {
    n: 24, seed: 20260402, polarityEffectOnIncomplete: 0.4, polarityEffectOnComprehension: 0.6, polarityEffectOnDprime: 0.4,
    withdrawn: [5], pausedLast: [11],
    // Three runs the app's own scorer flags engagement 'bad' (only QC timings changed; see the option).
    disengaged: [2, 7, 13],
  };
  const N_BAD = SIM.disengaged.length;
  // positive minus negative: negative polarity RAISES incomplete blinking; positive polarity RAISES comprehension.
  // positive polarity RAISES d' (the trial-level signal-detection model); the outer ring LOWERS it (the default).
  const EXPECTED_SIGN = { primary: -1, comprehension: 1, dprime: 1 };
  /*
   * Every cohort the gate reads — the main one and the small hostile ones further down — from ONE
   * dumper process, which writes each cohort's folders, its pooled export, and the dashboard's count of
   * its confirmatory and sensitivity sets. (One tsx start-up per cohort cost about two seconds each.)
   */
  const COHORTS = {
    cohort: SIM,
    one: { n: 1, seed: 3 },
    twice: { n: 4, seed: 4 },
    'no-verdict': { n: 4, seed: 5 },
    few: { n: 3, seed: 31 },
    'cameras-off': { n: 6, seed: 6, cameraOff: 'all' },
    // Three of twelve declined the camera: the ocular models lose their rows, nothing else may.
    'cameras-some': { n: 12, seed: 8, cameraOff: [0, 1, 2] },
    'one-polarity': { n: 4, seed: 7, onePolarity: 'positive' },
    'one-polarity-edited': { n: 4, seed: 9 },
    // Ten participants, the size of the pilot: this seed puts the PERCLOS participant variance at its
    // boundary, where statsmodels' gradient-based optimizers raise LinAlgError (2 of 20 seeds at N = 10).
    ten: { n: 10, seed: 1 },
  };
  const cohortDumper = join(dir, 'dumpCohort.ts');
  writeFileSync(cohortDumper, `
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { buildExportFiles } from ${JSON.stringify(join(process.cwd(), 'src/storage/export.ts'))};
import { buildAnalysisDataset } from ${JSON.stringify(join(process.cwd(), 'src/storage/analysisExport.ts'))};
import { simulateCohort } from ${JSON.stringify(join(process.cwd(), 'src/sim/analysisCohort.ts'))};
import { cohortSummary } from ${JSON.stringify(join(process.cwd(), 'src/dashboard/aggregate.ts'))};
import { N_CONDITIONS } from ${JSON.stringify(join(process.cwd(), 'src/experiment/conditions.ts'))};
const jobs: { root: string; options: unknown }[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const { root, options } of jobs) {
  const bundles = simulateCohort(options as Parameters<typeof simulateCohort>[0]);
  for (const b of bundles) {
    const out = root + '/' + b.session.participant_id;
    mkdirSync(out, { recursive: true });
    for (const f of buildExportFiles(b)) writeFileSync(out + '/' + f.filename, f.content);
  }
  const ds = buildAnalysisDataset(bundles);
  mkdirSync(root + '/_pooled', { recursive: true });
  for (const f of ds.files) writeFileSync(root + '/_pooled/' + f.filename, f.content);
  const s = cohortSummary(ds.files, ds.integrity, N_CONDITIONS);
  writeFileSync(root + '.expected.json', JSON.stringify({ confirmatory: s.confirmatory, sensitivity: s.sensitivity }));
}
`);
  const at = (name) => join(dir, name);
  const jobsFile = join(dir, 'cohorts.json');
  writeFileSync(jobsFile, JSON.stringify(Object.entries(COHORTS).map(([name, options]) => ({ root: at(name), options }))));
  execFileSync('npx', ['tsx', cohortDumper, jobsFile], { stdio: 'pipe' });
  const expected = JSON.parse(readFileSync(`${at('cohort')}.expected.json`, 'utf8'));
  const cohortDir = at('cohort');

  /** Rewrite one column of a per-sitting CSV in place. The export quotes no field these edits touch. */
  const editColumn = (file, column, edit) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    const idx = lines[0].split(',').indexOf(column);
    if (idx < 0) return false;
    writeFileSync(file, lines.map((l, i) => {
      if (i === 0 || !l.trim()) return l;
      const cells = l.split(',');
      cells[idx] = edit(cells[idx], i);
      return cells.join(',');
    }).join('\n'));
    return true;
  };
  const sittings = (root) => readdirSync(root).filter((f) => /^P\d+/.test(f));

  // The derived states, each a copy of a cohort with one thing changed. Why each matters is said
  // where it is checked.
  //  - flagged: four of P001's runs below the frame-rate floor, so the sensitivity refit must fire;
  cpSync(cohortDir, at('flagged'), { recursive: true });
  const flaggedMarked = editColumn(join(at('flagged'), 'P001', '07_eye_metrics.csv'), 'fps_adequate_for_ratio',
    (v, i) => (i <= 4 ? 'false' : v));
  //  - r-short: every exposure halved, and no target locations (a pre-Round-66 export);
  cpSync(cohortDir, at('r-short'), { recursive: true });
  const shortMarked = editColumn(join(at('r-short'), 'P001', '07_eye_metrics.csv'), 'observed_duration_ms',
    (v) => String(Math.round(Number(v) / 2)));
  for (const pid of sittings(at('r-short'))) editColumn(join(at('r-short'), pid, '08_reaction_trials.csv'), 'stim_ring', () => '');
  //  - twice: one sitting exported into two folders;
  cpSync(join(at('twice'), 'P001'), join(at('twice'), 'P001_exported_again'), { recursive: true });
  //  - no-verdict: the per-sitting folders without the pooled export;
  rmSync(join(at('no-verdict'), '_pooled'), { recursive: true, force: true });
  //  - one-polarity-edited: every run relabelled positive in the per-sitting condition tables only.
  for (const pid of sittings(at('one-polarity-edited'))) {
    editColumn(join(at('one-polarity-edited'), pid, '02_conditions.csv'), 'polarity', () => 'positive');
  }

  // Launched longest first: the two full R runs, then the rest.
  const RUNS = {
    ...(rReady ? {
      'R:cohort': launchR(cohortDir), 'R:r-short': launchR(at('r-short')), 'R:cameras-some': launchR(at('cameras-some')),
      'R:cameras-off': launchR(at('cameras-off')), 'R:one': launchR(at('one')), 'R:twice': launchR(at('twice')),
      'R:no-verdict': launchR(at('no-verdict')), 'R:one-polarity': launchR(at('one-polarity')),
      'R:one-polarity-edited': launchR(at('one-polarity-edited')),
    } : {}),
    'Python:cohort': launchPy(cohortDir), 'Python:flagged': launchPy(at('flagged')),
    'Python:cameras-some': launchPy(at('cameras-some')), 'Python:cameras-off': launchPy(at('cameras-off')),
    'Python:one': launchPy(at('one')), 'Python:twice': launchPy(at('twice')), 'Python:no-verdict': launchPy(at('no-verdict')),
    'Python:few': launchPy(at('few')), 'Python:ten': launchPy(at('ten')), 'Python:one-polarity': launchPy(at('one-polarity')),
    'Python:one-polarity-edited': launchPy(at('one-polarity-edited')),
  };
  console.log(`         (cohort: ${SIM.n} participants; dashboard confirmatory set ${expected.confirmatory.rows} runs / `
    + `${expected.confirmatory.participants} participants, sensitivity set ${expected.sensitivity.rows} / ${expected.sensitivity.participants};`
    + ` ${Object.keys(RUNS).length} template runs, ${POOL} at a time)`);

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
  const r = await RUNS['Python:cohort'];
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
  // ... ON ITS OWN ROWS. A heading proves nothing: the R refit printed this heading for two rounds
  // while fitting the confirmatory rows (see the R check of the same name). The paused participant's
  // nine finished runs are in the sensitivity set only, so it must model more blinks.
  const pySens = /polarity_c: confirmatory -?[\d.]+ \(SE [\d.]+, n (\d+) blinks\) \| sensitivity -?[\d.]+ \(SE [\d.]+, n (\d+) blinks\)/.exec(out);
  ok('... on the sensitivity set\'s rows, which carry more blinks than the confirmatory set\'s',
    pySens != null && +pySens[2] > +pySens[1], pySens ? `confirmatory ${pySens[1]} blinks, sensitivity ${pySens[2]}` : 'no confirmatory | sensitivity line');
  /*
   * ENGAGEMENT 'bad' RUNS ARE COUNTED, KEPT, AND REFITTED WITHOUT ONLY AS A SENSITIVITY (M2).
   * DROP_DISENGAGED used to be TRUE: 'bad' runs vanished from every model without a count, and the
   * flag is built partly from outcomes. Put back, it passed this whole gate, because no run here was
   * 'bad'. Three are now, so the primary must use them and the without-'bad' refit must fire.
   */
  const pyPrimRuns = +(/^\[n\] primary: (\d+) of \d+ camera-on condition-runs used \((\d+) blinks\)/m.exec(out)?.[1] ?? NaN);
  const pyPrimBlinks = +(/^\[n\] primary: \d+ of \d+ camera-on condition-runs used \((\d+) blinks\)/m.exec(out)?.[1] ?? NaN);
  const pyNoBad = /without engagement 'bad' runs\s+polarity_c -?[\d.]+ \(SE [\d.]+\), (\d+) blink rows/.exec(out);
  ok(`the ${N_BAD} engagement-'bad' runs are counted and RETAINED: the primary uses every confirmatory run`,
    new RegExp(`\\[engagement\\] ${N_BAD} of ${expected.confirmatory.rows} confirmatory condition-runs are flagged 'bad'\\. RETAINED`).test(out)
      && pyPrimRuns === expected.confirmatory.rows, `[engagement] line or primary runs (${pyPrimRuns}) wrong`);
  ok('... and the primary is refitted without them, on fewer blinks, as a labelled sensitivity',
    pyNoBad != null && +pyNoBad[1] < pyPrimBlinks, pyNoBad ? `${pyNoBad[1]} blink rows vs ${pyPrimBlinks}` : 'no without-\'bad\' refit line');
  // The simulated effects are known, so the signs are too. A sign-inverted model (the comprehension
  // GEE was one) or a different estimand would fail here, where a heading check cannot.
  const pyPrimary = coefAfter(out, 'PRIMARY: incomplete-blink ratio', 'polarity_c');
  const pyComp = coefAfter(out, 'Comprehension GEE', 'polarity_c');
  ok('the primary polarity coefficient has the simulated sign', Math.sign(pyPrimary) === EXPECTED_SIGN.primary, `got ${pyPrimary}`);
  ok('the comprehension polarity coefficient has the simulated sign', Math.sign(pyComp) === EXPECTED_SIGN.comprehension, `got ${pyComp}`);
  /*
   * H1'S EFFECT SIZE (M7). The plan's falsification quantities — the polarity effect's 95% CI, and the
   * predicted difference in proportion — were never printed by either template. Read back here and
   * held to the simulated sign, to each other (the odds ratio is exp(log-odds), on both limits), and,
   * further down, to R's.
   */
  const h1 = (text) => {
    const lo = /\[H1\] primary: polarity\S* \(positive minus negative\) log-odds (-?[\d.]+) \(95% CI (-?[\d.]+) to (-?[\d.]+)\), p \S+ — the CI (EXCLUDES|INCLUDES) zero/.exec(text);
    const or = /\[H1\] primary: odds ratio ([\d.]+) \(95% CI ([\d.]+) to ([\d.]+)\)/.exec(text);
    const pd = /\[H1\] primary: predicted proportion incomplete, positive ([\d.]+) vs negative ([\d.]+); difference (-?[\d.]+) \(95% CI (-?[\d.]+) to (-?[\d.]+)\)/.exec(text);
    return lo && or && pd ? {
      est: +lo[1], lcl: +lo[2], ucl: +lo[3], verdict: lo[4], or: [+or[1], +or[2], +or[3]],
      pPos: +pd[1], pNeg: +pd[2], diff: +pd[3], dLcl: +pd[4], dUcl: +pd[5],
    } : null;
  };
  const h1Sane = (h) => h != null
    && Math.abs(h.or[0] - Math.exp(h.est)) < 0.002 && Math.abs(h.or[1] - Math.exp(h.lcl)) < 0.002 && Math.abs(h.or[2] - Math.exp(h.ucl)) < 0.002
    && h.lcl < h.est && h.est < h.ucl && h.dLcl < h.diff && h.diff < h.dUcl
    && Math.abs(h.pPos - h.pNeg - h.diff) < 0.0011;
  const pyH1 = h1(out);
  ok('H1 is reported as a log-odds difference with its 95% CI, an odds ratio, and a difference in proportion',
    h1Sane(pyH1), `parsed ${JSON.stringify(pyH1)}`);
  ok('... with the simulated sign on both scales, and a CI that excludes zero for a simulated 0.4 log-odds effect',
    pyH1 != null && Math.sign(pyH1.est) === EXPECTED_SIGN.primary && Math.sign(pyH1.diff) === EXPECTED_SIGN.primary
      && pyH1.verdict === 'EXCLUDES' && Math.sign(pyH1.dUcl) === EXPECTED_SIGN.primary, `parsed ${JSON.stringify(pyH1)}`);
  ok('H1 is also reported on the §2 formula, without the frame-rate covariate',
    /\[H1\] without eff_fps_c \(§2 formula\): polarity/.test(out), 'no H1 line for the fit without eff_fps_c');
  ok('the primary family prints H1a and H1b, raw and Holm across the two',
    /PRIMARY FAMILY[\s\S]*H1a polarity[^\n]*Holm across the two [\d.e-]+\n[^\n]*H1b polarity x colour[^\n]*Holm across the two [\d.e-]+/.test(out),
    'no primary-family block with both tests');
  /*
   * THE DESIGNED DEGREES OF FREEDOM. Two polarities by five colours leave four interaction columns,
   * and H1b tests all four. A design that has lost one — treatment-coded colour no longer matched by
   * the prefix the test collects, an aliased cell — tests fewer and still prints a p-value.
   */
  ok('H1b tests the four designed interaction columns (Wald, 4 df)', /H1b polarity x colour \(Wald, 4 df\)/.test(out),
    `H1b is ${/H1b polarity x colour \(Wald, (\d+) df\)/.exec(out)?.[1] ?? 'not'} df`);
  ok('the GEEs\' covariance is not withheld on a 22-participant cohort', !/\[SE CAUTION\]/.test(out), 'an [SE CAUTION] printed');
  /*
   * PERCLOS (M13). A sleepiness COVARIATE in the codebook and the synopsis, which this file fitted RAW
   * as an outcome of polarity and never used as the covariate the synopsis's sensitivity analysis adds.
   */
  ok('every mixed model fits on the main cohort (none is named as not fitted)', !/the LMM did not fit/.test(out),
    (/^\[[^\]]+\] the LMM did not fit[^\n]*/m.exec(out) ?? [''])[0]);
  ok('PERCLOS is not modelled as an outcome, raw or otherwise', !/=== perclos_p80 mixed model ===/.test(out),
    'the raw perclos_p80 outcome model is still fitted');
  ok('the primary is refitted with PERCLOS as a covariate (synopsis §3.9)',
    /adjusted for perclos_p80 \(synopsis §3\.9\)\s+polarity_c -?[\d.]+/.test(out), 'no PERCLOS-adjusted refit');
  ok('PERCLOS is checked against the condition, compressed by sample size, not clipped at a constant',
    /COVARIATE CHECK for the PERCLOS-adjusted refit/.test(out) && /\[perclos\] compressed as \(y\(n - 1\) \+ 0\.5\) \/ n, n = \d+/.test(out)
      && /\[perclos\] LMM on logit\(y'\): polarity_c/.test(out), 'no PERCLOS covariate check with the compression');
  ok('the GEE says why it is not refitted for overdispersion', /\[overdispersion\] the participant-clustered sandwich/.test(out),
    'no [overdispersion] line');
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
    // m4: rows used of rows given, for every model.
    ['every model reports the rows it used', '[n] primary:'],
    // M5: NASA-TLX was never analysed in this file.
    ['NASA-TLX is summarised', 'NASA-TLX raw score'],
    ['the primary is also reported without the frame-rate covariate', 'without the eff_fps_c covariate'],
  ]) ok(label, out.includes(needle), `"${needle}" not in the output`);
  // M6: the robust sandwich SE is too small with few clusters, and statsmodels' bias-reduced
  // correction failed outright with weights=; the primary is now fitted per blink so it can be used.
  /*
   * PROVENANCE FIRST (m6). Nothing in the output said which software or which collecting build it
   * came from, and CI installs the packages unpinned; ANALYSIS_PLAN.md §7 asks for the build.
   */
  ok('the output opens with its provenance: interpreter, packages, and the collecting builds',
    /^=+\nPROVENANCE\n=+\nPython \d/.test(r.stdout) && /^\s+statsmodels\s+\d/m.test(r.stdout)
      && /^\s+git_hash\s+\S+ \(\d+\)/m.test(r.stdout) && /builds that collected the CONFIRMATORY SET: \S/.test(r.stdout),
    'no PROVENANCE block, package versions, git_hash table or confirmatory-set build line');
  ok('the GEEs use the small-sample (bias-reduced) covariance',
    (out.match(/Covariance type:\s+bias_reduced/g) ?? []).length >= 2, 'a GEE is printed with another covariance type');
  // M3: passage is not balanced against polarity; a GEE cannot carry a passage random effect but can
  // carry a fixed one, and did not.
  ok('the primary and comprehension GEEs carry passage as a fixed effect',
    /C\(passage_id\)\[T\./.test(primaryBlock) && /C\(passage_id\)\[T\./.test(out.split('Comprehension GEE')[1] ?? ''),
    'no C(passage_id) term in the primary or the comprehension model');

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
  ok('the fixture can be marked with inadequate frame rates', flaggedMarked, '07_eye_metrics.csv has no fps_adequate_for_ratio column');
  const r2 = await RUNS['Python:flagged'];
  ok('with rows below the floor, the template still runs', r2.status === 0,
    (r2.stderr || '').trim().split('\n').slice(-3).join(' | '));
  ok('and refits on the adequately-sampled rows, as the plan requires',
    `${r2.stdout}`.includes('PRIMARY refit, adequately-sampled conditions ONLY'),
    'the pre-registered sensitivity refit did not run');
  // =========================================================================
  // The R template.
  // =========================================================================
  if (!rReady) {
    console.log(`\n[verify-analysis] ${rSkipReason}`);
  } else {
    console.log('\n' + '='.repeat(104));
    console.log('ANALYSIS TEMPLATE (R) — the authoritative template must run on a MULTI-PARTICIPANT export');
    console.log('='.repeat(104));

    const rRun = await RUNS['R:cohort'];

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
    /*
     * ... ON THE SENSITIVITY SET'S ROWS. refit_on() called update(m_primary, data = rows), which lme4
     * evaluates first in the formula's (global) environment; once the moderator loop had assigned a
     * global `rows`, the "sensitivity set" fit was the confirmatory fit again — n 220 on this cohort's
     * set of 229 — and only the heading was checked. Every camera on this cohort is on and every run
     * blinks, so the refit must use exactly the sensitivity set's runs, more than the primary's.
     */
    const rSensN = /^\[n\] sensitivity set: (\d+) of (\d+) rows used/m.exec(rOut);
    const rPrimN = +(/^\[n\] primary: (\d+) of \d+/m.exec(rOut)?.[1] ?? NaN);
    ok('R: ... on its own rows: every run of the sensitivity set, more than the confirmatory fit',
      rSensN != null && +rSensN[1] === +rSensN[2] && +rSensN[1] === expected.sensitivity.rows && +rSensN[1] > rPrimN,
      rSensN ? `sensitivity refit used ${rSensN[1]} of ${rSensN[2]} rows; set ${expected.sensitivity.rows}; primary ${rPrimN}` : 'no [n] sensitivity set line');
    // M2, as in Python: the 'bad' runs counted and kept, and the without-'bad' refit on the rest.
    const rNoBad = /without engagement 'bad' runs\s+polarity -?[\d.]+ \(SE [\d.]+\), n (\d+)/.exec(rOut);
    ok(`R: the ${N_BAD} engagement-'bad' runs are counted and RETAINED: the primary uses every confirmatory run`,
      new RegExp(`\\[engagement\\] ${N_BAD} of ${expected.confirmatory.rows} confirmatory condition-runs are flagged 'bad'\\. RETAINED`).test(rOut)
        && rPrimN === expected.confirmatory.rows, `[engagement] line or primary rows (${rPrimN}) wrong`);
    ok('R: ... and the primary is refitted without them as a labelled sensitivity',
      rNoBad != null && +rNoBad[1] === expected.confirmatory.rows - N_BAD, rNoBad ? `n ${rNoBad[1]}` : 'no without-\'bad\' refit line');
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

    // M7: H1's effect size, read back as in Python, and the two toolchains agreeing on it in sign.
    const rH1 = h1(rOut);
    ok('R: H1 is reported as a log-odds difference with its 95% CI, an odds ratio, and a difference in proportion',
      h1Sane(rH1), `parsed ${JSON.stringify(rH1)}`);
    ok('R: the H1 log-odds equal the primary\'s polarity coefficient (emmeans reads the sum-coded main effect)',
      rH1 != null && Math.abs(rH1.est - rPrimary) < 0.0011, `H1 ${rH1?.est} vs coefficient ${rPrimary}`);
    ok('R and Python agree on the sign of H1 on both scales, and both CIs exclude zero',
      rH1 != null && pyH1 != null && Math.sign(rH1.est) === Math.sign(pyH1.est) && Math.sign(rH1.diff) === Math.sign(pyH1.diff)
        && rH1.verdict === 'EXCLUDES' && pyH1.verdict === 'EXCLUDES', `R ${JSON.stringify(rH1)}, Python ${JSON.stringify(pyH1)}`);
    ok('R: the primary family prints H1a and H1b, raw and Holm across the two',
      /PRIMARY FAMILY[\s\S]*H1a polarity[^\n]*Holm across the two [\d.e-]+\n[^\n]*H1b polarity x colour[^\n]*Holm across the two [\d.e-]+/.test(rOut),
      'no primary-family block with both tests');
    // The omnibus LRT's Df is lme4's count of the columns it actually dropped: 4 for the full 2 x 5
    // crossing, fewer where the design matrix was rank deficient. The heading says so; this holds it.
    const lrtDf = /^m_primary\s+\d+(?:\s+-?[\d.]+){5}\s+(\d+)\s+\S+\s*$/m.exec(rOut.split('=== OMNIBUS TEST')[1] ?? '')?.[1];
    ok('R: the polarity x colour likelihood-ratio test has the designed 4 df', lrtDf === '4', `Df ${lrtDf ?? 'not found'}`);
    /*
     * OVERDISPERSION AND CONVERGENCE (M9, m8). The beta-binomial refit used to be "required" above a
     * dispersion ratio of 1.5 and never fitted; an observation-level refit now runs on every primary,
     * and the beta-binomial one wherever glmmTMB is installed (it is in neither the install line nor
     * CI, so its absence must be SAID). And a fit lme4 flagged as not converged used to be kept.
     */
    const olre = /\[OLRE\] polarity log-odds (-?[\d.]+) \(95% CI (-?[\d.]+) to (-?[\d.]+)\), odds ratio [\d.]+; SE ([\d.]+) vs binomial ([\d.]+)/.exec(rOut);
    ok('R: the observation-level refit of the primary runs, whatever the dispersion ratio',
      olre != null && Math.sign(+olre[1]) === EXPECTED_SIGN.primary && (+olre[2] > 0 || +olre[3] < 0),
      olre ? `OLRE ${olre[1]} (${olre[2]} to ${olre[3]})` : 'no [OLRE] line');
    ok('R: ... and its polarity SE is not smaller than the binomial one (it adds variance, it cannot remove it)',
      olre != null && +olre[4] >= 0.98 * +olre[5], olre ? `SE ${olre[4]} vs ${olre[5]}` : 'no [OLRE] line');
    const hasTmb = spawnSync('Rscript', ['-e', 'q(status = as.integer(!requireNamespace("glmmTMB", quietly = TRUE)))'], { stdio: 'ignore' }).status === 0;
    ok(`R: the beta-binomial refit ${hasTmb ? 'is fitted (glmmTMB is installed)' : 'is reported as skipped (glmmTMB is not installed)'}`,
      hasTmb ? /\[beta-binomial\] polarity log-odds -?[\d.]+/.test(rOut) : /\[beta-binomial\] \[SKIPPED: glmmTMB not installed\]/.test(rOut),
      'no [beta-binomial] line of the expected kind');
    ok('R: no dispersion threshold is left deciding a refit that is never run',
      !/betabinomial refit required/.test(rOut), 'the old "refit required" verdict printed');
    ok('R: the reduction ladder reports its convergence verdict rung by rung',
      /PRIMARY MODEL CONVERGENCE \(the ladder, rung by rung\):\n {2}maximal: /.test(rOut), 'no ladder convergence report');
    ok('R: the binomial secondaries report their convergence too',
      /\[convergence\] comprehension: /.test(rOut), 'no [convergence] line for comprehension');
    /*
     * SENSITIVITY AND CRITERION ON THE TRIALS (M8). d' was an LMM on per-block values weighted by
     * 1 / d_prime_se^2 — and that SE rises with d', so the weights penalised high sensitivity — and the
     * template printed the share of blocks flagged d_prime_unstable, which is every block there can be.
     * The cohort simulates a polarity effect on d' (positive higher) and a lower d' on the outer ring.
     */
    const sdtDp = /\[sdt\] polarity effect on d' \(positive minus negative\) (-?[\d.]+) \(95% CI (-?[\d.]+) to (-?[\d.]+)\), p \S+; polarity x colour on d': Wald chi2\(4\)/.exec(rOut);
    ok('R: the trial-level probit model recovers the simulated polarity effect on d\', with a CI that excludes zero',
      sdtDp != null && Math.sign(+sdtDp[1]) === EXPECTED_SIGN.dprime && +sdtDp[2] > 0, sdtDp ? sdtDp.slice(1).join(' / ') : 'no [sdt] d\' line');
    ok('R: ... reports the criterion separately, with its own interval and interaction test',
      /\[sdt\] polarity effect on the criterion c \(positive minus negative\) -?[\d.]+ \(95% CI -?[\d.]+ to -?[\d.]+\), p \S+; polarity x colour on c: Wald chi2\(4\)/.test(rOut),
      'no [sdt] criterion line');
    const ring = /\[sdt\] ring \(§4a\): d' inner ([\d.]+), outer ([\d.]+); ring on d' Wald p \S+; ring x colour on d' Wald chi2\(4\)/.exec(rOut);
    ok('R: ... carries the Round 66 ring and ring x colour terms, and finds the simulated outer-ring loss',
      ring != null && +ring[2] < +ring[1], ring ? `inner ${ring[1]}, outer ${ring[2]}` : 'no [sdt] ring line');
    ok('R: no d_prime_unstable count is printed as a finding, and no d\' fit is weighted by its SE',
      !/blocks flagged d_prime_unstable/.test(rOut) && !/weights: 1 \/ d_prime_se/.test(rOut), 'the old count or weighting is still printed');
    ok('R: the d-prime and criterion family rows come from the trial-level model',
      /^ {2}d-prime\s+-?[\d.]+ \(-?[\d.]+ to -?[\d.]+\)\s+d' \(probit units\)/m.test(rOut) && /^ {2}criterion\s+-?[\d.]+ \(-?[\d.]+ to -?[\d.]+\)\s+criterion c \(probit units\)/m.test(rOut),
      'the family rows are not the probit model\'s');
    // M13: PERCLOS is a covariate — a sensitivity refit and a check, never an outcome, and never
    // clipped at a fixed constant before the logit.
    ok('R: PERCLOS is checked against the condition, compressed by sample size, not clipped at a constant',
      /COVARIATE CHECK for the PERCLOS-adjusted refit/.test(rOut) && /\[perclos\] compressed as \(y\(n - 1\) \+ 0\.5\) \/ n, n = \d+/.test(rOut)
        && /\[perclos\] LMM on logit\(y'\): polarity/.test(rOut) && !/squeezed inward/.test(rOut),
      'no PERCLOS covariate check with the compression, or the old squeeze');
    ok(`R: the PERCLOS beta GLMM ${hasTmb ? 'is fitted' : 'is reported as skipped'}`,
      hasTmb ? /\[perclos\] beta GLMM on y'/.test(rOut) : /\[perclos\] beta GLMM \[SKIPPED: glmmTMB not installed\]/.test(rOut),
      'no PERCLOS beta-GLMM line of the expected kind');
    ok('R: the PERCLOS-adjusted refit sits in the sensitivity list', /adjusted for perclos_p80 \(synopsis §3\.9\)\s+polarity -?[\d.]+/.test(rOut),
      'no PERCLOS-adjusted sensitivity line');
    // m5: Objective 2's three models carry the primary's covariates, and the residual-hue model's
    // collinearity is printed beside its coefficients.
    ok('R: the Objective 2 models carry the primary\'s covariates, and the residual-hue model\'s collinearity is shown',
      /\[model\] Objective 2: [^\n]*eff_fps_c/.test(rOut) && /Collinearity of the residual-hue model \(VIF\)[\s\S]*?log_contrast\s+[\d.]+/.test(rOut),
      'Objective 2 lacks eff_fps_c or the VIF table');
    // The per-colour polarity effects are ONE family of five. Left grouped by colour, emmeans would
    // adjust each one-contrast group on its own, which is no adjustment.
    ok('R: the per-colour polarity effects are Holm-adjusted across the five colours',
      /P value adjustment: holm method for 5 tests/.test(rOut), 'no "holm method for 5 tests" under the per-colour contrasts');
    /*
     * The secondary families of ANALYSIS_PLAN.md §4b: every family printed, every modelled member
     * with an effect and its CI, the Holm-adjusted p never below the raw one, and the members the
     * template does not model yet listed rather than silently dropped.
     */
    const famBlock = rOut.split('=== SECONDARY OUTCOMES: effect sizes and multiplicity')[1] ?? '';
    const famRows = [...famBlock.matchAll(/^ {2}(\S+(?: \S+)?)\s+(-?[\d.]+) \((-?[\d.]+) to (-?[\d.]+)\)\s+.*?\s(\S+)\s+(\S+)\s+\| (\S+)\s+(\S+)$/gm)];
    const pnum = (s) => (s === '-' ? NaN : s.startsWith('<') ? 0 : Number(s));
    ok('R: the three outcome families are printed, each with its size',
      ['ocular', 'subjective', 'performance'].every((f) => new RegExp(`\\[family\\] ${f}: \\d+ of \\d+ outcome`).test(famBlock)),
      'a family header is missing');
    ok('R: every performance outcome the template models has an effect with a 95% CI',
      ['reading speed', 'comprehension', 'RT', 'RT variability', 'lapse rate', 'd-prime', 'criterion', 'search completion', 'search rate', 'search d-prime']
        .every((o) => famRows.some((m) => m[1] === o)), `rows: ${famRows.map((m) => m[1]).join(', ')}`);
    ok('R: the ocular and subjective families are complete: blink rate, inter-blink interval, fatigue, comfort, clarity',
      ['blink rate', 'inter-blink interval', 'fatigue', 'comfort', 'clarity'].every((o) => famRows.some((m) => m[1] === o)),
      `rows: ${famRows.map((m) => m[1]).join(', ')}`);
    ok('R: no Holm-adjusted p is below its raw p',
      famRows.length > 0 && famRows.every((m) => !(pnum(m[6]) < pnum(m[5])) && !(pnum(m[8]) < pnum(m[7]))),
      famRows.map((m) => `${m[1]} ${m[5]}/${m[6]} ${m[7]}/${m[8]}`).join('; '));
    ok('R: every family member is modelled (Round 71) — none is listed as not yet modelled',
      !/not yet modelled/.test(famBlock) && ['ocular: 2 of 2', 'subjective: 3 of 3', 'performance: 10 of 10'].every((f) => famBlock.includes(`[family] ${f}`)),
      'a family member is still unmodelled');
    /*
     * THE REST OF THE PRE-REGISTERED ANALYSES (M11, m10, m11): RT polarity x position (§3), the trial-
     * level log-RT model with the ring terms (§4a), the restarted / interrupted / serial-position /
     * carryover refits of the primary, moderation (Objective 3), and the CVS-Q and NASA-TLX intervals,
     * one value per participant.
     */
    ok('R: the RT polarity x serial-position interaction is tested (§3)',
      /\[RT x position\] polarity x serial position \(§3\): -?[\d.]+ ms per position \(95% CI/.test(rOut), 'no [RT x position] line');
    ok('R: the trial-level log-RT model carries ring, ring x colour and polarity x position (§4a)',
      /\[RT trials\] ring1\s+x[\d.]+/.test(rOut) && /\[RT trials\] ring x colour: Wald chi2\(4\)/.test(rOut)
        && /\[RT trials\] polarity1:session_position/.test(rOut), 'the trial-level RT lines are missing');
    ok('R: the simulated slower outer ring is found in the trial RTs (inner / outer below 1)',
      +(/\[RT trials\] ring1\s+x([\d.]+)/.exec(rOut)?.[1] ?? NaN) < 1, 'ring1 ratio not below 1');
    ok('R: untouched sliders are counted and left out of comfort and clarity',
      /\[comfort\] \d+ of \d+ rating\(s\) left at the slider's default/.test(rOut), 'no untouched-slider count');
    const hasOrdinal = spawnSync('Rscript', ['-e', 'q(status = as.integer(!requireNamespace("ordinal", quietly = TRUE)))'], { stdio: 'ignore' }).status === 0;
    ok(`R: the ordinal sensitivity on the fatigue items ${hasOrdinal ? 'is fitted' : 'is reported as skipped'}`,
      hasOrdinal ? /\[clmm\] polarity \(positive minus negative\), latent logit scale/.test(rOut) : /\[clmm\] \[SKIPPED: ordinal not installed\]/.test(rOut),
      'no [clmm] line of the expected kind');
    for (const [label, re] of [
      ['restarted runs', /without restarted runs \(attempt_number > 1\)|no run was restarted/],
      ['interrupted runs', /without interrupted runs \(condition_interrupted\)|no run was interrupted/],
      ['serial position as a factor', /serial position as a factor\s+polarity -?[\d.]+/],
      ['first-order carryover', /\[carryover\] after a polarity switch: log-odds -?[\d.]+ \(95% CI/],
    ]) ok(`R: the primary is refitted for ${label}`, re.test(rOut), `no ${label} line`);
    ok('R: each recorded moderator of Objective 3 is tested, Holm across them, and the unrecorded one is named',
      ['daily_screen_hours', 'lighting_habit', 'device_familiarity'].every((m) => new RegExp(`\\[moderator\\] ${m}\\s+polarity x moderator: chi2\\(\\d+\\)`).test(rOut))
        && /Holm across the 3 moderator\(s\) tested/.test(rOut) && /display-mode preference \(H1rho\) is not recorded/.test(rOut),
      'a moderator line is missing');
    ok('R: the CVS-Q change has an interval over PARTICIPANTS, and NASA-TLX one per participant',
      /\[cvsq\] mean change, close minus baseline: -?[\d.]+ points \(95% CI -?[\d.]+ to -?[\d.]+\), n = 22 participant/.test(rOut)
        && /\[NASA-TLX\] mean raw TLX [\d.]+ \(95% CI [\d.]+ to [\d.]+\), one value per participant, n = 22/.test(rOut),
      'no per-participant CVS-Q or NASA-TLX interval');
    // m6: provenance first — the R version and packages, then the builds that collected the data.
    ok('R: the output opens with its provenance: R, packages, and the collecting builds',
      /^=+\nPROVENANCE\n=+\nR version \d/.test(rRun.stdout) && /^\s+lme4\s+\d/m.test(rOut)
        && /^\s+git_hash\s+\S+ \(\d+\)/m.test(rOut) && /builds that collected the CONFIRMATORY SET: \S/.test(rOut),
      'no PROVENANCE block, package versions, git_hash table or confirmatory-set build line');
    // emmeans' Kenward-Roger default needs pbkrtest; without it every call printed a fallback notice.
    ok('R: lmer contrasts use the stated Satterthwaite df, not a silent Kenward-Roger fallback',
      !/Cannot use mode = kenward-roger/.test(rOut), 'emmeans fell back from Kenward-Roger');
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
      ['the passage intercept ANALYSIS_PLAN.md §2 prescribes is in the structure', '(1 | passage_id)'],
      // The structure line is read from the fitted model now; it used to be a label that claimed a
      // sitting term (1 | participant:sitting) which had not been fitted.
      ['the structure printed is the one fitted, read from the model', 'PRIMARY MODEL RANDOM STRUCTURE:  maximal: (1 + polarity | participant_id) + (1 | passage_id)'],
      // m4: every model says how many rows it used of the rows it was given.
      ['every model reports the rows it used', '[n] primary:'],
      ['the behavioural models report theirs too', '[n] comprehension:'],
      // M5: NASA-TLX was looked for at DATA_DIR's top level only and never analysed.
      ['NASA-TLX is found in the one-folder-per-sitting layout and summarised', 'NASA-TLX raw score'],
      // M2: engagement-flagged runs are counted and retained; the without-'bad' fit is a sensitivity.
      ['engagement-flagged runs are counted and retained', '[engagement]'],
      ['the primary sensitivity refits are reported side by side', 'PRIMARY: sensitivity refits'],
      // Four of the seven §4 secondary outcomes were not modelled at all. They are
      // pre-registered, so an analyst running this file produced a thesis with four of its own
      // stated outcomes unanalysed.
      ['§4 reading speed is modelled', 'Reading speed (secondary'],
      ['§4 sensitivity and response bias are modelled on the trials', 'SENSITIVITY AND CRITERION: trial-level probit GLMM'],
      ['the per-block d\' and criterion are kept as unweighted cross-checks', 'per-block d\' and criterion, LMM, UNWEIGHTED'],
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
      // M10: a range of ten cells' censoring rates is not a test (it fired in most null datasets); a
      // likelihood ratio is. Search speed is a Poisson rate with the time as exposure, and search d'
      // (which the codebook asks to prefer to accuracy) is modelled.
      ['whether censoring depends on the condition is TESTED', '[censoring] LRT of the condition terms: chi2(9)'],
      ['search speed is a rate with the search time as exposure', 'targets found per minute (Poisson GLMM, time as exposure)'],
      ['search d\' is modelled', 'search d\' (LMM, unweighted)'],
      ['completion is offered as a censoring-immune outcome', 'completed within the window'],
      ['the uncensored fit declares its own downward bias', 'biased DOWNWARD'],
    ]) ok(`R: ${label}`, rOut.includes(needle), `"${needle}" not in the output`);

    // M3: passage is not balanced against polarity, so it is in EVERY model, not only the primary.
    // (Matched across the line break R puts in a long formula.)
    // Read from the one-line [model] formula each fit prints, not from summary(), which lmerTest
    // prints as the unevaluated paste0() call.
    const modelLine = (label) => new RegExp(`^\\[model\\] ${label}: (.*)$`, 'm').exec(rOut)?.[1] ?? '';
    ok('R: comprehension carries the passage and item intercepts',
      modelLine('comprehension').includes('(1 | passage_id)') && modelLine('comprehension').includes('(1 | item)'),
      `the comprehension formula is "${modelLine('comprehension')}"`);
    ok('R: no range rule on the censoring rates is left', !/spread in censoring across conditions/.test(rOut), 'the 10-point spread warning still prints');
    for (const label of ['search rate', 'search d-prime']) {
      ok(`R: the ${label} model carries the passage intercept (target counts differ by passage)`, modelLine(label).includes('(1 | passage_id)'),
        `the ${label} formula is "${modelLine(label)}"`);
    }
    for (const label of ['RT', 'fatigue', 'reading speed', 'signal detection \\(trial cells\\)', 'per-block d_prime', 'per-block criterion', 'search time', 'anchor', 'blink rate']) {
      ok(`R: the ${label} model carries the passage intercept too`, modelLine(label).includes('(1 | passage_id)'),
        `the ${label} formula is "${modelLine(label)}"`);
    }

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
    // coherent now, which makes a deliberately truncated copy a real test of the check: P001's
    // observed_duration_ms is halved (the camera saw half the exposure, and every RATE on the row
    // still looks normal). The same copy doubles as a PRE-ROUND-66 export: no trial records where the
    // dot appeared. The ring terms cannot be estimated, and the template must say so and fit the
    // model without them.
    ok('the fixture exposes observed_duration_ms to truncate', shortMarked,
      '07_eye_metrics.csv has no observed_duration_ms column');
    if (shortMarked) {
      const shortRun = await RUNS['R:r-short'];
      const shortOut = `${shortRun.stdout}\n${shortRun.stderr}`;
      ok('R: with a truncated exposure, the template still runs', shortRun.status === 0,
        (shortRun.stderr || '').trim().split('\n').filter((l) => /^Error/.test(l)).slice(-1).join(' | '));
      const flagged = /below 0\.9 \(ANALYST DEFAULT\):\s*(\d+)\//.exec(shortOut);
      ok('R: §5.4 detects a half-length exposure rather than reporting zero',
        flagged != null && Number(flagged[1]) === 10,
        `expected 10 flagged rows (one participant x ten conditions), got ${flagged ? flagged[1] : 'no match'}`);
      ok('R: an export with no target locations (pre-Round 66) fits the trial model without the ring terms, and says so',
        /\[location\] NO target location/.test(shortOut) && /\[sdt\] polarity effect on d'/.test(shortOut) && !/\[sdt\] ring/.test(shortOut),
        'no [location] message, or the ring line printed anyway');
      ok('R: the flagged rows are counted as failing a §5 check',
        /rows failing at least one §5 check:\s*10\//.test(shortOut),
        'the combined qc_clean flag did not pick them up');
    }
  }

  // =========================================================================
  // States a real cohort reaches. Each used to end in a cryptic error, or worse, in a run that looked
  // successful: one participant gave lme4's "grouping factors must have > 1 sampled level" in R and,
  // in Python, a polarity standard error of 6e-16 with z = 3.6e14; one polarity gave R a contrasts
  // error and Python a bare LinAlgError; a sitting exported into two folders fitted RT, fatigue and
  // comprehension on 419 rows instead of 109; with every camera off R stopped at
  // "!is.null(m_primary) is not TRUE" and lost every behavioural outcome. Each must now end with a
  // NAMED message — and a cohort with some or all cameras off must still report every behavioural
  // outcome, on every participant.
  // =========================================================================
  console.log('\n' + '='.repeat(104));
  console.log('STATES A REAL COHORT REACHES — each ends with a named message, never a traceback or a wrong number');
  console.log('='.repeat(104));
  const both = async (name) => [['Python', await RUNS[`Python:${name}`]], ...(rReady ? [['R', await RUNS[`R:${name}`]]] : [])];
  const said = (res, re) => re.test(`${res.stdout}\n${res.stderr}`);

  for (const [who, res] of await both('one')) {
    ok(`${who}: one participant stops, and says why`, res.status !== 0 && said(res, /\[TOO FEW PARTICIPANTS\]/),
      `exit ${res.status}`);
  }
  for (const [who, res] of await both('twice')) {
    ok(`${who}: a sitting exported into two folders stops, naming them`,
      res.status !== 0 && said(res, /\[DUPLICATED EXPORT\][^\n]*P001_exported_again/), `exit ${res.status}`);
  }
  for (const [who, res] of await both('no-verdict')) {
    ok(`${who}: without the pooled export's verdict it stops and says what to export`,
      res.status !== 0 && said(res, /\[NO VERDICT\][^\n]*Download analysis dataset/), `exit ${res.status}`);
  }
  /*
   * ONE POLARITY, twice. Through the app's own writers it never reaches a model: every participant
   * has two runs in each colour cell, the exporter's audit marks the sitting (duplicate_cell), and the
   * templates stop on an empty confirmatory set, naming the reason. The templates' own guard is the
   * second line, for a condition table edited after export — there the verdict still admits every run
   * and only the template can see that no contrast is left.
   */
  for (const [who, res] of await both('one-polarity')) {
    ok(`${who}: a one-polarity export is refused by the exporter's verdict, and the run stops naming why`,
      res.status !== 0 && said(res, /\[exclusion\] duplicate_cell/) && said(res, /\[TOO FEW PARTICIPANTS\] the confirmatory set holds 0/),
      `exit ${res.status}`);
  }
  for (const [who, res] of await both('one-polarity-edited')) {
    ok(`${who}: a condition table edited to one polarity stops with [ONE POLARITY]`,
      res.status !== 0 && said(res, /\[ONE POLARITY\] every confirmatory condition-run has polarity 'positive'/), `exit ${res.status}`);
  }
  // With no more participants than GEE parameters the cluster-robust covariance is rank deficient: the
  // Python H1 interval printed -553 to 554 and the interaction's Wald p was exactly 0 on three
  // participants. The coefficients are printed; the intervals and tests are withheld, and say why.
  const fewPy = await RUNS['Python:few'];
  ok('Python: with fewer participants than parameters, H1\'s intervals and tests are withheld, not printed',
    fewPy.status === 0 && /\[H1\] primary: polarity_c[^\n]*WITHHELD: \[SE CAUTION\]/.test(fewPy.stdout)
      && !/\[H1\] primary: polarity_c[^\n]*95% CI/.test(fewPy.stdout) && /p-values WITHHELD/.test(fewPy.stdout),
    `exit ${fewPy.status}`);
  /*
   * A BOUNDARY FIT IS NOT A CRASH. On ten participants a participant variance of zero is ordinary;
   * lme4 returns a singular fit, and statsmodels' default optimizers raised LinAlgError("Singular
   * matrix") in the PERCLOS covariate check, so the cross-check ended in a traceback, exit 1. Every
   * MixedLM now retries by Powell's method, says so, and names a model that fits by neither.
   */
  const tenPy = await RUNS['Python:ten'];
  ok('Python: a 10-participant cohort whose PERCLOS variance is at its boundary runs to the end, without a traceback',
    tenPy.status === 0 && !/Traceback/.test(tenPy.stderr) && /\[perclos\] the gradient-based optimizers stopped \(LinAlgError/.test(tenPy.stdout)
      && /\[perclos\] LMM on logit\(y'\): polarity_c/.test(tenPy.stdout),
    `exit ${tenPy.status}: ${(tenPy.stderr || '').trim().split('\n').slice(-1)}`);
  /*
   * WITHOUT THE CAMERA. Every behavioural section — not a sample of three — because the original
   * defect (M4) was a brace: the PERCLOS block closed two hundred lines late, so reading speed, d' and
   * criterion, and visual search ran only when PERCLOS had values, and a cohort without cameras lost
   * them with exit 0 and no message.
   */
  const BEHAVIOURAL = {
    Python: [['RT', /=== RT mixed model ===/], ['fatigue', /=== Fatigue mixed model/], ['comprehension', /=== Comprehension GEE/],
      ['d\'', /=== Mean per-block d' per participant/], ['CVS-Q', /=== CVS-Q baseline-to-close change/], ['NASA-TLX', /=== NASA-TLX raw score/]],
    R: [['RT', /=== RT mixed model ===/], ['fatigue', /=== Fatigue mixed model ===/], ['comprehension', /=== Comprehension logistic mixed model ===/],
      ['reading speed', /=== Reading speed \(secondary, §4\) ===/], ['d\' and criterion', /=== SENSITIVITY AND CRITERION: trial-level probit GLMM/],
      ['visual search', /=== Visual search \(secondary, §4\) ===/], ['CVS-Q', /=== KEY SECONDARY \(EXPLORATORY\): CVS-Q/], ['NASA-TLX', /=== NASA-TLX raw score/]],
  };
  const missingSections = (who, res) => BEHAVIOURAL[who].filter(([, re]) => !said(res, re)).map(([label]) => label);
  /** "[n] <label>: used of given" — the rows a model used. */
  const rowsUsed = (res, label) => +(new RegExp(`^\\[n\\] ${label}: (\\d+) of \\d+`, 'm').exec(res.stdout)?.[1] ?? NaN);
  for (const [who, res] of await both('cameras-off')) {
    ok(`${who}: with every camera off the run completes and says the primary is not estimable`,
      res.status === 0 && said(res, /\[PRIMARY NOT ESTIMABLE\]/), `exit ${res.status}: ${(res.stderr || '').trim().split('\n').slice(-1)}`);
    const missing = missingSections(who, res);
    ok(`${who}: ... and still reports every behavioural and questionnaire outcome`, missing.length === 0, `missing: ${missing.join(', ')}`);
    ok(`${who}: ... and flags the small cohort`, said(res, /\[SMALL N\] 6 participants/), 'no [SMALL N] line');
  }
  // Three of twelve without the camera: the primary is fitted on the nine who had one, and every
  // behavioural model keeps all twelve — reading speed used to be taken from the camera-on frame.
  const someExpected = JSON.parse(readFileSync(`${at('cameras-some')}.expected.json`, 'utf8')).confirmatory.rows;
  for (const [who, res] of await both('cameras-some')) {
    ok(`${who}: with some cameras off the run completes and fits the primary on the camera-on runs only`,
      res.status === 0 && rowsUsed(res, 'primary') === someExpected - 30,
      `exit ${res.status}; primary used ${rowsUsed(res, 'primary')} rows, expected ${someExpected - 30}`);
    const missing = missingSections(who, res);
    ok(`${who}: ... reports every behavioural and questionnaire outcome`, missing.length === 0, `missing: ${missing.join(', ')}`);
    const behav = who === 'R' ? ['RT', 'fatigue', 'reading speed'] : ['RT', 'fatigue'];
    ok(`${who}: ... on every participant's runs, camera or not (${behav.join(', ')})`,
      behav.every((label) => rowsUsed(res, label) === someExpected),
      behav.map((label) => `${label} ${rowsUsed(res, label)}`).join(', ') + ` of ${someExpected}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log('='.repeat(104));
console.log(failures === 0
  ? `PASS — the shipped analysis templates run on the app's own export and recover what was simulated (${seconds} s)`
  : `FAIL — ${failures} check(s) failed (${seconds} s)`);
process.exit(failures === 0 ? 0 : 1);
