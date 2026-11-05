/**
 * The formal colour-vision plates are recorded where the app asks for them (audit 86 UI-7).
 *
 * When the app's own colour screen did not pass, its notice told the operator to administer the formal
 * plates "now, while the participant is here, and record the result on the profile form" — with
 * "Recorded — continue" as its only button. The profile comes BEFORE the colour screen and nothing in
 * the sitting returns to it, so the result could not be entered: a participant whose plates showed a
 * deficiency kept the profile's 'not done' and stayed eligible=TRUE. The notice now asks for the result
 * itself, and both screens record it through one rule, eligibility.ts recordFormalPlates.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { recordFormalPlates, mergeExclusionReasons, FORMAL_PLATES_REASON, splitExclusionReasons } from '@/experiment/eligibility';
import { OperatorNotice } from '@/screening/IshiharaTest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AGE = 'age 36 outside the 18–35 inclusion range';
const CONTACTS = 'contact-lens wear on a test day is an exclusion';
const SELF = 'self-reported colour-vision deficiency';

describe('one rule for the formal plate result', () => {
  it('records the answer, and a deficient result excludes', () => {
    expect(recordFormalPlates(undefined, 'normal', null)).toEqual({ cvd_clinical: 'normal', eligible: true, exclusion_reason: null });
    expect(recordFormalPlates('not_done', 'deficient', null))
      .toEqual({ cvd_clinical: 'deficient', eligible: false, exclusion_reason: FORMAL_PLATES_REASON });
  });

  it('keeps a deficient result from an earlier sitting, reason and all', () => {
    // It kept cvd_clinical='deficient' but dropped the reason, so the row read deficient AND eligible.
    const r = recordFormalPlates('deficient', 'normal', FORMAL_PLATES_REASON);
    expect(r.cvd_clinical).toBe('deficient');
    expect(r.eligible).toBe(false);
    expect(r.exclusion_reason).toBe(FORMAL_PLATES_REASON);
  });

  it('never lets not done overwrite a real result', () => {
    expect(recordFormalPlates('normal', 'not_done', null).cvd_clinical).toBe('normal');
    expect(recordFormalPlates(undefined, 'not_done', null).cvd_clinical).toBe('not_done');
    expect(recordFormalPlates(null, 'not_done', null)).toEqual({ cvd_clinical: 'not_done', eligible: true, exclusion_reason: null });
  });

  it('a later answer in the same sitting replaces an earlier one (merged against the row before the sitting)', () => {
    // The profile said 'deficient' by mistake; the notice says 'normal'. Against the pre-sitting row the
    // correction stands, and the reason the profile wrote goes with it.
    const r = recordFormalPlates(undefined, 'normal', FORMAL_PLATES_REASON);
    expect(r).toEqual({ cvd_clinical: 'normal', eligible: true, exclusion_reason: null });
  });

  it('touches no other writer’s reasons', () => {
    const r = recordFormalPlates('not_done', 'deficient', `${AGE}; ${SELF}`);
    expect(splitExclusionReasons(r.exclusion_reason)).toEqual([AGE, SELF, FORMAL_PLATES_REASON]);
    const cleared = recordFormalPlates(undefined, 'normal', `${AGE}; ${FORMAL_PLATES_REASON}; ${CONTACTS}`);
    expect(splitExclusionReasons(cleared.exclusion_reason)).toEqual([AGE, CONTACTS]);
    expect(cleared.eligible).toBe(false);
  });

  it('the profile no longer owns the formal-plates reason, so its merge cannot strip one the notice wrote', () => {
    // The notice writes after the profile; a sitting-2 profile with clean answers must not erase it
    // except through recordFormalPlates, which decides from the stored result.
    expect(mergeExclusionReasons(FORMAL_PLATES_REASON, 'profile', []).exclusion_reason).toBe(FORMAL_PLATES_REASON);
    expect(mergeExclusionReasons(FORMAL_PLATES_REASON, 'formal_plates', []).exclusion_reason).toBeNull();
  });

  it('both screens record it through that rule', () => {
    const src = readFileSync('src/experiment/Experiment.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src.match(/recordFormalPlates\(/g) ?? [], 'the profile and the notice').toHaveLength(2);
    expect(src).toMatch(/cvd_clinical: plates\.cvd_clinical,[\s\S]*?cvd_clinical: plates\.cvd_clinical,/);
    expect(src).toMatch(/onFormalPlates=\{latched\('formal-plates', saveFormalPlates\)\}/);
  });
});

function mount(props: Partial<Parameters<typeof OperatorNotice>[0]> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onDone = vi.fn();
  const onFormalPlates = vi.fn(async () => {});
  act(() => {
    root.render(createElement(OperatorNotice, { status: 'screen_failed', onDone, onFormalPlates, onProfile: 'not_done', ...props }));
  });
  const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
  return { host, q, onDone, onFormalPlates, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('the colour-screen notice records the formal plates itself', () => {
  it('no longer sends the operator to the profile form', () => {
    const m = mount();
    expect(m.host.textContent).not.toMatch(/on the profile form as normal or deficient/);
    expect(m.host.textContent).toMatch(/record the result below/);
    // What the profile holds is said beside the choice.
    expect(m.host.textContent).toMatch(/on the profile form: not done/);
    m.unmount();
  });

  it('moves on only after a result is chosen, and records that result first', async () => {
    const m = mount();
    const go = m.q('formal-plates-record');
    expect(go.disabled, 'continuing must be a statement about the plates, not a tap past a default').toBe(true);
    expect(m.q('formal-plates-deficient').getAttribute('aria-pressed')).toBe('false');
    act(() => { go.click(); });
    expect(m.onFormalPlates).not.toHaveBeenCalled();
    act(() => { m.q('formal-plates-deficient').click(); });
    expect(m.q('formal-plates-deficient').getAttribute('aria-pressed')).toBe('true');
    expect(go.disabled).toBe(false);
    await act(async () => { go.click(); });
    expect(m.onFormalPlates).toHaveBeenCalledWith('deficient');
    expect(m.onDone).toHaveBeenCalledTimes(1);
    expect(m.onFormalPlates.mock.invocationCallOrder[0]).toBeLessThan(m.onDone.mock.invocationCallOrder[0]);
    m.unmount();
  });

  it('a failed save keeps the notice up and says so', async () => {
    const m = mount({ onFormalPlates: vi.fn(async () => { throw new Error('QuotaExceededError'); }) });
    act(() => { m.q('formal-plates-not_done').click(); });
    await act(async () => { m.q('formal-plates-record').click(); });
    expect(m.onDone).not.toHaveBeenCalled();
    expect(m.host.textContent).toMatch(/was not saved/);
    expect(m.q('formal-plates-record').disabled).toBe(false);
    m.unmount();
  });
});
