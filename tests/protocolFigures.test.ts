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
import { SELF_TEST, selfTestMachineMs } from '@/tracking/selfTest';

const root = resolve(__dirname, '..');
const protocol = readFileSync(resolve(root, 'docs/PROTOCOL.md'), 'utf8').replace(/\s+/g, ' ');
const timingDoc = readFileSync(resolve(root, 'docs/TIMING_MODEL.md'), 'utf8');

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

/*
 * docs/TIMING_MODEL.md's headline figures are the model's too (Round 92, audit 86 P3, P6 addendum): its
 * tiers and sensitivity table had drifted from the script (26.3/29.6/42.5 min, "98.4 min as modelled"
 * against 26.2/29.5/42.9 and 98.7), and Round 92 changed the model again when it charged the camera
 * check and the intro cards.
 */
describe('TIMING_MODEL.md quotes the timing model it names (Round 92)', () => {
  const out = model();
  const tier = (label: string) => new RegExp(`${label}[^\\n]*?([\\d.]+) min\\s+(\\d+)%`).exec(out)!;

  it('the three tiers, minutes and shares', () => {
    const [, eMin, eShare] = tier('ENFORCED by CONFIG');
    const [, cMin, cShare] = tier('CORPUS arithmetic');
    const [, gMin, gShare] = tier('ESTIMATED by me');
    expect(timingDoc).toContain(`| ${eMin} | ${eShare}% |`);
    expect(timingDoc).toContain(`| ${cMin} | ${cShare}% |`);
    expect(timingDoc).toContain(`| ${gMin} | ${gShare}% |`);
    expect(timingDoc).toContain(`**${(Number(eMin) + Number(cMin)).toFixed(1)} minutes**`);
  });

  it('the sensitivity table and the floors', () => {
    for (const pct of [0, 20, 30, 50, 70, 100]) {
      const v = num(out, new RegExp(`estimates\\s+${pct}% too high ->\\s+([\\d.]+) min`));
      expect(timingDoc, `${pct}%`).toMatch(new RegExp(`estimates\\s+${pct}% too high ->\\s+${v.replace('.', '\\.')} min`));
    }
    const floor = num(out, /zero deliberation = ([\d.]+) min/);
    expect(timingDoc).toContain(`leaves **${floor} minutes**`);
    expect(timingDoc).toContain(`**${num(out, /^\s+TOTAL\s+([\d.]+) min/m)} minutes**`);
  });

  it('the camera check and the calibration are charged, and named for what happens', () => {
    expect(out).toMatch(/camera_check \(machine: five flashes\)/);
    expect(out).toMatch(/camera_check \(human: intro, result\)/);
    expect(out).not.toMatch(/9 taps/);
    const src = readFileSync(resolve(root, 'scripts/lib/timingModel.ts'), 'utf8');
    expect(src).toMatch(/selfTestMachineMs\(\) \/ S/);
    // The camera check's machine time is the screen's own: five flashes and the tail, 19 s.
    expect(selfTestMachineMs()).toBe(SELF_TEST.FIRST_CUE_MS + SELF_TEST.CUES * SELF_TEST.CUE_EVERY_MS + SELF_TEST.TAIL_MS);
    expect(selfTestMachineMs()).toBe(19_000);
    const screen = readFileSync(resolve(root, 'src/start/CameraSelfTest.tsx'), 'utf8');
    expect(screen).toMatch(/first \+ SELF_TEST\.CUES \* every \+ \(fast \? 150 : SELF_TEST\.TAIL_MS\)/);
  });
});
