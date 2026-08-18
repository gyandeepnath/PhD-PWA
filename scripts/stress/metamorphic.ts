/**
 * ROUND 4 - metamorphic and differential properties.
 *
 * Rounds 1-3 asserted what specific inputs should produce. That can only catch bugs someone
 * thought to write an expectation for. Metamorphic testing instead asserts RELATIONSHIPS between
 * outputs of related inputs, which holds even where nobody knows the right answer:
 *
 *   - determinism      exporting the same bundle twice must give the same bytes, or the manifest
 *                      checksums certify nothing
 *   - order invariance shuffling records within a store must not change a single output cell; if
 *                      it does, some join is position-dependent and the "right" answer is luck
 *   - isolation        adding an orphan must change only the integrity report, never real data
 *   - monotonicity     removing a record must never populate a cell that was previously empty
 *   - sensitivity      any single-byte change must change the file's checksum
 *
 * A violation of any of these is a bug regardless of what the correct value is.
 */
import { buildExportFiles, fnv1a } from '../../src/storage/export';
import { buildFixtureBundle } from '../../src/sim/bundleFixture';
import { auditBundle } from '../../src/storage/integrity';
import type { SessionBundle } from '../../src/storage/gather';

const fails: string[] = [];
let checks = 0;
const check = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fails.push(label + (detail ? '\n      ' + detail : ''));
};

/**
 * Export content with the export-time provenance stamps normalised away.
 *
 * `exported_at` legitimately differs between two exports of the same data - it records when the
 * export ran, not what it contains - so it is masked here rather than treated as a difference.
 * Everything else must be byte-identical, including inside the JSON bundle.
 */
const TS_RE = /"exported_at":\s*"[^"]*"/g;
function stable(bundle: SessionBundle): Map<string, string> {
  return new Map(buildExportFiles(bundle)
    .filter((f) => f.filename !== 'export_manifest.json')
    .map((f) => [f.filename, f.content.replace(TS_RE, '"exported_at":"<masked>"')]));
}

