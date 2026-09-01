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
    /**
     * The FIRST condition gets a grey field too.
     *
     * Adaptation only ever followed a condition, so condition 0 began from whatever the participant
     * had been looking at — the cream setup UI, which is light. A negative-polarity condition at
     * position 0 therefore started light-adapted while a positive-polarity one started already
     * matched to its own background. Adaptation state at onset was thus a function of polarity, for
     * the one position in the sitting where the Williams square puts every condition equally often
     * across participants: an asymmetry confounded with the study's primary factor, in a design
     * whose whole purpose is to separate them.
     *
     * The grey field costs 60 s once per sitting, which the feasibility simulation absorbs.
     */
    return { stage: 'ADAPTATION', stepIndex: -1 };
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
      // stepIndex -1 is the pre-first-condition grey field: go straight into condition 0, with no
      // break (nothing has happened yet to rest from).
      if (stepIndex < 0) return { stage: 'READING_TASK', stepIndex: 0 };
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

/**
 * What a resumed session still owes, before it may re-enter the condition loop.
 *
 * A resume used to jump straight to the first reading task. That was safe only while a resume
 * pointer existed exclusively for sessions that had already reached the loop. Once every
 * in-progress session became resumable — which it had to, so that a second participant could not
 * strand the first — a session interrupted anywhere in the ten-stage setup chain was offered as
 * "Resume (next condition 1/10)" and, on tapping it, dropped the participant straight into the
 * reading task.
 *
 * Everything the setup chain establishes was then silently absent: no consent record, no
 * participant row (so age, correction, colour vision, eligibility and exclusion_reason are
 * permanently unrecoverable), no pre-flight, no calibration, and neither baseline instrument — so
 * the CVS-Q change score, the key secondary outcome, cannot be computed, and every fatigue_delta
 * is null. The sitting nonetheless completed ten conditions, so `session_complete` was TRUE and
 * the codebook's own filter admitted it.
 *
 * This returns the first setup stage whose product is missing, or null when the chain is complete.
 * Pure, so it can be tested without a database.
 */
export interface ResumePrerequisites {
  consentGiven: boolean;
  hasParticipantRecord: boolean;
  preflightComplete: boolean;
  colourVisionScreened: boolean;
  hasBaselineCvsq: boolean;
  hasBaselineFatigue: boolean;
  /** Whether this participant consented to camera measurement; drives re-calibration. */
  wantsCamera: boolean;
}

export function firstUnsatisfiedSetupStage(p: ResumePrerequisites): Stage | null {
  if (!p.consentGiven) return 'CONSENT';
  if (!p.hasParticipantRecord) return 'PARTICIPANT_PROFILE';
  if (!p.preflightComplete) return 'PREFLIGHT';
  if (!p.colourVisionScreened) return 'COLOR_VISION';
  /**
   * Camera setup and calibration are re-run on EVERY resume when the grant is present, not only
   * when they were missed: the app remounts, and the EAR and gaze baselines that every blink
   * threshold is a fraction of live in refs that the remount cleared.
   *
   * CAMERA_SETUP sits before the baselines in SETUP_ORDER, so returning it here is correct — but
   * it must NOT hide the two checks below it. It used to `return` unconditionally, which made them
   * unreachable in the ordinary case where the camera is consented: a session interrupted after
   * the colour-vision screen and resumed went camera → calibration → straight into condition 1,
   * and the baseline CVS-Q and baseline fatigue were never administered. They are pre-exposure
   * measurements and cannot be taken afterwards, so the CVS-Q change score — the key secondary
   * outcome — and every fatigue_delta were lost for that sitting, which still exported
   * session_complete=TRUE. See `resumeOwesBaselines`, which is what tells the resume whether it
   * may enter the condition loop straight after calibration.
   */
  if (p.wantsCamera) return 'CAMERA_SETUP';
  if (!p.hasBaselineCvsq) return 'CVSQ_BASELINE';
  if (!p.hasBaselineFatigue) return 'BASELINE_FATIGUE';
  return null;
}

/**
 * Whether a resumed session still owes a PRE-EXPOSURE measurement.
 *
 * Distinct from firstUnsatisfiedSetupStage because the camera path is a re-initialisation, not a
 * missing prerequisite: when only the camera is owed, the resume may re-enter the condition loop
 * as soon as calibration finishes. When a baseline is missing it may not — it has to walk the rest
 * of the setup chain first, or the sitting loses a measurement that cannot be recovered.
 */
export function resumeOwesBaselines(p: ResumePrerequisites): boolean {
  return !p.hasBaselineCvsq || !p.hasBaselineFatigue;
}
