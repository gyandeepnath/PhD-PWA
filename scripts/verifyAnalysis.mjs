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
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
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

  const r = run(join(dir, 'out'));
  ok('the template runs to completion without raising', r.status === 0,
    (r.stderr || '').trim().split('\n').slice(-3).join(' | '));

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
  execFileSync('cp', ['-r', ...['.'].map(() => join(dir, 'out') + '/.'), dir2]);
  const mark = spawnSync(py, ['-c',
    `import pandas as pd\n`
    + `p = ${JSON.stringify(join(dir2, '07_eye_metrics.csv'))}\n`
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
  // Deterministic variation — see the header note on "Response is constant".
  (b.eyeMetrics ?? []).forEach((m, k) => {
    m.blink_count_full = 26 + ((i * 5 + k * 3) % 11);
    m.blink_count_micro = (i + k) % 3;
    m.blink_count_incomplete = 4 + ((i * 7 + k * 5) % 9);
    m.perclos_p80 = Math.round((0.02 + ((i * 3 + k) % 9) * 0.004) * 1000) / 1000;
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
        ['§5.5 careless responding is reported', 'careless responding'],
        ['flagged rows are retained, not silently dropped', 'RETAINED'],
      ]) ok(`R: ${label}`, rOut.includes(needle), `"${needle}" not in the output`);

      // A threshold that is not in the protocol must say so where it is read, not only in a comment.
      ok('R: analyst-chosen QC thresholds are labelled as such',
        rOut.includes('ANALYST DEFAULT'), 'no threshold was marked as an analyst default');

      // The modelling frame must be one row per participant x condition. The fixture's condition ids
      // were shared across clones, so every join on condition_id matched twelve rows and the frame
      // came out twelve times too large — models fitting happily on data that repeated itself.
      const frameRows = /rows failing at least one §5 check:\s*\d+\/(\d+)/.exec(rOut);
      ok('R: the modelling frame is one row per participant x condition',
        frameRows != null && Number(frameRows[1]) === 120,
        `expected 120 rows (12 participants x 10 conditions), got ${frameRows ? frameRows[1] : 'no match'}`);

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