/** Proper RFC-4180 parse - the fixture's participant id deliberately contains a comma. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function diffMaps(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k); const y = b.get(k);
    if (x === y) continue;
    if (x == null || y == null) { out.push(`${k}: present in only one export`); continue; }
    const xl = x.split('\n'); const yl = y.split('\n');
    const i = xl.findIndex((l, j) => l !== yl[j]);
    out.push(`${k}: first differing line ${i + 1}\n        A: ${String(xl[i]).slice(0, 110)}\n        B: ${String(yl[i]).slice(0, 110)}`);
  }
  return out;
}

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

console.log('='.repeat(100));
console.log('ROUND 4 - METAMORPHIC AND DIFFERENTIAL PROPERTIES');
console.log('='.repeat(100));

// ---------------------------------------------------------------- determinism
console.log('\n1. DETERMINISM');
{
  const b = buildFixtureBundle();
  const a1 = stable(b);
  const a2 = stable(b);
  const d = diffMaps(a1, a2);
  check('exporting the same bundle twice is byte-identical', d.length === 0, d.join('\n      '));

  // Two separately constructed but identical bundles must also agree.
  const d2 = diffMaps(stable(buildFixtureBundle()), stable(buildFixtureBundle()));
  check('two identically-built bundles export identically', d2.length === 0, d2.join('\n      '));

  const m1 = JSON.parse(buildExportFiles(b).find((f) => f.filename === 'export_manifest.json')!.content);
  const m2 = JSON.parse(buildExportFiles(b).find((f) => f.filename === 'export_manifest.json')!.content);
  const c1 = m1.files.filter((f: { filename: string }) => f.filename !== 'export_manifest.json').map((f: { checksum_fnv1a: string }) => f.checksum_fnv1a).join();
  const c2 = m2.files.filter((f: { filename: string }) => f.filename !== 'export_manifest.json').map((f: { checksum_fnv1a: string }) => f.checksum_fnv1a).join();
  check('manifest checksums are reproducible', c1 === c2);
}

// ---------------------------------------------------------------- order invariance
console.log('2. ORDER INVARIANCE');
{
  const base = stable(buildFixtureBundle());
  const stores = ['eyeMetrics', 'rtSummaries', 'comprehension', 'visualSearch', 'perception', 'fatigue', 'cvsq', 'reactionTrials'] as const;
  for (const store of stores) {
    const b = buildFixtureBundle();
    (b[store] as unknown[]) = shuffle(b[store] as unknown[]);
    const d = diffMaps(base, stable(b));
    // The store's OWN csv legitimately reorders; every other file must be untouched.
    const foreign = d.filter((x) => !x.startsWith(fileFor(store)));
    check(`shuffling ${store} changes no other file`, foreign.length === 0, foreign.join('\n      '));
  }
  // Shuffling conditions reorders the condition-keyed files, but each condition must keep ITS data.
  const b2 = buildFixtureBundle();
  b2.conditions = shuffle(b2.conditions);
  const t = buildExportFiles(b2).find((f) => f.filename === '10_wide_summary.csv')!.content;
  const baseT = buildExportFiles(buildFixtureBundle()).find((f) => f.filename === '10_wide_summary.csv')!.content;
  const rowsOf = (csv: string) => {
    const p = parseCsv(csv);
    const li = p[0].indexOf('condition_label');
    const bi = p[0].indexOf('blink_rate');
    const ri = p[0].indexOf('mean_rt_hits_ms');
    return new Map(p.slice(1).map((c) => [c[li], c[bi] + '|' + c[ri]]));
  };
  const A = rowsOf(baseT); const B = rowsOf(t);
  let kept = true;
  for (const [label, v] of A) if (B.get(label) !== v) kept = false;
  check('shuffling conditions keeps each condition bound to its own measurements', kept);
}

function fileFor(store: string): string {
  return ({
    eyeMetrics: '07_eye_metrics.csv', rtSummaries: '09_rt_summary.csv',
    comprehension: '04_comprehension.csv', visualSearch: '05_visual_search.csv',
    perception: '06_display_perception.csv', fatigue: '03_fatigue_scores.csv',
    cvsq: '13_cvsq.csv', reactionTrials: '08_reaction_trials.csv',
  } as Record<string, string>)[store] ?? '';
}

// ---------------------------------------------------------------- isolation
console.log('3. ISOLATION OF DAMAGE');
{
  const base = stable(buildFixtureBundle());
  const b = buildFixtureBundle();
  b.eyeMetrics.push({ ...b.eyeMetrics[0], condition_id: 'orphan-xyz' });
  const after = stable(b);
  // The JSON bundle is a faithful dump of every store, so it legitimately reflects the new row.
  const d = diffMaps(base, after).filter((x) =>
    !x.startsWith('07_eye_metrics.csv') && !x.startsWith('16_integrity_report.csv') && !x.includes('.json'));
  check('adding an orphan changes no unrelated CSV', d.length === 0, d.join('\n      '));

  const r = auditBundle(b);
  check('adding an orphan is reported as an error', r.errors > 0);
}

// ---------------------------------------------------------------- monotonicity
console.log('4. MONOTONICITY');
{
  const full = buildFixtureBundle();
  const fullFiles = new Map(buildExportFiles(full).map((f) => [f.filename, f.content]));
  const populated = (csv: string) => csv.split('\n').slice(1).reduce((n, l) => n + l.split(',').filter((c) => c !== '').length, 0);

  for (const store of ['eyeMetrics', 'rtSummaries', 'perception', 'comprehension'] as const) {
    const b = buildFixtureBundle();
    (b[store] as unknown[]) = (b[store] as unknown[]).slice(0, 1);
    const files = new Map(buildExportFiles(b).map((f) => [f.filename, f.content]));
    const w = '10_wide_summary.csv';
    const before = populated(fullFiles.get(w)!);
    const afterN = populated(files.get(w)!);
    check(`removing ${store} rows never populates MORE cells in the wide summary`,
      afterN <= before, `${before} -> ${afterN}`);
  }
}

// ---------------------------------------------------------------- checksum sensitivity
console.log('5. CHECKSUM SENSITIVITY');
{
  const b = buildFixtureBundle();
  const files = buildExportFiles(b);
  for (const f of files) {
    if (!f.filename.endsWith('.csv') || f.content.length < 10) continue;
    const h0 = fnv1a(f.content);
    // flip one character in the middle
    const i = Math.floor(f.content.length / 2);
    const flipped = f.content.slice(0, i) + (f.content[i] === 'x' ? 'y' : 'x') + f.content.slice(i + 1);
    check(`${f.filename}: a one-character change changes the checksum`, fnv1a(flipped) !== h0);
  }
  check('checksums differ for different content', fnv1a('a') !== fnv1a('b'));
  check('checksum is stable for identical content', fnv1a('abc') === fnv1a('abc'));
}

// ---------------------------------------------------------------- randomised damage sweep
console.log('6. RANDOMISED DAMAGE SWEEP (300 bundles)');
{
  let disagreements = 0;
  for (let i = 0; i < 300; i++) {
    const b = buildFixtureBundle();
    let damaged = false;
    // Apply a random subset of mutations, some damaging and some not.
    if (rnd() < 0.3 && b.conditions.length > 1) { b.conditions[1] = { ...b.conditions[1], condition_id: b.conditions[0].condition_id }; damaged = true; }
    if (rnd() < 0.3) { b.eyeMetrics.push({ ...b.eyeMetrics[0], condition_id: 'ghost' + i }); damaged = true; }
    if (rnd() < 0.3) { b.rtSummaries = b.rtSummaries.slice(0, 4); damaged = true; }
    if (rnd() < 0.3) { b.tlx.push({ ...b.tlx[0], tlx_id: 't2' }); damaged = true; }
    if (rnd() < 0.3) { b.session.lux_readings = []; }                    // not a join fault
    if (rnd() < 0.3) { b.participant = undefined; }                      // not a join fault
    if (rnd() < 0.3) { b.conditions = shuffle(b.conditions); }           // not a fault at all

    let files;
    try { files = buildExportFiles(b); }
    catch (e) { check(`bundle ${i} exports without throwing`, false, (e as Error).message.slice(0, 100)); continue; }

    const m = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    if (damaged !== !m.integrity.joins_sound) disagreements++;
    for (const f of files) {
      if (!f.filename.endsWith('.csv')) continue;
      if (/(^|[,\n"])(NaN|-?Infinity|undefined)([,\n"]|$)/.test(f.content)) {
        check(`bundle ${i} ${f.filename} has no non-finite literal`, false);
      }
    }
  }
  check('the integrity verdict matches the damage applied in all 300 bundles', disagreements === 0, `${disagreements} disagreements`);
}

console.log(`\n${checks - fails.length}/${checks} properties held`);
if (fails.length) {
  console.log('\nVIOLATIONS:');
  fails.slice(0, 15).forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  if (fails.length > 15) console.log(`  ... ${fails.length - 15} more`);
}
process.exit(fails.length ? 1 : 0);
