/**
 * The 8 experimental display conditions.
 *
 * Hex values are LOCKED — the original spec carries the comment "must not be changed under
 * any circumstance." We preserve them exactly and instead derive contrast metadata
 * (WCAG ratio, Michelson, polarity) so the analysis can control for the luminance-contrast
 * confound that the literature audit surfaced (notably C4 yellow-on-white at ~2.4:1).
 */
import {
  michelsonContrast,
  wcagContrastRatio,
  wcagLevel,
  type WcagLevel,
} from '@/lib/contrast';

export type Polarity = 'positive' | 'negative';

export interface ConditionDef {
  /** Stable label, C1..C8. Identity of the condition independent of presentation order. */
  label: string;
  background: string;
  text: string;
  polarity: Polarity;
  /** Human-readable text-colour name. */
  colorName: string;
}

/** Locked condition table (do not edit hex values). */
const BASE_CONDITIONS: ConditionDef[] = [
  { label: 'C1', background: '#FFFFFF', text: '#000000', polarity: 'positive', colorName: 'black' },
  { label: 'C2', background: '#FFFFFF', text: '#1E4ED8', polarity: 'positive', colorName: 'blue' },
  { label: 'C3', background: '#FFFFFF', text: '#C81E1E', polarity: 'positive', colorName: 'red' },
  { label: 'C4', background: '#FFFFFF', text: '#C9A400', polarity: 'positive', colorName: 'yellow' },
  { label: 'C5', background: '#000000', text: '#FFFFFF', polarity: 'negative', colorName: 'white' },
  { label: 'C6', background: '#000000', text: '#1E4ED8', polarity: 'negative', colorName: 'blue' },
  { label: 'C7', background: '#000000', text: '#C81E1E', polarity: 'negative', colorName: 'red' },
  { label: 'C8', background: '#000000', text: '#C9A400', polarity: 'negative', colorName: 'yellow' },
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

/** The 8 conditions with derived contrast metadata attached. */
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

/**
 * Deterministic definition hash (FNV-1a) over the locked hex values + colour names.
 * Stamped into exports so a dataset can be tied to the exact condition table used.
 */
export function conditionDefinitionHash(): string {
  const payload = BASE_CONDITIONS.map(
    (c) => `${c.label}:${c.background}:${c.text}:${c.polarity}:${c.colorName}`,
  ).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
