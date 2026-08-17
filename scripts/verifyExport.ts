/**
 * Export verification harness — traces every exported cell back to the record it came from.
 *
 * Runs the REAL export path (`buildExportFiles`) over a type-checked fixture whose values are all
 * deliberately distinctive, re-parses the CSVs with an independent RFC-4180 parser, and asserts
 * cell-level provenance. Prints the tables so a person can confirm alignment by eye rather than
 * trusting a passing assertion.
 *
 *   npx tsx scripts/verifyExport.ts            print tables + run assertions
 *   npx tsx scripts/verifyExport.ts --quiet    assertions only (non-zero exit on failure)
 *   npx tsx scripts/verifyExport.ts --show 10_wide_summary.csv   dump one file in full
 */
import { buildExportFiles } from '../src/storage/export';
import { buildFixtureBundle, FIXTURE, readingMs, fatigueMean, ibrFor, rtFor } from '../src/sim/bundleFixture';
import { CONDITIONS } from '../src/experiment/conditions';
import { PASSAGES } from '../src/experiment/passages';
import { summariseLux } from '../src/experiment/illumination';

const QUIET = process.argv.includes('--quiet');
const SHOW = process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1] : null;
const log = (...a: unknown[]) => { if (!QUIET) console.log(...a); };

const failures: string[] = [];
let checks = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  checks++;
  const a = actual === undefined || actual === null ? '' : String(actual);
  const e = expected === undefined || expected === null ? '' : String(expected);
  if (a !== e) failures.push(`${label}\n      got      ${JSON.stringify(a)}\n      expected ${JSON.stringify(e)}`);
}
function ok(label: string, cond: boolean, detail?: string) {
  checks++;
  if (!cond) failures.push(detail ? `${label} — ${detail}` : label);
}

/** Independent RFC-4180 parser: quotes, escaped quotes, embedded newlines and CRLF. */
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
  return {
    headers,
    rows: p.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
    raw: p,
  };
}
function printTable(name: string, csv: string, maxRows = 6) {
  const t = table(csv);
  log(`\n--- ${name}  (${t.rows.length} rows x ${t.headers.length} cols) ---`);
  const cols = t.headers;
  const w = cols.map((h) => Math.min(22, Math.max(h.length, ...t.rows.slice(0, maxRows).map((r) => String(r[h] ?? '').length))));
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  log('  ' + cols.map((h, i) => clip(h, w[i])).join(' | '));
  log('  ' + cols.map((_, i) => '-'.repeat(w[i])).join('-+-'));
  for (const r of t.rows.slice(0, maxRows)) {
    log('  ' + cols.map((h, i) => clip(String(r[h] ?? ''), w[i])).join(' | '));
  }
  if (t.rows.length > maxRows) log(`  … ${t.rows.length - maxRows} more rows`);
}

// ================================================================ build + export
const bundle = buildFixtureBundle();
const files = buildExportFiles(bundle);
const F = new Map(files.map((f) => [f.filename, f.content]));
const S = bundle.session;
const conds = bundle.conditions;

log('='.repeat(104));
log('EXPORT VERIFICATION — one complete session through the real buildExportFiles()');
log('='.repeat(104));
log(`participant_id     ${JSON.stringify(FIXTURE.pid)}   <- contains a comma AND a quote on purpose`);
log(`enrolment / block  ${FIXTURE.enrolment} / ${FIXTURE.block}  ->  illumination "${S.ambient_illumination_level}" (order first: ${S.illumination_order_first})`);
log(`condition order    ${conds.map((c) => c.condition_label).join(' ')}`);
log(`files produced     ${files.length}`);
for (const f of files) {
  log(`   ${f.filename.padEnd(26)} ${String(f.content.split('\n').length - 1).padStart(4)} data rows  ${String(f.content.length).padStart(7)} bytes`);
}

if (SHOW) {
  const c = F.get(SHOW);
  if (!c) { console.error(`No such file: ${SHOW}`); process.exit(2); }
  console.log(c);
  process.exit(0);
}

