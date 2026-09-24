import { describe, it, expect } from 'vitest';
import {
  initialState,
  nextState,
  progressPercent,
  shouldBreakAfter,
  TOTAL_TRACKED_STEPS,
  type MachineState,
} from '@/experiment/stateMachine';
import type { Stage } from '@/storage/types';
import { N_CONDITIONS } from '@/experiment/conditions';
import { TASKS_PER_CONDITION } from '@/experiment/config';

/** Walk the whole machine to completion, collecting the visited stage sequence. */
function walk(nConditions?: number): { stage: Stage; stepIndex: number }[] {
  const visited: MachineState[] = [];
  let s = initialState();
  for (let i = 0; i < 200; i++) {
    visited.push(s);
    if (s.stage === 'EXPORT_DASHBOARD') break;
    s = nextState(s, nConditions);
  }
  return visited;
}

describe('stage machine', () => {
  it('total tracked steps is 9 setup + N×TASKS_PER_CONDITION', () => {
    expect(TOTAL_TRACKED_STEPS).toBe(9 + N_CONDITIONS * TASKS_PER_CONDITION);
  });

  it('runs the full setup chain then N condition loops then end CVS-Q, NASA-TLX, completion', () => {
    const visited = walk();
    const stages = visited.map((v) => v.stage);
    expect(stages.slice(0, 10)).toEqual([
      'SESSION_INIT',
      'CONSENT',
      'PARTICIPANT_PROFILE',
      'PREFLIGHT',
      'COLOR_VISION',
      'CAMERA_SETUP',
      'CALIBRATION',
      'CVSQ_BASELINE',
      'BASELINE_FATIGUE',
      'INSTRUCTIONS',
    ]);
    expect(stages[stages.length - 1]).toBe('EXPORT_DASHBOARD');
    expect(stages[stages.length - 2]).toBe('SESSION_COMPLETE');
    expect(stages[stages.length - 3]).toBe('NASA_TLX');
    expect(stages[stages.length - 4]).toBe('CVSQ_END');
  });

  it('visits READING_TASK exactly N times (once per condition)', () => {
    const readings = walk().filter((v) => v.stage === 'READING_TASK');
    expect(readings).toHaveLength(N_CONDITIONS);
    expect(readings.map((r) => r.stepIndex)).toEqual(Array.from({ length: N_CONDITIONS }, (_, i) => i));
  });

  it('has N adaptations: one before the first condition and one after each but the last', () => {
    // The pre-first grey field is not cosmetic. Without it, condition 0 began from the cream setup
    // UI, so a negative-polarity condition at position 0 started light-adapted while a
    // positive-polarity one started already matched — adaptation state at onset was a function of
    // polarity, at the one position where the Williams square puts every condition equally often.
    const adaptations = walk().filter((v) => v.stage === 'ADAPTATION');
    expect(adaptations).toHaveLength(N_CONDITIONS);
    expect(adaptations[0].stepIndex).toBe(-1);
    expect(adaptations.slice(1).map((a) => a.stepIndex))
      .toEqual(Array.from({ length: N_CONDITIONS - 1 }, (_, i) => i));
  });

  it('puts the pre-first grey field immediately before the first reading task', () => {
    const stages = walk().map((v) => v.stage);
    const firstReading = stages.indexOf('READING_TASK');
    expect(stages[firstReading - 1]).toBe('ADAPTATION');
    expect(stages[firstReading - 2]).toBe('INSTRUCTIONS');
  });

  it('REACTION_TIME (last task) of the final condition goes to the end CVS-Q', () => {
    const last = N_CONDITIONS - 1;
    expect(nextState({ stage: 'REACTION_TIME', stepIndex: last })).toEqual({
      stage: 'CVSQ_END',
      stepIndex: last,
    });
    expect(nextState({ stage: 'REACTION_TIME', stepIndex: 0 })).toEqual({
      stage: 'ADAPTATION',
      stepIndex: 0,
    });
  });

  it('per-condition order: ratings come right after reading, then search/reaction', () => {
    // READING → COMPREHENSION → DISPLAY_PERCEPTION → POST_FATIGUE → VISUAL_SEARCH → REACTION_TIME
    expect(nextState({ stage: 'COMPREHENSION', stepIndex: 2 })).toEqual({ stage: 'DISPLAY_PERCEPTION', stepIndex: 2 });
    expect(nextState({ stage: 'POST_FATIGUE', stepIndex: 2 })).toEqual({ stage: 'VISUAL_SEARCH', stepIndex: 2 });
  });

  it('inserts a self-paced break after every 2 conditions, never after the last', () => {
    const visited = walk();
    const breaks = visited.filter((v) => v.stage === 'BREAK_SCREEN');
    // A break follows every 2nd condition, but never the last one of the sitting.
    const expectedBreaks = Array.from({ length: N_CONDITIONS }, (_, i) => i)
      .filter((i) => (i + 1) % 2 === 0 && i < N_CONDITIONS - 1);
    expect(breaks.map((b) => b.stepIndex)).toEqual(expectedBreaks);
    // Each BREAK_SCREEN leads into the grey adaptation field, and only that into the next condition.
    expect(nextState({ stage: 'BREAK_SCREEN', stepIndex: 1 })).toEqual({ stage: 'ADAPTATION', stepIndex: 1 });
    expect(nextState({ stage: 'ADAPTATION', stepIndex: 1 })).toEqual({ stage: 'READING_TASK', stepIndex: 2 });
  });

  it('puts the adaptation field IMMEDIATELY before every condition, including after a break', () => {
    /*
     * The order was REACTION_TIME -> ADAPTATION -> BREAK_SCREEN -> READING_TASK. The break is a
     * cream, self-paced screen, so every condition after a break began light-adapted from it and the
     * polarity-switch control ran before the break instead of before the condition — defeated at
     * four of nine transitions, and the effect on onset adaptation depended on polarity. Asserted
     * over the whole walk rather than at one step, so no future insertion can land between the
     * grey field and the condition it adapts the eye for.
     */
    for (const n of [N_CONDITIONS, 5]) {
      const visited = walk(n);
      visited.forEach((v, i) => {
        if (v.stage === 'READING_TASK') {
          expect(visited[i - 1]?.stage, `reading ${v.stepIndex} of ${n}`).toBe('ADAPTATION');
        }
      });
    }
  });

  it('shouldBreakAfter only fires on multiples of N before the final condition', () => {
    expect(shouldBreakAfter(2, 8)).toBe(true);
    expect(shouldBreakAfter(4, 8)).toBe(true);
    expect(shouldBreakAfter(8, 8)).toBe(false); // last condition of the sitting
    expect(shouldBreakAfter(1, 8)).toBe(false);
    expect(shouldBreakAfter(2, 2)).toBe(false); // split sitting: no break after its final condition
  });

  it('split sitting of 4 conditions ends at CVS-Q after condition 4 with one mid-break', () => {
    const visited = walk(4);
    const readings = visited.filter((v) => v.stage === 'READING_TASK');
    expect(readings.map((r) => r.stepIndex)).toEqual([0, 1, 2, 3]);
    expect(visited.filter((v) => v.stage === 'BREAK_SCREEN').map((b) => b.stepIndex)).toEqual([1]);
    // Final (local) condition's reaction time goes straight to the end CVS-Q.
    expect(nextState({ stage: 'REACTION_TIME', stepIndex: 3 }, 4)).toEqual({ stage: 'CVSQ_END', stepIndex: 3 });
    expect(visited[visited.length - 1].stage).toBe('EXPORT_DASHBOARD');
  });

  it('progress increases monotonically from 0 to 100', () => {
    const visited = walk();
    // Wrap so Array.map's index argument isn't mistaken for nConditions.
    const progress = visited.map((s) => progressPercent(s));
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(100);
  });
});

