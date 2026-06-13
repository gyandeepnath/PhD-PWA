import { describe, it, expect } from 'vitest';
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

  // These are the audit values that justify treating contrast as a covariate.
  const expected: Record<string, number> = {
    C1: 21.0,
    C2: 6.7,
    C3: 5.74,
    C4: 2.39,
    C5: 21.0,
    C6: 3.14,
    C7: 3.66,
    C8: 8.79,
  };

  for (const c of CONDITIONS) {
    it(`${c.label} contrast ratio ~= ${expected[c.label]}:1`, () => {
      expect(c.wcag_contrast_ratio).toBeCloseTo(expected[c.label], 1);
    });
  }

  it('flags C4 (yellow-on-white) as below WCAG AA', () => {
    const c4 = CONDITIONS.find((c) => c.label === 'C4')!;
    expect(c4.below_wcag_aa).toBe(true);
    expect(c4.wcag_level).toBe('Fail');
  });

  it('counts exactly the conditions below AA (C4, C6, C7)', () => {
    const below = CONDITIONS.filter((c) => c.below_wcag_aa).map((c) => c.label);
    expect(below.sort()).toEqual(['C4', 'C6', 'C7']);
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