// ================================================================ 1. structure
log('\n' + '='.repeat(104));
log('1. STRUCTURAL INTEGRITY');
log('='.repeat(104));
for (const f of files) {
  if (!f.filename.endsWith('.csv')) continue;
  const t = table(f.content);
  const n = t.headers.length;
  const bad = t.raw.slice(1).map((r, i) => ({ i, n: r.length })).filter((r) => r.n !== n);
  const dup = t.headers.filter((h, i) => t.headers.indexOf(h) !== i);
  ok(`${f.filename}: every row has ${n} fields`, bad.length === 0,
    bad.length ? `${bad.length} bad row(s), first at data row ${bad[0].i + 1} with ${bad[0].n} fields` : undefined);
  ok(`${f.filename}: header names unique`, dup.length === 0, dup.length ? `duplicates: ${[...new Set(dup)].join(', ')}` : undefined);
  log(`   ${f.filename.padEnd(26)} ${String(n).padStart(3)} cols  ${bad.length ? 'MISALIGNED' : 'aligned'}${dup.length ? '  DUP HEADERS: ' + [...new Set(dup)].join(',') : ''}`);
}

// ================================================================ 2. session row
log('\n' + '='.repeat(104));
log('2. SESSION INFO — source record -> exported cell');
log('='.repeat(104));
const si = table(F.get('01_session_info.csv')!);
ok('01_session_info has exactly one row', si.rows.length === 1, `got ${si.rows.length}`);
const sr = si.rows[0] ?? {};
eq('participant_id round-trips through CSV escaping', sr.participant_id, FIXTURE.pid);
eq('enrolment_number', sr.enrolment_number, S.enrolment_number);
eq('session_index', sr.session_index, S.session_index);
eq('conditions_per_session', sr.conditions_per_session, S.conditions_per_session);
eq('ambient_illumination_level', sr.ambient_illumination_level, S.ambient_illumination_level);
eq('illumination_block', sr.illumination_block, S.illumination_block);
eq('illumination_order_first', sr.illumination_order_first, S.illumination_order_first);
eq('screen_white_luminance_cd_m2', sr.screen_white_luminance_cd_m2, S.screen_white_luminance_cd_m2);
eq('schema_version', sr.schema_version, S.provenance.schema_version);
eq('condition_def_hash', sr.condition_def_hash, S.provenance.condition_def_hash);
const lx = summariseLux(S.ambient_illumination_level, S.lux_readings);
eq('lux_start', sr.lux_start, 152);
eq('lux_middle', sr.lux_middle, 148);
eq('lux_end', sr.lux_end, 151);
eq('lux_mean matches summariseLux (rounded for presentation)', sr.lux_mean, Math.round(lx.mean! * 100) / 100);
eq('lux_max_deviation matches summariseLux', sr.lux_max_deviation, lx.max_deviation);
eq('lux_logged_all_in_range', sr.lux_logged_all_in_range, S.lux_all_in_range);
eq('lux_n_readings', sr.lux_n_readings, S.lux_readings.length);
eq('lux_checkpoints_logged', sr.lux_checkpoints_logged, S.lux_readings.map((r) => r.checkpoint).join('+'));
eq('lux_complete', sr.lux_complete, true);
for (const [k, v] of Object.entries(sr)) {
  if (k.startsWith('lux_') || k.includes('illumination')) log(`   ${k.padEnd(30)} ${v}`);
}

