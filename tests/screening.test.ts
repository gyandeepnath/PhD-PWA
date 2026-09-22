import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveCvdStatus, countsComeFromPriorAdministration, buildScreeningPlates, SCREEN_TEST_PLATES, SCREEN_ALLOWED_SLIPS } from '@/screening/ishihara';
import { isFigurePixel, scoreIshihara, PLATES } from '@/screening/ishihara';
import { cvsqItemScore, scoreCvsq, CVSQ_ITEMS, CVSQ_CUTOFF } from '@/scales/cvsq';
import { CODEBOOK } from '@/storage/export';
import {
  confusionDirection, simulateDichromat, paletteSeparation, relativeLuminance, chromaticSignal,
  type DichromatKind,
} from '@/screening/dichromat';

/** A participant-file codebook description, as the analyst receives it. */
const cvdEntry = (column: string) =>
  CODEBOOK.find((r) => r.file === '11_participant.csv' && r.column === column)?.description ?? '';

describe('Ishihara screening', () => {
  it('font mask marks lit pixels as figure', () => {
    // Digit '1' has its centre column lit; corners are not.
    expect(isFigurePixel('1', 0.5, 0.5)).toBe(true);
    expect(isFigurePixel('1', 0.05, 0.05)).toBe(false);
    expect(isFigurePixel('8', 0.5, 0.05)).toBe(true); // top bar of 8
  });

  it('all answers correct → normal', () => {
    const answers = Object.fromEntries(PLATES.map((p) => [p.id, p.digit]));
    const r = scoreIshihara(PLATES, answers);
    expect(r.status).toBe('normal');
    expect(r.correct).toBe(PLATES.length);
  });

  it('missing several test plates → screen_failed (control passed)', () => {
    const answers: Record<number, string> = {};
    for (const p of PLATES) answers[p.id] = p.axis === 'control' ? p.digit : '0';
    const r = scoreIshihara(PLATES, answers);
    expect(r.status).toBe('screen_failed');
    expect(r.testCorrect).toBe(0);
  });

  it('failing the control plate → inconclusive', () => {
    const answers = Object.fromEntries(PLATES.map((p) => [p.id, p.digit]));
    const control = PLATES.find((p) => p.axis === 'control')!;
    // Any digit but the right one. Hard-coding '9' worked only until a plate set came up in which
    // the control's own digit WAS '9', at which point the test silently stopped testing anything.
    answers[control.id] = control.digit === '9' ? '8' : '9';
    expect(scoreIshihara(PLATES, answers).status).toBe('inconclusive');
  });

  it('allows one slip on test plates and still passes', () => {
    const answers = Object.fromEntries(PLATES.map((p) => [p.id, p.digit]));
    const oneTest = PLATES.find((p) => p.axis !== 'control')!;
    answers[oneTest.id] = '0';
    expect(scoreIshihara(PLATES, answers).status).toBe('normal');
  });
});

describe('CVS-Q scoring (Seguí 2015)', () => {
  it('has 16 items and cutoff 6', () => {
    expect(CVSQ_ITEMS).toHaveLength(16);
    expect(CVSQ_CUTOFF).toBe(6);
  });

  it('recodes item severity 0→0, 1-2→1, 4→2', () => {
    expect(cvsqItemScore(0, 0)).toBe(0);
    expect(cvsqItemScore(1, 1)).toBe(1); // severity 1
    expect(cvsqItemScore(1, 2)).toBe(1); // severity 2
    expect(cvsqItemScore(2, 1)).toBe(1); // severity 2
    expect(cvsqItemScore(2, 2)).toBe(2); // severity 4
  });

  it('asymptomatic profile scores below cutoff', () => {
    const r = scoreCvsq(Array(16).fill(0), Array(16).fill(0));
    expect(r.total).toBe(0);
    expect(r.symptomatic).toBe(false);
  });

  it('symptomatic profile crosses the cutoff', () => {
    // 6 items at max severity (score 2 each) = 12 ≥ 6.
    const freq = Array(16).fill(0);
    const inten = Array(16).fill(0);
    for (let i = 0; i < 6; i++) { freq[i] = 2; inten[i] = 2; }
    const r = scoreCvsq(freq, inten);
    expect(r.total).toBe(12);
    expect(r.symptomatic).toBe(true);
  });

  it('exactly at cutoff is symptomatic', () => {
    const freq = Array(16).fill(0);
    const inten = Array(16).fill(0);
    for (let i = 0; i < 6; i++) { freq[i] = 1; inten[i] = 1; } // six items, score 1 each = 6
    const r = scoreCvsq(freq, inten);
    expect(r.total).toBe(6);
    expect(r.symptomatic).toBe(true);
  });
});

