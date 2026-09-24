import { describe, it, expect } from 'vitest';
import { fixationInkFor } from '@/tasks/ReactionTimeTask';
import { readFileSync } from 'node:fs';
import { wcagContrastRatio, michelsonContrast, relativeLuminance, wcagLevel } from '@/lib/contrast';
import { CONDITIONS, conditionDefinitionHash, rtStimulusColours } from '@/experiment/conditions';

describe('WCAG relative luminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
  });
});

describe('WCAG contrast ratio', () => {
  it('black/white is 21:1', () => {
    expect(wcagContrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
  });

  // Synopsis Table 3.4 — the audit values that justify treating contrast as a covariate.
  const expected: Record<string, number> = {
    P1: 21.0, P2: 6.7, P3: 5.74, P4: 2.39, P5: 3.19,
    N1: 21.0, N2: 3.14, N3: 3.66, N4: 8.79, N5: 6.57,
  };

  for (const c of CONDITIONS) {
    it(`${c.label} contrast ratio ~= ${expected[c.label]}:1`, () => {
      expect(c.wcag_contrast_ratio).toBeCloseTo(expected[c.label], 1);
    });
  }

  it('flags P4 (yellow-on-white) as below WCAG AA', () => {
    const p4 = CONDITIONS.find((c) => c.label === 'P4')!;
    expect(p4.below_wcag_aa).toBe(true);
    expect(p4.wcag_level).toBe('Fail');
  });

  it('balances sub-AA conditions two per polarity (this is why green was added)', () => {
    const below = CONDITIONS.filter((c) => c.below_wcag_aa);
    expect(below.map((c) => c.label).sort()).toEqual(['N2', 'N3', 'P4', 'P5']);
    expect(below.filter((c) => c.polarity === 'positive')).toHaveLength(2);
    expect(below.filter((c) => c.polarity === 'negative')).toHaveLength(2);
  });

  it('holds the achromatic pair at 21:1 in BOTH polarities (the contrast-matched anchor)', () => {
    const ach = CONDITIONS.filter((c) => c.colorName === 'achromatic');
    expect(ach).toHaveLength(2);
    expect(ach.map((c) => c.polarity).sort()).toEqual(['negative', 'positive']);
    for (const c of ach) expect(c.wcag_contrast_ratio).toBeCloseTo(21.0, 1);
  });

  it('reverses the chromatic contrast ordering between polarities (rho = -1, arithmetic)', () => {
    const rank = (pol: string) =>
      CONDITIONS.filter((c) => c.polarity === pol && c.colorName !== 'achromatic')
        .sort((a, b) => a.wcag_contrast_ratio - b.wcag_contrast_ratio)
        .map((c) => c.colorName);
    expect(rank('positive')).toEqual([...rank('negative')].reverse());
  });

  /**
   * The one design claim in conditions.ts that was NOT pinned, and the one it has already been
   * wrong about: the docstring used to read "+0.11" without stating the polarity coding, so the
   * sign could not be checked against it. The figure is the argument that polarity and luminance
   * contrast can enter the same model without collinearity — if a hex value or the colour set ever
   * changes, this is the number that has to be recomputed, and a prose figure will not notice.
   */
  it('keeps polarity very nearly uncorrelated with log contrast (r = -0.113, positive coded 1)', () => {
    const x = CONDITIONS.map((c) => (c.polarity === 'positive' ? 1 : 0));
    const y = CONDITIONS.map((c) => Math.log(c.wcag_contrast_ratio));
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const sd = (a: number[], m: number) => Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
    const mx = mean(x);
    const my = mean(y);
    const r = mean(x.map((v, i) => (v - mx) * (y[i] - my))) / (sd(x, mx) * sd(y, my));
    expect(r).toBeCloseTo(-0.113, 3);
    // The claim the design rests on is not the exact value but that it is near zero.
    expect(Math.abs(r)).toBeLessThan(0.2);
  });

  it('exposes the same five colour levels in both polarities (factorial crossing)', () => {
    const lv = (pol: string) => CONDITIONS.filter((c) => c.polarity === pol).map((c) => c.colorName).sort();
    expect(lv('positive')).toEqual(lv('negative'));
    expect(new Set(lv('positive')).size).toBe(5);
  });

  it('saturates Michelson contrast at 1.000 under negative polarity (metric is uninformative there)', () => {
    const neg = CONDITIONS.filter((c) => c.polarity === 'negative');
    for (const c of neg) expect(c.michelson_contrast).toBeCloseTo(1.0, 3);
  });
});

describe('Michelson contrast', () => {
  it('is 1 for black/white and in [0,1] for all conditions', () => {
    expect(michelsonContrast('#000000', '#FFFFFF')).toBeCloseTo(1, 6);
    for (const c of CONDITIONS) {
      expect(c.michelson_contrast).toBeGreaterThanOrEqual(0);
      expect(c.michelson_contrast).toBeLessThanOrEqual(1);
    }
  });
});

describe('wcagLevel banding', () => {
  it('bands correctly', () => {
    expect(wcagLevel(21)).toBe('AAA');
    expect(wcagLevel(7)).toBe('AAA');
    expect(wcagLevel(4.5)).toBe('AA');
    expect(wcagLevel(3)).toBe('AA Large');
    expect(wcagLevel(2.39)).toBe('Fail');
  });
});

describe('condition definition hash', () => {
  it('is stable and 8 hex chars', () => {
    const h = conditionDefinitionHash();
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(conditionDefinitionHash()).toBe(h);
  });
});

/**
 * The reaction-time block runs IN the condition's display: the go-target is the condition's own
 * text colour, and the no-go dots are the other text colours of the same polarity.
 *
 * This replaced an achromatic target (black on light, white on dark) after the investigator saw a
 * blue-text condition followed by a reaction block tapping for a BLACK dot, and chose to have every
 * task of a condition-run performed in that condition's colours. The earlier tests here pinned the
 * achromatic design; these pin the one chosen, so a well-meant "fix" back to constant salience fails
 * loudly instead of silently undoing an investigator decision.
 */
describe('reaction-time stimulus colours are the condition\'s own', () => {
  it('draws the go-target in the condition\'s text colour, for every condition', () => {
    for (const c of CONDITIONS) {
      const s = rtStimulusColours(c);
      expect(s.target, c.label).toBe(c.text);
      expect(s.targetName, c.label).toBe(c.inkName);
    }
  });

  it('uses the other four text colours of the SAME polarity as the no-go dots', () => {
    for (const c of CONDITIONS) {
      const s = rtStimulusColours(c);
      const samePolarity = CONDITIONS.filter((x) => x.polarity === c.polarity);
      expect(s.distractors, c.label).toHaveLength(samePolarity.length - 1);
      // Never the target itself — a no-go dot in the go colour would make the rule unanswerable.
      expect(s.distractors.map((d) => d.toUpperCase()), c.label).not.toContain(c.text.toUpperCase());
      // Distinct, and together with the target exactly the palette of that polarity.
      expect(new Set(s.distractors).size, c.label).toBe(s.distractors.length);
      expect(new Set([s.target, ...s.distractors]), c.label)
        .toEqual(new Set(samePolarity.map((x) => x.text)));
    }
  });

  it('keeps the RULE constant while the colour changes', () => {
    // Every block asks the same question — does the dot match the text? — so the task does not
    // turn into a new rule to learn in every condition. The instruction card has to say so.
    const src = readFileSync('src/tasks/ReactionTimeTask.tsx', 'utf8');
    expect(src).toMatch(/the same\s+colour as the text you have just read/);
  });

  it('keeps the fixation cross achromatic and at 21:1, since it is not the stimulus', () => {
    // A cross in the condition ink would be 2.39:1 in P4 (yellow on white): one the participant
    // cannot hold, so the dot arrives further into the periphery and the delay is blamed on the
    // display.
    for (const c of CONDITIONS) {
      const ink = fixationInkFor(c.background);
      expect(ink, c.label).toBe(c.polarity === 'positive' ? '#000000' : '#FFFFFF');
      expect(wcagContrastRatio(c.background, ink), c.label).toBeCloseTo(21.0, 1);
    }
  });

  it('makes the target visibility vary with condition — the stated cost, measured', () => {
    // Recorded, not hidden: this is what "RT partly reflects how visible the colour is" means in
    // numbers. If a future palette change moves these, the protocol text describing the cost is
    // out of date and this test is where that is noticed.
    const ratio = (label: string) => {
      const c = CONDITIONS.find((x) => x.label === label)!;
      return wcagContrastRatio(c.background, rtStimulusColours(c).target);
    };
    expect(ratio('P1')).toBeCloseTo(21.0, 1);
    expect(ratio('P4')).toBeLessThan(2.5);   // yellow on white: the hardest go-target to see
    expect(ratio('N1')).toBeCloseTo(21.0, 1);
  });
});
