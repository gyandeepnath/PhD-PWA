/**
 * The exposure step (Round 79, rule exp-r1): fix the exposure on the grey field and keep it only if the
 * camera stays at least as fast and the picture bright enough; otherwise compensation, otherwise auto —
 * and always say which and why.
 *
 * The fake camera below is a toy, not a model of the tablet: under auto it exposes 40 ms (25 fps) on the
 * grey field; a fixed exposure of t ms runs at min(30, 1000 / t) fps; brightness is exposure x gain.
 */
import { describe, it, expect } from 'vitest';
import { setExposure, isoLadder, compensationSteps, EXPOSURE, type ExposureDeps } from '@/tracking/cameraExposure';

interface FakeOpts {
  modes?: string[];
  time?: { min: number; max: number } | null;
  iso?: { min: number; max: number } | null;
  comp?: { min: number; max: number; step: number } | null;
  /** The camera refuses manual exposure. */
  refuseManual?: boolean;
  /** The camera accepts the constraint but carries on in auto. */
  ignoresManual?: boolean;
  /** Under a fixed exposure the camera runs at this rate whatever the exposure (a fixed frame duration). */
  manualFps?: number;
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
      exposureMode: o.ignoresManual ? 'continuous' : st.mode,
      ...(st.mode === 'manual' ? { exposureTime: st.time100 ?? AUTO_MS * 10 } : {}),
      ...(st.iso != null ? { iso: st.iso } : {}),
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
    const r = await setExposure(cam.deps);
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

  it('keeps the exposure auto-exposure chose when it is already 30 ms or shorter', async () => {
    const cam = fakeCamera({ iso: { min: 100, max: 3200 } });
    // A brighter scene: auto settled at 20 ms. The fake reports the held time once manual is applied.
    cam.deps.settings = () => ({ exposureMode: cam.st.mode, exposureTime: cam.st.time100 ?? 200 });
    const r = await setExposure(cam.deps);
    expect(cam.applied.some((a) => 'exposureTime' in a)).toBe(false);
    expect(r.exposure_time_100us).toBe(200);
  });

  it('puts auto back, and says why, when the fixed exposure leaves the picture too dark', async () => {
    const r = await setExposure(fakeCamera({ iso: null }).deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/too dark/);
    expect(r.iso).toBeNull();
    // What the attempt did is kept, so a reverted lock is not a blank.
    expect(r.lock_fps).toBeCloseTo(30, 6);
  });

  it('puts auto back when the fixed exposure makes the camera slower than under auto', async () => {
    const cam = fakeCamera({ iso: { min: 100, max: 3200 }, manualFps: 20 });
    const r = await setExposure(cam.deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/slower \(20\.0 against 25\.0/);
    expect(cam.applied[cam.applied.length - 1]).toEqual({ exposureMode: 'continuous' });
  });

  it('does not call a camera that ignored the request "locked"', async () => {
    const r = await setExposure(fakeCamera({ ignoresManual: true, iso: { min: 100, max: 3200 } }).deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/did not keep the fixed exposure/);
  });

  it('records a refusal, and falls back to compensation when the camera offers it', async () => {
    const refused = await setExposure(fakeCamera({ refuseManual: true }).deps);
    expect(refused.policy).toBe('auto');
    expect(refused.reason).toMatch(/refused a fixed exposure \(OverconstrainedError\)/);

    const comp = await setExposure(fakeCamera({ refuseManual: true, comp: { min: -2, max: 2, step: 1 / 3 } }).deps);
    expect(comp.policy).toBe('compensated-v1');
    // -1/3 EV keeps 79% of the brightness; -2/3 would keep 63%, under the 70% floor.
    expect(comp.exposure_comp).toBeCloseTo(-1 / 3, 3);
    expect(comp.reason).toMatch(/refused a fixed exposure/);
  });

  it('uses compensation when the camera offers no fixed exposure at all', async () => {
    const r = await setExposure(fakeCamera({ modes: ['continuous'], time: null, comp: { min: -2, max: 2, step: 1 / 3 } }).deps);
    expect(r.policy).toBe('compensated-v1');
    expect(r.reason).toMatch(/only compensation/);
  });

  it('leaves a camera with no exposure control on auto, and says so', async () => {
    const r = await setExposure(fakeCamera({ modes: ['continuous'], time: null }).deps);
    expect(r).toMatchObject({ policy: 'auto', reason: 'the camera offers no exposure control to the browser', lock_fps: null, auto_fps: 25 });
  });

  it('does not judge a lock it cannot measure', async () => {
    const cam = fakeCamera();
    cam.deps.measure = async () => ({ cameraFps: null, luma: null });
    const r = await setExposure(cam.deps);
    expect(r.policy).toBe('auto');
    expect(r.reason).toMatch(/could not be measured/);
    expect(cam.applied).toEqual([]);
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
