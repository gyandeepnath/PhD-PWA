/**
 * The session-length figures PROTOCOL.md quotes are the timing model's (audit 86 D11).
 *
 * docs/PROTOCOL.md quoted "median 97 min, p95 118 min, p99 130 min ... 4.0% (81/2000) exceed two hours"
 * and "adaptation 14.0 min", copied by hand from an earlier configuration, while the model on the same
 * commit gave 97.7, 120.7 and 132.5 min, 5.5% (110/2000) and 15.0 min: the document a reviewer reads
 * understated the tail. The model is deterministic (seeded) and takes about a second, so the test runs
 * it and checks every figure the section quotes. Its command table also quoted test and check counts
 * ("326 unit tests", "579 checks", "6 end-to-end tests across 4 spec files") that each round outdated;
 * it now names what each command checks and lets the command print the count.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const protocol = readFileSync(resolve(root, 'docs/PROTOCOL.md'), 'utf8').replace(/\s+/g, ' ');

function model(): string {
  return execFileSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'scripts/simulateParticipant.ts')], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
  });
}

const num = (out: string, re: RegExp): string => {
  const m = re.exec(out);
  if (!m) throw new Error(`timing model output has no ${re}`);
  return m[1];
};

describe('PROTOCOL.md quotes the timing model it names (audit 86 D11)', () => {
  const out = model();
  const p50 = num(out, /p50\s+([\d.]+) min/);
  const p95 = num(out, /p95\s+([\d.]+) min/);
  const p99 = num(out, /p99\s+([\d.]+) min/);
  const over = /Participants exceeding 120 min: (\d+) \/ (\d+) \(([\d.]+)%\)/.exec(out)!;
  const minutes = (stage: string) => num(out, new RegExp(`^\\s+${stage}[^\\n]*?\\s([\\d.]+) min\\s+([\\d.]+)%`, 'm'));
  const share = (stage: string) => new RegExp(`^\\s+${stage}[^\\n]*?\\s[\\d.]+ min\\s+([\\d.]+)%`, 'm').exec(out)![1];

  it('the distribution and the share over two hours', () => {
    expect(protocol).toContain(`**median ${p50} min, p95 ${p95} min, p99 ${p99} min**`);
    expect(protocol).toContain(`${over[3]}% of simulated participants (${over[1]}/${over[2]})`);
    // The rounded figures in the procedure and the fatigue note.
    expect(protocol).toContain(`(median ~${Math.round(Number(p50))} min, p95 ~${Math.round(Number(p95))} min)`);
    expect(protocol).toContain(`**Session length** (median ~${Math.round(Number(p50))} min)`);
  });

  it('where the time goes, and what switching polarity costs', () => {
    expect(protocol).toContain(`reading ${minutes('reading')} min (${share('reading')}%)`);
    expect(protocol).toContain(`adaptation ${minutes('adaptation')} min (${share('adaptation')}%)`);
    expect(protocol).toContain(`RT blocks ${minutes('rt_block')} min (${share('rt_block')}%)`);
    expect(protocol).toContain(`comprehension ${minutes('comprehension')} min (${share('comprehension')}%)`);
    expect(protocol).toContain(`visual search ${minutes('visual_search')} min`);
    const cvsq = (Number(minutes('cvsq_baseline')) + Number(minutes('cvsq_end'))).toFixed(1);
    expect(protocol).toContain(`CVS-Q ×2 ${cvsq} min`);
    expect(protocol).toContain(`costs ~${num(out, /switching costs ([\d.]+) min/)} min per sitting`);
  });

  it('the command table states no count a later round would outdate', () => {
    expect(protocol).not.toMatch(/\| \d[\d,]* unit and property tests/);
    expect(protocol).not.toMatch(/runs \d[\d,]* checks over the export pipeline/);
    expect(protocol).not.toMatch(/\d+ end-to-end tests across \d+ spec files/);
  });
});
