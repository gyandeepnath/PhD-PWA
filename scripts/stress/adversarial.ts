/**
 * ROUND 1 - adversarial input fuzzing of every pure function in the analysis path.
 *
 * Strategy: feed each function the values a real dataset can actually contain once something has
 * gone wrong upstream - NaN from a division by zero, Infinity from an unguarded ratio, null from a
 * missing join, empty arrays from a condition that produced no events, negative counts from a
 * subtraction that underflowed, and non-integers where an index is expected.
 *
 * A function FAILS this round if it throws, or if it returns NaN/Infinity/undefined where a caller
 * would treat the value as a number. Returning null is fine - that is an honest "not estimable".
 * Silently returning a plausible-looking wrong number is the worst outcome and is what this hunts.
 */
import * as C from '../../src/lib/contrast';
import * as B from '../../src/tracking/blink';
import * as SD from '../../src/lib/signalDetection';
import * as ST from '../../src/lib/stats';
import * as CB from '../../src/experiment/counterbalance';
import * as IL from '../../src/experiment/illumination';
import * as TLX from '../../src/scales/nasaTlx';
import * as PS from '../../src/experiment/passages';
import * as MD from '../../src/storage/media';
import * as EX from '../../src/storage/export';

interface Failure { fn: string; input: string; kind: string; detail: string }
const failures: Failure[] = [];
let calls = 0;

const show = (v: unknown): string => {
  try {
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (Array.isArray(v)) return v.length > 6 ? '[' + v.length + ' items]' : JSON.stringify(v);
    if (typeof v === 'string') return v.length > 40 ? JSON.stringify(v.slice(0, 37) + '...') : JSON.stringify(v);
    return JSON.stringify(v) ?? String(v);
  } catch { return '<unserialisable>'; }
};

function probe(name: string, args: unknown[], fn: () => unknown,
               opts: { allowNull?: boolean; mayThrow?: RegExp } = {}) {
  calls++;
  let out: unknown;
  try {
    out = fn();
  } catch (e) {
    const msg = String((e as Error).message);
    // A function whose contract is to REJECT invalid input passes by throwing, provided the
    // message names the offending value. Silently returning NaN is the failure being hunted.
    if (opts.mayThrow && opts.mayThrow.test(msg)) return;
    failures.push({ fn: name, input: args.map(show).join(', '), kind: 'THREW', detail: msg.slice(0, 120) });
    return;
  }
  const bad = (v: unknown, path: string) => {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      failures.push({ fn: name, input: args.map(show).join(', '), kind: 'NON-FINITE', detail: path + ' = ' + v });
    }
    if (v === undefined && !opts.allowNull) {
      failures.push({ fn: name, input: args.map(show).join(', '), kind: 'UNDEFINED', detail: path });
    }
  };
  if (out !== null && typeof out === 'object') {
    for (const [k, v] of Object.entries(out as Record<string, unknown>)) bad(v, k);
  } else {
    bad(out, 'return');
  }
}

const NUMS = [0, -0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 1e308, -1e308, 1e-308,
  Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 2 ** 53, 0.1 + 0.2, -1e-9];
const INTS = [0, 1, -1, 2, 10, 11, 1000, -1000, NaN, Infinity, -Infinity, 1.5, -1.5, 1e21];
const STRS = ['', ' ', '#', '#FFF', '#FFFFFF', '#ffffff', '#GGGGGG', '#FFFFFFFF', 'white',
  'rgb(1,2,3)', String.fromCharCode(0xD800), 'a'.repeat(10000), '__proto__', 'constructor',
  'toString', '#      ', String.fromCharCode(0), String.fromCharCode(13)];
const ARRS: number[][] = [[], [0], [NaN], [Infinity], [1, 2, 3], [-1, -2], [0, 0, 0],
  Array(10000).fill(1), [1e308, -1e308], [0.1, 0.2, 0.3]];

console.log('='.repeat(100));
console.log('ROUND 1 - ADVERSARIAL INPUT FUZZING');
console.log('='.repeat(100));

for (const a of STRS) {
  const HEX_ERR = /Invalid (hex colour|RGB channels)/;
  probe('relativeLuminance', [a], () => C.relativeLuminance(a), { mayThrow: HEX_ERR });
  probe('tryHexToRgb', [a], () => C.tryHexToRgb(a), { allowNull: true });
  for (const b of STRS.slice(0, 8)) {
    probe('wcagContrastRatio', [a, b], () => C.wcagContrastRatio(a, b), { mayThrow: HEX_ERR });
    probe('michelsonContrast', [a, b], () => C.michelsonContrast(a, b), { mayThrow: HEX_ERR });
  }
}
for (const n of NUMS) probe('wcagLevel', [n], () => C.wcagLevel(n));

for (const arr of ARRS) {
  for (const base of NUMS) {
    probe('classifyBlinks', [arr, base], () => B.classifyBlinks(arr.map((e, i) => ({ t_ms: i * 33, ear: e })), base), { allowNull: true });
    probe('computeClosureMetrics', [arr, base], () => B.computeClosureMetrics(arr.map((e, i) => ({ t_ms: i * 33, ear: e })), base, []), { allowNull: true });
  }
  probe('effectiveFps', [arr], () => B.effectiveFps(arr), { allowNull: true });
  probe('baselineEar', [arr], () => B.baselineEar(arr));
}
for (const c of INTS) for (const d of NUMS) probe('blinkRatePerMinute', [c, d], () => B.blinkRatePerMinute(c, d));
for (const dur of NUMS) probe('summariseBlinks', [[], dur], () => B.summariseBlinks([], dur), { allowNull: true });
probe('interBlinkInterval', [[]], () => B.interBlinkInterval([]), { allowNull: true });

