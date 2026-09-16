import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveCvdStatus } from '@/screening/ishihara';
import { isFigurePixel, scoreIshihara, PLATES } from '@/screening/ishihara';
import { cvsqItemScore, scoreCvsq, CVSQ_ITEMS, CVSQ_CUTOFF } from '@/scales/cvsq';

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

  it('detects when stickiness inherited an earlier verdict', () => {
    expect(experiment).toMatch(/const inheritedVerdict = status === p\.cvd_status && status !== r\.status;/);
  });

  it('writes the prior administration’s counts in exactly that case', () => {
    expect(experiment).toMatch(/cvd_screen_correct: inheritedVerdict \? p\.cvd_screen_correct : r\.testCorrect/);
    expect(experiment).toMatch(/cvd_screen_total: inheritedVerdict \? p\.cvd_screen_total : r\.testTotal/);
  });

  it('is the case resolveCvdStatus actually produces', () => {
    // prior failed, this administration passed -> status stays screen_failed while r.status is
    // 'normal', which is precisely the inheritedVerdict condition.
    expect(resolveCvdStatus('screen_failed', 'normal')).toBe('screen_failed');
    // and a first failure is NOT inherited: status comes from this administration, counts follow it
    expect(resolveCvdStatus('normal', 'screen_failed')).toBe('screen_failed');
  });

  it('the codebook says which administration the counts belong to', () => {
    const cb = readFileSync('src/storage/export.ts', 'utf8');
    const entry = cb.split('\n').find((l) => l.includes("column: 'cvd_screen_correct'")) ?? '';
    expect(entry).toMatch(/administration that produced cvd_status/);
  });
});