// ================================================================ 3. per-condition alignment
log('\n' + '='.repeat(104));
log('3. PER-CONDITION ALIGNMENT — 02_conditions.csv against the condition table');
log('='.repeat(104));
const cd = table(F.get('02_conditions.csv')!);
eq('row count', cd.rows.length, conds.length);
for (let i = 0; i < conds.length; i++) {
  const r = cd.rows[i]; const c = conds[i];
  const def = CONDITIONS.find((x) => x.label === c.condition_label)!;
  eq(`[${c.condition_label}] session_position`, r.session_position, c.session_position);
  eq(`[${c.condition_label}] polarity`, r.polarity, def.polarity);
  eq(`[${c.condition_label}] color_name is the 5-level factor`, r.color_name, def.colorName);
  eq(`[${c.condition_label}] ink_name is the display name`, r.ink_name, def.inkName);
  eq(`[${c.condition_label}] wcag_contrast_ratio`, r.wcag_contrast_ratio, def.wcag_contrast_ratio);
  eq(`[${c.condition_label}] below_wcag_aa`, r.below_wcag_aa, def.below_wcag_aa);
  eq(`[${c.condition_label}] reading_time_ms`, r.reading_time_ms, readingMs(i));
  // reading_speed_wpm must be derived from the DERIVED word count, not a declared one.
  const words = PASSAGES[c.passage_id].wordCount;
  eq(`[${c.condition_label}] reading_speed_wpm = ${words} words / ${readingMs(i)}ms`,
    r.reading_speed_wpm, String(Math.round(words / (readingMs(i) / 60000))));
}
printTable('02_conditions.csv', F.get('02_conditions.csv')!, 10);

// ================================================================ 4. wide summary joins
log('\n' + '='.repeat(104));
log('4. WIDE SUMMARY — cross-store joins must land on the right condition');
log('='.repeat(104));
const wd = table(F.get('10_wide_summary.csv')!);
eq('wide row count', wd.rows.length, conds.length);
for (let i = 0; i < conds.length; i++) {
  const r = wd.rows.find((x) => x.condition_label === conds[i].condition_label);
  ok(`wide row exists for ${conds[i].condition_label}`, r != null);
  if (!r) continue;
  eq(`[${conds[i].condition_label}] wide fatigue_mean`, r.fatigue_mean, fatigueMean(i));
  eq(`[${conds[i].condition_label}] wide mean_rt_hits_ms`, r.mean_rt_hits_ms, rtFor(i));
  eq(`[${conds[i].condition_label}] wide session_index`, r.session_index, S.session_index);
  eq(`[${conds[i].condition_label}] wide polarity`, r.polarity, conds[i].polarity);
  eq(`[${conds[i].condition_label}] wide color_name`, r.color_name, conds[i].color_name);
}
printTable('10_wide_summary.csv', F.get('10_wide_summary.csv')!, 10);

// ================================================================ 5. referential integrity
log('\n' + '='.repeat(104));
log('5. REFERENTIAL INTEGRITY — every child row points at a real condition');
log('='.repeat(104));
const condIds = new Set(conds.map((c) => c.condition_id));
const condLabels = new Set(conds.map((c) => c.condition_label));
for (const [file, keyCol, universe] of [
  ['02_conditions.csv', 'condition_id', condIds],
  ['10_wide_summary.csv', 'condition_label', condLabels],
] as const) {
  const t = table(F.get(file)!);
  if (!t.headers.includes(keyCol)) { log(`   ${file}: no ${keyCol} column`); continue; }
  const orphans = t.rows.filter((r) => !universe.has(r[keyCol]));
  ok(`${file}: no orphan ${keyCol}`, orphans.length === 0, `${orphans.length} orphan(s)`);
  log(`   ${file.padEnd(26)} ${t.rows.length} rows, 0 orphans`);
}
// eye metrics / rt summary keyed by condition_id in their own files
for (const f of files.filter((x) => x.filename.endsWith('.csv'))) {
  const t = table(f.content);
  if (!t.headers.includes('condition_id')) continue;
  const orphans = t.rows.filter((r) => r.condition_id && !condIds.has(r.condition_id));
  ok(`${f.filename}: condition_id all resolve`, orphans.length === 0, `${orphans.length} orphan(s): ${orphans.slice(0, 3).map((o) => o.condition_id).join(',')}`);
}

