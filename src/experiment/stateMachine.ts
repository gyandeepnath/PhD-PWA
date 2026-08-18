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
import { TASKS_PER_CONDITION, CONFIG } from './config';

/** Linear setup chain. SESSION_INIT is researcher-only and not counted in the progress bar. */
export const SETUP_ORDER: Stage[] = [
  'SESSION_INIT',
  'CONSENT',
  'PARTICIPANT_PROFILE',
  // Pre-flight (display/room configured: brightness fixed, night-shift OFF) MUST precede the
  // colour-vision screening — a blue-light filter would invalidate the red-green Ishihara plates.
  'PREFLIGHT',
  'COLOR_VISION',
  'CAMERA_SETUP',
  'CALIBRATION',
  'CVSQ_BASELINE',
  'BASELINE_FATIGUE',
  // Participant-facing overview of what the 8 condition-blocks involve, shown once before the loop.
  'INSTRUCTIONS',
];

/** Tracked setup steps (all except SESSION_INIT). */
export const SETUP_STEPS = SETUP_ORDER.length - 1;

/**
 * Per-condition sub-stages in order; the last (ADAPTATION) is a rest, not a measured step.
 * Order follows the protocol: reading is the exposure task, so the preference rating and the
 * fatigue questionnaire are collected IMMEDIATELY after reading (perception fresh; reading is the
 * strongest fatigue inducer), then the attention/cognitive tasks (search, reaction) follow.
 */
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

/**
 * Normalise a sitting size to a whole number of conditions.
 *
 * Production always passes plan.length, which is an integer, but a fractional or non-finite value
 * used to make the loop run a different number of conditions than the caller believed - 1.5 ran
 * two reading tasks. The sitting size decides how many condition records exist, so it must be
 * exactly what the caller asked for or the default.
 */
function sittingSize(n: number): number {
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : N_CONDITIONS;
}

/** Tracked steps for a sitting that runs `nConditions` conditions (default = full 8). */
export function totalTrackedSteps(nConditionsRaw: number = N_CONDITIONS): number {
  return SETUP_STEPS + sittingSize(nConditionsRaw) * TASKS_PER_CONDITION;
}

/** True when a self-paced break is offered after completing `completedCount` of `nConditions`. */
export function shouldBreakAfter(completedCount: number, nConditionsRaw: number): boolean {
  const nConditions = sittingSize(nConditionsRaw);
  const every = CONFIG.BREAK_EVERY_N_CONDITIONS;
  return every > 0 && completedCount % every === 0 && completedCount < nConditions;
}

export interface MachineState {
  stage: Stage;
  /** Current condition index within this sitting, 0..nConditions-1 (meaningful only inside the loop). */
  stepIndex: number;
}

export function initialState(): MachineState {
  return { stage: 'SESSION_INIT', stepIndex: 0 };
}

/**
 * Compute the next state. `nConditions` is the number of conditions in THIS sitting (8 for a
 * single session, 4 for a split sitting); it defaults to the full set so existing callers/tests
 * are unaffected. A self-paced BREAK_SCREEN is inserted after every N completed conditions.
 */
export function nextState(state: MachineState, nConditionsRaw: number = N_CONDITIONS): MachineState {
  const { stage, stepIndex } = state;
  const nConditions = sittingSize(nConditionsRaw);
  // Setup chain.
  const setupIdx = SETUP_ORDER.indexOf(stage);
  if (setupIdx >= 0 && setupIdx < SETUP_ORDER.length - 1) {
    return { stage: SETUP_ORDER[setupIdx + 1], stepIndex: 0 };
  }
  if (stage === 'INSTRUCTIONS') {
    return { stage: 'READING_TASK', stepIndex: 0 };
  }

  // Condition loop.
  const loopIdx = LOOP_ORDER.indexOf(stage);
  if (loopIdx >= 0) {
    // REACTION_TIME is the final measured sub-stage of a condition.
    if (stage === 'REACTION_TIME') {
      return stepIndex < nConditions - 1
        ? { stage: 'ADAPTATION', stepIndex }
        : { stage: 'CVSQ_END', stepIndex };
    }
    if (stage === 'ADAPTATION') {
      // After resting, optionally insert a self-paced break, then move to the next condition.
      return shouldBreakAfter(stepIndex + 1, nConditions)
        ? { stage: 'BREAK_SCREEN', stepIndex }
        : { stage: 'READING_TASK', stepIndex: stepIndex + 1 };
    }
    return { stage: LOOP_ORDER[loopIdx + 1], stepIndex };
  }

  if (stage === 'BREAK_SCREEN') return { stage: 'READING_TASK', stepIndex: stepIndex + 1 };
  // NASA-TLX sits between the end CVS-Q and completion: both are session-level instruments, and
  // asking for workload AFTER the symptom questionnaire keeps the symptom rating from being
  // primed by having just reflected on how hard the session was.
  if (stage === 'CVSQ_END') return { stage: 'NASA_TLX', stepIndex };
  if (stage === 'NASA_TLX') return { stage: 'SESSION_COMPLETE', stepIndex };
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
  if (stage === 'ADAPTATION' || stage === 'BREAK_SCREEN') {
    // After all measured sub-stages of this condition (rest/break is not itself a tracked step).
    return SETUP_STEPS + (stepIndex + 1) * TASKS_PER_CONDITION;
  }
  // SESSION_COMPLETE / EXPORT_DASHBOARD
  return TOTAL_TRACKED_STEPS;
}

/** Progress as a 0-100 percentage, relative to this sitting's condition count. */
export function progressPercent(state: MachineState, nConditionsRaw: number = N_CONDITIONS): number {
  const nConditions = sittingSize(nConditionsRaw);
  return Math.min(100, (completedSteps(state) / totalTrackedSteps(nConditions)) * 100);
}

export function isSetup(stage: Stage): boolean {
  return SETUP_ORDER.includes(stage);
}
export function isInLoop(stage: Stage): boolean {
  return LOOP_ORDER.includes(stage);
}
