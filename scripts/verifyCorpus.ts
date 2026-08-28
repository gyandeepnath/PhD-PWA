/**
 * Reading-corpus QA gate.
 *
 * The ten passages are the stimulus material of the primary outcome. Two of their properties are
 * load-bearing and neither is obvious from reading them:
 *
 *   1. LENGTH sets the reading exposure, and the reading exposure sets how many blinks each
 *      condition captures. The incomplete-blink ratio is a binomial proportion, so its standard
 *      error is fixed by that count. At ~240 words the exposure was 73 s, about 16 blinks, and
 *      the polarity x colour interaction — the design's binding contrast — had 27% power. The
 *      corpus is therefore held at a length that delivers a ~180 s exposure.
 *
 *   2. DIFFICULTY must be matched across passages, because passage is rotated against condition.
 *      An unmatched passage would inject variance that the rotation spreads across conditions
 *      rather than removing.
 *
 * Both are easy to break by editing prose and impossible to notice by eye, so they are checked
 * here and in tests/passages.test.ts. This script additionally reports the distributions, which
 * the test cannot, and is the thing to run after any edit to the corpus.
 */
import { PASSAGES, countWords, countTargetOccurrences } from '../src/experiment/passages';

/** Reading rate implied by the pilot timing simulation: 240 words measured at 73 s. */
const WPM = 240 / (73 / 60);
const TARGET_EXPOSURE_S = 180;

/**
 * Flesch Reading Ease with the deliberately crude syllable heuristic the corpus is matched on.
 * The point is not phonetic accuracy but a stable, reproducible difficulty index; the same
 * function is asserted in tests/passages.test.ts, so the two can never drift apart.
 */
function fre(text: string): { fre: number; words: number; sentences: number; syllPerWord: number } {
  const syll = (w: string) =>
    Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]{1,2}/g) || []).length);
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((x) => x.trim()).length;
  const spw = words.reduce((a, x) => a + syll(x), 0) / words.length;
  return {
    fre: 206.835 - 1.015 * (words.length / sentences) - 84.6 * spw,
    words: words.length,
    sentences,
    syllPerWord: spw,
  };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

let failures = 0;
const fail = (m: string) => { failures++; console.log(`   FAIL  ${m}`); };

console.log('='.repeat(100));
console.log('READING CORPUS VERIFICATION');
console.log('='.repeat(100));

const rows = PASSAGES.map((p) => {
  const text = p.pages.join(' ');
  const f = fre(text);
  return { p, f, exposure: (p.wordCount / WPM) * 60 };
});

console.log('\n id  title                                   pages  words  sent  s/word    FRE  exposure  target(n)');
console.log(' ' + '-'.repeat(98));
for (const { p, f, exposure } of rows) {
  console.log(
    ` ${String(p.id).padStart(2)}  ${p.title.slice(0, 38).padEnd(38)}  ${String(p.pages.length).padStart(5)}` +
    `  ${String(p.wordCount).padStart(5)}  ${String(f.sentences).padStart(4)}  ${f.syllPerWord.toFixed(2).padStart(6)}` +
    `  ${f.fre.toFixed(1).padStart(5)}  ${(exposure.toFixed(0) + 's').padStart(8)}` +
    `  ${p.searchTarget}(${p.searchTargetCount})`,
  );
}

const words = rows.map((r) => r.p.wordCount);
const fres = rows.map((r) => r.f.fre);
const exps = rows.map((r) => r.exposure);

console.log('\n' + '='.repeat(100));
console.log('1. EXPOSURE — length must buy a three-minute reading window');
console.log('='.repeat(100));
console.log(`   implied reading rate  ${WPM.toFixed(0)} wpm (from the pilot timing simulation)`);
console.log(`   words   mean ${mean(words).toFixed(0)}  sd ${sd(words).toFixed(0)}  range ${Math.min(...words)}-${Math.max(...words)}`);
console.log(`   exposure mean ${mean(exps).toFixed(0)}s  range ${Math.min(...exps).toFixed(0)}-${Math.max(...exps).toFixed(0)}s  (target ${TARGET_EXPOSURE_S}s)`);
if (mean(exps) < TARGET_EXPOSURE_S * 0.92) fail(`mean exposure ${mean(exps).toFixed(0)}s is short of the ${TARGET_EXPOSURE_S}s the synopsis commits to`);
for (const { p, exposure } of rows) {
  if (exposure < TARGET_EXPOSURE_S * 0.85) fail(`passage ${p.id} "${p.title}" gives only ${exposure.toFixed(0)}s of exposure`);
}

console.log('\n' + '='.repeat(100));
console.log('2. MATCHING — passage is rotated against condition, so difficulty must not vary');
console.log('='.repeat(100));
console.log(`   FRE     mean ${mean(fres).toFixed(1)}  sd ${sd(fres).toFixed(1)}  range ${Math.min(...fres).toFixed(1)} to ${Math.max(...fres).toFixed(1)}`);
const wordSpread = (Math.max(...words) - Math.min(...words)) / mean(words);
console.log(`   length spread ${(wordSpread * 100).toFixed(1)}% of the mean`);
if (Math.max(...fres) - Math.min(...fres) > 22) fail(`FRE spread ${(Math.max(...fres) - Math.min(...fres)).toFixed(1)} is too wide for a matched set`);
if (wordSpread > 0.18) fail(`length spread ${(wordSpread * 100).toFixed(1)}% exceeds 18% — passages are not length-matched`);
for (const { p, f } of rows) {
  if (f.fre <= 0 || f.fre >= 35) fail(`passage ${p.id} FRE ${f.fre.toFixed(1)} falls outside the matched band (0, 35)`);
}

