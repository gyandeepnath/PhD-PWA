/**
 * PROSE THAT NAMES A DESIGN COUNT MUST AGREE WITH THE CODE.
 *
 * The codebooks describe the design in words — "the ten conditions", "the nine targets", "the
 * sixteen items", "Five levels". None of that is wrong today. The point is what happens if the design
 * is ever amended: a colour dropped, an item added, a calibration point removed. The code would
 * change, the prose would not, and the exported codebook would quietly describe a study that was not
 * run — while every type check and every existing test still passed.
 *
 * That is not hypothetical here. The visual-search cap was raised from 40 s to 60 s and four copies
 * of the old number survived in prose, one of them a line above an instruction telling the analyst to
 * censor at it. This is the same failure mode, pre-empted.
 *
 * A TRIPWIRE, not a refactor. Interpolating every one of these strings would be churn against a
 * design far more stable than a cap that was being actively tuned — the CVS-Q's sixteen items are
 * definitional to a validated instrument, not a choice. What this does instead is fail loudly if the
 * design moves, and point at the prose that needs rewriting.
 */
import { describe, it, expect } from 'vitest';
import { CONDITIONS, N_CONDITIONS } from '@/experiment/conditions';
import { GAZE_TARGETS } from '@/tracking/gazeCalibration';
import { CVSQ_ITEMS } from '@/scales/cvsq';
import { CODEBOOK } from '@/storage/export';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';

/** Every description string in either codebook, which is what an analyst actually reads. */
const allProse = (): string[] => [
  ...CODEBOOK.map((c) => String(c.description ?? '')),
  ...ANALYSIS_CODEBOOK.map((c) => String((c as { description?: string }).description ?? '')),
];

describe('the design is what the prose says it is', () => {
  it('crosses two polarities with five colours to give the condition count', () => {
    // The factorial has to actually cross: five colours in each polarity, the SAME five, or
    // polarity x colour is not estimable at all.
    const polarities = new Set(CONDITIONS.map((c) => c.polarity));
    const colours = new Set(CONDITIONS.map((c) => c.colorName));
    expect(polarities.size).toBe(2);
    expect(colours.size).toBe(5);
    expect(polarities.size * colours.size).toBe(N_CONDITIONS);
    expect(CONDITIONS).toHaveLength(N_CONDITIONS);
    for (const p of polarities) {
      const inThisPolarity = new Set(CONDITIONS.filter((c) => c.polarity === p).map((c) => c.colorName));
      expect(inThisPolarity).toEqual(colours);
    }
  });

  it('has nine calibration targets and sixteen CVS-Q items', () => {
    expect(GAZE_TARGETS).toHaveLength(9);
    expect(CVSQ_ITEMS).toHaveLength(16);
  });
});

describe('codebook prose naming a design count still matches that count', () => {
  const cases: [RegExp, () => number, number, string][] = [
    [/\bten conditions\b/i, () => N_CONDITIONS, 10, 'N_CONDITIONS'],
    [/\bnine (?:calibration )?targets\b/i, () => GAZE_TARGETS.length, 9, 'GAZE_TARGETS.length'],
    [/\bsixteen items\b/i, () => CVSQ_ITEMS.length, 16, 'CVSQ_ITEMS.length'],
    [/\bfive levels\b/i, () => new Set(CONDITIONS.map((c) => c.colorName)).size, 5, 'distinct colorName'],
  ];

  for (const [pattern, actual, spelled, source] of cases) {
    it(`"${pattern.source}" is only written while ${source} is ${spelled}`, () => {
      const mentions = allProse().filter((d) => pattern.test(d));
      if (mentions.length === 0) return; // the phrase was rewritten; nothing to keep in step
      expect(
        actual(),
        `codebook prose says "${pattern.source}" but ${source} is ${actual()} — rewrite the prose, `
        + 'or the exported codebook describes a study that was not run',
      ).toBe(spelled);
    });
  }

  it('checks prose that actually exists, so the suite cannot pass by matching nothing', () => {
    // Without this, rewording every description would make the block above vacuous — the exact
    // failure this audit keeps finding in checks that look green.
    const matched = cases.filter(([p]) => allProse().some((d) => p.test(d)));
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });
});
