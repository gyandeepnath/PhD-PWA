/**
 * WHAT THE EYE SAW JUST BEFORE THE GREY FIELD (Round 92, audit 86 P8).
 *
 * The grey field before each display lasts at most 60 s, or 120 s "when polarity switches" (config.ts
 * ADAPTATION_SAME_POLARITY_MS, ADAPTATION_SWITCH_POLARITY_MS), and a run's polarity_switched (analysis_long)
 * says whether the run before it, in the same sitting, had the other polarity. Both are keyed to the
 * previous DISPLAY. But a grey field does not always follow a display: after every second display there is
 * a break, a light (cream) screen the participant may sit at for minutes, and the first field of a sitting
 * follows the light set-up screens, as a resumed sitting's does. There the eye comes to the field
 * light-adapted whatever the previous display was. So a dark display after a break that followed a dark one
 * gets the 60 s maximum and polarity_switched FALSE, although the eye steps from light to dark; a light
 * display after a break that followed a dark one gets 120 s and TRUE, although it steps from light to light.
 * Over the ten Williams rows that is 20 of the 40 post-break fields (8 and 12), and the 5 rows that open on a
 * dark display (60 s, flag blank).
 *
 * Which rule is right is the investigator's decision. docs/ANALYSIS_PLAN.md defines polarity_switched as a
 * first-order CARRYOVER code — the previous run's polarity, the crossover design's "previous treatment" —
 * and for that purpose the present rule is correct; PROTOCOL.md's "120 s when polarity switches" does not
 * say which reference it means. So the behaviour is unchanged, and what was not recorded now is: which
 * screen the grey field followed. With it, an analyst can apply either rule to the data (an adaptation-state
 * switch is "followed a light screen and the display is dark", or polarity_switched where it followed a
 * display), and the investigator can change the field's maximum later knowing what it changes.
 */

import { CONFIG } from './config';
import type { Polarity } from './conditions';

/**
 * The grey field's maximum, as it has been since the field became participant-paced (Round 57): 120 s
 * when the next display's polarity differs from the PREVIOUS DISPLAY's, 60 s otherwise and before the
 * first display. Unchanged by Round 92; here so the rule the screen runs is the rule the tests walk.
 */
export function greyFieldMaximum(previous: Polarity | undefined, next: Polarity | undefined): { switched: boolean; maxMs: number } {
  const switched = previous != null && next != null && previous !== next;
  return { switched, maxMs: switched ? CONFIG.ADAPTATION_SWITCH_POLARITY_MS : CONFIG.ADAPTATION_SAME_POLARITY_MS };
}

/** The screen in front of the participant immediately before a grey field. */
export type AdaptationPrecededBy = 'reaction_task' | 'break' | 'setup_or_resume';

/**
 * From the stage shown before the ADAPTATION stage: the previous display's reaction task (its own
 * background), the break (a light screen), or anything else — a set-up screen, a resume's re-calibration
 * or launch check, or nothing at all in this run of the app (a resume that opened on the field) — which are
 * light screens too.
 */
export function adaptationPrecededBy(stageBefore: string | null): AdaptationPrecededBy {
  if (stageBefore === 'REACTION_TIME') return 'reaction_task';
  if (stageBefore === 'BREAK_SCREEN') return 'break';
  return 'setup_or_resume';
}
