/**
 * The frame-rate simulation behind gate fps-g2 (Round 79; src/sim/fpsGate.ts, scripts/fpsGateSim.ts,
 * docs/FPS_GATE_SIMULATION.md). The full run takes minutes and is not part of verify; these tests pin
 * what it rests on, so a change to the simulated camera, the matching of blinks or the statistics shows
 * here rather than silently moving the numbers the gate was set from.
 */
import { describe, it, expect } from 'vitest';
import {
  runScenario, frameValue, closureIntegral, ratio, kappa, pairedDiff, slope, exposureOf, detectionByDepth,
  type Blink, type Cell,
} from '@/sim/fpsGate';
import { frameClosure } from '@/tracking/blinkFit';

const blink: Blink = { t0: 1000, depth: 0.4, down: 100, up: 220 };

describe('the simulated camera', () => {
  it('averages the lid over each frame\'s exposure exactly', () => {
    for (const shape of ['cosine', 'linear'] as const) {
      for (const t of [1030, 1100, 1120, 1250, 1330]) {
        for (const E of [10, 33.3, 50]) {
          // A fine numerical average of the instantaneous openness over [t - E, t].
          let num = 0;
          const k = 4000;
          for (let i = 0; i < k; i++) num += frameValue(t - E + (E * (i + 0.5)) / k, 0, [blink], shape);
          expect(frameValue(t, E, [blink], shape), `${shape} t ${t} E ${E}`).toBeCloseTo(num / k, 6);
        }
      }
    }
    // A whole blink integrates to half its length for both profiles (symmetric halves of each phase).
    expect(closureIntegral(10_000, blink, 'cosine')).toBeCloseTo(160, 9);
    expect(closureIntegral(10_000, blink, 'linear')).toBeCloseTo(160, 9);
  });

  it('models a cosine blink exactly as the fitted minimum does, from separate code', () => {
    // The simulation's camera and blinkFit.ts's template are written independently; for the cosine
    // profile they must agree, or the fit would be tested against a camera it cannot represent.
    for (const t of [1040, 1100, 1180, 1300]) {
      for (const E of [0, 15, 40]) {
        const sim = frameValue(t, E, [blink], 'cosine');
        const fit = 1 - (1 - blink.depth) * frameClosure(t, blink.t0, blink.down, blink.up, E);
        expect(sim).toBeCloseTo(fit, 10);
      }
    }
  });

  it('never exposes a frame for longer than the frame interval', () => {
    expect(exposureOf({ kind: 'regular', fps: 20, exposureMs: 'frame' })).toBe(50);
    expect(exposureOf({ kind: 'regular', fps: 30, exposureMs: 40 })).toBeCloseTo(1000 / 30, 9);
    expect(exposureOf({ kind: 'drop', cameraFps: 30, keep: 0.8, exposureMs: 10 })).toBe(10);
  });
});

describe('the statistics', () => {
  it('computes the ratio, kappa, a paired difference and a slope', () => {
    const truth = Int8Array.from([1, 1, 0, 0, 0, 0, 1, 0]);
    const a = Int8Array.from([1, 0, 0, 0, 0, 0, 1, -1]); // the last blink was not detected
    expect(ratio(a)).toBeCloseTo(2 / 7, 12);
    // 6 of 7 agree; p_a = 2/7, p_t = 3/7: kappa = (6/7 - pe) / (1 - pe).
    const pe = (2 / 7) * (3 / 7) + (5 / 7) * (4 / 7);
    expect(kappa(a, truth)).toBeCloseTo((6 / 7 - pe) / (1 - pe), 12);
    const d = pairedDiff(truth, a); // over the 7 blinks detected in both: one +1, six 0
    expect(d.diff).toBeCloseTo(1 / 7, 12);
    expect(slope([20, 25, 30], [3, 2, 1])).toBeCloseTo(-0.2, 12);
  });
});

describe('a small fixed-seed run', () => {
  const cells: Cell[] = [20, 30, 60].map((fps) => ({ label: String(fps), plan: { kind: 'regular', fps, exposureMs: 'frame' } }));
  const run = () => runScenario({ name: 'pin', shape: 'cosine', sigma: 0.03, runs: 6, seed: 42 }, cells);

  it('is deterministic', () => {
    const a = run(), b = run();
    expect(a.nBlinks).toBe(b.nBlinks);
    for (const c of ['20', '30', '60']) expect(Array.from(a.cells[c].cls)).toEqual(Array.from(b.cells[c].cls));
  });

  it('finds nearly every blink and keeps the numbers it was committed with', () => {
    const r = run();
    expect(r.nBlinks).toBe(PINNED.nBlinks);
    for (const c of ['20', '30', '60']) {
      expect(r.cells[c].detection, `detection at ${c} fps`).toBeGreaterThan(0.95);
      expect(ratio(r.cells[c].cls), `ratio at ${c} fps`).toBeCloseTo(PINNED.ratio[c as '20'], 10);
    }
    // Every blink deeper than 0.70 is found at 20 fps: the misses sit at the registration cut.
    const [deep] = detectionByDepth(r, '20', [[0, 0.7]]);
    expect(deep.detection).toBe(1);
  });

  it('fits the minimum when asked, and leaves the lowest-frame class alone', () => {
    const r = runScenario({ name: 'pin-fit', shape: 'cosine', sigma: 0.03, runs: 2, seed: 7 },
      [{ label: '24', plan: { kind: 'regular', fps: 24, exposureMs: 'frame' }, fit: 'true' }]);
    const c = r.cells['24'];
    const plain = runScenario({ name: 'pin-fit', shape: 'cosine', sigma: 0.03, runs: 2, seed: 7 },
      [{ label: '24', plan: { kind: 'regular', fps: 24, exposureMs: 'frame' } }]).cells['24'];
    expect(c.clsFit).not.toBeNull();
    expect(plain.clsFit).toBeNull();
    expect(Array.from(c.cls)).toEqual(Array.from(plain.cls));
    // Detected blinks get a fitted class; undetected ones stay -1 in both.
    c.cls.forEach((v, i) => expect(c.clsFit![i] < 0).toBe(v < 0));
  });
});

/** The values the small run gave when the simulation was committed. Change only with the simulation. */
const PINNED = {
  nBlinks: 180,
  ratio: { '20': 0.25842696629213485, '30': 0.24444444444444444, '60': 0.22777777777777777 },
};
