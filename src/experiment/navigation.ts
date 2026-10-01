/**
 * Where an operator may go BACK, and where they may leave, stage by stage.
 *
 * WHY A TABLE. Setup had no Back, no Cancel and no way out at all: SESSION_INIT could not be cancelled
 * although nothing had been written, a mistyped profile could not be corrected, and CameraDeclined's
 * own header said a change to the camera grant "means going back to consent" while no route there
 * existed. Stopping during setup meant closing the app. Adding controls one screen at a time is how a
 * Back ends up on a colour-vision plate, so the policy is written down here, in one place, and
 * tests/navigation.test.ts holds every stage to it.
 *
 * WHERE BACK MAY EXIST — to correct the screen before, when nothing measured lies between:
 *   - PARTICIPANT_PROFILE → CONSENT (to change a grant before anything uses it)
 *   - PREFLIGHT → PARTICIPANT_PROFILE (to correct a mistyped profile; the profile write is replaced)
 *   - CAMERA_SETUP, and CameraDeclined which stands in for it → CONSENT, to change the camera grant.
 *     Consent is rewritten and the superseded record kept (consent_revisions), and the walk returns
 *     straight to the camera screen: the profile, pre-flight and colour-vision plates in between are
 *     not repeated.
 *
 * WHERE BACK MUST NOT EXIST, and why:
 *   - the colour-vision plates: a second look turns detection into recall;
 *   - calibration and the camera self-test: they are restarted, not revisited;
 *   - everything inside a condition, from the grey field to the last reaction trial: a previous page
 *     changes the reading exposure the blink window measures, going back from the questions to the
 *     passage makes comprehension open-book, and the ratings are immediate post-exposure judgements;
 *   - a questionnaire after it is submitted (baseline CVS-Q, baseline fatigue, closing CVS-Q,
 *     NASA-TLX): a second answer after seeing later screens is a different measurement;
 *   - the break and the thank-you screen.
 * Pause-and-resume, which restarts the condition, remains the only backward route inside the loop.
 *
 * LEAVING. SESSION_INIT has Cancel: nothing is written until "Begin setup". Every other setup screen,
 * the break, a resume's launch check and the two closing questionnaires have "Exit — resume later", which returns to the
 * session manager and leaves the sitting resumable; the resume re-enters at the first screen whose
 * product is missing (Experiment.tsx). Inside the loop the existing Pause does the same. The
 * thank-you screen and the dashboard have neither: the sitting is complete.
 */
import type { Stage } from '@/storage/types';
import { isInLoop, SETUP_ORDER } from './stateMachine';

/** The stage a Back control on `stage` returns to, or null where the policy above forbids one. */
export function backTarget(stage: Stage): Stage | null {
  switch (stage) {
    case 'PARTICIPANT_PROFILE': return 'CONSENT';
    case 'PREFLIGHT': return 'PARTICIPANT_PROFILE';
    case 'CAMERA_SETUP': return 'CONSENT';
    default: return null;
  }
}

/** What the operator chip on `stage` does. */
export type OperatorExit =
  /** SESSION_INIT: back to the session manager; nothing has been written. */
  | 'cancel'
  /** Setup, the break and the closing questionnaires: to the manager, resumable. */
  | 'exit'
  /** Inside a condition: the existing Pause, drawn in the condition's ink. */
  | 'pause'
  | null;

export function operatorExitFor(stage: Stage): OperatorExit {
  if (stage === 'SESSION_INIT') return 'cancel';
  if (isInLoop(stage)) return 'pause';
  if (SETUP_ORDER.includes(stage)) return 'exit';
  // The launch check exists to offer this way out: exit, relaunch from the home-screen icon, resume.
  if (stage === 'BREAK_SCREEN' || stage === 'LAUNCH_CHECK' || stage === 'CVSQ_END' || stage === 'NASA_TLX') return 'exit';
  return null;
}

/** The Back control's label: where it goes, as an action. */
export const BACK_LABEL: Partial<Record<Stage, string>> = {
  CONSENT: '← Back to consent',
  PARTICIPANT_PROFILE: '← Back to the profile',
};

/** The operator chip's label for each kind of exit. */
export const EXIT_LABEL: Record<Exclude<OperatorExit, null>, string> = {
  cancel: '← Cancel — back to sessions',
  exit: 'Exit — resume later',
  pause: 'Pause',
};