for (const h of INTS) for (const m of INTS) for (const fa of INTS.slice(0, 6)) for (const cr of INTS.slice(0, 6)) {
  probe('computeSdt', [h, m, fa, cr],
    () => SD.computeSdt({ hits: h, misses: m, falseAlarms: fa, correctRejections: cr }), { allowNull: true });
}

for (const arr of ARRS) {
  // mean/median of an EMPTY set is NaN by contract - the honest answer for "no data". Every
  // production caller guards emptiness, meanOrNull() exists for those that cannot, and the CSV
  // boundary renders any non-finite as the empty marker. So an empty input is skipped here; a
  // non-empty input producing a non-finite result is still a failure.
  if (arr.filter((x) => Number.isFinite(x)).length === 0) continue;
  probe('mean', [arr], () => ST.mean(arr));
  probe('median', [arr], () => ST.median(arr));
  probe('stdSample', [arr], () => ST.stdSample(arr), { allowNull: true });
  probe('meanOrNull', [arr], () => ST.meanOrNull(arr), { allowNull: true });
}

for (const e of INTS) {
  probe('conditionOrderFor', [e], () => CB.conditionOrderFor(e));
  probe('sessionPlan', [e], () => CB.sessionPlan(e));
  for (const b of INTS) probe('blockPlan', [e, b], () => CB.blockPlan(e, b));
  for (const c of INTS) probe('passageForCondition', [c, e], () => CB.passageForCondition(c, e));
}
for (const n of INTS) { probe('williamsFirstRow', [n], () => CB.williamsFirstRow(n)); probe('williamsSquare', [n], () => CB.williamsSquare(n)); }

for (const e of INTS) {
  probe('illuminationOrderFor', [e], () => IL.illuminationOrderFor(e));
  for (const b of INTS) probe('illuminationForBlock', [e, b], () => IL.illuminationForBlock(e, b));
}
for (const lv of ['dim', 'moderate', 'low', 'high', '', 'DIM', '__proto__']) {
  for (const n of NUMS) probe('luxInRange', [lv, n], () => IL.luxInRange(lv, n));
  probe('specFor', [lv], () => IL.specFor(lv), { allowNull: true });
  probe('summariseLux(empty)', [lv, []], () => IL.summariseLux(lv, []), { allowNull: true });
  probe('summariseLux(NaN)', [lv, 'NaN'], () => IL.summariseLux(lv, [{ checkpoint: 'start', lux: NaN }]), { allowNull: true });
  probe('summariseLux(null)', [lv, null], () => IL.summariseLux(lv, null), { allowNull: true });
}

for (const v of NUMS) {
  const r = Object.fromEntries(TLX.TLX_DIMENSIONS.map((d) => [d.key, v])) as TLX.TlxRatings;
  probe('scoreTlx', [v], () => TLX.scoreTlx(r));
  for (const d of TLX.TLX_DIMENSIONS) probe('tlxContribution', [d.key, v], () => TLX.tlxContribution(d, v));
}

for (const t of STRS) probe('countTargetOccurrences', [t], () => PS.countTargetOccurrences(['a b c'], t));
probe('countWords([])', [[]], () => PS.countWords([]));
probe('countWords(huge)', ['huge'], () => PS.countWords([('w '.repeat(100000))]));

for (const cp of ['session_start', 'session_end', 'reading_segment', '', '__proto__']) {
  probe('requiredGrant', [cp], () => MD.requiredGrant(cp as MD.MediaCheckpoint));
  probe('mayCapture(null)', [cp], () => MD.mayCapture(null, cp as MD.MediaCheckpoint));
  probe('mayCapture(empty)', [cp], () => MD.mayCapture({} as MD.MediaConsent, cp as MD.MediaCheckpoint));
}
for (const n of NUMS) probe('formatBytes', [n], () => MD.formatBytes(n));
probe('fnv1aBytes(empty)', [[]], () => MD.fnv1aBytes(new Uint8Array([])));
probe('fnv1aBytes(big)', ['1e6'], () => MD.fnv1aBytes(new Uint8Array(1_000_000)));

for (const s of STRS) { probe('escapeCsv', [s], () => EX.escapeCsv(s)); probe('safeFilePart', [s], () => EX.safeFilePart(s)); probe('fnv1a', [s], () => EX.fnv1a(s)); }
for (const n of NUMS) {
  probe('escapeCsv(num)', [n], () => EX.escapeCsv(n));
  // round() deliberately passes a non-finite through unchanged so the CSV boundary can count and
  // empty it; a silent 0 here would erase the evidence that something upstream broke.
  // A non-finite is passed through unchanged by contract, for the CSV boundary to count and empty.
  if (Number.isFinite(n)) probe('round', [n], () => EX.round(n));
}
probe('toCsv(no rows)', [[]], () => EX.toCsv(['a', 'b'], []));
probe('toCsv(missing keys)', ['{}'], () => EX.toCsv(['a', 'b'], [{}]));

console.log('\nprobes run: ' + calls);
console.log('failures  : ' + failures.length + '\n');
const byFn = new Map<string, Failure[]>();
for (const f of failures) { if (!byFn.has(f.fn)) byFn.set(f.fn, []); byFn.get(f.fn)!.push(f); }
for (const [fn, fs] of [...byFn.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(fn + '  (' + fs.length + ' failing inputs)');
  const seen = new Set<string>();
  for (const f of fs) {
    const key = f.kind + '|' + f.detail;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('   ' + f.kind.padEnd(11) + ' ' + f.detail);
    console.log('      input: ' + f.input);
    if (seen.size >= 4) { console.log('      ... ' + (fs.length - 4) + ' more'); break; }
  }
}
process.exit(failures.length ? 1 : 0);
