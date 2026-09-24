/**
 * A camera that stops delivering frames without firing `ended` — muted or paused, as backgrounding
 * does on some tablets — must be noticed. See tracking/cameraLiveness.ts and markLost in useTracking.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { startLivenessCheck } from '@/tracking/cameraLiveness';

function rig(opts: { visible?: boolean } = {}) {
  let t = 0;
  let visible = opts.visible ?? true;
  let tick: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const last = { current: null as number | null };
  let stalls = 0;
  let nudges = 0;
  const stop = startLivenessCheck({
    lastResultAt: last,
    isVisible: () => visible,
    now: () => t,
    stallMs: 5000,
    onStall: () => { stalls++; },
    onVisible: () => { nudges++; },
    every: (fn) => { tick = fn; return () => { tick = null; }; },
    visibilityTarget: {
      addEventListener: (_: string, fn: EventListenerOrEventListenerObject) => { listeners.add(fn as () => void); },
      removeEventListener: (_: string, fn: EventListenerOrEventListenerObject) => { listeners.delete(fn as () => void); },
    },
  });
  return {
    last,
    advance: (ms: number) => { t += ms; tick?.(); },
    result: () => { last.current = t; },
    hide: () => { visible = false; listeners.forEach((f) => f()); },
    show: () => { visible = true; listeners.forEach((f) => f()); },
    stalls: () => stalls, nudges: () => nudges, stop, listeners,
  };
}

describe('camera liveness', () => {
  it('is quiet while results keep arriving', () => {
    const r = rig();
    for (let i = 0; i < 100; i++) { r.result(); r.advance(100); }
    expect(r.stalls()).toBe(0);
  });

  it('fires once when results stop while the page is visible', () => {
    const r = rig();
    r.result();
    r.advance(4000);
    expect(r.stalls()).toBe(0);
    r.advance(2000);
    expect(r.stalls()).toBe(1);
    r.advance(10_000);
    expect(r.stalls()).toBe(1);
  });

  it('is not armed before the first result — the model is still loading', () => {
    const r = rig();
    r.advance(60_000);
    expect(r.stalls()).toBe(0);
  });

  it('does not count hidden time as a stall, and restarts the clock on return', () => {
    const r = rig();
    r.result();
    r.hide();
    r.advance(60_000);                // backgrounded for a minute
    expect(r.stalls()).toBe(0);
    r.show();
    expect(r.nudges()).toBe(1);       // the paused video is nudged
    r.advance(3000);
    expect(r.stalls()).toBe(0);       // 3 s since return, not 63 s since the last result
    r.advance(3000);
    expect(r.stalls()).toBe(1);       // and frames never came back
  });

  it('detaches on stop', () => {
    const r = rig();
    r.stop();
    expect(r.listeners.size).toBe(0);
  });
});

describe('the tracker and the experiment act on it', () => {
  const tracker = readFileSync('src/tracking/useTracking.ts', 'utf8');
  const experiment = readFileSync('src/experiment/Experiment.tsx', 'utf8');
  it('an ended track and a stall both go to markLost, which the API exposes', () => {
    expect(tracker).toMatch(/track\.addEventListener\('ended', markLost\)/);
    expect(tracker).toMatch(/onStall: markLost/);
    expect(tracker).toMatch(/setCameraLostAt\(Date\.now\(\)\)/);
    expect(tracker).not.toMatch(/trackEndedRef/);
  });
  it('rows written while lost say so', () => {
    expect(tracker).toMatch(/disabledEyeMetrics\(conditionId, sessionId, lostRef\.current \? 'lost' : 'not_running'\)/);
  });
  it('the experiment stops the sitting with a notice whose recovery is the pause path', () => {
    expect(experiment).toMatch(/const showCameraLost = tracking\.cameraLostAt != null && !cameraLossAccepted && canPause;/);
    const notice = experiment.slice(experiment.indexOf('data-testid="camera-lost"'), experiment.indexOf('data-testid="camera-lost"') + 2500);
    expect(notice).toMatch(/onClick=\{pauseAndExit\}/);
    expect(notice).toMatch(/setCameraLossAccepted\(true\)/);
  });
});

describe('camera-off rows carry their cause', () => {
  it('lost vs never running', async () => {
    const { disabledEyeMetrics } = await import('@/tracking/aggregator');
    expect(disabledEyeMetrics('C', 'S').camera_inactive_reason).toBe('not_running');
    expect(disabledEyeMetrics('C', 'S', 'lost').camera_inactive_reason).toBe('lost');
  });
});
