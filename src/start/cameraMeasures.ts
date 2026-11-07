/**
 * What the camera measures, in the participant's words: ONE source for the consent screen, its camera
 * option, the camera set-up's privacy box and the manual's spoken script (audit 86 UI-5).
 *
 * The three described different things. The consent said the camera computes "how often you blink,
 * how fully your eyelids close, head position", and its option read "Use the camera for blink and
 * head-position measures"; the privacy box on the next camera screen said "blink rate, head position
 * and gaze zone"; and the calibration asks the participant to look at three dots, a gaze check, while
 * 07_eye_metrics exports on_screen_ratio from the iris position. The gaze estimate was named on two
 * screens and missing from the consent. "Gaze zone" was itself out of date: the zones went with rule
 * gaze-r1 (Round 80); what is estimated now is whether the eyes are on the screen.
 *
 * NOTHING COLLECTED CHANGES HERE: the same numbers are computed and kept. Only the description is made
 * one, and complete. Because the consent text is ethics-approved, the investigator checks this wording
 * against the approved consent (AUDIT_FINDINGS Round 90); if the approved text cannot name the gaze
 * estimate, the alternative is to stop deriving and exporting it, which is a change to what is
 * collected and the investigator's decision, not the app's.
 */

/** Each family of measure the camera produces, as the participant is told it, and where it is exported. */
export const CAMERA_MEASURES = [
  { family: 'blink', words: 'how often you blink', short: 'blink', exported: ['blink_rate'] },
  { family: 'lid closure', words: 'how fully your eyelids close', short: 'eyelid', exported: ['incomplete_blink_ratio', 'perclos_p80'] },
  { family: 'head position', words: 'your head position', short: 'head-position', exported: ['head_pitch_mean'] },
  { family: 'gaze', words: 'roughly whether you are looking at the screen', short: 'gaze', exported: ['on_screen_ratio'] },
] as const;

/** "a, b, c and d". */
const list = (xs: readonly string[]) => `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** "how often you blink, how fully your eyelids close, your head position and roughly whether you are looking at the screen". */
export const CAMERA_MEASURES_TEXT = list(CAMERA_MEASURES.map((m) => m.words));

/** The consent option's title: "Use the camera for blink, eyelid, head-position and gaze measures". */
export const CAMERA_OPTION_TITLE = `Use the camera for ${list(CAMERA_MEASURES.map((m) => m.short))} measures`;
