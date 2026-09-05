/**
 * The 10 experimental display conditions (synopsis Table 3.4).
 *
 * Hex values are LOCKED — the original spec carries the comment "must not be changed under
 * any circumstance." We preserve them exactly and instead derive contrast metadata
 * (WCAG ratio, Michelson, polarity) so the analysis can control for the luminance-contrast
 * confound that the literature audit surfaced (notably C4 yellow-on-white at ~2.4:1).
 *
 * GREEN (#00A651) was added to the original four-colour set after a colour-set simulation
 * compared four candidates on three criteria: balance of sub-AA conditions across polarity,
 * the correlation between polarity and log contrast (a confounding index, zero ideal), and
 * the contrast of the weakest condition. Without green the sub-AA conditions are unbalanced
 * (1 positive vs 2 negative); with green they are 2 per polarity, so polarity is not
 * systematically confounded with accessibility compliance. Coding positive = 1,
 * r(polarity, log contrast) = -0.113 across the ten conditions — close enough to zero that
 * polarity and contrast can enter the same model without collinearity. (This line previously read
 * "+0.11" and did not state the coding, so the sign could not be checked against it.) The two rejected alternatives were a luminance-matched
 * chromatic set (worst: all four sub-AA conditions in one polarity, r = +0.43) and the
 * web-default hues (yields an unusable 1.07:1 condition).
 *
 * The contrast ordering is exactly REVERSED between polarities. This is arithmetic, not
 * design: contrast on white is 1.05/(L+0.05), strictly decreasing in the text's relative
 * luminance L, while contrast on black is (L+0.05)/0.05, strictly increasing in the same L.
 * Chromatic-only rank correlation between polarities is exactly -1.00 for ANY colour set.
 * The achromatic pair is the exception and the anchor: 21.00:1 in both polarities, so that
 * one pair varies polarity with luminance contrast held constant.
 */
import {
  tryHexToRgb,
  michelsonContrast,
  wcagContrastRatio,
  wcagLevel,
  type WcagLevel,
} from '@/lib/contrast';

export type Polarity = 'positive' | 'negative';

/**
 * The text-colour FACTOR, five levels. Both achromatic conditions carry 'achromatic' — not
 * 'black' and 'white' — because polarity x colour is a crossed factorial: colour must take the
 * same five levels in both polarities for the interaction to be estimable. Labelling the
 * achromatic ink by its hue would split it into two single-polarity levels and silently break
 * the design. The human-readable ink name is carried separately as `inkName`.
 */
export type TextColour = 'achromatic' | 'blue' | 'red' | 'yellow' | 'green';
export const TEXT_COLOURS: TextColour[] = ['achromatic', 'blue', 'red', 'yellow', 'green'];

export interface ConditionDef {
  /** Stable label, P1..P5 / N1..N5 — the codes used in synopsis Table 3.4. */
  label: string;
  background: string;
  text: string;
  polarity: Polarity;
  /** Text-colour factor level (5 levels, identical set in both polarities). */
  colorName: TextColour;
  /** Human-readable ink name for researcher-facing UI only; never an analysis factor. */
  inkName: string;
}

/** Locked condition table (do not edit hex values). Synopsis Table 3.4, in table order. */
const BASE_CONDITIONS: ConditionDef[] = [
  { label: 'P1', background: '#FFFFFF', text: '#000000', polarity: 'positive', colorName: 'achromatic', inkName: 'black' },
  { label: 'P2', background: '#FFFFFF', text: '#1E4ED8', polarity: 'positive', colorName: 'blue', inkName: 'blue' },
  { label: 'P3', background: '#FFFFFF', text: '#C81E1E', polarity: 'positive', colorName: 'red', inkName: 'red' },
  { label: 'P4', background: '#FFFFFF', text: '#C9A400', polarity: 'positive', colorName: 'yellow', inkName: 'yellow' },
  { label: 'P5', background: '#FFFFFF', text: '#00A651', polarity: 'positive', colorName: 'green', inkName: 'green' },
  { label: 'N1', background: '#000000', text: '#FFFFFF', polarity: 'negative', colorName: 'achromatic', inkName: 'white' },
  { label: 'N2', background: '#000000', text: '#1E4ED8', polarity: 'negative', colorName: 'blue', inkName: 'blue' },
  { label: 'N3', background: '#000000', text: '#C81E1E', polarity: 'negative', colorName: 'red', inkName: 'red' },
  { label: 'N4', background: '#000000', text: '#C9A400', polarity: 'negative', colorName: 'yellow', inkName: 'yellow' },
  { label: 'N5', background: '#000000', text: '#00A651', polarity: 'negative', colorName: 'green', inkName: 'green' },
];

export interface ConditionContrast {
  wcag_contrast_ratio: number;
  wcag_level: WcagLevel;
  michelson_contrast: number;
  /** True when below WCAG AA (4.5:1) — flag for the codebook and analysis covariate. */
  below_wcag_aa: boolean;
}

export type Condition = ConditionDef & ConditionContrast;

/** Round to 2 dp for stable storage/export. */
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The 10 conditions with derived contrast metadata attached. */
export const CONDITIONS: Condition[] = BASE_CONDITIONS.map((c) => {
  const ratio = wcagContrastRatio(c.background, c.text);
  return {
    ...c,
    wcag_contrast_ratio: r2(ratio),
    wcag_level: wcagLevel(ratio),
    michelson_contrast: r4(michelsonContrast(c.background, c.text)),
    below_wcag_aa: ratio < 4.5,
  };
});

export const N_CONDITIONS = CONDITIONS.length;

// Load-time integrity assertion over the locked table. A malformed hex would otherwise surface far
// downstream as a NaN contrast covariate; here it fails on the first import, naming the condition.
for (const c of CONDITIONS) {
  for (const [field, value] of [['background', c.background], ['text', c.text]] as const) {
    if (tryHexToRgb(value) == null) {
      throw new Error(`Condition ${c.label} has an invalid ${field} colour: ${JSON.stringify(value)}`);
    }
  }
  if (!Number.isFinite(c.wcag_contrast_ratio) || c.wcag_contrast_ratio < 1 || c.wcag_contrast_ratio > 21) {
    throw new Error(`Condition ${c.label} produced an out-of-range contrast ratio: ${c.wcag_contrast_ratio}`);
  }
}

/**
 * Deterministic definition hash (FNV-1a) over the locked hex values + colour names.
 * Stamped into exports so a dataset can be tied to the exact condition table used.
 */
export function conditionDefinitionHash(): string {
  const payload = BASE_CONDITIONS.map(
    (c) => `${c.label}:${c.background}:${c.text}:${c.polarity}:${c.colorName}`,
  ).join('|');
  // NOTE: changing the table changes this hash by design — a dataset can always be tied back
  // to the exact condition set that produced it. The 8-condition (pre-green) table hashed
  // differently, so pilot data collected under it is distinguishable from main-study data.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
