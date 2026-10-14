/**
 * Fix the camera's exposure once per sitting, on the grey field, so every condition is filmed the same
 * way (Round 79, rule 'exp-r1'; Round 82, rule 'exp-r2' — see "WHAT COUNTS AS FIXED" below).
 *
 * WHY. The investigator measured at most 23-25 frames a second on the study tablet, even in good light.
 * Chrome leaves the camera's auto-exposure free to lengthen each frame when it judges the picture dark
 * (it picks the auto-exposure frame-rate range with the lowest minimum; Chromium source, ledger #60), and
 * auto-exposure also avoids exposures that would show the room lights' flicker (Android camera2
 * reference, ledger #61). A white page lights the face more than a black one, so under auto-exposure the
 * frame rate — and the motion blur of each frame — can differ between the two polarities. The frame
 * rate moves the incomplete-blink ratio's level (docs/FPS_GATE_SIMULATION.md), so a rate that follows
 * polarity would bias exactly the comparison the study makes. Nothing about this was measured on the
 * tablet: whether its rate is limited by exposure at all is what the bench check in
 * docs/OPERATOR_MANUAL.md finds out.
 *
 * WHAT IS DONE. With the participant seated and the screen showing the grey field (#808080, the one
 * screen identical in every condition):
 *
 *   1. auto-exposure settles, and the camera's delivered frame rate and the picture's brightness are
 *      measured under it ("auto");
 *   2. the exposure is fixed: `exposureMode: 'manual'` makes Chrome hold the exposure auto-exposure had
 *      just chosen (Chromium sets SENSOR_EXPOSURE_TIME to the last measured value). If that is longer
 *      than 30 ms (`exposureTime` 300, in the browser's units of 100 µs), it is shortened to 30 ms, so a
 *      30-fps frame interval can hold it; 30 ms is a whole multiple of 10 ms, so it does not show the
 *      flicker of lights on 50 Hz mains (the site's mains frequency is assumed, not verified: ledger #61);
 *   3. Chrome sets the sensor's sensitivity only when the page gives an `iso`, so with the exposure fixed
 *      the picture can come out darker than under auto. If it is below 90% of the auto brightness and
 *      the camera offers ISO, the ISO is raised step by step (doubling) until it is not;
 *   4. the result is checked for 3 s: the lock is KEPT only if the camera does not report that
 *      auto-exposure is running again, delivers at least as many frames a second as under auto (1 fps
 *      tolerance) and the picture is at least 70% as bright as under auto. Otherwise auto-exposure is
 *      restored, and why is recorded.
 *
 * WHAT COUNTS AS FIXED (exp-r2, Round 82). exp-r1 kept the lock only when the camera read back
 * `exposureMode === 'manual'`. Chrome on Android never reads that back (Chromium source, ledger #60,
 * read again at commit 3bdd35dd on 14 Oct 2026): for the web's 'manual' it sets CONTROL_AE_MODE_OFF and
 * never sets CONTROL_AE_LOCK (VideoCaptureCamera2.java, configureCommonCaptureSettings), and it reports
 * the current mode as NONE when CONTROL_AE_MODE is OFF and as FIXED only when CONTROL_AE_LOCK is set
 * (getPhotoCapabilities); NONE reaches the page as "none" (video_capture_device_android.cc,
 * ToMojomMeteringMode; image_capture.cc, UpdateMediaTrackSettingsAndCapabilities, which runs before
 * applyConstraints resolves). So under exp-r1 every Android sitting fell back to compensation or auto.
 * exp-r2 reads the mode for what it says about auto-exposure: 'manual' and 'none' both mean auto-exposure
 * is off; 'continuous' and 'single-shot' mean it runs, and the lock is not kept; a camera that reports no
 * mode is judged on the measurements alone, as before. The measured checks (rate and brightness) are
 * unchanged. The raw mode is kept (`mode_readback`), so a row can be re-judged under either rule. Not
 * measured on the study tablet: this is what the browser's source says it reports.
 *
 * WHERE THE LOCK IS NOT OFFERED. Some cameras offer only exposure compensation. Then the most negative
 * compensation step (down to -1 EV) that keeps the picture at least 70% as bright is used
 * ('compensated-v1'): auto-exposure stays on but aims darker, so it needs shorter exposures. That is a
 * weaker remedy — the rate can still follow the screen — and is recorded as such. With neither, the
 * camera stays on auto ('auto') and the record says why.
 *
 * WHY "AT LEAST THE AUTO RATE", NOT A FIXED 28 FPS. The research note proposed reverting when the locked
 * camera delivers fewer than 28 frames a second. A fixed floor would revert on any camera whose maximum
 * is below 28 (Chromium's own test camera delivers 20) even when the lock holds that rate steady across
 * both polarities — and a STEADY rate is what removes the polarity confound; the LEVEL is judged by the
 * frame-rate gate (fps-g2, tracking/blink.ts) on every condition. What the lock must never do is make
 * the camera slower or the picture much darker than auto, and that is what is checked.
 *
 * The exposure is set once and never between conditions; a camera restart (a resume) re-runs camera
 * setup and so this step, and each 07_eye_metrics row records the exposure that was in force.
 *
 * Pure apart from the injected camera calls, so every branch is unit-tested.
 */
