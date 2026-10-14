/**
 * The camera self-test simulation (Round 79; src/sim/selfTestSim.ts, scripts/selfTestSim.ts,
 * docs/FPS_GATE_SIMULATION.md). The full run is not part of verify; this pins a small fixed-seed run of
 * what the Round 79 audit reports, so a change to the rule, the aggregator or the simulated camera that
 * moves those numbers shows here.
 */
import { describe, it, expect } from 'vitest';
import { runSelfTestScenario, CHECK_MS, type SelfTestCell, type SelfTestScenario } from '@/sim/selfTestSim';
import { SELF_TEST } from '@/tracking/selfTest';

const cell = (fps: number): SelfTestCell => ({ label: `${fps}`, plan: { kind: 'regular', fps, exposureMs: 'frame' } });
const dropping: SelfTestCell = { label: 'drop', plan: { kind: 'drop', cameraFps: 30, keep: 0.8, exposureMs: 'frame' } };
const base: SelfTestScenario = { name: 't', shape: 'cosine', sigma: 0.03, faceLossMs: 0, blinks: true, runs: 40, seed: 4242 };

describe('the camera self-test under simulation', () => {
  it('lasts as long as the screen runs it', () => {
    expect(CHECK_MS).toBe(SELF_TEST.FIRST_CUE_MS + SELF_TEST.CUES * SELF_TEST.CUE_EVERY_MS + 1500);
  });

  it('a participant who blinks at every flash passes st-r2 and st-r3 at 24 fps — and never passed st-r1 there', () => {
    const r = runSelfTestScenario(base, [cell(24), dropping, cell(30)]);
    expect(r['24']).toMatchObject({ passR1: 0, passR2: 1, passR3: 1 });
    expect(r['24'].verdict.working).toBe(1);
    expect(r['24'].hitsOk).toBe(1);
    // A tracker keeping 80% of a 30-fps camera's frames is the same ~24: st-r2 passes it as working.
    expect(r.drop.passR2).toBe(1);
    expect(r.drop.passR1).toBeLessThan(0.1);
    // At 30 the two rules agree.
    expect(r['30']).toMatchObject({ passR1: 1, passR2: 1 });
  });

  it('passes as "reduced" at 18, fails under 15', () => {
    const r = runSelfTestScenario(base, [cell(18), cell(12)]);
    expect(r['18'].verdict.reduced).toBe(1);
    expect(r['12'].passR2).toBe(0);
    // Not for want of blinks: they were seen; the rate is what fails.
    expect(r['12'].hitsOk).toBe(1);
  });

  it('a second without a face no longer fails the rate: st-r2 judges the rate while the face was seen', () => {
    const r = runSelfTestScenario({ ...base, faceLossMs: 1000 }, [cell(25), cell(30)]);
    expect(r['25'].passR2).toBe(1);
    expect(r['25'].passR1).toBe(0); // the whole-window rate reads about 23.7
    expect(r['25'].meanFps).toBeLessThan(24);
    expect(r['25'].meanSamplingFps).toBeGreaterThan(24.9);
  });

  it('landmark noise alone, with no blink at all, passed no attempt at any rate', () => {
    const r = runSelfTestScenario({ ...base, shape: 'linear', sigma: 0.04, blinks: false }, [cell(15), cell(24), cell(30)]);
    for (const k of ['15', '24', '30']) expect(r[k].passR2, k).toBe(0);
    for (const k of ['15', '24', '30']) expect(r[k].passR3, k).toBe(0);
  });

  /*
   * Round 82. Blinks that answer no flash — a participant who ignores the flashes and blinks only
   * spontaneously — passed st-r2 often, because a blink up to 1.2 s BEFORE a flash counted. st-r3 counts
   * only blinks after a flash. The full run (npm run sim:selftest, 1,000 attempts) is in
   * docs/FPS_GATE_SIMULATION.md; this pins a small one. The rate is a simulation assumption.
   */
  it('blinks that answer no flash pass st-r3 far less often than st-r2; a participant who answers loses nothing', () => {
    const spont = runSelfTestScenario({ ...base, blinks: false, spontaneousPerMin: 20, runs: 300 }, [cell(24)])['24'];
    // The camera saw the blinks: about 20 a minute over the 19-s check.
    expect(spont.meanBlinks).toBeGreaterThan(5.5);
    expect(spont.meanBlinks).toBeLessThan(7.5);
    expect(spont.passR2).toBeGreaterThan(0.25);
    expect(spont.passR3).toBeLessThan(0.15);
    expect(spont.passR3).toBeLessThan(spont.passR2 / 3);
    // Answering every flash and blinking spontaneously besides: st-r3 passes every attempt st-r2 did.
    const both = runSelfTestScenario({ ...base, spontaneousPerMin: 20, runs: 100 }, [cell(24), cell(15)]);
    expect(both['24']).toMatchObject({ passR2: 1, passR3: 1, meanHits: 5 });
    expect(both['15'].passR3).toBe(both['15'].passR2);
  });

  it('is deterministic: the same seed gives the same numbers', () => {
    expect(runSelfTestScenario({ ...base, runs: 10 }, [cell(20)])).toEqual(runSelfTestScenario({ ...base, runs: 10 }, [cell(20)]));
  });
});