/**
 * How a screening result becomes the stored colour-vision status.
 *
 * scoreIshihara returns 'inconclusive' when the greyscale control plate is missed — the attempt
 * measured nothing. That status was not in the stored union, so it fell through to whatever
 * cvd_status the participant already had, which for someone who self-reported no deficiency is
 * 'normal'. Mis-tapping the control while scoring 3 of 5 test plates therefore left them normal and
 * eligible, where the SAME 3 of 5 with the control correct would have been screen_failed and
 * excluded: performing worse made them eligible.
 */
describe('resolving a screening result into the stored status', () => {
  it('never turns an invalid attempt into a pass', async () => {
    const { resolveCvdStatus } = await import('@/screening/ishihara');
    expect(resolveCvdStatus('normal', 'inconclusive')).toBe('screen_inconclusive');
    expect(resolveCvdStatus('unknown', 'inconclusive')).toBe('screen_inconclusive');
  });

  it('keeps a failure sticky across the second sitting', async () => {
    // The plates are identical and deterministically seeded, so a participant who failed at
    // sitting 1 may well "pass" at sitting 2 from memory. The exclusion must survive that.
    const { resolveCvdStatus } = await import('@/screening/ishihara');
    expect(resolveCvdStatus('screen_failed', 'normal')).toBe('screen_failed');
    expect(resolveCvdStatus('screen_failed', 'inconclusive')).toBe('screen_failed');
  });

  it('does not let the screen overturn a self-reported deficiency', async () => {
    // The module's own header calls this a screening aid and names formal plates as the standard
    // for exclusion, so it has no business clearing someone who reports a diagnosed deficiency.
    const { resolveCvdStatus } = await import('@/screening/ishihara');
    expect(resolveCvdStatus('self_reported_deficient', 'normal')).toBe('self_reported_deficient');
  });

  it('records a clean pass and a clean failure as themselves', async () => {
    const { resolveCvdStatus } = await import('@/screening/ishihara');
    expect(resolveCvdStatus('normal', 'normal')).toBe('normal');
    expect(resolveCvdStatus('normal', 'screen_failed')).toBe('screen_failed');
  });
});

/**
 * The two cues a pseudoisochromatic set has to avoid.
 *
 * Matching mean luminance is not enough if the figure is consistently the DARKER region: an
 * observer with no chromatic discrimination can learn "the digit is the darker patch" and apply it
 * to every plate. Measured across the original five test plates the figure was darker on all five —
 * contrast ratios of only 1.03 to 1.10, but unanimous in direction, which is what makes a cue
 * usable.
 *
 * And the set was a fixed module constant while the screen runs in BOTH sittings, so a participant
 * who failed at sitting 1 could pass at sitting 2 by recalling six digits.
 */
/**
 * The property the plates exist for, measured rather than asserted.
 *
 * Every confusion plate must be INVISIBLE to the observer it targets — not "low contrast", not
 * "iso-luminant for a normal observer", but the same colour, so there is no hue difference and no
 * brightness difference to fall back on. Before this the plates were matched on sRGB relative
 * luminance, which is the NORMAL trichromat's luminous efficiency; measured through the Viénot 1999
 * transform, the old set separated by a contrast ratio of 1.20-1.29 for a protanope with barely a
 * fifth of the dot ranges overlapping, the same way round on all five plates. A protanope could
 * read the digit off that edge and be recorded `normal`.
 */
