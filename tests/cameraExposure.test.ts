/**
 * The exposure step (Round 79; rule exp-r2 from Round 82, exp-r3 from Round 91): fix the exposure on the grey field and keep it only if the
 * camera stays at least as fast and the picture bright enough; otherwise compensation, otherwise auto —
 * and always say which and why.
 *
 * The fake camera below is a toy, not a model of the tablet: under auto it exposes 40 ms (25 fps) on the
 * grey field; a fixed exposure of t ms runs at min(30, 1000 / t) fps; brightness is exposure x gain.
 */
import { describe, it, expect } from 'vitest';
import { setExposure, isoLadder, compensationSteps, autoExposureState, benchLockLabel, restoreAutoExposure, EXPOSURE, EXPOSURE_RULE, type ExposureDeps } from '@/tracking/cameraExposure';

interface FakeOpts {
  modes?: string[];
  time?: { min: number; max: number } | null;
  iso?: { min: number; max: number } | null;
  comp?: { min: number; max: number; step: number } | null;
  /** The camera refuses manual exposure. */
  refuseManual?: boolean;
  /** The camera accepts the constraint but carries on in auto. */
  ignoresManual?: boolean;
  /**
   * The mode the camera reads back once 'manual' is applied. Chrome on Android reads back 'none': it
   * turns auto-exposure off without setting the auto-exposure lock flag, and reports NONE for that
   * (Chromium source, ledger #60; Round 82). Chrome's own fake camera echoes 'manual', which is why
   * exp-r1's refusal of 'none' never showed in a test.
   */
  readbackWhenManual?: string;
  /** Under a fixed exposure the camera runs at this rate whatever the exposure (a fixed frame duration). */
  manualFps?: number;
}

/** The step run to its end (no signal, so never stopped): its outcome. */
async function exposeNow(d: ExposureDeps) {
  const r = await setExposure(d);
  if (!r) throw new Error('the step returned null without being stopped');
  return r;
}

function fakeCamera(o: FakeOpts = {}) {
  const AUTO_MS = 40, AUTO_GAIN = 4, AUTO_LUMA = 120;
  const st: { mode: string; time100: number | null; iso: number | null; comp: number } = { mode: 'continuous', time100: null, iso: null, comp: 0 };
  const applied: Record<string, unknown>[] = [];
  const caps: Record<string, unknown> = {
    exposureMode: o.modes ?? ['manual', 'continuous'],
    ...(o.time === null ? {} : { exposureTime: { ...(o.time ?? { min: 1, max: 3000 }), step: 1 } }),
    ...(o.iso ? { iso: { ...o.iso, step: 1 } } : {}),
    ...(o.comp ? { exposureCompensation: o.comp } : {}),
  };
  const now = () => {
    if (st.mode === 'manual' && !o.ignoresManual) {
      const ms = (st.time100 ?? AUTO_MS * 10) / 10;
      const gain = (st.iso ?? 100) / 100;
      return { cameraFps: o.manualFps ?? Math.min(30, 1000 / Math.max(ms, 1000 / 30)), luma: AUTO_LUMA * (ms * gain) / (AUTO_MS * AUTO_GAIN) };
    }
    // Auto, possibly aiming darker: each -1 EV halves the brightness target, so the exposure halves.
    const f = 2 ** st.comp;
    const ms = AUTO_MS * f;
    return { cameraFps: Math.min(30, 1000 / Math.max(ms, 1000 / 30)), luma: AUTO_LUMA * f };
  };
  const deps: ExposureDeps = {
    capabilities: () => caps as MediaTrackCapabilities,
    settings: () => ({
      exposureMode: o.ignoresManual ? 'continuous' : (st.mode === 'manual' && o.readbackWhenManual) || st.mode,
      ...(st.mode === 'manual' ? { exposureTime: st.time100 ?? AUTO_MS * 10 } : {}),
      ...(st.iso != null ? { iso: st.iso } : {}),
      ...(o.comp ? { exposureCompensation: st.comp } : {}),
    }),
    apply: async (set) => {
      applied.push(set);
      if (set.exposureMode === 'manual' && o.refuseManual) throw Object.assign(new Error('no'), { name: 'OverconstrainedError' });
      if (typeof set.exposureMode === 'string') st.mode = set.exposureMode;
      if (typeof set.exposureTime === 'number') st.time100 = set.exposureTime;
      if (typeof set.iso === 'number') st.iso = set.iso;
      if (typeof set.exposureCompensation === 'number') st.comp = set.exposureCompensation;
      if (set.exposureMode === 'continuous') { st.time100 = null; st.iso = null; }
    },
    measure: async () => now(),
    wait: async () => {},
    now: () => 1,
  };
  return { deps, applied, st };
}

