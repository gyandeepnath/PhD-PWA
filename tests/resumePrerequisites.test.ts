/**
 * What a resumed session still owes before it may re-enter the condition loop.
 *
 * This is the failure the per-session resume pointer created. Making every in-progress session
 * resumable was necessary — with one global pointer, starting a second participant stranded the
 * first — but it also meant a session interrupted anywhere in the ten-stage setup chain was offered
 * as "Resume (next condition 1/10)", and tapping it dropped the participant straight into the
 * reading task.
 *
 * Everything setup establishes was then silently absent: no consent record, no participant row (so
 * age, correction, colour vision, eligibility and exclusion_reason are permanently unrecoverable),
 * no pre-flight, no calibration, and neither baseline instrument — so the CVS-Q change score, the
 * key secondary outcome, cannot be computed at all. The sitting still ran ten conditions, so
 * `session_complete` came out TRUE and the codebook's own filter admitted the row.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  firstUnsatisfiedSetupStage, SETUP_ORDER, setupStagesHeld, sittingColourVisionScreened, sittingProfileComplete,
  type ResumePrerequisites,
} from '@/experiment/stateMachine';

const complete: ResumePrerequisites = {
  consentGiven: true,
  profileComplete: true,
  preflightComplete: true,
  colourVisionScreened: true,
  hasBaselineCvsq: true,
  hasBaselineFatigue: true,
  wantsCamera: false,
};

describe('a resume re-enters setup at the first thing that is missing', () => {
  it('lets a fully-set-up session go straight back to the loop', () => {
    expect(firstUnsatisfiedSetupStage(complete)).toBeNull();
  });

  it.each([
    ['consentGiven', 'CONSENT'],
    ['profileComplete', 'PARTICIPANT_PROFILE'],
    ['preflightComplete', 'PREFLIGHT'],
    ['colourVisionScreened', 'COLOR_VISION'],
    ['hasBaselineCvsq', 'CVSQ_BASELINE'],
    ['hasBaselineFatigue', 'BASELINE_FATIGUE'],
  ] as const)('sends a session missing %s back to %s', (missing, stage) => {
    expect(firstUnsatisfiedSetupStage({ ...complete, [missing]: false })).toBe(stage);
  });

  it('returns them in protocol order, not in the order they happen to be checked', () => {
    // A session interrupted at the very start is missing everything; it must be sent to the
    // EARLIEST unsatisfied stage, because the later ones depend on it.
    const nothing: ResumePrerequisites = {
      consentGiven: false, profileComplete: false, preflightComplete: false,
      colourVisionScreened: false, hasBaselineCvsq: false, hasBaselineFatigue: false,
      wantsCamera: true,
    };
    expect(firstUnsatisfiedSetupStage(nothing)).toBe('CONSENT');

    // And each stage it returns is a real member of the setup chain.
    for (const k of ['consentGiven', 'profileComplete', 'preflightComplete',
      'colourVisionScreened', 'hasBaselineCvsq', 'hasBaselineFatigue'] as const) {
      const s = firstUnsatisfiedSetupStage({ ...complete, [k]: false });
      expect(SETUP_ORDER).toContain(s);
    }
  });

  it('always re-runs camera setup when the grant is present, even if setup was complete', () => {
    // Not because it was missed — because the remount cleared the EAR and gaze baselines that every
    // blink threshold is expressed as a fraction of. They cannot be inherited from before the
    // interruption.
    expect(firstUnsatisfiedSetupStage({ ...complete, wantsCamera: true })).toBe('CAMERA_SETUP');
  });

  it('does not send a camera-refusing participant to the camera screen', () => {
    expect(firstUnsatisfiedSetupStage({ ...complete, wantsCamera: false })).toBeNull();
  });

  it('puts consent before anything that records data about the participant', () => {
    // The ordering is the protection: a session that has not consented must never reach a stage
    // that writes measurements.
    const noConsentButOtherwiseReady = { ...complete, consentGiven: false, wantsCamera: true };
    expect(firstUnsatisfiedSetupStage(noConsentButOtherwiseReady)).toBe('CONSENT');
  });
});

/**
 * A resume must never skip a PRE-EXPOSURE measurement.
 *
 * The baseline CVS-Q and the baseline fatigue scale are taken before any condition runs, and they
 * cannot be taken afterwards. `firstUnsatisfiedSetupStage` used to `return 'CAMERA_SETUP'`
 * unconditionally when the camera was consented — which is the ordinary case — making the two
 * checks below it unreachable. A session interrupted after the colour-vision screen and resumed
 * went camera, calibration, then straight into condition 1. Both baselines were never administered,
 * so the CVS-Q change score (the key secondary outcome) and every fatigue_delta were lost for that
 * sitting, and it still exported session_complete=TRUE.
 */
