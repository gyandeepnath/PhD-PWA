import { describe, it, expect } from 'vitest';
import { CONFIG } from '@/experiment/config';
import { goTargetColor } from '@/tasks/ReactionTimeTask';
import { wcagContrastRatio, michelsonContrast, relativeLuminance, wcagLevel } from '@/lib/contrast';
import { CONDITIONS, conditionDefinitionHash } from '@/experiment/conditions';

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

describe('reaction-time go-target (synopsis §3.6)', () => {
  it('is achromatic and background-relative: black on light fields, white on dark', () => {
    for (const c of CONDITIONS) {
      const expected = c.polarity === 'positive' ? '#000000' : '#FFFFFF';
      expect(goTargetColor(c.background)).toBe(expected);
    }
  });

  it('gives the target identical maximal contrast in BOTH polarities', () => {
    const ratios = CONDITIONS.map((c) => wcagContrastRatio(c.background, goTargetColor(c.background)));
    for (const r of ratios) expect(r).toBeCloseTo(21.0, 1);
  });

  it('never lets the go-target collide with a text-colour condition', () => {
    const stimulusInks = new Set(CONDITIONS.map((c) => c.text.toUpperCase()));
    const targets = new Set(CONDITIONS.map((c) => goTargetColor(c.background).toUpperCase()));
    // The achromatic inks are #000000/#FFFFFF, which ARE used as text in P1/N1 — but never in the
    // same polarity as the target that shares their value, so no condition shows a distractor
    // in the go-target colour. Distractors are the four chromatic hues only.
    for (const d of CONFIG.RT_DISTRACTOR_COLORS) expect(targets.has(d.toUpperCase())).toBe(false);
    expect(stimulusInks.has('#00A651')).toBe(true); // green is now a stimulus, not the target
  });

  it('uses all four chromatic text colours as distractors', () => {
    expect([...CONFIG.RT_DISTRACTOR_COLORS].sort()).toEqual(
      ['#00A651', '#1E4ED8', '#C81E1E', '#C9A400'],
    );
  });
});
