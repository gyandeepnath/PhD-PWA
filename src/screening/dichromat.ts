/**
 * Dichromat colour simulation, used to hold the colour-vision screen's plates to a property their
 * design depends on: that the figure and the background carry NO usable luminance edge for the
 * observer each plate is trying to detect.
 *
 * WHY THIS FILE EXISTS. `ishihara.ts` balances its plates on sRGB relative luminance,
 * 0.2126R + 0.7152G + 0.0722B. That is the NORMAL trichromat's luminous efficiency, and the
 * confusion palettes differ almost purely along red-green — the axis on which a dichromat's
 * luminance function departs most from it. Measured with the transform below, the previous palettes
 * were iso-luminant for a deuteranope (contrast ratio 1.00-1.04) and NOT for a protanope
 * (1.20-1.29, the greener member lighter on all five plates, with the dot-lightness ranges barely
 * overlapping). A protanope could read the digit off a luminance boundary and score full marks —
 * a false negative on the one measure the plate exists to make.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PROVENANCE OF THE CONSTANTS. Read this before changing a digit of them.
 *
 * The algorithm is the single-projection-plane simplification of
 *
 *     Viénot, F., Brettel, H. & Mollon, J. D. (1999). Digital video colourmaps for checking the
 *     legibility of displays by dichromats. Color Research and Application, 24(4), 243-252.
 *
 * which is valid for PROTANOPIA and DEUTERANOPIA only. Tritanopia needs the two-half-plane version
 * of Brettel, Viénot & Mollon (1997), JOSA A 14(10), 2647-2655, and is not implemented here because
 * this screen does not probe the tritan axis.
 *
 * WHAT IS VERIFIED AND WHAT IS NOT:
 *
 *   - The two 3x3 matrices below are DIRECTLY REPORTED: copied verbatim from `libDaltonLens.c`
 *     (the DaltonLens project's public-domain single-file implementation), fetched from
 *     https://raw.githubusercontent.com/DaltonLens/libDaltonLens/master/libDaltonLens.c and read in
 *     full, where they appear under the heading "Viénot 1999 precomputed parameters".
 *   - They were INDEPENDENTLY RE-DERIVED for this repository from first principles — Smith & Pokorny
 *     (1975) cone fundamentals on Judd-Vos-corrected sRGB/BT.709 primaries, projected along the
 *     missing cone's axis onto the black-white-blue-yellow plane with RGB white as the neutral —
 *     and the derivation reproduced both matrices to within 4.3e-6, i.e. exactly at the published
 *     five-decimal precision.
 *   - The 1999 PAPER ITSELF WAS NOT READ from this environment. It is paywalled and the fetch
 *     failed. So "this is what Viénot et al. published" is UNVERIFIED here; what is verified is
 *     "this is what libDaltonLens implements and attributes to them, and it reconstructs from the
 *     cone fundamentals it names".
 *   - The matrices use MODERN sRGB/BT.709 primaries, not the CRT primaries of the 1999 paper.
 *     libDaltonLens states this: "This follows the paper exactly, but using the modern sRGB standard
 *     to decode the input RGB values." That is the right choice for a tablet display and the wrong
 *     one for reproducing the paper's own tables.
 *   - The matrices act on LINEAR RGB. Applying them to gamma-encoded sRGB — which is what most
 *     circulating implementations do — is a large error, not a small one.
 *
 * WHAT THE SIMULATION DOES AND DOES NOT LICENSE US TO SAY:
 *
 *   EXACT: if two colours map to the SAME simulated value, a dichromat of that type cannot tell them
 *   apart, in hue or in brightness. That is what a projection means, and it needs no further
 *   assumption. This is the property `confusionDirection` and the plate tests rely on.
 *
 *   A PROXY: the relative luminance OF the simulated colour is not the dichromat's own luminous
 *   efficiency — the simulated colour is an sRGB value intended to be viewed by a trichromat. Where
 *   a plate is NOT a metamer for the observer (a protanope looking at a deutan plate), the numbers
 *   this file reports are an indicator of the direction and rough size of a residual edge, not a
 *   measurement of one. Statements about those cases are labelled as such wherever they are made.
 *
 * Anomalous trichromats (protanomaly, deuteranomaly — commoner than the dichromacies) retain a
 * shifted cone rather than losing one, so they see a REDUCED version of what a trichromat sees
 * rather than nothing. This transform models the dichromatic extreme. The screen's sensitivity to
 * anomalous trichromacy is not established by anything here.
 */