import type { ExposureOutcome } from '@/storage/types';

export type { ExposureOutcome };

export const EXPOSURE_RULE = 'exp-r2';
/** The rule before Round 82: kept the lock only on a read-back of 'manual' (see the header). */
export const EXPOSURE_RULE_BEFORE = 'exp-r1';

/**
 * What a read-back `exposureMode` says about auto-exposure (exp-r2): 'off' for 'manual' and 'none' (Chrome
 * on Android reports 'none' for the web's 'manual'; header), 'on' for 'continuous' and 'single-shot', and
 * null when the camera reports no mode or one this list does not know.
 */
export function autoExposureState(mode: unknown): 'off' | 'on' | null {
  if (mode === 'manual' || mode === 'none') return 'off';
  if (mode === 'continuous' || mode === 'single-shot') return 'on';
  return null;
}

export type ExposurePolicy = 'auto' | 'locked-v1' | 'compensated-v1';

export const EXPOSURE = {
  /** Longest exposure kept under the lock: 300 x 100 µs = 30 ms. */
  CAP_100US: 300,
  /** The ISO is raised until the picture is at least this share of its auto brightness. */
  LUMA_TARGET: 0.9,
  /** Below this share of the auto brightness the lock (or compensation) is not kept. */
  LUMA_FLOOR: 0.7,
  /** The locked camera may deliver at most this many frames a second fewer than under auto. */
  FPS_TOLERANCE: 1,
  /** ISO raises tried at most. */
  MAX_ISO_STEPS: 5,
  /** Compensation steps tried, in EV, from mild to strong. */
  COMP_STEPS_EV: [-1 / 3, -2 / 3, -1],
} as const;

/** How long each part takes, ms. Collapsed under the e2e harness by the caller. */
export interface ExposureTiming {
  /** Auto-exposure settles on the grey field before anything is measured. */
  SETTLE_MS: number;
  /** Frame rate and brightness under auto. */
  AUTO_MS: number;
  /** After each change, before measuring. */
  STEP_SETTLE_MS: number;
  /** Brightness after each change. */
  LUMA_MS: number;
  /** The final check of the kept setting. */
  VERIFY_MS: number;
}

export const EXPOSURE_TIMING: ExposureTiming = {
  SETTLE_MS: 1500, AUTO_MS: 2000, STEP_SETTLE_MS: 400, LUMA_MS: 600, VERIFY_MS: 3000,
};