describe('the exposure step', () => {
  it('fixes the exposure at 30 ms and raises the ISO until the picture is as bright as under auto', async () => {
    const cam = fakeCamera({ iso: { min: 100, max: 3200 } });
    const r = await exposeNow(cam.deps);
    expect(r.policy).toBe('locked-v1');
    expect(r.reason).toBeNull();
    // Auto held 40 ms (25 fps); the lock shortens it to 30 ms, so the camera can run at 30.
    expect(r.exposure_time_100us).toBe(EXPOSURE.CAP_100US);
    expect(r.auto_fps).toBe(25);
    expect(r.lock_fps).toBeCloseTo(30, 6);
    // 30 ms at the default ISO is far darker than 40 ms at auto's gain: the ISO is doubled until it is not.
    expect(r.iso).toBe(800);
    expect(r.iso_steps).toBe(3);
    expect(r.lock_luma!).toBeGreaterThanOrEqual(EXPOSURE.LUMA_TARGET * r.auto_luma!);
    // Only image-capture constraints are sent (Chrome rejects a mix with size or frame rate).
    for (const a of cam.applied) expect(Object.keys(a).every((k) => ['exposureMode', 'exposureTime', 'iso', 'exposureCompensation'].includes(k))).toBe(true);
  });

  it('keeps the lock on a camera that reads back "none" for a fixed exposure, as Chrome on Android does (exp-r2)', async () => {
    const cam = fakeCamera({ iso: { min: 100, max: 3200 }, readbackWhenManual: 'none' });
    const r = await exposeNow(cam.deps);
    expect(r).toMatchObject({ rule: EXPOSURE_RULE, policy: 'locked-v1', reason: null, mode_readback: 'none', exposure_time_100us: EXPOSURE.CAP_100US, iso: 800 });
    // Nothing was undone: the last thing sent is the lock itself, not a return to auto.
    expect(cam.applied[cam.applied.length - 1]).toMatchObject({ exposureMode: 'manual' });
    // exp-r1 would have refused this sitting: the raw read-back is what lets a row be judged under both.
    const clean = await exposeNow(fakeCamera({ iso: { min: 100, max: 3200 } }).deps);
    expect(clean.mode_readback).toBe('manual');
  });

  it('still refuses a lock the camera reports as running auto-exposure, and records what it said', async () => {
    for (const said of ['continuous', 'single-shot', 'something-else']) {
      const r = await exposeNow(fakeCamera({ iso: { min: 100, max: 3200 }, readbackWhenManual: said }).deps);
      expect(r.policy, said).toBe('auto');
      expect(r.reason, said).toBe(`the camera did not keep the fixed exposure (it reports "${said}")`);
      expect(r.mode_readback, said).toBe(said);
    }
    expect(autoExposureState('manual')).toBe('off');
    expect(autoExposureState('none')).toBe('off');
    expect(autoExposureState('continuous')).toBe('on');
    expect(autoExposureState(undefined)).toBeNull();
  });

  it('a "none" read-back does not excuse the measured checks: a darker picture still undoes the lock', async () => {
    const r = await exposeNow(fakeCamera({ iso: null, readbackWhenManual: 'none' }).deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/too dark/);
    expect(r.mode_readback).toBe('none');
  });

  it('keeps the exposure auto-exposure chose when it is already 30 ms or shorter', async () => {
    const cam = fakeCamera({ iso: { min: 100, max: 3200 } });
    // A brighter scene: auto settled at 20 ms. The fake reports the held time once manual is applied.
    cam.deps.settings = () => ({ exposureMode: cam.st.mode, exposureTime: cam.st.time100 ?? 200 });
    const r = await exposeNow(cam.deps);
    expect(cam.applied.some((a) => 'exposureTime' in a)).toBe(false);
    expect(r.exposure_time_100us).toBe(200);
  });

  it('puts auto back, and says why, when the fixed exposure leaves the picture too dark', async () => {
    const r = await exposeNow(fakeCamera({ iso: null }).deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/too dark/);
    expect(r.iso).toBeNull();
    // What the attempt did is kept, so a reverted lock is not a blank.
    expect(r.lock_fps).toBeCloseTo(30, 6);
  });

  it('puts auto back when the fixed exposure makes the camera slower than under auto', async () => {
    const cam = fakeCamera({ iso: { min: 100, max: 3200 }, manualFps: 20 });
    const r = await exposeNow(cam.deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/slower \(20\.0 against 25\.0/);
    expect(cam.applied[cam.applied.length - 1]).toEqual({ exposureMode: 'continuous' });
  });

  it('does not call a camera that ignored the request "locked"', async () => {
    const r = await exposeNow(fakeCamera({ ignoresManual: true, iso: { min: 100, max: 3200 } }).deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/did not keep the fixed exposure/);
  });

  it('records a refusal, and falls back to compensation when the camera offers it', async () => {
    const refused = await exposeNow(fakeCamera({ refuseManual: true }).deps);
    expect(refused.policy).toBe('auto');
    expect(refused.reason).toMatch(/refused a fixed exposure \(OverconstrainedError\)/);

    const comp = await exposeNow(fakeCamera({ refuseManual: true, comp: { min: -2, max: 2, step: 1 / 3 } }).deps);
    expect(comp.policy).toBe('compensated-v1');
    // -1/3 EV keeps 79% of the brightness; -2/3 would keep 63%, under the 70% floor.
    expect(comp.exposure_comp).toBeCloseTo(-1 / 3, 3);
    expect(comp.reason).toMatch(/refused a fixed exposure/);
  });

  it('uses compensation when the camera offers no fixed exposure at all', async () => {
    const r = await exposeNow(fakeCamera({ modes: ['continuous'], time: null, comp: { min: -2, max: 2, step: 1 / 3 } }).deps);
    expect(r.policy).toBe('compensated-v1');
    expect(r.reason).toMatch(/only compensation/);
  });

  it('leaves a camera with no exposure control on auto, and says so', async () => {
    const r = await exposeNow(fakeCamera({ modes: ['continuous'], time: null }).deps);
    expect(r).toMatchObject({ policy: 'auto', reason: 'the camera offers no exposure control to the browser', lock_fps: null, auto_fps: 25 });
  });

  it('does not judge a lock it cannot measure', async () => {
    const cam = fakeCamera();
    cam.deps.measure = async () => ({ cameraFps: null, luma: null });
    const r = await exposeNow(cam.deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/could not be measured/);
    expect(cam.applied).toEqual([]);
  });
});

describe('the step measures "auto" under automatic exposure, whatever was left before it (exp-r3; audit 86 CAM-4)', () => {
  /*
   * The bench check runs this step between its halves, and used to end by setting only the mode back. On
   * a camera that ended the bench compensated, the participant's step then began from that compensation:
   * it recorded a darker "auto" than the camera's own and went darker again, below its own 70% floor.
   */
  const compOnly = () => fakeCamera({ modes: ['continuous'], time: null, comp: { min: -2, max: 2, step: 1 / 3 } });

  it('the bench, then the participant\'s step: "auto" is the camera\'s own, and the picture stays above the floor', async () => {
    const cam = compOnly();
    const bench = await exposeNow(cam.deps);
    expect(bench).toMatchObject({ policy: 'compensated-v1', auto_luma: 120 });
    expect(cam.st.comp).toBeCloseTo(-1 / 3, 3);
    // The bench's end: back to auto, the mode and the compensation (useTracking runCameraBench).
    await restoreAutoExposure(cam.deps.apply, cam.deps.capabilities());
    expect(cam.st.comp).toBe(0);
    const sitting = await exposeNow(cam.deps);
    expect(sitting).toMatchObject({ rule: EXPOSURE_RULE, policy: 'compensated-v1', auto_luma: 120 });
    expect(120 * 2 ** cam.st.comp).toBeGreaterThanOrEqual(EXPOSURE.LUMA_FLOOR * 120);
  });

  it('a camera still compensated when the step begins is put back on auto before "auto" is measured', async () => {
    const cam = compOnly();
    await cam.deps.apply({ exposureCompensation: -1 / 3 });
    cam.applied.length = 0;
    const r = await exposeNow(cam.deps);
    expect(cam.applied[0]).toEqual({ exposureMode: 'continuous' });
    expect(cam.applied[1]).toEqual({ exposureCompensation: 0 });
    expect(r.auto_luma).toBe(120);
    expect(r.auto_fps).toBe(25);
  });

  it('a camera left on a fixed exposure is put back on auto too; one already on auto gets no extra call', async () => {
    const locked = fakeCamera({ iso: { min: 100, max: 3200 } });
    await locked.deps.apply({ exposureMode: 'manual', exposureTime: 100 });
    locked.applied.length = 0;
    const r = await exposeNow(locked.deps);
    expect(locked.applied[0]).toEqual({ exposureMode: 'continuous' });
    expect(r.auto_fps).toBe(25);
    const fresh = fakeCamera({ iso: { min: 100, max: 3200 } });
    await exposeNow(fresh.deps);
    expect(fresh.applied[0]).toEqual({ exposureMode: 'manual' });
  });
});

describe('a stopped exposure step keeps nothing and leaves the camera on auto (audit 86 CAM-10)', () => {
  /*
   * The step ran to its end whatever happened: a tablet turned to portrait meanwhile had the sitting's
   * exposure fixed under the dark "rotate back" screen. Camera setup now aborts it on the rotation.
   */
  const stoppedAt = async (o: FakeOpts, stopOnMeasure: number) => {
    const cam = fakeCamera(o);
    const stop = new AbortController();
    let measures = 0;
    const measure = cam.deps.measure;
    cam.deps.measure = async (ms) => {
      measures += 1;
      const m = await measure(ms);
      if (measures === stopOnMeasure) stop.abort();
      return m;
    };
    const r = await setExposure({ ...cam.deps, signal: stop.signal });
    return { r, cam, measures };
  };

  it('stopped while auto is measured: null, no lock tried, the camera on auto', async () => {
    const { r, cam, measures } = await stoppedAt({ iso: { min: 100, max: 3200 } }, 1);
    expect(r).toBeNull();
    expect(measures).toBe(1);
    expect(cam.applied.some((a) => a.exposureMode === 'manual')).toBe(false);
    expect(cam.st.mode).toBe('continuous');
  });

  it('stopped with the lock in place: null, and the lock undone (mode back to continuous, compensation 0)', async () => {
    // Measures: auto, the brightness after the lock, then the ISO steps; stopped after the second.
    const { r, cam } = await stoppedAt({ iso: { min: 100, max: 3200 }, comp: { min: -2, max: 2, step: 1 / 3 } }, 2);
    expect(r).toBeNull();
    expect(cam.applied.some((a) => a.exposureMode === 'manual')).toBe(true);
    expect(cam.applied.slice(-2)).toEqual([{ exposureMode: 'continuous' }, { exposureCompensation: 0 }]);
    expect(cam.st).toMatchObject({ mode: 'continuous', comp: 0, iso: null, time100: null });
  });

  it('stopped during compensation: null, and compensation back to 0', async () => {
    const { r, cam } = await stoppedAt({ modes: ['continuous'], time: null, comp: { min: -2, max: 2, step: 1 / 3 } }, 2);
    expect(r).toBeNull();
    expect(cam.st.comp).toBe(0);
  });

  it('a signal never aborted changes nothing', async () => {
    const plain = await setExposure(fakeCamera({ iso: { min: 100, max: 3200 } }).deps);
    const signalled = await setExposure({ ...fakeCamera({ iso: { min: 100, max: 3200 } }).deps, signal: new AbortController().signal });
    expect(signalled).toEqual(plain);
  });
});

describe('the bench check\'s second half is named by what the exposure step achieved (Round 82)', () => {
  const base = { rule: 'exp-r2' as const, reason: null, exposure_time_100us: null, iso: null, exposure_comp: null, auto_fps: 24, auto_luma: 120, lock_fps: 24, lock_luma: 110, iso_steps: 0, mode_readback: null, at: 1 };
  it('fixed only when the lock was kept, with its exposure time', () => {
    expect(benchLockLabel({ ...base, policy: 'locked-v1', exposure_time_100us: 300 })).toEqual({ short: 'fixed (30 ms)', tag: 'fixed', note: null });
  });
  it('compensated, with the step, and a note that the rate can still follow the screen', () => {
    const l = benchLockLabel({ ...base, policy: 'compensated-v1', exposure_comp: -1 / 3 });
    expect(l).toMatchObject({ short: 'compensated (−0.33 EV)', tag: 'compensated' });
    expect(l.note).toMatch(/can still follow the screen/);
  });
  it('never "fixed" when the lock was not kept or the step did not run, and says why', () => {
    const l = benchLockLabel({ ...base, policy: 'auto', reason: 'the camera offers no exposure control to the browser' });
    expect(l).toMatchObject({ short: 'automatic (not fixed)', tag: 'auto again' });
    expect(l.note).toBe('The exposure was not fixed: the camera offers no exposure control to the browser. '
      + 'The second three rows are automatic exposure again, so they cannot show whether fixing it helps.');
    expect(benchLockLabel(null).note).toMatch(/the exposure step did not run/);
  });
});

describe('the ladders', () => {
  it('doubles the ISO up to the maximum, which is tried last', () => {
    expect(isoLadder(100, 100, 3200)).toEqual([200, 400, 800, 1600, 3200]);
    expect(isoLadder(100, 50, 600)).toEqual([200, 400, 600]);
    expect(isoLadder(800, 100, 800)).toEqual([800]);
  });

  it('snaps compensation to the camera\'s step and stays inside its range', () => {
    expect(compensationSteps(-2, 2, 1 / 3)).toEqual([-0.333, -0.667, -1]);
    expect(compensationSteps(-0.5, 2, 0.5)).toEqual([-0.5]);
    expect(compensationSteps(0, 2, 0.5)).toEqual([]);
  });
});