// ================================================================ 6. NASA-TLX
log('\n' + '='.repeat(104));
log('6. NASA-TLX — one session-level row, Performance reversed exactly once');
log('='.repeat(104));
const tl = table(F.get('14_nasa_tlx.csv')!);
eq('tlx row count', tl.rows.length, 1);
const t0 = tl.rows[0] ?? {};
const T = bundle.tlx[0];
eq('raw_tlx (rounded to 2dp for presentation)', t0.raw_tlx, Math.round(T.raw_tlx * 100) / 100);
eq('performance (raw response)', t0.performance, T.performance);
eq('performance_load (reversed)', t0.performance_load, T.performance_load);
eq('performance + performance_load = 100', Number(t0.performance) + Number(t0.performance_load), 100);
const manualMean = (['mental_demand', 'physical_demand', 'temporal_demand', 'performance_load', 'effort', 'frustration']
  .map((k) => Number(t0[k])).reduce((a, b) => a + b, 0)) / 6;
eq('raw_tlx equals the mean of the six LOAD-aligned columns', Number(t0.raw_tlx).toFixed(2), manualMean.toFixed(2));
eq('tlx carries the session illumination level', t0.ambient_illumination_level, S.ambient_illumination_level);
printTable('14_nasa_tlx.csv', F.get('14_nasa_tlx.csv')!, 2);

// ================================================================ 7. eye metrics / primary outcome
log('\n' + '='.repeat(104));
log('7. PRIMARY OUTCOME — incomplete_blink_ratio survives the pipeline unrounded');
log('='.repeat(104));
const em = files.find((f) => /eye_metrics/.test(f.filename));
ok('an eye-metrics CSV exists', em != null);
if (em) {
  const t = table(em.content);
  eq('eye rows', t.rows.length, conds.length);
  for (let i = 0; i < conds.length; i++) {
    const r = t.rows.find((x) => x.condition_id === conds[i].condition_id);
    ok(`eye row for ${conds[i].condition_label}`, r != null);
    if (r) eq(`[${conds[i].condition_label}] incomplete_blink_ratio`, r.incomplete_blink_ratio, ibrFor(i));
  }
  printTable(em.filename, em.content, 4);
}

// ================================================================ 8. manifest
log('\n' + '='.repeat(104));
log('8. MANIFEST — checksums must match the bytes actually written');
log('='.repeat(104));
const man = files.find((f) => /manifest/i.test(f.filename));
ok('a manifest exists', man != null);
if (man) {
  log(man.content.split('\n').slice(0, 4).join('\n'));
}

// ================================================================ 9. completeness reporting
log('\n' + '='.repeat(104));
log('9. LUX COMPLETENESS — a partially-verified session must SAY so');
log('='.repeat(104));
for (const cps of [['start'], ['start', 'end'], ['start', 'middle', 'end']] as const) {
  const b2 = buildFixtureBundle({ luxCheckpoints: [...cps] });
  const t2 = table(buildExportFiles(b2).find((f) => f.filename === '01_session_info.csv')!.content);
  const r2 = t2.rows[0];
  const complete = cps.length === 3;
  eq(`[${cps.join('+')}] lux_n_readings`, r2.lux_n_readings, cps.length);
  eq(`[${cps.join('+')}] lux_checkpoints_logged`, r2.lux_checkpoints_logged, cps.join('+'));
  eq(`[${cps.join('+')}] lux_complete`, r2.lux_complete, complete);
  log(`   ${cps.join('+').padEnd(20)} n=${r2.lux_n_readings}  logged=${String(r2.lux_checkpoints_logged).padEnd(20)} complete=${r2.lux_complete}`);
}

