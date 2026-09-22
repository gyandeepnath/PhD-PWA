import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveCvdStatus, countsComeFromPriorAdministration, buildScreeningPlates, SCREEN_TEST_PLATES, SCREEN_ALLOWED_SLIPS } from '@/screening/ishihara';
import { isFigurePixel, scoreIshihara, PLATES } from '@/screening/ishihara';
import { cvsqItemScore, scoreCvsq, CVSQ_ITEMS, CVSQ_CUTOFF } from '@/scales/cvsq';
import { CODEBOOK } from '@/storage/export';

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
    answers[control.id] = '9';
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
describe('the screening set carries no learnable non-chromatic cue', () => {
  it('does not put the figure on the same side of the luminance boundary every time', async () => {
    const { buildScreeningPlates, luminancePolarityBalance } = await import('@/screening/ishihara');
    for (const seed of [0, 1, 2, 7, 42, 999]) {
      const b = luminancePolarityBalance(buildScreeningPlates(seed));
      expect(b.total).toBe(5);
      // Balanced, not merely random: no administration may present an all-one-way set.
      expect(b.figureLighter).toBeGreaterThan(0);
      expect(b.figureLighter).toBeLessThan(b.total);
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
