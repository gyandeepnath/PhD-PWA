/**
 * Codebook completeness gate.
 *
 * 00_CODEBOOK.csv is the data dictionary shipped inside every export. It is what makes the
 * dataset interpretable by anyone who did not write the instrument: a supervisor, an examiner,
 * a statistician, or the author two years later. An undocumented column is not a cosmetic gap,
 * because a column whose units or reversal are guessed at is a column that gets analysed wrongly.
 *
 * The export writes each CSV from an explicit column allow-list, so this script compares that
 * allow-list against the codebook in both directions:
 *
 *   - every exported column must be documented   (otherwise the analyst is guessing)
 *   - every documented column must be exported   (otherwise the codebook describes a phantom)
 *
 * Run it as part of the verification gate. It reads export.ts as source rather than executing the
 * export, so it stays honest about the literal column lists rather than about a fixture.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CODEBOOK } from '../src/storage/export';

const SRC = resolve(import.meta.dirname ?? '.', '../src/storage/export.ts');
const src = readFileSync(SRC, 'utf8');

/** Column allow-lists as written in the csv(...) calls. */
function exportedColumns(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of src.matchAll(/csv\('([0-9_a-z]+\.csv)',\s*\n?\s*(\[[^\]]*\])/g)) {
    out.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  }
  return out;
}

const exported = exportedColumns();
// Some columns are generated in a family (the 32 CVS-Q item columns), and the codebook documents
// the family with a "freq_1..16" style entry rather than 32 near-identical rows. Expand those.
const documented = new Set<string>();
for (const r of CODEBOOK) {
  const m = r.column.match(/^(.*?)(\d+)\.\.(\d+)$/);
  if (m) {
    for (let i = Number(m[2]); i <= Number(m[3]); i++) documented.add(`${r.file}|${m[1]}${i}`);
  } else {
    documented.add(`${r.file}|${r.column}`);
  }
}
const documentedRaw = new Set(CODEBOOK.map((r) => `${r.file}|${r.column}`));

let undocumented = 0;
let phantom = 0;

console.log('='.repeat(96));
console.log('CODEBOOK COMPLETENESS');
console.log('='.repeat(96));
console.log(`   ${CODEBOOK.length} codebook entries covering ${new Set(CODEBOOK.map((r) => r.file)).size} files`);
console.log(`   ${exported.size} exported CSVs, ${[...exported.values()].reduce((a, c) => a + c.length, 0)} columns\n`);

for (const [file, cols] of [...exported].sort()) {
  const missing = cols.filter((c) => !documented.has(`${file}|${c}`));
  undocumented += missing.length;
  const mark = missing.length === 0 ? 'ok  ' : 'GAP ';
  console.log(`   ${mark} ${file.padEnd(30)} ${String(cols.length - missing.length).padStart(3)}/${String(cols.length).padEnd(3)} documented`);
  if (missing.length) console.log(`        undocumented: ${missing.join(', ')}`);
}

// A codebook row describing a column that is not exported sends the analyst looking for it.
const exportedKeys = new Set([...exported].flatMap(([f, cols]) => cols.map((c) => `${f}|${c}`)));
const phantoms = CODEBOOK.filter((r) => !/\d+\.\.\d+$/.test(r.column) && !exportedKeys.has(`${r.file}|${r.column}`));
void documentedRaw;
phantom = phantoms.length;
if (phantom) {
  console.log('\n   documented but never exported:');
  for (const p of phantoms) console.log(`        ${p.file} :: ${p.column}`);
}

// Every entry must actually say something. A blank unit or description is a silent gap.
const thin = CODEBOOK.filter((r) => !r.description || r.description.trim().length < 20 || !r.type || !r.unit || !r.role);
if (thin.length) {
  console.log('\n   entries missing type/unit/role or with a description under 20 characters:');
  for (const p of thin) console.log(`        ${p.file} :: ${p.column}`);
}

const ROLES = new Set(['id', 'iv', 'dv', 'covariate', 'qc', 'meta', 'provenance', 'primary']);
const badRole = CODEBOOK.filter((r) => !ROLES.has(r.role));
if (badRole.length) {
  console.log('\n   entries with an unrecognised role:');
  for (const p of badRole) console.log(`        ${p.file} :: ${p.column} -> "${p.role}"`);
}

const failures = undocumented + phantom + thin.length + badRole.length;
console.log('\n' + '='.repeat(96));
console.log(failures === 0
  ? 'PASS — every exported column is documented and every documented column is exported'
  : `FAIL — ${undocumented} undocumented, ${phantom} phantom, ${thin.length} thin, ${badRole.length} bad role`);
console.log('='.repeat(96));
process.exit(failures === 0 ? 0 : 1);
