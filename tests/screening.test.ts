import { describe, it, expect } from 'vitest';
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
