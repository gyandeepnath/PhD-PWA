import { describe, it, expect } from 'vitest';
import {
  initialState,
  nextState,
  progressPercent,
  TOTAL_TRACKED_STEPS,
  type MachineState,
} from '@/experiment/stateMachine';
import type { Stage } from '@/storage/types';

/** Walk the whole machine to completion, collecting the visited stage sequence. */
function walk(): { stage: Stage; stepIndex: number }[] {
  const visited: MachineState[] = [];
  let s = initialState();
  for (let i = 0; i < 200; i++) {
    visited.push(s);
    if (s.stage === 'EXPORT_DASHBOARD') break;
    s = nextState(s);
  }
  return visited;
}

describe('stage machine', () => {
  it('total tracked steps is 57 (9 setup + 8×6)', () => {
    expect(TOTAL_TRACKED_STEPS).toBe(57);
  });

  it('runs the full setup chain then 8 condition loops then completion + end CVS-Q', () => {
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
    expect(stages[stages.length - 3]).toBe('CVSQ_END');
  });

  it('visits READING_TASK exactly 8 times (once per condition)', () => {
    const readings = walk().filter((v) => v.stage === 'READING_TASK');
    expect(readings).toHaveLength(8);
    expect(readings.map((r) => r.stepIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('has 7 adaptations (skipped after the final condition)', () => {
    const adaptations = walk().filter((v) => v.stage === 'ADAPTATION');
    expect(adaptations).toHaveLength(7);
  });

  it('REACTION_TIME (last task) of the final condition goes to the end CVS-Q', () => {
    expect(nextState({ stage: 'REACTION_TIME', stepIndex: 7 })).toEqual({
      stage: 'CVSQ_END',
      stepIndex: 7,
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

  it('progress increases monotonically from 0 to 100', () => {
    const visited = walk();
    const progress = visited.map(progressPercent);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(100);
  });
});
