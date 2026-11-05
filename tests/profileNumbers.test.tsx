/**
 * The profile's typed numbers are numbers, in range, or the form says why it will not go on
 * (audit 86 UI-8, M4).
 *
 * "Daily screen hours" was checked only for being non-empty and "Hours since you woke up today" only
 * for Number(text) being finite, and both were stored as Number(text): "abc" was stored as NaN, a
 * single space as 0 (Number(' ') === 0), and 60 daily screen hours or 30 hours awake as typed. Daily
 * screen hours is a pre-specified moderator in both analysis templates. The session form's lux had the
 * same hole: a space was a reading of 0 lux. Rendered for real in jsdom.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { ParticipantProfile, type ProfileData } from '@/start/setupStages';
import { parseNumberEntry, HOURS_IN_DAY } from '@/lib/numberEntry';
import { parseLuxEntry } from '@/experiment/illumination';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const readSource = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

function mount() {
  const submitted: ProfileData[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => { root.render(createElement(ParticipantProfile, { onSubmit: (d) => { submitted.push(d); } })); });
  const q = (id: string) => host.querySelector(`[data-testid=${id}]`) as HTMLInputElement;
  const type = (id: string, v: string) => act(() => {
    const el = q(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const pick = (label: string) => act(() => {
    const b = Array.from(host.querySelectorAll('button')).find((x) => x.textContent === label)!;
    b.click();
  });
  const cont = () => Array.from(host.querySelectorAll('button')).find((x) => /^Continue/.test(x.textContent ?? ''))!;
  // Everything but the two hour fields, answered.
  type('age', '24');
  for (const label of ['female', 'moderate', 'bright', 'none', 'normal']) pick(label);
  // The two no/yes groups: the self-report, then caffeine.
  const noButtons = () => Array.from(host.querySelectorAll('button')).filter((x) => x.textContent === 'no');
  act(() => { noButtons()[0].click(); });
  act(() => { noButtons()[1].click(); });
  return { submitted, q, type, cont, text: () => host.textContent ?? '' };
}

describe('the profile\'s hour fields', () => {
  it('accept a number of hours from 0 to 24, decimals included, and store the number', () => {
    const m = mount();
    m.type('hours', '6.5');
    m.type('since-sleep', ' 3 ');
    expect(m.cont().disabled).toBe(false);
    act(() => { m.cont().click(); });
    expect(m.submitted).toHaveLength(1);
    expect(m.submitted[0].dailyScreenHours).toBe(6.5);
    expect(m.submitted[0].hoursSinceSleep).toBe(3);
  });

  for (const [field, other] of [['hours', 'since-sleep'], ['since-sleep', 'hours']] as const) {
    it(`refuse text, a space, a range and an impossible number in ${field}, and say why under it`, () => {
      const m = mount();
      m.type(other, '4');
      for (const bad of ['abc', ' ', '6-8', '25', '60', '-1', '1e1', '0x4']) {
        m.type(field, bad);
        expect(m.cont().disabled, `${field}="${bad}"`).toBe(true);
        if (bad.trim() !== '') expect(m.q(`${field}-problem`)?.textContent ?? '', `${field}="${bad}"`).toMatch(/from 0 to 24/);
      }
      m.type(field, '24');
      expect(m.cont().disabled).toBe(false);
      expect(m.q(`${field}-problem`)).toBeNull();
      m.type(field, '0');
      expect(m.cont().disabled).toBe(false);
    });
  }

  it('say nothing under an empty field: empty is not yet answered, not wrong', () => {
    const m = mount();
    expect(m.q('hours-problem')).toBeNull();
    expect(m.q('since-sleep-problem')).toBeNull();
    expect(m.cont().disabled).toBe(true);
  });
});

describe('one rule for a typed number', () => {
  it('digits with one decimal point or comma, spaces ignored, inside the range', () => {
    expect(parseNumberEntry('6', HOURS_IN_DAY.min, HOURS_IN_DAY.max)).toBe(6);
    expect(parseNumberEntry(' 6,5 ', 0, 24)).toBe(6.5);
    expect(parseNumberEntry('24', 0, 24)).toBe(24);
    for (const bad of ['', ' ', 'abc', '6-8', '24.5', '-0.5', '1e1', '0x4', '6..5', '.5', 'Infinity']) {
      expect(parseNumberEntry(bad, 0, 24), bad).toBeNull();
    }
  });

  it('the lux entry is the same rule: a space is not 0 lux', () => {
    expect(parseLuxEntry(' ')).toBeNull();
    expect(parseLuxEntry('1e3')).toBeNull();
    expect(parseLuxEntry('300')).toBe(300);
    expect(parseLuxEntry('300,5')).toBe(300.5);
  });

  it('the session form reads its lux through it, and the profile its three numbers', () => {
    // A source check: the forms used Number(text) and `text !== ''`, which is how a space became 0.
    const src = readSource('src/start/setupStages.tsx');
    expect(src).not.toMatch(/Number\(lux\)/);
    expect(src).not.toMatch(/Number\(hours\)|Number\(sinceSleep\)|Number\(age\)/);
    expect(src).toMatch(/parseLuxEntry\(lux\)/);
  });
});