describe('each confusion plate is invisible to the observer it targets', () => {
  const plates = (seed: number) => buildScreeningPlates(seed).filter((p) => p.axis !== 'control');

  it('annihilates its own confusion direction, which is what makes a pair a metamer pair', () => {
    // The directions are solved from the matrices rather than tabulated, so this checks the solving
    // and the matrices together. A direction the matrix does not kill is not a confusion axis.
    for (const kind of ['protan', 'deutan'] as const) {
      const d = confusionDirection(kind);
      for (const c of simulateDichromat(d, kind)) expect(Math.abs(c)).toBeLessThan(1e-6);
      // ...and it is NOT killed by the other deficiency: that is why one plate cannot serve both.
      const other = kind === 'protan' ? 'deutan' : 'protan';
      expect(Math.max(...simulateDichromat(d, other).map(Math.abs))).toBeGreaterThan(0.1);
    }
  });

  it('leaves no luminance edge for its target observer, on every plate of every set', () => {
    for (const seed of [0, 1, 2, 7, 42, 101, 999]) {
      for (const p of plates(seed)) {
        const sep = paletteSeparation(p.figureColors, p.backgroundColors, p.axis as DichromatKind);
        expect(sep.contrastRatio, `seed ${seed} ${p.axis} plate ${p.id}`).toBeLessThan(1.01);
        // Not 1.00: the palettes are stored as 8-bit hex, and rounding each channel to a byte
        // perturbs an exact metamer pair slightly. The contrast ratio above is the primary
        // assertion; this one says the rounding did not open a readable gap.
        expect(sep.rangeOverlap, `seed ${seed} ${p.axis} plate ${p.id}`).toBeGreaterThan(0.95);
      }
    }
  });

  it('refuses to build an unevenly split set rather than crashing on an undefined plate', () => {
    // The guard exists because the failure it replaces was an index past the end of the shorter
    // axis list, producing a plate built from `undefined` at module load.
    const src = readFileSync('src/screening/ishihara.ts', 'utf8');
    expect(src).toMatch(/must be split evenly between the two red-green axes/);
    expect(src).toMatch(/if \(protan\.length !== perAxis \|\| deutan\.length !== perAxis\)/);
  });

  it('presents both axes in equal number, so neither deficiency is under-probed', () => {
    /*
     * With five plates split 3/2, whoever got the two could reach the pass mark by guessing one of
     * them — roughly one in five at ten buttons. Three per axis means guessing two of three, under
     * three percent. This is the assertion that keeps the set from silently drifting back.
     */
    for (const seed of [0, 1, 2, 7, 42, 101, 999]) {
      const set = plates(seed);
      expect(set.filter((p) => p.axis === 'protan')).toHaveLength(SCREEN_TEST_PLATES / 2);
      expect(set.filter((p) => p.axis === 'deutan')).toHaveLength(SCREEN_TEST_PLATES / 2);
    }
  });

  it('keeps a trichromat reading hue, not lightness', () => {
    // Iso-luminant enough for a normal observer that the digit is not simply a lightness figure,
    // and with the two dot ranges heavily overlapped so there is no local edge either.
    for (const p of plates(3)) {
      const sep = paletteSeparation(p.figureColors, p.backgroundColors, null);
      expect(sep.contrastRatio, `plate ${p.id}`).toBeLessThan(1.13);
      expect(sep.rangeOverlap, `plate ${p.id}`).toBeGreaterThan(0.55);
    }
  });

  it('bounds the residual edge for the OTHER dichromat, who is meant to read this plate', () => {
    /*
     * Not a defect, and deliberately not asserted at 1.00. A protanope SHOULD be able to read the
     * deutan plates; they fail through the three protan ones. Bounded anyway, so the cross-axis
     * plates do not become lightness figures for anybody.
     */
    for (const p of plates(3)) {
      const other = p.axis === 'protan' ? 'deutan' : 'protan';
      const sep = paletteSeparation(p.figureColors, p.backgroundColors, other);
      expect(sep.contrastRatio, `plate ${p.id}`).toBeLessThan(1.22);
      expect(sep.rangeOverlap, `plate ${p.id}`).toBeGreaterThan(0.30);
    }
  });

  it('leaves a normal trichromat enough chromatic signal to read the digit', () => {
    /*
     * THE TEST THAT WOULD HAVE CAUGHT THE MISTAKE THIS FILE'S HISTORY CONTAINS.
     *
     * A first version of these palettes widened the dot-lightness spread from 1.35x to 1.8x, to
     * hide the luminance boundary better. Every luminance assertion still passed — the spread only
     * helps them — and the digits quietly became hard for a NORMAL observer to read: measured in
     * CIELAB, the chromatic signal fell to a mean dC of 37.7 against an L* spread of 20, where the
     * old palettes had 41.8 against 11. Roughly half the signal-to-noise, and nothing failed.
     *
     * The consequence is not cosmetic. A trichromat who cannot read the plates FAILS the screen,
     * and this screen's recent history is precisely of over-calling failures — it was, until a few
     * rounds ago, excluding those participants from the study outright. So the floor is set at the
     * old palettes' worst plate: whatever else changes, the digit must stay at least as findable as
     * it was before any of this work started.
     */
    for (const p of plates(3)) {
      const sig = chromaticSignal(p.figureColors, p.backgroundColors);
      expect(sig.chromaticDistance, `plate ${p.id} chromatic signal`).toBeGreaterThan(39.7);
      expect(sig.lightnessSpread, `plate ${p.id} lightness noise`).toBeLessThan(14);
      // The ratio is what legibility actually depends on; the old set's worst was about 3.3.
      expect(sig.chromaticDistance / sig.lightnessSpread, `plate ${p.id} signal-to-noise`)
        .toBeGreaterThan(3.2);
    }
  });

  it('cannot be asked to serve both axes at once — the three luminances are rank two', () => {
    /*
     * The reason the set is split by axis rather than compromised across both, checked rather than
     * asserted in prose. Writing the three luminance functionals as row vectors over linear R,G,B,
     * both dichromat rows differ from the normal row only in the R and G coefficients, and those
     * two difference vectors are proportional. So the reachable set of
     * (dL_normal, dL_protan, dL_deutan) is a PLANE, and any pair differing in the red-green
     * direction — which every red-green screening pair must — separates in at least one dichromat
     * space. There is no colour pair that is iso-luminant for all three observers and still red-green.
     */
    const V = [0.2126, 0.7152, 0.0722];
    const row = (kind: DichromatKind) => [0, 1, 2].map((col) => {
      const basis: [number, number, number] = [0, 0, 0];
      basis[col] = 1;
      return relativeLuminance(simulateDichromat(basis, kind));
    });
    const dP = row('protan').map((x, i) => x - V[i]);
    const dD = row('deutan').map((x, i) => x - V[i]);
    // Blue is untouched by both, and the R and G differences are equal and opposite within each.
    expect(Math.abs(dP[2])).toBeLessThan(1e-9);
    expect(Math.abs(dD[2])).toBeLessThan(1e-9);
    expect(dP[0] + dP[1]).toBeCloseTo(0, 9);
    expect(dD[0] + dD[1]).toBeCloseTo(0, 9);
    // ...so the two difference vectors are parallel: rank two, not three.
    expect(dP[0] / dD[0]).toBeCloseTo(dP[1] / dD[1], 9);
    expect(dP[0] / dD[0]).toBeCloseTo(-1.8823, 3);
  });
});