describe('a resumed session still owes its pre-exposure baselines', () => {
  const withCamera: ResumePrerequisites = { ...complete, wantsCamera: true };

  it('reports that baselines are owed even when the camera path comes first', async () => {
    const { resumeOwesBaselines } = await import('@/experiment/stateMachine');
    // The camera re-run is a device re-initialisation, not a missing measurement, so it must not
    // mask a missing one.
    expect(resumeOwesBaselines({ ...withCamera, hasBaselineCvsq: false })).toBe(true);
    expect(resumeOwesBaselines({ ...withCamera, hasBaselineFatigue: false })).toBe(true);
    expect(resumeOwesBaselines(withCamera)).toBe(false);
  });

  it('still sends a camera session to camera setup first, since it comes earlier in the chain', () => {
    // CAMERA_SETUP precedes the baselines in SETUP_ORDER, so it is the correct entry point — the
    // defect was that it also ENDED the walk.
    expect(firstUnsatisfiedSetupStage({ ...withCamera, hasBaselineCvsq: false })).toBe('CAMERA_SETUP');
  });

  it('sends a camera-refusing session straight to the missing baseline', () => {
    expect(firstUnsatisfiedSetupStage({ ...complete, hasBaselineCvsq: false })).toBe('CVSQ_BASELINE');
    expect(firstUnsatisfiedSetupStage({ ...complete, hasBaselineFatigue: false })).toBe('BASELINE_FATIGUE');
  });

  it('owes nothing once both baselines exist and the camera is refused', async () => {
    const { resumeOwesBaselines } = await import('@/experiment/stateMachine');
    expect(firstUnsatisfiedSetupStage(complete)).toBeNull();
    expect(resumeOwesBaselines(complete)).toBe(false);
  });
});

/**
 * The profile and the colour-vision plates are owed PER SITTING.
 *
 * Both used to be read off the participant record, which the first sitting creates and every later
 * sitting shares. In a second sitting (a split, or a new protocol pass) both were therefore
 * "satisfied" before that sitting had shown either: stopped on its profile — one tap on "Exit —
 * resume later" — it resumed straight to pre-flight, and its own caffeine, hours since waking,
 * correction type and colour-vision answers were never recorded (caffeine_today_session and
 * hours_since_sleep_session exported blank). The verdict must come from the sitting itself.
 */
describe('a second sitting owes its own profile and its own colour-vision screen', () => {
  const sittingOneRow = { cvd_screen_total: 6 };

  it('a sitting whose profile has not run is not complete, whatever the participant record holds', () => {
    // Sitting 2, stopped on the profile: the record from sitting 1 exists, this session has no state pair.
    expect(sittingProfileComplete({ caffeine_today: undefined, hours_since_sleep: undefined })).toBe(false);
    expect(sittingProfileComplete({ caffeine_today: null, hours_since_sleep: null })).toBe(false);
    // Both are required answers; one without the other is a write that did not finish.
    expect(sittingProfileComplete({ caffeine_today: false, hours_since_sleep: null })).toBe(false);
    // A real answer, including "no caffeine" and "0 hours", is a completed profile.
    expect(sittingProfileComplete({ caffeine_today: false, hours_since_sleep: 0 })).toBe(true);
  });

  it('so the resume sends that sitting to the profile, not past it', () => {
    const p = { ...complete, profileComplete: sittingProfileComplete({}), wantsCamera: true };
    expect(firstUnsatisfiedSetupStage(p)).toBe('PARTICIPANT_PROFILE');
  });

  it('the plates are judged by the sitting\'s own flag, not by an earlier sitting\'s counts', () => {
    expect(sittingColourVisionScreened({ colour_vision_screened: false }, sittingOneRow)).toBe(false);
    expect(sittingColourVisionScreened({ colour_vision_screened: true }, sittingOneRow)).toBe(true);
    expect(sittingColourVisionScreened({ colour_vision_screened: true }, undefined)).toBe(true);
    // A sitting started before the flag existed is resumed as it was then, from the record.
    expect(sittingColourVisionScreened({}, sittingOneRow)).toBe(true);
    expect(sittingColourVisionScreened({}, { cvd_screen_total: null })).toBe(false);
  });

  it('a walk that passes the plates steps over them when this sitting already has them', () => {
    // Shown twice in one sitting they are the same seeded plates: the second look is a memory test.
    const held = setupStagesHeld({ ...complete, profileComplete: false, colourVisionScreened: true });
    expect(held.has('COLOR_VISION')).toBe(true);
    expect(setupStagesHeld({ ...complete, colourVisionScreened: false }).has('COLOR_VISION')).toBe(false);
  });

  it('the app reads both from the sitting, and every new sitting starts unscreened', () => {
    const src = readFileSync('src/experiment/Experiment.tsx', 'utf8');
    expect(src).toMatch(/profileComplete: sittingProfileComplete\(s\)/);
    expect(src).toMatch(/colourVisionScreened: sittingColourVisionScreened\(s, participantRow\)/);
    expect(src).toMatch(/colour_vision_screened: false,/);
    expect(src).toMatch(/colour_vision_screened: true \}/);
    // The shared record is no longer what the profile check reads.
    expect(src).not.toMatch(/!!participantRow/);
  });
});
