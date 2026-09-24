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
    // The interval runs every second, so time passes a tick at a time.
    advance: (ms: number) => { for (let k = 0; k < ms; k += 1000) { t += Math.min(1000, ms - k); tick?.(); } },
    // A page that stops executing (a blocking dialog): the clock runs, the next tick arrives late.
    block: (ms: number) => { t += ms; tick?.(); },
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
    r.advance(5000);
    expect(r.stalls()).toBe(0);
    r.advance(2000);            // two consecutive ticks past the bound
    expect(r.stalls()).toBe(1);
    r.advance(10_000);
    expect(r.stalls()).toBe(1);
  });

  it('a page that stopped running (a blocking dialog) is not a lost camera', () => {
    // Pause opens window.confirm; the operator reads it for 20 s and cancels. The first tick after
    // it arrives 20 s late, before any new frame result.
    const r = rig();
    r.result();
    r.block(20_000);
    expect(r.stalls()).toBe(0);
    r.result();                 // frames resume
    r.advance(3000);
    expect(r.stalls()).toBe(0);
  });

  it('one stale tick is not enough', () => {
    const r = rig();
    r.result();
    r.advance(6000);            // first stale tick
    r.result();                 // a result arrives in time
    r.advance(1000);
    expect(r.stalls()).toBe(0);
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
    r.advance(4000);
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
    expect(experiment).toMatch(/const cameraNoticeUp = tracking\.cameraLostAt != null && !cameraLossAccepted && pausable;/);
    expect(experiment).toMatch(/setBlockingNotice\(cameraNoticeUp\)/);
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

const experimentSrc = readFileSync('src/experiment/Experiment.tsx', 'utf8');
const trackerSrc = readFileSync('src/tracking/useTracking.ts', 'utf8');

describe('time behind the camera-lost notice is not task time', () => {
  it('the grey field does not count it as delivered', async () => {
    const { trackFieldBlockedTime } = await import('@/lib/hiddenTime');
    let t = 0;
    let shown = false;
    const listeners = new Set<() => void>();
    const noticeTarget = {
      addEventListener: (_: string, fn: EventListenerOrEventListenerObject) => { listeners.add(fn as () => void); },
      removeEventListener: (_: string, fn: EventListenerOrEventListenerObject) => { listeners.delete(fn as () => void); },
    };
    const inert = { addEventListener: () => {}, removeEventListener: () => {} };
    const tr = trackFieldBlockedTime({
      documentTarget: inert, orientationTarget: inert, noticeTarget,
      isDocumentHidden: () => false, isPortrait: () => false, isNoticeShown: () => shown, clock: () => t,
    });
    t += 10_000;
    shown = true; listeners.forEach((f) => f());
    t += 30_000;                       // the operator reads the notice for 30 s
    shown = false; listeners.forEach((f) => f());
    t += 5_000;
    expect(tr.stop()).toEqual({ hiddenMs: 30_000, events: 1 });
  });

  it('the app-level signal drives the per-condition tracker', async () => {
    const { trackBlockingNoticeTime, setBlockingNotice } = await import('@/lib/hiddenTime');
    let t = 0;
    const tr = trackBlockingNoticeTime({ clock: () => t });
    setBlockingNotice(true);
    t += 12_000;
    setBlockingNotice(false);
    expect(tr.stop()).toEqual({ hiddenMs: 12_000, events: 1 });
  });

  it('a condition the notice covered for more than the limit is marked interrupted', async () => {
    const { conditionEngagement, ENGAGEMENT } = await import('@/dashboard/aggregate');
    const base = { reading_time_ms: 180_000, reading_min_page_dwell_ms: 40_000, reading_hidden_ms: 0, condition_hidden_ms: 0, condition_portrait_ms: 0, word_count: 585 };
    expect(conditionEngagement({ ...base, condition_notice_ms: 0 }).condition_interrupted).toBe(false);
    expect(conditionEngagement({ ...base, condition_notice_ms: ENGAGEMENT.CONDITION_HIDDEN_MAX_MS + 1 }).condition_interrupted).toBe(true);
  });

  it('each condition records it', () => {
    expect(experimentSrc).toMatch(/conditionNotice\.current = trackBlockingNoticeTime\(\)/);
    expect(experimentSrc).toMatch(/condition_notice_ms: noticed\?\.hiddenMs/);
  });
});

describe('the rest of the camera-lost path', () => {
  it('a replaced calibration routine cannot advance the stage afterwards', () => {
    const routine = readFileSync('src/start/CalibrationRoutine.tsx', 'utf8');
    expect(routine).toMatch(/useEffect\(\(\) => \(\) => \{ mounted\.current = false; \}, \[\]\)/);
    const body = routine.slice(routine.indexOf('const start = async'), routine.indexOf('onDone();'));
    expect((body.match(/if \(!mounted\.current\) return;/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('a lost camera discards the clip of the run it was filming', () => {
    expect(experimentSrc).toMatch(/if \(tracking\.cameraLostAt != null\) annotationRecording\.current\?\.finish\(false\);/);
  });
  it('starts are serialised, and a failed start releases the camera', () => {
    expect(trackerSrc).toMatch(/startingRef\.current = startCamera\(\)\.finally/);
    const catchBlock = trackerSrc.slice(trackerSrc.indexOf('Release whatever was acquired.'), trackerSrc.indexOf("const denied = name === 'NotAllowedError'"));
    expect(catchBlock).toMatch(/t\.removeEventListener\('ended', markLost\);\s*t\.stop\(\);/);
  });
});