export type DichromatKind = 'protan' | 'deutan';

/**
 * Viénot 1999, protanope: linear RGB -> simulated linear RGB, row-major.
 * Verbatim from libDaltonLens.c (`dl_vienot_protan_rgbCvd_from_rgb`).
 */
export const VIENOT_PROTAN = [
  0.11238, 0.88762, 0.00000,
  0.11238, 0.88762, -0.00000,
  0.00401, -0.00401, 1.00000,
] as const;

/**
 * Viénot 1999, deuteranope: linear RGB -> simulated linear RGB, row-major.
 * Verbatim from libDaltonLens.c (`dl_vienot_deutan_rgbCvd_from_rgb`).
 */
export const VIENOT_DEUTAN = [
  0.29275, 0.70725, 0.00000,
  0.29275, 0.70725, -0.00000,
  -0.02234, 0.02234, 1.00000,
] as const;

const matrixFor = (kind: DichromatKind) => (kind === 'protan' ? VIENOT_PROTAN : VIENOT_DEUTAN);

/** sRGB transfer function, IEC 61966-2-1. The matrices are meaningless without it. */
export function srgbToLinear(channel: number): number {
  return channel < 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** `#rgb` or `#rrggbb` to linear RGB. */
export function hexToLinearRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const ch = (o: number) => srgbToLinear(parseInt(full.slice(o, o + 2), 16) / 255);
  return [ch(0), ch(2), ch(4)];
}

/** The colour a dichromat of `kind` cannot distinguish this one from, in linear RGB. */
export function simulateDichromat(
  linear: readonly [number, number, number],
  kind: DichromatKind,
): [number, number, number] {
  const m = matrixFor(kind);
  const [r, g, b] = linear;
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ];
}

