/**
 * An exclusion recorded by one stage must survive the other.
 *
 * `eligible` and `exclusion_reason` are written from two places, and the participant record is
 * created once and SHARED across a participant's sittings. The colour-vision stage was careful —
 * it read the prior reasons, stripped only its own, and set `eligible: p.eligible && !fails`. The
 * profile stage was not: it wrote a verdict computed from this sitting's answers over whatever was
 * there.
 *
 * So for a participant excluded at sitting 1 by the Ishihara screen — which the profile stage knows
 * nothing about, since it asks only about self-report and formal plates — sitting 2's profile stage
 * produced an empty reasons array, set eligible = true, and erased the exclusion. In the ordinary
 * flow the colour-vision stage restores it a few screens later. The window is the finding: a sitting
 * abandoned between the two, which is exactly what a participant withdrawing during setup produces,
 * leaves eligible = TRUE with no reason, permanently — and the codebook tells the analyst to drop
 * rows where eligible is false, so that participant re-enters the confirmatory analysis of a
 * text-colour factor they cannot perceive normally.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeExclusionReasons, splitExclusionReasons } from '@/experiment/eligibility';

const SCREEN_FAILED = 'failed the colour-vision screening';
const AGE = 'age 36 outside the 18–35 inclusion range';
const CONTACTS = 'contact-lens wear on a test day is an exclusion';

describe('a clean participant', () => {
  it('is eligible with no reason recorded', () => {
    expect(mergeExclusionReasons(null, 'profile', [])).toEqual({ eligible: true, exclusion_reason: null });
  });
});

describe('the profile stage cannot erase the colour-vision stage', () => {
  it('KEEPS a screen failure when this sitting finds nothing wrong', () => {
    // The exact path: sitting 1 failed the plates, sitting 2's profile answers are all clean.
    const v = mergeExclusionReasons(SCREEN_FAILED, 'profile', []);
    expect(v.eligible, 'an excluded participant was re-admitted').toBe(false);
    expect(v.exclusion_reason).toBe(SCREEN_FAILED);
  });

  it('adds its own reason alongside, rather than replacing', () => {
    const v = mergeExclusionReasons(SCREEN_FAILED, 'profile', [AGE]);
    expect(v.eligible).toBe(false);
    expect(splitExclusionReasons(v.exclusion_reason)).toEqual([SCREEN_FAILED, AGE]);
  });

  it('drops its OWN reason when this sitting no longer finds it', () => {
    // A participant who wore contacts to sitting 1 and glasses to sitting 2 is recorded as they
    // presented. Removing a reason it owns is correct; removing another stage's is not.
    const v = mergeExclusionReasons(`${SCREEN_FAILED}; ${CONTACTS}`, 'profile', []);
    expect(splitExclusionReasons(v.exclusion_reason)).toEqual([SCREEN_FAILED]);
    expect(v.eligible).toBe(false);
  });
});

describe('the colour-vision stage cannot erase the profile stage', () => {
  it('keeps an age exclusion when the plates are passed', () => {
    const v = mergeExclusionReasons(AGE, 'colour_vision', []);
    expect(v.eligible).toBe(false);
    expect(v.exclusion_reason).toBe(AGE);
  });

  it('clears its own verdict on a pass, leaving the rest', () => {
    const v = mergeExclusionReasons(`${AGE}; ${SCREEN_FAILED}`, 'colour_vision', []);
    expect(splitExclusionReasons(v.exclusion_reason)).toEqual([AGE]);
  });

  it('makes a participant eligible again only when NOTHING is left', () => {
    const v = mergeExclusionReasons(SCREEN_FAILED, 'colour_vision', []);
    expect(v).toEqual({ eligible: true, exclusion_reason: null });
  });
});

describe('repeated writes are idempotent', () => {
  it('does not accumulate duplicates when a stage re-runs with the same verdict', () => {
    let stored: string | null = null;
    for (let sitting = 0; sitting < 3; sitting++) {
      stored = mergeExclusionReasons(stored, 'profile', [AGE]).exclusion_reason;
      stored = mergeExclusionReasons(stored, 'colour_vision', [SCREEN_FAILED]).exclusion_reason;
    }
    expect(splitExclusionReasons(stored)).toEqual([AGE, SCREEN_FAILED]);
  });
});

describe('every reason a stage can emit, it can also recognise', () => {
  /*
   * A reason a stage emits but cannot match would be duplicated on every re-run; one it matches but
   * cannot emit would be silently dropped by the other stage. The ownership table and the strings
   * that produce them live in different files, so this is the thing that keeps them in step.
   */
  const experimentRaw = readFileSync('src/experiment/Experiment.tsx', 'utf8');
  /*
   * Comments stripped. The file now DISCUSSES the removed hand-rolled merge at length, and a naive
   * match is satisfied by the explanation of the very thing it is checking is gone — the same trap
   * tests/updateGate.test.ts documents for swUpdate.
   */
  const experiment = experimentRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the profile stage’s reasons are recognised as its own', () => {
    for (const reason of [AGE, CONTACTS, 'colour-vision deficiency on formal plates']) {
      expect(mergeExclusionReasons(reason, 'profile', []).exclusion_reason, reason).toBeNull();
    }
  });

  it('the colour-vision stage’s reasons are recognised as its own', () => {
    for (const reason of [SCREEN_FAILED, 'self-reported colour-vision deficiency']) {
      expect(mergeExclusionReasons(reason, 'colour_vision', []).exclusion_reason, reason).toBeNull();
    }
  });

  it('neither stage claims the other’s', () => {
    expect(mergeExclusionReasons(SCREEN_FAILED, 'profile', []).exclusion_reason).toBe(SCREEN_FAILED);
    expect(mergeExclusionReasons(AGE, 'colour_vision', []).exclusion_reason).toBe(AGE);
  });

  it('both writers go through the merge, and both WRITE what it returned', () => {
    // Calling the merge is not the same as using it. The first version of this test checked only
    // that the call existed, and a mutation that kept the call while writing a locally recomputed
    // verdict passed — which is precisely the shape of the original defect.
    expect(experiment.match(/mergeExclusionReasons\(/g) ?? []).toHaveLength(2);
    const written = experiment.match(/eligible: verdict\.eligible,\n\s+exclusion_reason: verdict\.exclusion_reason,/g) ?? [];
    expect(written, 'a writer computes its own verdict instead of writing the merged one').toHaveLength(2);
    // And no writer joins or splits reason strings on its own any more.
    expect(experiment).not.toMatch(/exclusion_reason: reasons/);
    expect(experiment).not.toMatch(/reasons\.join\(/);
    expect(experiment).not.toMatch(/priorReasons/);
  });

  it('the profile stage no longer asserts a colour-vision reason of its own', () => {
    // Ownership is disjoint: two stages asserting the same reason would each strip and re-add the
    // other's. The self-report is recorded into the sticky cvd_status and asserted downstream.
    const profile = experiment.slice(experiment.indexOf('const reasons: string[] = []'), experiment.indexOf('const prior = await get('));
    expect(profile).not.toMatch(/self-reported colour-vision deficiency/);
  });
});
