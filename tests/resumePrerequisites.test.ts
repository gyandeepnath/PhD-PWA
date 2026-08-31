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
import { firstUnsatisfiedSetupStage, SETUP_ORDER, type ResumePrerequisites } from '@/experiment/stateMachine';

const complete: ResumePrerequisites = {
  consentGiven: true,
  hasParticipantRecord: true,
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
    ['hasParticipantRecord', 'PARTICIPANT_PROFILE'],
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
      consentGiven: false, hasParticipantRecord: false, preflightComplete: false,
      colourVisionScreened: false, hasBaselineCvsq: false, hasBaselineFatigue: false,
      wantsCamera: true,
    };
    expect(firstUnsatisfiedSetupStage(nothing)).toBe('CONSENT');

    // And each stage it returns is a real member of the setup chain.
    for (const k of ['consentGiven', 'hasParticipantRecord', 'preflightComplete',
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