/*
 * The resume path re-enters the condition loop through the grey field rather than dropping the
 * participant straight into the reading task (Experiment.tsx). It does that by setting
 * { stage: 'ADAPTATION', stepIndex: loopTarget - 1 }, which relies on ADAPTATION naming the
 * condition it FOLLOWS. If that arithmetic were off by one the participant would silently repeat a
 * finished condition or skip an unrun one — the same exported sitting would then carry two rows for
 * one condition, or none for another, with nothing marking either.
 */
describe('resuming re-enters the loop through the grey field, at the right condition', () => {
  const settle = (s: MachineState, n: number): MachineState => {
    // A resume landing on a break boundary passes through BREAK_SCREEN first; that is intended,
    // because the mid-sitting illuminance prompt lives on that screen.
    let next = nextState(s, n);
    if (next.stage === 'BREAK_SCREEN') next = nextState(next, n);
    return next;
  };

  it('lands on exactly the condition the resume pointer names, for every resume point', () => {
    for (let loopTarget = 0; loopTarget < N_CONDITIONS; loopTarget++) {
      const entry: MachineState = { stage: 'ADAPTATION', stepIndex: loopTarget - 1 };
      const arrived = settle(entry, N_CONDITIONS);
      expect(arrived.stage).toBe('READING_TASK');
      expect(arrived.stepIndex).toBe(loopTarget);
    }
  });

  it('resuming at condition 0 enters the same state a fresh sitting walks into', () => {
    // Not a restatement of the formula: this reads the grey-field state a FRESH machine actually
    // reaches on its way to condition 0, and requires the resume entry to equal it. If the two
    // paths ever diverge, the first condition of a resumed sitting stops being comparable with
    // the first condition of every other one.
    const fresh = walk().find((v) => v.stage === 'ADAPTATION');
    expect(fresh).toBeDefined();
    const resumeEntry: MachineState = { stage: 'ADAPTATION', stepIndex: 0 - 1 };
    expect(resumeEntry).toEqual(fresh);
    expect(settle(resumeEntry, N_CONDITIONS)).toEqual({ stage: 'READING_TASK', stepIndex: 0 });
  });

  it('works for a split sitting, where the plan is shorter than the full design', () => {
    const half = N_CONDITIONS / 2;
    for (let loopTarget = 0; loopTarget < half; loopTarget++) {
      const arrived = settle({ stage: 'ADAPTATION', stepIndex: loopTarget - 1 }, half);
      expect(arrived.stage).toBe('READING_TASK');
      expect(arrived.stepIndex).toBe(loopTarget);
    }
  });
});
