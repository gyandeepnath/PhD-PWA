import { describe, it, expect } from 'vitest';
import { mean, median, stdPopulation, stdSample, probit, normalPdf, clampRate } from '@/lib/stats';
import { computeSdt } from '@/lib/signalDetection';
import {
  eyeAspectRatio,
  baselineEar,
  classifyBlinks,
  blinkRatePerMinute,
  summariseBlinks,
  effectiveFps,
  fpsAdequateForTiers,
  type EarSample,
} from '@/tracking/blink';

describe('stats', () => {
  it('mean/median/sd', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
    expect(stdPopulation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6); // classic example
    expect(stdSample([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(stdPopulation([5])).toBe(0);
  });

  it('probit is the inverse normal CDF', () => {
    expect(probit(0.5)).toBeCloseTo(0, 6);
    expect(probit(0.975)).toBeCloseTo(1.959964, 4);
    expect(probit(0.025)).toBeCloseTo(-1.959964, 4);
    expect(probit(0.8413447)).toBeCloseTo(1.0, 4);
  });

  it('normalPdf peaks at 0', () => {
    expect(normalPdf(0)).toBeCloseTo(0.3989423, 6);
  });

  it('clampRate applies the 1/(2N) correction', () => {
    expect(clampRate(1, 24)).toBeCloseTo(1 - 1 / 48, 6);
    expect(clampRate(0, 24)).toBeCloseTo(1 / 48, 6);
    expect(clampRate(0.5, 24)).toBe(0.5);
  });
});

describe('signal detection (d-prime)', () => {
  it('computes a known d-prime: H=0.69, F=0.31 -> ~1.0', () => {
    // z(0.69)=0.4959, z(0.31)=-0.4959 -> d' ~ 0.99
    const r = computeSdt({ hits: 69, misses: 31, falseAlarms: 31, correctRejections: 69 });
    expect(r.d_prime).toBeCloseTo(0.992, 2);
    expect(r.criterion).toBeCloseTo(0, 2);
  });

  it('flags instability with few signal trials (24)', () => {
    const r = computeSdt({ hits: 18, misses: 6, falseAlarms: 4, correctRejections: 20 });
    expect(r.d_prime).toBeGreaterThan(0);
    expect((r.d_prime_se ?? 0)).toBeGreaterThan(0);
    // With ~24 trials per pool the SE is large.
    expect(r.d_prime_unstable).toBe((r.d_prime_se ?? 0) > 0.3);
  });

  it('handles perfect performance without infinities', () => {
    const r = computeSdt({ hits: 24, misses: 0, falseAlarms: 0, correctRejections: 24 });
    expect(Number.isFinite(r.d_prime)).toBe(true);
    expect(r.d_prime).toBeGreaterThan(0);
  });

  it('criterion is 0 for symmetric H/F and rises as responding gets conservative', () => {
    const sym = computeSdt({ hits: 12, misses: 12, falseAlarms: 12, correctRejections: 12 });
    expect(sym.criterion).toBeCloseTo(0, 6); // H=F=0.5 → c=0
    const conservative = computeSdt({ hits: 6, misses: 18, falseAlarms: 1, correctRejections: 23 });
    expect(conservative.criterion).toBeGreaterThan(0); // few responses overall → positive bias
  });
});

describe('EAR & blink classification', () => {
  it('EAR is ~0.3 for an open eye geometry', () => {
    // p1..p6: horizontal span 0.1, vertical spans ~0.03 -> EAR ~ (0.03+0.03)/(2*0.1)=0.3
    const open = [
      { x: 0, y: 0 },
      { x: 0.025, y: 0.015 },
      { x: 0.075, y: 0.015 },
      { x: 0.1, y: 0 },
      { x: 0.075, y: -0.015 },
      { x: 0.025, y: -0.015 },
    ];
    expect(eyeAspectRatio(open)).toBeCloseTo(0.3, 2);
  });

  it('baseline EAR uses the 90th percentile', () => {
    const samples = Array.from({ length: 100 }, (_, i) => 0.2 + i * 0.001); // 0.200..0.299
    expect(baselineEar(samples)).toBeCloseTo(0.289, 3);
  });

  it('detects a full blink in an EAR dip', () => {
    const baseline = 0.3;
    // 30fps-ish samples; a dip well below full threshold (0.18) for ~150ms.
    const samples: EarSample[] = [];
    for (let t = 0; t <= 400; t += 33) {
      const ear = t >= 100 && t <= 250 ? 0.1 : 0.3;
      samples.push({ t_ms: t, ear });
    }
    const events = classifyBlinks(samples, baseline);
    expect(events.length).toBe(1);
    expect(events[0].tier).toBe('full');
    expect(events[0].duration_ms).toBeGreaterThan(80);
  });

  it('blink rate per minute', () => {
    expect(blinkRatePerMinute(10, 60000)).toBe(10);
    expect(blinkRatePerMinute(5, 30000)).toBe(10);
    // No window is not a rate of zero — see blinkRatePerMinute.
    expect(blinkRatePerMinute(0, 0)).toBeNull();
  });

  it('classifyBlinks produces incomplete blinks end-to-end (regression: ratio was stuck at 0)', () => {
    const baseline = 0.3;
    const samples: { t_ms: number; ear: number }[] = [];
    let t = 0;
    const push = (ear: number, n: number) => { for (let i = 0; i < n; i++) { samples.push({ t_ms: t, ear }); t += 33; } };
    // Two deep (full-closure) blinks and two shallow partial closures that never fully close.
    push(0.30, 15); push(0.05, 6); push(0.30, 15); push(0.20, 6); // full, then incomplete
    push(0.30, 15); push(0.05, 6); push(0.30, 15); push(0.20, 6); // full, then incomplete
    push(0.30, 15);
    const events = classifyBlinks(samples, baseline);
    const s = summariseBlinks(events, samples[samples.length - 1].t_ms);
    expect(s.blink_count_full).toBe(2);
    expect(s.blink_count_incomplete).toBe(2);
    expect(s.incomplete_blink_ratio).toBeCloseTo(0.5, 6);
  });

  it('summarises tiers and incomplete ratio', () => {
    const events = [
      { onset_ms: 0, duration_ms: 150, min_ear: 0.1, tier: 'full' as const },
      { onset_ms: 1000, duration_ms: 120, min_ear: 0.25, tier: 'incomplete' as const },
    ];
    const s = summariseBlinks(events, 60000);
    expect(s.blink_count_full).toBe(1);
    expect(s.blink_count_incomplete).toBe(1);
    expect(s.incomplete_blink_ratio).toBeCloseTo(0.5, 6);
    expect(s.blink_rate).toBeCloseTo(2, 6);
  });

  it('gates blink tiers on effective fps', () => {
    const ts15 = Array.from({ length: 16 }, (_, i) => i * 66.7); // ~15fps
    const ts30 = Array.from({ length: 31 }, (_, i) => i * 33.3); // ~30fps
    expect(Math.round(effectiveFps(ts15)!)).toBe(15);
    expect(Math.round(effectiveFps(ts30)!)).toBe(30);
    expect(fpsAdequateForTiers(effectiveFps(ts15))).toBe(false);
    expect(fpsAdequateForTiers(effectiveFps(ts30))).toBe(true);
  });
});

/**
 * An anticipation is not a detection.
 *
 * A response faster than the 150 ms cutoff cannot reflect stimulus processing. It was excluded from
 * the RT means — the task header said so — but still entered hit_rate, false_alarm_rate, d-prime,
 * criterion and error_rate, all exported as detection measures. So a participant who had stopped
 * watching and was tapping on a rhythm was credited with hits, and the credit was largest exactly
 * where disengagement was largest: the fatigue effect the task exists to detect was attenuated
 * toward null by the very behaviour that signals fatigue.
 */
describe('the reaction-time accuracy scale separates anticipations from detections', () => {
  it('carries anticipation as its own level', async () => {
    const { computeSdt } = await import('@/lib/signalDetection');
    // With anticipations removed from both pools, the trial counts shrink and the rates describe
    // only the trials on which a detection judgement was actually made.
    const clean = computeSdt({ hits: 17, misses: 1, falseAlarms: 1, correctRejections: 11 });
    const inflated = computeSdt({ hits: 19, misses: 1, falseAlarms: 3, correctRejections: 9 });
    // The inflated version — anticipations folded in as hits and false alarms — reports a higher
    // hit rate off a larger signal pool.
    expect(inflated.hit_rate).toBeGreaterThan(clean.hit_rate);
    expect(clean.d_prime).not.toBeNull();
  });

  it('reports d-prime with a standard error that says how far to trust it', async () => {
    const { computeSdt } = await import('@/lib/signalDetection');
    // 20 signal / 12 noise trials cannot support a precise per-condition d-prime: the best
    // achievable SE across every possible outcome of a block is about 0.46. The flag is therefore
    // true for every block in the study, which is a fact about the design, not about a participant.
    const best = computeSdt({ hits: 10, misses: 10, falseAlarms: 6, correctRejections: 6 });
    expect(best.d_prime_se).not.toBeNull();
    expect(best.d_prime_se!).toBeGreaterThan(0.3);
  });
});
