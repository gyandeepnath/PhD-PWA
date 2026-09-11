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
 * `analysis_template.R` is not run here because R is not available in this environment. That is a
 * gap, and it is stated rather than papered over — the R template is the one that implements the
 * plan, so it is the one that most needs this.
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
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('='.repeat(104));
console.log(failures === 0
  ? 'PASS — the shipped analysis template runs on the app\'s own export and reports every required section'
  : `FAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