/** Relative luminance (WCAG / BT.709) of a linear-RGB triple. */
export function relativeLuminance(linear: readonly [number, number, number]): number {
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * Luminance of a colour as seen through the simulation, or unsimulated when `kind` is null.
 *
 * See the module header on what this licenses: for the observer a plate is a metamer for, a zero
 * difference here is exact. For any other observer it is an indicator, not a measurement.
 */
export function observedLuminance(hex: string, kind: DichromatKind | null): number {
  const lin = hexToLinearRgb(hex);
  return relativeLuminance(kind ? simulateDichromat(lin, kind) : lin);
}

/**
 * A direction in linear RGB that the given deficiency cannot see at all — a confusion axis.
 *
 * Two colours separated along this direction project to the SAME simulated colour, so to that
 * observer they are one colour: same hue, same brightness, no edge. This is what makes a plate a
 * screening plate rather than a picture.
 *
 * Solved from the matrices rather than tabulated, so it cannot drift away from them:
 *   protan rows require 0.11238 dR + 0.88762 dG = 0 and dB + 0.00401(dR - dG) = 0
 *   deutan rows require 0.29275 dR + 0.70725 dG = 0 and dB - 0.02234(dR - dG) = 0
 * Returned normalised. `tests/screening.test.ts` asserts the matrix annihilates it.
 */
export function confusionDirection(kind: DichromatKind): [number, number, number] {
  const m = matrixFor(kind);
  const dR = m[1];            // so that m[0]*dR + m[1]*dG == 0 with dG = -m[0]
  const dG = -m[0];
  const dB = -(m[6] * dR + m[7] * dG);
  const n = Math.hypot(dR, dG, dB);
  return [dR / n, dG / n, dB / n];
}

export interface Separation {
  /**
   * WCAG-style contrast ratio between the two sets' MEAN luminances. 1.0 means the two regions are
   * equally bright on average. The +0.05 flare term is WCAG's; it is kept so the number is on a
   * scale a reader already has intuitions about.
   */
  contrastRatio: number;
  /**
   * How much of the narrower set's luminance range lies inside the wider set's, 0 to 1.
   *
   * This is the measure that matters most, and the one the previous palettes failed. Means can be
   * matched while every figure dot still sits above every background dot; what removes a readable
   * boundary is the two RANGES overlapping, so that a dot of any given lightness could belong to
   * either region. It is the defence real pseudoisochromatic plates rely on, and it is why the
   * dot-lightness spread was widened along with the palettes.
   */
  rangeOverlap: number;
}

/** Luminance agreement between a plate's two dot palettes, for one observer. */
export function paletteSeparation(
  figure: readonly string[],
  background: readonly string[],
  kind: DichromatKind | null,
): Separation {
  const stat = (cs: readonly string[]) => {
    const ls = cs.map((c) => observedLuminance(c, kind));
    return {
      min: Math.min(...ls),
      max: Math.max(...ls),
      mean: ls.reduce((a, b) => a + b, 0) / ls.length,
    };
  };
  const a = stat(figure);
  const b = stat(background);
  const hi = Math.max(a.mean, b.mean) + 0.05;
  const lo = Math.min(a.mean, b.mean) + 0.05;
  const oLo = Math.max(a.min, b.min);
  const oHi = Math.min(a.max, b.max);
  const narrower = Math.min(a.max - a.min, b.max - b.min);
  return {
    contrastRatio: hi / lo,
    rangeOverlap: oHi <= oLo || narrower <= 0 ? 0 : (oHi - oLo) / narrower,
  };
}

/**
 * CIELAB. Needed because the property a trichromat actually reads the digit by is CHROMATIC
 * difference, and nothing in this file measured it until a change to the plates made that painfully
 * clear: widening the dot-lightness spread from 1.35x to 1.8x looked like a strictly better hiding
 * of the luminance boundary, and every luminance test still passed, while the digits quietly became
 * hard for a NORMAL observer to read. That direction of failure matters — a trichromat who cannot
 * read the plates fails the screen, and this screen's recent history is of over-calling failures.
 *
 * D65 white point, sRGB primaries, CIE 1976 L*a*b*.
 */
function labOf(hex: string): [number, number, number] {
  const [r, g, b] = hexToLinearRgb(hex);
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X / 0.95047);
  const fy = f(Y / 1.0);
  const fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export interface ChromaticSignal {
  /**
   * Chromatic distance between the two palettes' mean colours, sqrt(da*^2 + db*^2).
   *
   * The SIGNAL: on a plate whose two regions are matched in lightness, this is the whole of what a
   * trichromat has to find the digit with. Lightness is deliberately excluded — including it would
   * let a plate score well on the strength of the very cue the design is trying to remove.
   */
  chromaticDistance: number;
  /**
   * L* range across every dot colour on the plate, both palettes together.
   *
   * The NOISE the shape has to be read through. It is wanted — it is what stops a boundary being
   * visible to an observer for whom the pair is not quite a metamer — but it is not free, and the
   * ratio of the two numbers is what decides whether the plate is readable at all.
   */
  lightnessSpread: number;
}

/** The trichromat's side of the bargain: how much chromatic signal, against how much lightness noise. */
export function chromaticSignal(
  figure: readonly string[],
  background: readonly string[],
): ChromaticSignal {
  const meanLab = (cs: readonly string[]) => {
    const ls = cs.map(labOf);
    return [0, 1, 2].map((i) => ls.reduce((s, l) => s + l[i], 0) / ls.length);
  };
  const f = meanLab(figure);
  const b = meanLab(background);
  const allL = [...figure, ...background].map((c) => labOf(c)[0]);
  return {
    chromaticDistance: Math.hypot(f[1] - b[1], f[2] - b[2]),
    lightnessSpread: Math.max(...allL) - Math.min(...allL),
  };
}