console.log('\n' + '='.repeat(100));
console.log('3. DERIVED COUNTS — must be computed from the text, never declared');
console.log('='.repeat(100));
for (const { p } of rows) {
  if (p.wordCount !== countWords(p.pages)) fail(`passage ${p.id} wordCount is stale`);
  if (p.searchTargetCount !== countTargetOccurrences(p.pages, p.searchTarget)) fail(`passage ${p.id} searchTargetCount is stale`);
  if (p.searchTargetCount < 6) fail(`passage ${p.id} target "${p.searchTarget}" occurs only ${p.searchTargetCount}x — too few for a 40 s search task`);
}
const targets = PASSAGES.map((p) => p.searchTarget.toLowerCase());
if (new Set(targets).size !== targets.length) fail('search targets are not unique across passages');
console.log(`   all ${PASSAGES.length} word counts and target counts derive from the text`);
console.log(`   target occurrences  mean ${mean(PASSAGES.map((p) => p.searchTargetCount)).toFixed(1)}  range ${Math.min(...PASSAGES.map((p) => p.searchTargetCount))}-${Math.max(...PASSAGES.map((p) => p.searchTargetCount))}`);

console.log('\n' + '='.repeat(100));
console.log('4. COMPREHENSION ITEMS');
console.log('='.repeat(100));
const KINDS = ['gist', 'inference', 'detail'] as const;
const posCounts = [0, 0, 0, 0];
let nQ = 0;
for (const { p } of rows) {
  const qs = (p as unknown as { questions?: unknown[] }).questions;
  if (!Array.isArray(qs)) { fail(`passage ${p.id} has no questions array`); continue; }
  nQ += qs.length;
  const kinds = qs.map((q) => (q as { kind: string }).kind);
  for (const k of KINDS) if (!kinds.includes(k)) fail(`passage ${p.id} is missing a "${k}" item`);
  for (const q of qs as { text: string; options: string[]; correctIndex: number }[]) {
    if (q.options.length !== 4) fail(`passage ${p.id} item "${q.text.slice(0, 40)}" has ${q.options.length} options`);
    if (new Set(q.options).size !== q.options.length) fail(`passage ${p.id} item "${q.text.slice(0, 40)}" has duplicate options`);
    if (q.correctIndex < 0 || q.correctIndex > 3) fail(`passage ${p.id} item has correctIndex ${q.correctIndex}`);
    posCounts[q.correctIndex]++;
  }
}
console.log(`   ${nQ} items across ${PASSAGES.length} passages`);
// LENGTH PARITY. A keyed option that is visibly longer than its distractors is a cue: "pick the
// longest" is the best-known multiple-choice heuristic, and options are rendered in authored order,
// so the cue is identical for every participant. When this was first measured the key was the unique
// longest option in 25 of 30 items and in 10 of 10 gist and 10 of 10 inference items, which let a
// participant who never read the passage score 83% against 25% for chance. That inflation would land
// in every condition, compress the between-condition variance the study is powered to detect, and
// destroy the item-kind contrast. Position bias is checked above; length is the same defect wearing
// a different hat.
let keyIsLongest = 0;
let overLong = 0;
for (const { p } of rows) {
  for (const q of p.questions) {
    const lens = q.options.map((o) => o.length);
    const max = Math.max(...lens);
    if (lens.filter((l) => l === max).length === 1 && lens[q.correctIndex] === max) keyIsLongest++;
    const median = [...lens].sort((a, b) => a - b)[Math.floor(lens.length / 2)];
    // No single option may tower over the middle of its own item.
    if (max > median * 1.6) {
      overLong++;
      fail(`passage ${p.id} item "${q.text.slice(0, 44)}" has an option ${Math.round((max / median - 1) * 100)}% longer than the item median`);
    }
  }
}
// Raw ordering overstates the risk once the options are close: a key two characters longer than
// its nearest rival is not something a participant can see. What matters is whether the key stands
// out by a VISIBLE margin, so that is what fails the gate; the raw count is reported alongside it
// because a systematic drift in the ordering is still worth noticing.
let keyLongestByMargin = 0;
for (const { p } of rows) {
  for (const q of p.questions) {
    const lens = q.options.map((o) => o.length);
    const keyLen = lens[q.correctIndex];
    const runnerUp = Math.max(...lens.filter((_, i) => i !== q.correctIndex));
    if (keyLen > runnerUp * 1.15) keyLongestByMargin++;
  }
}
const longestShare = nQ ? keyIsLongest / nQ : 0;
const marginShare = nQ ? keyLongestByMargin / nQ : 0;
console.log(`   key is the longest option in ${keyIsLongest}/${nQ} items (${(100 * longestShare).toFixed(0)}%), by a visible margin in ${keyLongestByMargin} (${(100 * marginShare).toFixed(0)}%)`);
if (marginShare > 0.2) {
  fail(`the key stands out by length in ${(100 * marginShare).toFixed(0)}% of items — "pick the longest" is a usable strategy`);
}
if (overLong === 0) console.log('   no option towers over the median of its own item');

console.log(`   correct-answer positions  A:${posCounts[0]}  B:${posCounts[1]}  C:${posCounts[2]}  D:${posCounts[3]}`);
// A guessing participant who always picks one letter must not beat chance by much.
if (nQ && Math.max(...posCounts) / nQ > 0.4) fail(`answer key is positionally biased: one position holds ${(100 * Math.max(...posCounts) / nQ).toFixed(0)}% of keys`);

console.log('\n' + '='.repeat(100));
console.log(failures === 0 ? `PASS — corpus is length-matched, difficulty-matched and item-complete` : `FAIL — ${failures} problem(s)`);
console.log('='.repeat(100));
process.exit(failures === 0 ? 0 : 1);
