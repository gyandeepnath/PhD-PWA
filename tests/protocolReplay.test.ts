/**
 * A participant who has finished the protocol must not be able to run it again by accident.
 *
 * The console resolved a participant's history on every keystroke of the ID field and then showed
 * none of it. For someone who had completed all ten conditions, `completed % 10` came out 0, the
 * planner built a fresh plan of all ten, and the sitting started: the whole protocol, again, in
 * silence. The replay's rows were labelled identically to the first run — `passage_repeat_number`
 * was derived from the illumination block, which the single-level design clamps to 0 — so the
 * export showed twenty independent condition-runs, each asserting a first reading of its passage,
 * for a participant who had read all ten passages twice, searched all ten texts twice, and answered
 * every comprehension question twice.
 *
 * The fix separates the two quantities that were conflated (participantProgress.ts), requires the
 * researcher to say in writing why a finished participant is being run again, and records both the
 * pass count and that reason on the session.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  participantProgress, passageRepeatNumber, repeatRunAcknowledged, REPEAT_NOTE_MIN_CHARS,
} from '@/experiment/participantProgress';
import { N_CONDITIONS } from '@/experiment/conditions';
import { N_ILLUMINATION_BLOCKS } from '@/experiment/illumination';

describe('a pass through the protocol is counted separately from the illumination block', () => {
  it('a new participant is on pass 0 at offset 0', () => {
    expect(participantProgress(0)).toEqual({ passes: 0, block: 0, offset: 0 });
  });

  it('a half-finished participant resumes where they stopped, still on pass 0', () => {
    const p = participantProgress(N_CONDITIONS / 2);
    expect(p.passes).toBe(0);
    expect(p.offset).toBe(N_CONDITIONS / 2);
  });

  it('COUNTS THE PASS of a participant who has completed the protocol', () => {
    // This is the number the clamp used to destroy. offset 0 is correct — a second pass does start
    // at the beginning — which is exactly why the pass count has to survive to say so.
    expect(participantProgress(N_CONDITIONS).passes).toBe(1);
    expect(participantProgress(N_CONDITIONS * 2).passes).toBe(2);
  });

  it('keeps the illumination block inside the design, however many passes there have been', () => {
    for (const completed of [0, N_CONDITIONS, N_CONDITIONS * 3]) {
      const { block } = participantProgress(completed);
      expect(block).toBeGreaterThanOrEqual(0);
      expect(block).toBeLessThanOrEqual(N_ILLUMINATION_BLOCKS - 1);
    }
  });

  it('treats nonsense as a first pass rather than producing a nonsense plan', () => {
    for (const bad of [NaN, -5, Infinity]) {
      expect(participantProgress(bad)).toEqual({ passes: 0, block: 0, offset: 0 });
    }
  });
});

describe('passage_repeat_number', () => {
  it('is 1 through a first pass', () => {
    expect(passageRepeatNumber({ protocol_pass: 0, illumination_block: 0 })).toBe(1);
  });

  it('is 2 on a replay — the row the export used to label 1', () => {
    expect(passageRepeatNumber({ protocol_pass: 1, illumination_block: 0 })).toBe(2);
  });

  it('falls back to the illumination block for sittings recorded before the pass was captured', () => {
    expect(passageRepeatNumber({ illumination_block: 1 })).toBe(2);
    expect(passageRepeatNumber({})).toBe(1);
  });
});

describe('starting a sitting for a participant who has already finished', () => {
  it('is allowed without ceremony for everyone on their first pass', () => {
    expect(repeatRunAcknowledged(0, '')).toBe(true);
  });

  it('is refused when nothing explains it', () => {
    expect(repeatRunAcknowledged(1, '')).toBe(false);
    expect(repeatRunAcknowledged(1, '   ')).toBe(false);
    expect(repeatRunAcknowledged(2, 'x'.repeat(REPEAT_NOTE_MIN_CHARS - 1))).toBe(false);
  });

  it('is permitted — not blocked — once the reason is written down', () => {
    // A voided sitting is a real reason to run one again. The point is that the reason becomes
    // data, not that the researcher is prevented.
    expect(repeatRunAcknowledged(1, 'first sitting voided — camera failed throughout')).toBe(true);
  });
});

describe('the console screen enforces it', () => {
  const src = readFileSync('src/start/setupStages.tsx', 'utf8');

  it('shows the participant their existing record instead of resolving it and discarding it', () => {
    expect(src).toContain('data-testid="prior-progress"');
    expect(src).toMatch(/assigned\.conditionsCompleted/);
  });

  it('gates the start button on the acknowledgement', () => {
    const valid = src.slice(src.indexOf('const valid ='), src.indexOf(';', src.indexOf('const valid =')));
    expect(valid).toContain('repeatAcknowledged');
  });
});