export interface ExposureDeps {
  capabilities: () => MediaTrackCapabilities | null;
  /** The track's settings; only the exposure fields are read (TypeScript's DOM types do not list them). */
  settings: () => { exposureMode?: unknown; exposureTime?: unknown; iso?: unknown; exposureCompensation?: unknown };
  /** `track.applyConstraints({ advanced: [set] })` — image-capture constraints only (Chrome rejects a mix). */
  apply: (set: Record<string, unknown>) => Promise<void>;
  /** Delivered camera frames a second and mean picture brightness over `ms`. */
  measure: (ms: number) => Promise<{ cameraFps: number | null; luma: number | null }>;
  wait: (ms: number) => Promise<void>;
  now?: () => number;
  timing?: ExposureTiming;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const range = (r: unknown) => {
  const o = r as { min?: unknown; max?: unknown; step?: unknown } | null | undefined;
  const min = num(o?.min), max = num(o?.max);
  return min != null && max != null && max >= min ? { min, max, step: num(o?.step) } : null;
};

/** The ISO values tried, doubling from `start`, capped at the camera's maximum (which is always tried last). */
export function isoLadder(start: number, min: number, max: number, steps: number = EXPOSURE.MAX_ISO_STEPS): number[] {
  const out: number[] = [];
  let v = Math.max(min, start);
  for (let i = 0; i < steps; i++) {
    v = Math.min(max, v * 2);
    if (out.length && out[out.length - 1] === v) break;
    out.push(Math.round(v));
    if (v >= max) break;
  }
  return out;
}

/** Compensation values to try, snapped to the camera's step and inside its range. Mild first. */
export function compensationSteps(min: number, max: number, step: number | null): number[] {
  const snap = (v: number) => (step && step > 0 ? Math.round(v / step) * step : v);
  const out: number[] = [];
  for (const ev of EXPOSURE.COMP_STEPS_EV) {
    const v = Math.round(snap(ev) * 1000) / 1000;
    if (v < 0 && v >= min && v <= max && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Run the procedure above. Never throws: a camera that refuses is left on auto, and the outcome says so. */
export async function setExposure(d: ExposureDeps): Promise<ExposureOutcome> {
  const t = d.timing ?? EXPOSURE_TIMING;
  const now = d.now ?? (() => Date.now());
  const out: ExposureOutcome = {
    rule: EXPOSURE_RULE, policy: 'auto', reason: null, exposure_time_100us: null, iso: null, exposure_comp: null,
    auto_fps: null, auto_luma: null, lock_fps: null, lock_luma: null, iso_steps: 0, mode_readback: null, at: now(),
  };
  let caps: MediaTrackCapabilities | null = null;
  try { caps = d.capabilities(); } catch { caps = null; }
  const c = (caps ?? {}) as Record<string, unknown>;
  const modes = Array.isArray(c.exposureMode) ? (c.exposureMode as unknown[]) : [];
  const timeR = range(c.exposureTime);
  const isoR = range(c.iso);
  const compR = range(c.exposureCompensation);
  const canLock = modes.includes('manual');
  const canComp = compR != null && compR.min < 0;

  await d.wait(t.SETTLE_MS);
  const auto = await d.measure(t.AUTO_MS);
  out.auto_fps = auto.cameraFps;
  out.auto_luma = auto.luma;

  if (!canLock && !canComp) {
    out.reason = 'the camera offers no exposure control to the browser';
    return out;
  }
  if (auto.cameraFps == null || auto.luma == null || auto.luma <= 0) {
    out.reason = 'the camera\'s frame rate or picture could not be measured under auto-exposure, so a fixed exposure could not be checked';
    return out;
  }
  const kept = (m: { cameraFps: number | null; luma: number | null }) =>
    m.cameraFps != null && m.luma != null
    && m.cameraFps >= (auto.cameraFps as number) - EXPOSURE.FPS_TOLERANCE
    && m.luma >= EXPOSURE.LUMA_FLOOR * (auto.luma as number);
  const failWhy = (m: { cameraFps: number | null; luma: number | null }, what: string) => {
    if (m.cameraFps == null || m.luma == null) return `${what}: the camera could not be measured afterwards`;
    if (m.cameraFps < (auto.cameraFps as number) - EXPOSURE.FPS_TOLERANCE) {
      return `${what} made the camera slower (${m.cameraFps.toFixed(1)} against ${(auto.cameraFps as number).toFixed(1)} frames a second under auto)`;
    }
    return `${what} made the picture too dark (${Math.round((100 * m.luma) / (auto.luma as number))}% of its brightness under auto)`;
  };
  const restoreAuto = async () => {
    try { await d.apply({ exposureMode: 'continuous' }); } catch { /* the camera's own state is recorded below */ }
    try { if (canComp) await d.apply({ exposureCompensation: 0 }); } catch { /* idem */ }
  };

  if (canLock) {
    try {
      // Hold the exposure auto-exposure has just chosen on the grey field.
      await d.apply({ exposureMode: 'manual' });
      let held = num(d.settings().exposureTime);
      let time: number | null = null;
      if (held == null || held > EXPOSURE.CAP_100US) {
        if (timeR) {
          time = Math.max(timeR.min, Math.min(timeR.max, EXPOSURE.CAP_100US));
          await d.apply({ exposureMode: 'manual', exposureTime: time });
        } else {
          /*
           * Chrome advertises the exposure-time range only on one code path, which depends on the
           * order the camera lists its auto-exposure modes in (VideoCaptureCamera2.java), so a camera
           * can accept an exposure time it did not advertise. Try it; a refusal leaves the held one.
           */
          try {
            await d.apply({ exposureMode: 'manual', exposureTime: EXPOSURE.CAP_100US });
            time = EXPOSURE.CAP_100US;
          } catch { /* keep the exposure auto-exposure had chosen */ }
        }
        held = num(d.settings().exposureTime) ?? time ?? held;
      }
      await d.wait(t.STEP_SETTLE_MS);
      let m = await d.measure(t.LUMA_MS);
      if (isoR && m.luma != null && m.luma < EXPOSURE.LUMA_TARGET * auto.luma) {
        const start = num(d.settings().iso) ?? isoR.min;
        for (const iso of isoLadder(start, isoR.min, isoR.max)) {
          out.iso_steps += 1;
          await d.apply(time != null ? { exposureMode: 'manual', exposureTime: time, iso } : { exposureMode: 'manual', iso });
          out.iso = iso;
          await d.wait(t.STEP_SETTLE_MS);
          m = await d.measure(t.LUMA_MS);
          if (m.luma != null && m.luma >= EXPOSURE.LUMA_TARGET * auto.luma) break;
        }
      }
      const check = await d.measure(t.VERIFY_MS);
      out.lock_fps = check.cameraFps;
      out.lock_luma = check.luma;
      const mode = d.settings().exposureMode;
      out.mode_readback = mode === undefined || mode === null ? null : String(mode);
      // exp-r2: 'none' is how Chrome on Android reports the fixed exposure; only a mode that says
      // auto-exposure is running (or one this rule does not know) undoes the lock. Unreported: as before.
      if (mode !== undefined && mode !== null && autoExposureState(mode) !== 'off') {
        out.reason = `the camera did not keep the fixed exposure (it reports "${String(mode)}")`;
      } else if (!kept(check)) {
        out.reason = failWhy(check, 'fixing the exposure');
      } else {
        out.policy = 'locked-v1';
        out.exposure_time_100us = num(d.settings().exposureTime) ?? held ?? null;
        return out;
      }
    } catch (err) {
      out.reason = `the camera refused a fixed exposure (${(err as { name?: string })?.name ?? 'error'})`;
    }
    out.iso = null;
    await restoreAuto();
    if (!canComp) return out;
  }

  // Exposure compensation: auto-exposure stays on but aims darker.
  const steps = compensationSteps(compR!.min, compR!.max, compR!.step);
  let best: number | null = null;
  try {
    for (const ev of steps) {
      await d.apply({ exposureCompensation: ev });
      await d.wait(t.STEP_SETTLE_MS);
      const m = await d.measure(t.LUMA_MS);
      if (m.luma != null && m.luma >= EXPOSURE.LUMA_FLOOR * auto.luma) best = ev;
      else break;
    }
    if (best == null) {
      out.reason = [out.reason, 'no exposure-compensation step kept the picture bright enough'].filter(Boolean).join('; ');
      await restoreAuto();
      return out;
    }
    await d.apply({ exposureCompensation: best });
    await d.wait(t.STEP_SETTLE_MS);
    const check = await d.measure(t.VERIFY_MS);
    out.lock_fps = check.cameraFps;
    out.lock_luma = check.luma;
    if (!kept(check)) {
      out.reason = [out.reason, failWhy(check, 'exposure compensation')].filter(Boolean).join('; ');
      out.lock_fps = check.cameraFps;
      await restoreAuto();
      return out;
    }
    out.policy = 'compensated-v1';
    out.exposure_comp = best;
    out.reason = out.reason ?? 'the camera offers no fixed exposure, only compensation';
    return out;
  } catch (err) {
    out.reason = [out.reason, `the camera refused exposure compensation (${(err as { name?: string })?.name ?? 'error'})`].filter(Boolean).join('; ');
    await restoreAuto();
    return out;
  }
}

/**
 * The bench check's second half, named by what the exposure step between the halves ACHIEVED (Round 82).
 *
 * WHY. The bench ran its second half after the exposure step and called it "fixed" whatever the step
 * did. On a camera with no exposure control, or one that refused the lock — and, under exp-r1, on every
 * Android camera (see "WHAT COUNTS AS FIXED") — those rows were automatic exposure again, yet the table
 * read "fixed", and the manual asks whether the fixed rows agree. The label now says which: fixed (with
 * the exposure time), compensated, or not fixed with the reason. `tag` is the one-word form the export
 * cell uses; `note` says, when the half is not a fixed exposure, what that half can and cannot show.
 */
export function benchLockLabel(lock: ExposureOutcome | null): { short: string; tag: 'fixed' | 'compensated' | 'auto again'; note: string | null } {
  if (lock?.policy === 'locked-v1') {
    return { short: lock.exposure_time_100us != null ? `fixed (${lock.exposure_time_100us / 10} ms)` : 'fixed', tag: 'fixed', note: null };
  }
  if (lock?.policy === 'compensated-v1') {
    const ev = lock.exposure_comp == null ? '' : ` (${lock.exposure_comp > 0 ? '+' : lock.exposure_comp < 0 ? '−' : ''}${Math.abs(lock.exposure_comp).toFixed(2)} EV)`;
    return {
      short: `compensated${ev}`, tag: 'compensated',
      note: 'The camera offers no fixed exposure, so automatic exposure was set to aim darker. Its rate can still follow the screen.',
    };
  }
  return {
    short: 'automatic (not fixed)', tag: 'auto again',
    note: `The exposure was not fixed: ${lock?.reason ?? 'the exposure step did not run'}. `
      + 'The second three rows are automatic exposure again, so they cannot show whether fixing it helps.',
  };
}
