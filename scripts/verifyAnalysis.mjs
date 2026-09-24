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
 * It asserts execution and the presence of the pre-registered sections, not numbers: the fixture is
 * one synthetic participant, so no coefficient it produces means anything. What is being checked is
 * that an analyst pointing the template at a real bundle gets output rather than a traceback, and
 * that the sections docs/ANALYSIS_PLAN.md requires are among them.
 *
 * `analysis_template.R` IS run here now, and the gap this comment used to describe was not
 * hypothetical. The R template — the one docs/ANALYSIS_PLAN.md §5b calls the implementation of the
 * plan — did not run at all: it selected `lux_all_in_range` from 01_session_info.csv, where the
 * exporter writes `lux_logged_all_in_range`, and dplyr stopped at that join. Everything below it,
 * including the primary model, had never executed.
 *
 * The R fixture is MULTI-PARTICIPANT and the Python one is not, for a reason worth stating: the
 * per-session export is one folder per sitting, so a single folder gives `(1 | participant_id)` a
 * single level and glmer stops with "grouping factors must have > 1 sampled level". A one-folder
 * fixture could therefore only ever have tested the R template's data loading, never its models.
 * The clones are perturbed deterministically because twelve identical participants make the
 * binomial response constant, which glmer also refuses — and that refusal is a property of the
 * fixture, not of the template.
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
  // Dump a fixture export through the real writer, so this checks the bytes the app emits.
  const dumper = join(dir, 'dump.ts');
  mkdirSync(join(dir, 'out'), { recursive: true });
  writeFileSync(dumper, `
import { writeFileSync } from 'node:fs';
import { buildExportFiles } from ${JSON.stringify(join(process.cwd(), 'src/storage/export.ts'))};
import { buildFixtureBundle } from ${JSON.stringify(join(process.cwd(), 'src/sim/bundleFixture.ts'))};
for (const f of buildExportFiles(buildFixtureBundle())) {
  writeFileSync(${JSON.stringify(join(dir, 'out'))} + '/' + f.filename, f.content);
}
`);
  execFileSync('npx', ['tsx', dumper], { stdio: 'pipe' });

  console.log('='.repeat(104));
  console.log('ANALYSIS TEMPLATE — the shipped Python template must run on the export the app writes');
  console.log('='.repeat(104));

  const run = (dataDir) => spawnSync(py, ['-c',
    `import sys; sys.path.insert(0, ${JSON.stringify(join(process.cwd(), 'src/analysis'))})\n`
    + `import analysis_template as t\nt.DATA_DIR = ${JSON.stringify(dataDir)}\nt.main()\n`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  /*
   * A MULTI-PARTICIPANT tree for the Python template too, for the same reason the R one needs it.
   *
   * The design has ten cells and one sitting has ten rows, so a single-participant fixture makes the
   * GEE saturated: it fits perfectly, every standard error is NaN or machine epsilon, and no
   * coefficient can be tested. The gate's assertion was that the section's TITLE appears in the
   * output, so it stayed green while the pre-registered primary model estimated nothing testable.
   *
   * Built here rather than reusing the R tree because that one is created later in this file and
   * only when R is installed; the Python path must not depend on R being present.
   */
  const pyDir = join(dir, 'py-cohort');
  mkdirSync(pyDir, { recursive: true });
  const pyDumper = join(dir, 'dumpPy.ts');
  writeFileSync(pyDumper, `
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildExportFiles } from ${JSON.stringify(join(process.cwd(), 'src/storage/export.ts'))};
import { buildFixtureBundle } from ${JSON.stringify(join(process.cwd(), 'src/sim/bundleFixture.ts'))};
const root = ${JSON.stringify(pyDir)};
const esc = (v) => JSON.stringify(v).slice(1, -1);
for (let i = 0; i < 12; i++) {
  const base = buildFixtureBundle();
  const pid = 'P' + String(i + 1).padStart(3, '0');
  let json = JSON.stringify(base)
    .split(esc(base.session.participant_id)).join(pid)
    .split(esc(base.session.session_id)).join('S' + String(i + 1).padStart(3, '0'));
  for (const c of base.conditions) json = json.split(esc(c.condition_id)).join(pid + '-' + c.condition_id);
  const b = JSON.parse(json);
  b.session.enrolment_number = i + 1;
  // The same two exclusions the R tree carries, on the same participants, so both templates are
  // held to removing them — ANALYSIS_PLAN.md 5b requires the toolchains to model the same rows.
  if (i === 11) b.conditions[b.conditions.length - 1].completed_at = null;
  if (i === 5) b.session.withdrawn_at = b.session.session_start_time + 3_600_000;
  // Between-participant variation, so the random/cluster structure has something to estimate.
  (b.eyeMetrics ?? []).forEach((m, k) => {
    m.blink_count_incomplete = Math.max(1, m.blink_count_incomplete + ((i * 3 + k) % 5) - 2);
  });
  const out = root + '/' + pid;
  mkdirSync(out, { recursive: true });
  for (const f of buildExportFiles(b)) writeFileSync(out + '/' + f.filename, f.content);
}
`);
  execFileSync('npx', ['tsx', pyDumper], { stdio: 'pipe' });

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
    ok('the polarity coefficient has a usable standard error',
      Number.isFinite(se) && se > 1e-6, `standard error was ${polarityRow[2]} — a saturated or constant fit`);
  }

  const out = `${r.stdout}\n${r.stderr}`;
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

      const rDir = join(dir, 'r');
      mkdirSync(rDir, { recursive: true });
      const rDumper = join(dir, 'dumpMany.ts');
      writeFileSync(rDumper, `
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildExportFiles } from ${JSON.stringify(join(process.cwd(), 'src/storage/export.ts'))};
import { buildFixtureBundle } from ${JSON.stringify(join(process.cwd(), 'src/sim/bundleFixture.ts'))};
const root = ${JSON.stringify(rDir)};
for (let i = 0; i < 12; i++) {
  const base = buildFixtureBundle();
  const pid = 'P' + String(i + 1).padStart(3, '0');
  const sid = 'S' + String(i + 1).padStart(3, '0');
  // Substituted in the JSON-ESCAPED form, not the raw one. FIXTURE.pid is 'VER,"01' — it carries a
  // comma and a quote on purpose, to stress the CSV writer — so the raw string never appears in
  // JSON.stringify output, and a naive split/join silently replaces nothing. Every participant then
  // keeps the same id, and lme4 stops with "grouping factors must have > 1 sampled level".
  const esc = (v) => JSON.stringify(v).slice(1, -1);
  let json = JSON.stringify(base)
    .split(esc(base.session.participant_id)).join(pid)
    .split(esc(base.session.session_id)).join(sid);
  // condition_id has to be made unique per participant too, and this is not housekeeping. The
  // fixture's condition ids are fixed values, so twelve clones shared them; every join on
  // condition_id then matched twelve rows instead of one and the modelling frame came out at 1440
  // rows for what should be 120. The models still fitted — on a dataset each of whose observations
  // appeared twelve times — so the gate would have been green while checking nothing real, and a
  // genuine fan-out bug in the template could have hidden inside the noise.
  for (const c of base.conditions) json = json.split(esc(c.condition_id)).join(pid + '-' + c.condition_id);
  const b = JSON.parse(json);
  b.session.enrolment_number = i + 1;
  // One PAUSED condition in the cohort: started, never finished, so no completed_at. The template
  // must remove it before modelling and say how many it removed — checked below.
  // Put on the LAST participant: the §5.4 truncation test below halves P001's exposures and counts
  // exactly ten flagged rows, and must not share a participant with this one.
  if (i === 11) b.conditions[b.conditions.length - 1].completed_at = null;
  // And one WITHDRAWN participant, on neither of those: every one of their rows must go, and be
  // counted, before any model sees them.
  if (i === 5) b.session.withdrawn_at = b.session.session_start_time + 3_600_000;
  // Deterministic variation — see the header note on "Response is constant".
  (b.eyeMetrics ?? []).forEach((m, k) => {
    m.blink_count_full = 26 + ((i * 5 + k * 3) % 11);
    m.blink_count_micro = (i + k) % 3;
    m.blink_count_incomplete = 4 + ((i * 7 + k * 5) % 9);
    m.perclos_p80 = Math.round((0.02 + ((i * 3 + k) % 9) * 0.004) * 1000) / 1000;
  });
  // The signal-detection measures need varying too, or the weighted d-prime model fails with
  // "not a positive definite matrix" — constant across participants is degenerate, the same way
  // identical blink counts made the binomial response constant. A section that reports "did not
  // fit" on every run is a section the gate cannot check.
  (b.rtSummaries ?? []).forEach((r, k) => {
    r.d_prime = Math.round((1.2 + ((i * 4 + k * 3) % 13) * 0.11) * 1000) / 1000;
    r.d_prime_se = Math.round((0.28 + ((i + k) % 5) * 0.03) * 1000) / 1000;
    r.criterion = Math.round((-0.3 + ((i * 3 + k * 5) % 11) * 0.06) * 1000) / 1000;
  });
  const out = root + '/' + pid;
  mkdirSync(out, { recursive: true });
  for (const f of buildExportFiles(b)) writeFileSync(out + '/' + f.filename, f.content);
}
`);
      execFileSync('npx', ['tsx', rDumper], { stdio: 'pipe' });

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
        // Every threshold this file applies must say where it came from. Three were labelled and
        // four were bare literals, which is an inconsistency in the file's own standard: a number
        // that decides how a result is read has to be defensible and reproducible.
        ['analyst-chosen thresholds are still declared as such', 'ANALYST DEFAULT'],
        ['the spread in censoring across conditions is quantified', 'spread in censoring across conditions'],
        ['completion is offered as a censoring-immune outcome', 'completed within the window'],
        ['the uncensored fit declares its own downward bias', 'biased DOWNWARD'],
      ]) ok(`R: ${label}`, rOut.includes(needle), `"${needle}" not in the output`);

      // A threshold that is not in the protocol must say so where it is read, not only in a comment.
      ok('R: analyst-chosen QC thresholds are labelled as such',
        rOut.includes('ANALYST DEFAULT'), 'no threshold was marked as an analyst default');

      // The modelling frame must be one row per participant x condition. The fixture's condition ids
      // were shared across clones, so every join on condition_id matched twelve rows and the frame
      // came out twelve times too large — models fitting happily on data that repeated itself.
      const frameRows = /rows failing at least one §5 check:\s*\d+\/(\d+)/.exec(rOut);
      // 12 x 10 condition-runs, less the withdrawn participant's ten and the one paused run.
      ok('R: the modelling frame is one row per participant x FINISHED condition, withdrawn excluded',
        frameRows != null && Number(frameRows[1]) === 109,
        `expected 109 rows (12 participants x 10 conditions, less 10 withdrawn and 1 paused), got ${frameRows ? frameRows[1] : 'no match'}`);

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