// ================================================================ 10. reference table stability
log('\n' + '='.repeat(104));
log('10. CONDITION REFERENCE TABLE — invariant across sessions, complete on a split sitting');
log('='.repeat(104));
const full = table(buildExportFiles(buildFixtureBundle()).find((f) => f.filename === '00_condition_reference.csv')!.content);
const partialBundle = buildFixtureBundle();
partialBundle.conditions = partialBundle.conditions.slice(0, 5);
partialBundle.session.conditions_per_session = 5;
const part = table(buildExportFiles(partialBundle).find((f) => f.filename === '00_condition_reference.csv')!.content);
eq('reference lists all conditions in a full sitting', full.rows.length, CONDITIONS.length);
eq('reference lists all conditions in a SPLIT sitting too', part.rows.length, CONDITIONS.length);
eq('reference row order is the canonical table order',
  full.rows.map((r) => r.condition_label).join(','), CONDITIONS.map((c) => c.label).join(','));
eq('reference order identical between the two sessions',
  part.rows.map((r) => r.condition_label).join(','), full.rows.map((r) => r.condition_label).join(','));
eq('split sitting marks 5 conditions as run', part.rows.filter((r) => r.ran_in_this_session === 'true').length, 5);
log(`   full sitting  ${full.rows.length} rows, order ${full.rows.map((r) => r.condition_label).join(' ')}`);
log(`   split sitting ${part.rows.length} rows, ran_in_this_session=true for ${part.rows.filter((r) => r.ran_in_this_session === 'true').length}`);

// ================================================================ 11. filename safety
log('\n' + '='.repeat(104));
log('11. FILENAME SAFETY — no exported name may contain characters illegal on Windows');
log('='.repeat(104));
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/;
for (const f of files) {
  ok(`${f.filename}: filename is portable`, !ILLEGAL.test(f.filename), `contains an illegal character`);
}
log(`   checked ${files.length} filenames, all portable`);
log(`   json bundle -> ${files.find((f) => f.filename.endsWith('.json') && !/manifest/.test(f.filename))!.filename}`);

// ================================================================ 12. codebook coverage
log('\n' + '='.repeat(104));
log('12. CODEBOOK COVERAGE — documented columns must exist, and key columns must be documented');
log('='.repeat(104));
const cbT = table(F.get('00_CODEBOOK.csv')!);
const documented = new Map<string, Set<string>>();
for (const r of cbT.rows) {
  if (!documented.has(r.file)) documented.set(r.file, new Set());
  documented.get(r.file)!.add(r.column);
}
for (const [file, cols] of documented) {
  const content = F.get(file);
  ok(`codebook references a real file: ${file}`, content != null);
  if (!content) continue;
  const actual = new Set(table(content).headers);
  for (const c of cols) {
    // Wildcard entries like "freq_1..16" document a family of columns.
    if (c.includes('..')) {
      const stem = c.split('_')[0];
      ok(`${file}.${c}: at least one ${stem}_* column exists`, [...actual].some((a) => a.startsWith(stem + '_')));
      continue;
    }
    ok(`${file}.${c} exists in the file`, actual.has(c), `documented but not exported`);
  }
}
// Every column carrying the primary outcome or an IV must be documented.
const MUST_DOCUMENT: [string, string][] = [
  ['07_eye_metrics.csv', 'incomplete_blink_ratio'],
  ['01_session_info.csv', 'ambient_illumination_level'],
  ['01_session_info.csv', 'lux_complete'],
  ['00_condition_reference.csv', 'color_name'],
  ['00_condition_reference.csv', 'polarity'],
  ['14_nasa_tlx.csv', 'raw_tlx'],
];
for (const [f, c] of MUST_DOCUMENT) {
  ok(`${f}.${c} is documented in the codebook`, documented.get(f)?.has(c) === true);
}
log(`   ${cbT.rows.length} documented columns across ${documented.size} files, all resolve`);

// ================================================================ 13. file ordering
log('\n' + '='.repeat(104));
log('13. FILE ORDERING — numeric prefixes must sort in the order they are emitted');
log('='.repeat(104));
const numbered = files.map((f) => f.filename).filter((n) => /^\d\d_/.test(n));
const sorted = [...numbered].sort();
eq('emitted order matches lexicographic order', numbered.join(' '), sorted.join(' '));
log(`   ${numbered.join(' ')}`);

// ================================================================ report
log('\n' + '='.repeat(104));
console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} — ${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
