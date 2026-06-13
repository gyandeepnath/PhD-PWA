/**
 * Pure experiment stage machine.
 *
 * Flow:
 *   SESSION_INIT → PARTICIPANT_PROFILE → CAMERA_SETUP → CALIBRATION → BASELINE_FATIGUE →
 *   [×8: READING_TASK → COMPREHENSION → DISPLAY_PERCEPTION → POST_FATIGUE → VISUAL_SEARCH →
 *        REACTION_TIME → ADAPTATION] → SESSION_COMPLETE → EXPORT_DASHBOARD
 *
 * Adaptation is skipped after the final condition (nothing to adapt to). Transitions are pure
 * functions of (stage, stepIndex) so they are unit-testable in isolation from React.
 */
import type { Stage } from '@/storage/types';
import { N_CONDITIONS } from './conditions';
import { TASKS_PER_CONDITION } from './config';

/** Linear setup chain. SESSION_INIT is researcher-only and not counted in the progress bar. */
export const SETUP_ORDER: Stage[] = [
  'SESSION_INIT',
  'CONSENT',
  'PARTICIPANT_PROFILE',
  'COLOR_VISION',
  'PREFLIGHT',
  'CAMERA_SETUP',
  'CALIBRATION',
  'CVSQ_BASELINE',
  'BASELINE_FATIGUE',
];

/** Tracked setup steps (all except SESSION_INIT). */
export const SETUP_STEPS = SETUP_ORDER.length - 1;

/** Per-condition sub-stages in order; the last (ADAPTATION) is a rest, not a measured step. */
export const LOOP_ORDER: Stage[] = [
  'READING_TASK',
  'COMPREHENSION',
  'DISPLAY_PERCEPTION',
  'POST_FATIGUE',
  'VISUAL_SEARCH',
  'REACTION_TIME',
  'ADAPTATION',
];

/** Measured sub-stages (exclude ADAPTATION) — used for progress. */
const MEASURED_LOOP = LOOP_ORDER.slice(0, TASKS_PER_CONDITION);

export const TOTAL_TRACKED_STEPS = SETUP_STEPS + N_CONDITIONS * TASKS_PER_CONDITION;

export interface MachineState {
  stage: Stage;
  /** Current condition index 0..N-1 (meaningful only inside the loop). */
  stepIndex: number;
}

export function initialState(): MachineState {
  return { stage: 'SESSION_INIT', stepIndex: 0 };
}

/** Compute the next state. */
export function nextState({ stage, stepIndex }: MachineState): MachineState {
  // Setup chain.
  const setupIdx = SETUP_ORDER.indexOf(stage);
  if (setupIdx >= 0 && setupIdx < SETUP_ORDER.length - 1) {
    return { stage: SETUP_ORDER[setupIdx + 1], stepIndex: 0 };
  }
  if (stage === 'BASELINE_FATIGUE') {
    return { stage: 'READING_TASK', stepIndex: 0 };
  }

  // Condition loop.
  const loopIdx = LOOP_ORDER.indexOf(stage);
  if (loopIdx >= 0) {
    if (stage === 'REACTION_TIME') {
      return stepIndex < N_CONDITIONS - 1
        ? { stage: 'ADAPTATION', stepIndex }
        : { stage: 'CVSQ_END', stepIndex };
    }
    if (stage === 'ADAPTATION') {
      return { stage: 'READING_TASK', stepIndex: stepIndex + 1 };
    }
    return { stage: LOOP_ORDER[loopIdx + 1], stepIndex };
  }

  if (stage === 'CVSQ_END') return { stage: 'SESSION_COMPLETE', stepIndex };
  if (stage === 'SESSION_COMPLETE') return { stage: 'EXPORT_DASHBOARD', stepIndex };
  return { stage: 'EXPORT_DASHBOARD', stepIndex }; // terminal
}

/** Number of completed tracked steps before the given state (0-based count). */
export function completedSteps({ stage, stepIndex }: MachineState): number {
  // Setup: PARTICIPANT_PROFILE..BASELINE_FATIGUE are the 4 tracked setup steps.
  const setupIdx = SETUP_ORDER.indexOf(stage);
  if (stage === 'SESSION_INIT') return 0;
  if (setupIdx > 0) return setupIdx - 1; // PARTICIPANT_PROFILE=0 completed before it, etc.

  const measuredIdx = MEASURED_LOOP.indexOf(stage);
  if (measuredIdx >= 0) {
    return SETUP_STEPS + stepIndex * TASKS_PER_CONDITION + measuredIdx;
  }
  if (stage === 'ADAPTATION') {
    // After all measured sub-stages of this condition.
    return SETUP_STEPS + (stepIndex + 1) * TASKS_PER_CONDITION;
  }
  // SESSION_COMPLETE / EXPORT_DASHBOARD
  return TOTAL_TRACKED_STEPS;
}

/** Progress as a 0-100 percentage. */
export function progressPercent(state: MachineState): number {
  return Math.min(100, (completedSteps(state) / TOTAL_TRACKED_STEPS) * 100);
}

export function isSetup(stage: Stage): boolean {
  return SETUP_ORDER.includes(stage);
}
export function isInLoop(stage: Stage): boolean {
  return LOOP_ORDER.includes(stage);
}
