/**
 * Is the tablet's frame rate limited by the camera's exposure or by the tracker? (Round 79)
 *
 * Usage:  npm run frame-intervals -- <export folder>
 *
 * Reads 07c_ear_trace.csv (every processed frame of every reading window), 07_eye_metrics.csv and
 * 02_conditions.csv from one participant's export folder, and prints, per condition, how the gaps
 * between frames are distributed and what that says (src/tracking/frameIntervals.ts):
 *
 *   gaps mostly 36-45 ms         -> the camera itself runs at about 25: exposure-limited
 *   gaps a mix of ~33 and ~67 ms -> the camera runs at 30 and the tracker skips frames
 *   gaps mostly under 36 ms      -> about 30 frames a second
 *
 * and then the positive-minus-negative difference in the median gap, because a camera limited by
 * exposure can run faster on white pages than on black ones. Nothing is written; it only reads.
 * This is the "frame-interval check" of docs/OPERATOR_MANUAL.md.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { summariseIntervals, INTERVAL_BINS, VERDICT_TEXT } from '../src/tracking/frameIntervals';

/** RFC-4180: quotes, escaped quotes, embedded newlines, CRLF. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows[0] ?? [];
  return rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, '07c_ear_trace.csv'))) {
  console.error('Usage: npm run frame-intervals -- <export folder containing 07c_ear_trace.csv>');
  process.exit(2);
}
const read = (f: string) => (existsSync(join(dir, f)) ? parseCsv(readFileSync(join(dir, f), 'utf8')) : []);
const trace = read('07c_ear_trace.csv').filter((r) => r.window === 'reading');
const eye = new Map(read('07_eye_metrics.csv').map((r) => [r.condition_id, r]));
const cond = new Map(read('02_conditions.csv').map((r) => [r.condition_id, r]));

const byCond = new Map<string, Array<{ t_ms: number | null; face: boolean }>>();
for (const r of trace) {
  const k = `${r.participant_id}\t${r.condition_id}`;
  const t = r.t_ms === '' ? null : Number(r.t_ms);
  (byCond.get(k) ?? byCond.set(k, []).get(k)!).push({ t_ms: Number.isFinite(t) ? t : null, face: r.face === '1' });
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`\nFrame-interval check — ${dir}\n`);
console.log([pad('participant', 12), pad('cond', 5), pad('pol', 9), pad('gaps', 6), ...INTERVAL_BINS.map((b) => pad(b.label, 7)), pad('median', 7), pad('camera', 7), pad('tracker', 8), 'reading'].join(''));
const medians: Record<string, Record<string, number[]>> = {};
for (const [k, frames] of byCond) {
  const [pid, cid] = k.split('\t');
  const s = summariseIntervals(frames);
  const e = eye.get(cid);
  const c = cond.get(cid);
  const pol = c?.polarity ?? '';
  if (s.medianMs != null && pol) ((medians[pid] ??= {})[pol] ??= []).push(s.medianMs);
  console.log([
    pad(pid, 12), pad(c?.condition_label ?? cid.slice(0, 4), 5), pad(pol, 9), pad(s.n, 6),
    ...s.shares.map((x) => pad(`${Math.round(x * 100)}%`, 7)),
    pad(s.medianMs == null ? '-' : `${Math.round(s.medianMs)}ms`, 7),
    pad(e?.camera_fps_delivered || '-', 7), pad(e?.tracker_fps || '-', 8), VERDICT_TEXT[s.verdict],
  ].join(''));
}
console.log('\nPositive minus negative polarity, median gap between frames (a camera limited by exposure is slower on dark pages):');
for (const [pid, m] of Object.entries(medians)) {
  const mean = (xs?: number[]) => (xs && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const p = mean(m.positive), n = mean(m.negative);
  console.log(`  ${pid}: positive ${p == null ? '-' : p.toFixed(1)} ms, negative ${n == null ? '-' : n.toFixed(1)} ms`
    + (p != null && n != null ? `, difference ${(p - n).toFixed(1)} ms` : ''));
}
console.log('');