describe('the screening set carries no learnable non-chromatic cue', () => {
  it('does not put the figure on the same side of the luminance boundary every time', async () => {
    const { buildScreeningPlates, luminancePolarityBalance } = await import('@/screening/ishihara');
    for (const seed of [0, 1, 2, 7, 42, 999]) {
      const b = luminancePolarityBalance(buildScreeningPlates(seed));
      expect(b.total).toBe(SCREEN_TEST_PLATES);
      /*
       * EXACTLY half, not merely "not all one way". With three plates per axis and the two axes
       * pointing opposite ways in normal luminance, choosing `redder` as the figure on the same
       * number of plates of each axis makes the count exactly half for any choice — so "roughly
       * balanced" would be a weaker assertion than the construction actually guarantees, and a
       * weaker assertion is how a guarantee quietly stops holding.
       */
      expect(b.figureLighter, `seed ${seed}`).toBe(SCREEN_TEST_PLATES / 2);
    }
  });

  it('keeps figure and background close in luminance on every confusion plate', async () => {
    // The chromatic difference has to be the signal; a large luminance step would let anyone read
    // the digit regardless of colour vision.
    const { buildScreeningPlates } = await import('@/screening/ishihara');
    const rel = (hex: string) => {
      const h = hex.replace('#', '');
      const chan = (o: number) => {
        const c = parseInt(h.slice(o, o + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
    };
    const meanLum = (cs: string[]) => cs.reduce((s, c) => s + rel(c), 0) / cs.length;
    for (const p of buildScreeningPlates(3).filter((x) => x.axis !== 'control')) {
      const f = meanLum(p.figureColors);
      const b = meanLum(p.backgroundColors);
      const ratio = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
      expect(ratio).toBeLessThan(1.2);
    }
  });

  it('gives the two sittings different plates, so a retest is not a memory test', async () => {
    const { buildScreeningPlates } = await import('@/screening/ishihara');
    const sitting1 = buildScreeningPlates(7 * 101 + 1);
    const sitting2 = buildScreeningPlates(7 * 101 + 2);
    expect(sitting1.map((p) => p.digit).join('')).not.toBe(sitting2.map((p) => p.digit).join(''));
  });

  it('is deterministic for a given seed, so a set can be reconstructed from the data', async () => {
    const { buildScreeningPlates } = await import('@/screening/ishihara');
    const a = buildScreeningPlates(11);
    const b = buildScreeningPlates(11);
    expect(a.map((p) => `${p.digit}:${p.figureColors.join('')}`))
      .toEqual(b.map((p) => `${p.digit}:${p.figureColors.join('')}`));
  });

  it('always includes exactly one greyscale control plate', async () => {
    const { buildScreeningPlates } = await import('@/screening/ishihara');
    for (const seed of [0, 5, 60]) {
      const controls = buildScreeningPlates(seed).filter((p) => p.axis === 'control');
      expect(controls).toHaveLength(1);
    }
  });
});

/**
 * The screen counts must describe the administration that produced the status.
 *
 * cvd_status is deliberately sticky: a failure at sitting 1 survives a pass at sitting 2, because
 * the plate set is identical and deterministically seeded, so a retest measures recall as much as
 * colour vision. The counts beside it were written unconditionally on every administration.
 *
 * So a participant who scored 3/6 and was marked screen_failed, then 6/6 at the next sitting,
 * exported cvd_status=screen_failed with cvd_screen_correct=6 of 6 — a verdict sitting next to the
 * numbers of a different, passing administration that flatly contradict it. Exclusion was never
 * affected, since cvd_status and eligible are both merged and sticky; it is the kind of QC
 * contradiction an analyst resolves the wrong way, by trusting the numbers over the flag.
 */
describe('a carried-forward screen failure keeps its own counts', () => {
  const experiment = readFileSync('src/experiment/Experiment.tsx', 'utf8');

  it('writes the prior administration’s counts in exactly that case', () => {
    expect(experiment).toMatch(/const inheritedVerdict = countsComeFromPriorAdministration\(status, r\.status\)/);
    expect(experiment).toMatch(/cvd_screen_correct: inheritedVerdict \? p\.cvd_screen_correct : r\.testCorrect/);
    expect(experiment).toMatch(/cvd_screen_total: inheritedVerdict \? p\.cvd_screen_total : r\.testTotal/);
  });

  /*
   * The predicate used to be written inline as `status === p.cvd_status && status !== r.status`,
   * comparing a StoredCvdStatus against an IshiharaResult['status'] — two different enumerations —
   * and the only test on it was a regex over that line, which could not see the defect. It is a
   * pure function now, and this is the whole truth table.
   */
  const TRUTH_TABLE = [
    { prior: 'screen_failed', result: 'normal', inherited: true, why: 'a prior failure survives a later pass; the counts stay with the failure' },
    { prior: 'screen_failed', result: 'inconclusive', inherited: true, why: 'this attempt measured nothing, so it has no counts worth keeping' },
    { prior: 'screen_failed', result: 'screen_failed', inherited: false, why: 'this administration failed too; its own counts describe it' },
    { prior: 'normal', result: 'screen_failed', inherited: false, why: 'a first failure is this administration’s' },
    { prior: 'normal', result: 'normal', inherited: false, why: 'an ordinary pass' },
    { prior: 'normal', result: 'inconclusive', inherited: false, why: 'the control was missed HERE, and that is what the counts show' },
    { prior: 'self_reported_deficient', result: 'normal', inherited: false, why: 'the self-report is not an administration and inherits no counts' },
    { prior: 'self_reported_deficient', result: 'screen_failed', inherited: false, why: 'the screen ran and produced a result of its own' },
    { prior: 'self_reported_deficient', result: 'inconclusive', inherited: false, why: 'the screen ran; the control is what it failed' },
  ] as const;

  for (const { prior, result, inherited, why } of TRUTH_TABLE) {
    it(`prior=${prior} result=${result} -> inherited=${inherited} (${why})`, () => {
      const status = resolveCvdStatus(prior, result);
      expect(countsComeFromPriorAdministration(status, result)).toBe(inherited);
    });
  }

  it('does not discard a self-reporting participant’s screen result', () => {
    /*
     * The regression. PARTICIPANT_PROFILE writes cvd_status='self_reported_deficient' two stages
     * before COLOR_VISION, so on a FIRST sitting the old predicate was true, and the handler wrote
     * the prior counts — null. Three things followed: the codebook says null means "not run", which
     * was then false; the operator manual tells the operator to compare the self-report against the
     * app's screen and record both if they disagree, which that row cannot support; and
     * `cvd_screen_total != null` is what the setup state machine uses to decide this stage is done,
     * so the screen was re-administered on every resume of that participant's session.
     */
    const status = resolveCvdStatus('self_reported_deficient', 'normal');
    expect(status).toBe('self_reported_deficient');
    expect(countsComeFromPriorAdministration(status, 'normal')).toBe(false);
  });

  it('the codebook says which administration the counts belong to', () => {
    // Against the BUILT codebook, not the source line: the entry is assembled from several pieces
    // now, and a source-text search would have started passing vacuously when it was reformatted.
    expect(cvdEntry('cvd_screen_correct')).toMatch(/administration that produced cvd_status/);
  });
});

/**
 * The app's own screen is a covariate. The operator's formal plates are the criterion.
 *
 * The COLOR_VISION handler asserted 'failed the colour-vision screening' as an exclusion, which set
 * eligible=false — and the codebook tells the analyst rows with eligible=false MUST be dropped. So a
 * complete ~2-hour dataset was discarded on a home-made six-plate screen with unknown specificity,
 * contradicting ishihara.ts's own header, the exported codebook, OPERATOR_MANUAL.md, and a comment
 * in the profile stage of the same file recording that this was already fixed there.
 */
describe('the app’s colour screen does not exclude anyone', () => {
  const experiment = readFileSync('src/experiment/Experiment.tsx', 'utf8');

  /**
   * Comments removed, so an assertion about what the code DOES is not satisfied or broken by prose
   * about what it used to do. The comment recording this defect necessarily quotes the string the
   * code must no longer emit; without this the guard would trip on its own explanation, and
   * softening the guard to let the explanation through is how a guard stops meaning anything.
   */
  const codeOnly = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');

  it('excludes on the self-report only, never on the screen result', () => {
    expect(experiment).toMatch(/const failsColourVision = status === 'self_reported_deficient';/);
    expect(codeOnly(experiment), 'the screen result is asserted as an exclusion reason again').not.toMatch(
      /failed the colour-vision screening/,
    );
  });

  it('keeps the self-report and the formal plates as the two criteria that remain', () => {
    // The self-report, asserted here; the formal plates, asserted by the profile stage. Both are
    // still exclusions — the point of the change is WHICH instrument decides, not that nothing does.
    expect(experiment).toMatch(/'self-reported colour-vision deficiency'/);
    expect(experiment).toMatch(/reasons\.push\('colour-vision deficiency on formal plates'\)/);
  });

  it('still records the failure, so the analyst can model or exclude on it', () => {
    // Not excluding is not the same as not knowing. cvd_status stays sticky and the counts ship.
    expect(resolveCvdStatus('screen_failed', 'normal')).toBe('screen_failed');
    expect(experiment).toMatch(/cvd_status: status,/);
  });

  it('retires a stale exclusion written by an earlier build rather than orphaning it', () => {
    // The stage no longer emits the reason but still OWNS the pattern, so the next administration
    // strips it. Dropping the pattern would leave it attached for ever, asserted by nothing.
    const elig = readFileSync('src/experiment/eligibility.ts', 'utf8');
    expect(elig).toMatch(/colour_vision: \[\/colour-vision screening\/i/);
    expect(elig).toMatch(/RECOGNISED BUT NO LONGER EMITTED/);
  });

  it('tells the operator to run the formal plates, while the participant is still there', () => {
    /*
     * The screen not excluding is only safe if someone acts on it. The dashboard shows no
     * colour-vision status at all, so before this the first reader of screen_failed was the
     * analyst, months later, with cvd_clinical=not_done beside it. The notice is shown for
     * screen_failed AND for inconclusive, and it is shown AFTER the result is persisted.
     */
    const ui = readFileSync('src/screening/IshiharaTest.tsx', 'utf8');
    expect(ui).toMatch(/if \(result\.status === 'normal'\) onDone\(\);\s*\n\s*else setNotice\(result\.status\)/);
    expect(ui).toMatch(/void Promise\.resolve\(onComplete\(result\)\)\.then/);
    expect(ui).toMatch(/Administer the formal plates/);
    expect(ui).toMatch(/does not exclude anyone and it is not a diagnosis/);
  });
});

describe('the exported codebook states the rule the screen actually applied', () => {
  it('gives the true denominator, and says the control plate is not in it', () => {
    /*
     * It said "six-plate digital screen" and, for the total, "Plates presented. The denominator."
     * The value is 5: the greyscale control is presented and scored into neither the numerator nor
     * the denominator. An analyst reconciling 4/5 against "six-plate ... plates presented" concludes
     * a plate was dropped.
     */
    const correct = cvdEntry('cvd_screen_correct');
    const total = cvdEntry('cvd_screen_total');
    expect(correct).toContain(`out of ${SCREEN_TEST_PLATES}, not out of ${SCREEN_TEST_PLATES + 1}`);
    expect(correct).toMatch(/greyscale control/i);
    expect(total).toContain(String(SCREEN_TEST_PLATES));
    expect(total).toMatch(/not scored|presented but not scored/i);
  });

  it('states the pass rule, which lived only in the source', () => {
    // 4-of-5 appeared nowhere in docs/, spec/, or either codebook. From the bundle alone nothing
    // said what turned cvd_screen_correct=4 into cvd_status=normal, nor that 3 would not have.
    expect(cvdEntry('cvd_screen_correct'))
      .toContain(`${SCREEN_TEST_PLATES - SCREEN_ALLOWED_SLIPS} or more correct is 'normal'`);
  });

  it('states how the plates are built, and what the score shape means', () => {
    /*
     * This entry used to say the screen's errors ran toward FALSE NEGATIVES, because its palettes
     * were iso-luminant only in the normal observer's luminance space and a protanope could read
     * the digit off the residual edge. That is no longer true of the instrument, so it must no
     * longer be true of the codebook: each plate is now a metamer pair for one deficiency, and the
     * entry states the construction and the score shape it implies instead of a warning about a
     * defect that has been fixed. A codebook that keeps a retired caveat is as wrong as one that
     * omits a live one.
     */
    const correct = cvdEntry('cvd_screen_correct');
    expect(correct).toMatch(/PROTAN confusion/);
    expect(correct).toMatch(/DEUTAN/);
    expect(correct).toMatch(/Viénot, Brettel & Mollon \(1999\)/);
    expect(correct).toMatch(/blank disc/);
    /*
     * The score shape an analyst will actually see. This said "score around half", from the
     * cross-axis contrast ratio being a non-trivial 1.19-1.20 — which turned out to be reasoning
     * about a number rather than about a plate. Rendered through the simulation (see
     * `scripts/platePreview.ts`), a ~20% luminance difference does not carry a digit through a
     * noisy dot field: the cross-axis plates read as uniform too. So the expected pattern is a
     * near-zero score WITH THE CONTROL CORRECT, and the codebook must say that, because "around
     * half" would have had an analyst treating the real signature as something else.
     */
    expect(correct).toMatch(/at or near zero on the confusion plates/i);
    expect(correct).toMatch(/GREYSCALE CONTROL CORRECT/);
    expect(correct).toMatch(/separates a colour-vision deficiency from inattention/i);
  });

  it('still states the limits that remain, now that the luminance one is gone', () => {
    // Fixing one limitation must not quietly retire the others. Three stand: unknown operating
    // characteristics, the dichromatic extreme rather than anomalous trichromacy, and not a criterion.
    const correct = cvdEntry('cvd_screen_correct');
    expect(correct).toMatch(/sensitivity and specificity are unknown/);
    expect(correct).toMatch(/DICHROMATIC extreme/);
    expect(correct).toMatch(/anomalous trichromacy/);
    expect(correct).toMatch(/never a criterion for exclusion/);
  });

  it('warns the analyst that a failed screen is IN the sample', () => {
    // The consequence of the screen no longer excluding: rows with screen_failed now reach the
    // confirmatory analysis, and the codebook has to say so rather than leave it to be discovered.
    const status = cvdEntry('cvd_status');
    expect(status).toMatch(/NEITHER screen_failed NOR screen_inconclusive sets eligible=false/);
    expect(status).toMatch(/cvd_clinical/);
  });
});

describe('a plate set that measured nothing is not scored as a pass', () => {
  it('calls an empty confusion set inconclusive, not normal', () => {
    // `testCorrect >= test.length - SCREEN_ALLOWED_SLIPS` reads `0 >= -1` on an empty set, so
    // scoreIshihara([], {}) returned a clean bill of colour vision.
    const r = scoreIshihara([], {});
    expect(r.status).toBe('inconclusive');
    expect(r.testTotal).toBe(0);
  });

  it('is unreachable from the app, which always builds a full set', () => {
    const plates = buildScreeningPlates(7);
    expect(plates.filter((p) => p.axis !== 'control')).toHaveLength(SCREEN_TEST_PLATES);
    expect(plates).toHaveLength(SCREEN_TEST_PLATES + 1);
  });

  it('applies the allowance it documents', () => {
    const plates = buildScreeningPlates(7);
    const all = Object.fromEntries(plates.map((p) => [p.id, p.digit]));
    const test = plates.filter((p) => p.axis !== 'control');
    const wrong = (n: number) => {
      const a = { ...all };
      for (let i = 0; i < n; i++) a[test[i].id] = 'x';
      return scoreIshihara(plates, a).status;
    };
    expect(wrong(SCREEN_ALLOWED_SLIPS)).toBe('normal');
    expect(wrong(SCREEN_ALLOWED_SLIPS + 1)).toBe('screen_failed');
  });
});
