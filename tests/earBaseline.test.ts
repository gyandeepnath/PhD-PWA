/**
 * The open-eye EAR baseline must be measured in the posture the outcome is measured in.
 *
 * Every blink threshold in this study is a fraction of the participant's own open-eye EAR
 * (EAR_TIERS: 0.75 for onset, 0.60 for a complete closure), so the baseline is not a calibration
 * constant — it is the denominator of the primary outcome. It was collected from the frames of the
 * nine-point gaze routine, three of whose targets sit at the top of the screen. Up-gaze raises the
 * upper lid and widens the palpebral fissure; baselineEar() takes the 90th percentile, which is
 * precisely the statistic that finds those frames. The result sat above the participant's
 * straight-ahead open eye, and both thresholds scale with it.
 *
 * These tests cover the two halves of the fix: the arrangement (a dedicated centre-fixation window,
 * first, and no EAR sampling during the nine targets) and the consequence it prevents.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calibrationSequence, GAZE_DWELL_MS } from '@/tracking/calibrationSequence';
import { GAZE_TARGETS } from '@/tracking/gazeCalibration';
import {
  baselineEar, classifyBlinks, fitEarBaseline, EAR_TIERS,
  FPS_RATIO_THRESHOLD, MIN_EAR_BASELINE_SAMPLES, type EarSample,
} from '@/tracking/blink';
import { CONFIG } from '@/experiment/config';
import { EyeMetricsAggregator, type FrameSample } from '@/tracking/aggregator';

describe('calibration sequence', () => {
  const STEPS = calibrationSequence();

  it('measures the open eye before the eye is asked to move', () => {
    expect(STEPS[0].kind).toBe('ear_baseline');
  });

  it('opens exactly one EAR window', () => {
    expect(STEPS.filter((s) => s.kind === 'ear_baseline')).toHaveLength(1);
  });

  it('still presents all nine gaze targets, and none of them is an EAR window', () => {
    const targets = STEPS.filter((s) => s.kind === 'gaze_target');
    expect(targets.map((t) => (t as { id: string }).id)).toEqual(GAZE_TARGETS.map((t) => t.id));
    expect(targets.every((t) => t.kind === 'gaze_target')).toBe(true);
  });

  it('holds the baseline window long enough that a camera solving a fraction of its frames still fits one', () => {
    // At the rate the primary outcome requires (FPS_RATIO_THRESHOLD), the window yields this many
    // frames. The floor is MIN_EAR_BASELINE_SAMPLES usable ones, so the margin is the share of
    // frames that may fail to solve — glare, a half-second of looking away — and still calibrate.
    const framesAtGateRate = (CONFIG.EAR_BASELINE_MS / 1000) * FPS_RATIO_THRESHOLD;
    expect(framesAtGateRate / MIN_EAR_BASELINE_SAMPLES).toBeGreaterThanOrEqual(4);
  });

  it('keeps the gaze dwell long enough to fixate', () => {
    expect(GAZE_DWELL_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('the nine-point routine does not feed the baseline', () => {
  const src = readFileSync('src/tracking/useTracking.ts', 'utf8');
  /** Body of a top-level `const NAME = useCallback(...)` in the hook, up to its closing `}, [`. */
  const bodyOf = (name: string): string => {
    const from = src.indexOf(`const ${name} = useCallback(`);
    expect(from, `${name} not found in useTracking.ts`).toBeGreaterThan(-1);
    const to = src.indexOf('\n  }, [', from);
    return src.slice(from, to);
  };

  it('beginGazeCalibration opens no EAR sample window', () => {
    // `calibrating.current = { samples: ... }` is the window. It used to be opened here, which is
    // what pooled the up-gaze frames into the baseline.
    expect(bodyOf('beginGazeCalibration')).not.toMatch(/calibrating\.current\s*=\s*\{/);
  });

  it('endGazeCalibration fits no baseline of its own', () => {
    const body = bodyOf('endGazeCalibration');
    expect(body).not.toMatch(/fitEarBaseline\s*\(/);
    expect(body).not.toMatch(/baselineEar\s*\(/);
  });

  it('measureEarBaseline is the only place a baseline is fitted', () => {
    expect(bodyOf('measureEarBaseline')).toMatch(/fitEarBaseline\s*\(/);
    expect(src.match(/fitEarBaseline\s*\(/g) ?? []).toHaveLength(1);
  });
});

describe('what an up-gaze-inflated baseline does to the primary outcome', () => {
  /**
   * A participant's own numbers, in ratio terms. Straight-ahead open eye is 1.00 by construction;
   * up-gaze widens the fissure. The 15% figure is illustrative, not a measurement from this study —
   * the test asserts the DIRECTION and the misclassification, both of which hold for any inflation
   * large enough to move a blink minimum across the 0.60 threshold.
   */
  const CENTRE_OPEN = 0.30;
  const UP_GAZE_OPEN = 0.345;   // +15%
  const DOWN_GAZE_OPEN = 0.27;  // -10%

  /** The pool the baseline used to be taken from: 800 ms on each of nine targets, three rows. */
  const ninePointPool = (): number[] => [
    ...Array(24).fill(UP_GAZE_OPEN),    // tl, tc, tr
    ...Array(24).fill(CENTRE_OPEN),     // ml, cc, mr
    ...Array(24).fill(DOWN_GAZE_OPEN),  // bl, bc, br
  ];

  /** The pool it is taken from now: one window, centre fixation, normal blinking. */
  const centrePool = (): number[] => [
    ...Array(160).fill(CENTRE_OPEN),
    ...Array(20).fill(0.15),           // blinks happen in the window; the 90th percentile absorbs them
  ];

  it('pooling the nine-point frames overstates the open eye', () => {
    const pooled = baselineEar(ninePointPool())!;
    const centre = baselineEar(centrePool())!;
    expect(pooled).toBeGreaterThan(centre);
    expect(pooled / centre).toBeGreaterThan(1.1);
  });

  it('the centre window survives its own blinks', () => {
    expect(fitEarBaseline(centrePool()).baseline).toBeCloseTo(CENTRE_OPEN, 5);
  });

  /**
   * An incomplete blink: the lids approach but do not meet. Its minimum sits between the two
   * thresholds computed from the TRUE baseline — below 0.75 (so it is a blink) and above 0.60 (so
   * it is incomplete). That is the event the study counts.
   */
  const incompleteBlink = (): EarSample[] => {
    const mins = [CENTRE_OPEN, 0.24, 0.20, 0.192, 0.20, 0.24, CENTRE_OPEN]; // min = 0.64 x baseline
    return mins.map((ear, i) => ({ t_ms: 1000 + i * 33, ear }));
  };

  it('is counted as incomplete against the baseline measured at centre fixation', () => {
    const centre = baselineEar(centrePool())!;
    const events = classifyBlinks(incompleteBlink(), centre);
    expect(events).toHaveLength(1);
    expect(events[0].min_ear / centre).toBeGreaterThan(EAR_TIERS.full);
    expect(events[0].tier).toBe('incomplete');
  });

  it('is counted as COMPLETE against the pooled baseline — the primary outcome, biased downward', () => {
    const pooled = baselineEar(ninePointPool())!;
    const events = classifyBlinks(incompleteBlink(), pooled);
    expect(events).toHaveLength(1);
    // The same blink, the same eye, the same frames: only the denominator changed.
    expect(events[0].min_ear / pooled).toBeLessThan(EAR_TIERS.full);
    expect(events[0].tier).not.toBe('incomplete');
  });
});

describe('within-sitting drift is visible in the export', () => {
  const frame = (t_ms: number, ear: number): FrameSample => ({
    t_ms, ear,
    pose: { pitch: 1, yaw: 2, roll: 0.5 },
    zone: 'cc', isCenter: true, offAxis: false,
    facePresent: true, faceSize: 0.22, luma: 120,
  });

  /** A condition whose open eye sits at `open`, blinking at a realistic rate, calibrated at 0.30. */
  const conditionAt = (open: number, frames = 300) => {
    const a = new EyeMetricsAggregator();
    for (let i = 0; i < frames; i++) a.ingest(frame(i * 33, i % 45 < 3 ? open * 0.5 : open));
    return a.finalize({
      conditionId: 'c', sessionId: 's', cameraActive: true,
      baselineEarValue: 0.30, earThresholdUsed: 0.30 * EAR_TIERS.partial,
      gazeCalibrated: false, headPitchCalibrated: false,
    });
  };

  it('reports the condition’s own open eye, not the calibration baseline', () => {
    const late = conditionAt(0.27);   // 10% of lid droop, ninety minutes in
    expect(late.open_ear_measured).toBeCloseTo(0.27, 3);
    expect(late.ear_baseline).toBe(0.30);
  });

  it('makes the drift computable: the ratio falls below 1 as the eye tires', () => {
    const early = conditionAt(0.30).open_ear_measured!;
    const late = conditionAt(0.27).open_ear_measured!;
    expect(late / early).toBeLessThan(1);
    expect(late / 0.30).toBeCloseTo(0.9, 2);
  });

  it('reports nothing rather than a thin number when the condition was barely observed', () => {
    expect(conditionAt(0.30, MIN_EAR_BASELINE_SAMPLES - 1).open_ear_measured).toBeNull();
  });
});
