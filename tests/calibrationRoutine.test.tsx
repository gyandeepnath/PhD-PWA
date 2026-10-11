/**
 * The calibration screen (Round 80, rules cal-r2 and gaze-r2), rendered in jsdom with faked clocks and
 * a faked tracker: on the grey field; the baseline step says whether the eyes are found and steady; the
 * three dots in order, a short dot shown again on its own; a missing baseline named with its reason and
 * repeated on its own; a gaze check that fell short as a calm notice whose retry repeats only the dots.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { CalibrationRoutine, baselineReasonText } from '@/start/CalibrationRoutine';
import { CONFIG } from '@/experiment/config';
import type { BaselineProgress, BaselineResult } from '@/tracking/calibrationSequence';
import type { CalibrationOutcome, GazeDotResult } from '@/tracking/useTracking';
import type { GazeDotId } from '@/tracking/gazeCalibration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GOOD: BaselineResult = { baseline: 0.3, usable: 140, frames: 146, faceFrames: 145, ms: 6000, reason: null };
const NO_FACE: BaselineResult = { baseline: null, usable: 12, frames: 150, faceFrames: 30, ms: 12000, reason: 'no_face' };

function outcome(valid: boolean, reason: 'too_few_samples' | 'not_separable' | null = null, shortDots: GazeDotId[] = []): CalibrationOutcome {
  return {
    gazeValid: valid, earBaseline: 0.3, earSamplesUsable: 140, gazeTrust: valid ? 'good' : 'unusable', baseline: GOOD,
    gaze: {
      valid, reason, shortDots, hLeft: -0.08, hCentre: 0.04, hRight: 0.16, centreSpread: 0.01,
      range: valid ? { lo: -0.12, hi: 0.2 } : null, samplesPerDot: { centre: 20, left: 20, right: 20 },
    },
  };
}

function mount(o: {
  baselines: BaselineResult[];
  /** Per call of sampleGazeTarget, whether the showing was enough. */
  dotEnough?: boolean[];
  outcomes?: CalibrationOutcome[];
}) {
  const calls = { baseline: 0, dots: [] as GazeDotId[], end: [] as Array<{ gazeRun?: boolean; baselineAttempts?: number }>, done: 0 };
  let dotCall = 0;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const props = {
    sessionId: 's1',
    measureEarBaseline: async (_step: unknown, onProgress?: (p: BaselineProgress) => void) => {
      const r = o.baselines[Math.min(calls.baseline, o.baselines.length - 1)];
      calls.baseline++;
      onProgress?.({ elapsedMs: 3000, usable: 60, needed: 30, minMs: 6000, maxMs: 12000, eyes: 'found', steady: true });
      await new Promise((res) => setTimeout(res, 6000));
      return r;
    },
    beginGazeCalibration: () => {},
    sampleGazeTarget: async (dot: GazeDotId, ms: number): Promise<GazeDotResult> => {
      calls.dots.push(dot);
      const enough = o.dotEnough?.[dotCall++] ?? true;
      await new Promise((res) => setTimeout(res, ms));
      return { dot, samples: enough ? 20 : 3, needed: 12, enough };
    },
    endGazeCalibration: async (_s: string, opts?: { gazeRun?: boolean; baselineAttempts?: number }) => {
      calls.end.push(opts ?? {});
      return (o.outcomes ?? [outcome(true)])[Math.min(calls.end.length - 1, (o.outcomes ?? [outcome(true)]).length - 1)];
    },
    onDone: () => { calls.done++; },
  };
  act(() => { root.render(createElement(CalibrationRoutine, props)); });
  const q = (id: string) => host.querySelector(`[data-testid=${id}]`) as HTMLElement | null;
  return {
    calls, q,
    click: async (id: string) => { await act(async () => { q(id)!.click(); }); },
    /** Let `ms` of faked time pass, a frame at a time, flushing the routine's awaits. */
    run: async (ms: number) => { for (let t = 0; t < ms; t += 50) await act(async () => { await vi.advanceTimersByTimeAsync(50); }); },
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe('the calibration screen', () => {
  afterEach(() => { vi.useRealTimers(); });
  const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });

  it('runs on the grey field, then the baseline says eyes found and steady, then the three dots in order', async () => {
    fake();
    const m = mount({ baselines: [GOOD] });
    expect(m.q('calibration-routine')!.dataset.ground).toBe(CONFIG.ADAPTATION_COLOR);
    await m.click('calibration-begin');
    await m.run(400);
    expect(m.q('calibration-routine')!.dataset.phase).toBe('baseline');
    expect(m.q('calibration-baseline-status')!.dataset.eyes).toBe('found');
    expect(m.q('calibration-eyes')!.textContent).toBe('Eyes found · steady');
    expect(m.q('calibration-baseline-status')!.textContent).toMatch(/60 usable frames \(needs 30\)/);
    await m.run(6000);
    expect(m.q('calibration-gaze-dot')!.dataset.dot).toBe('centre');
    expect(m.q('calibration-step-baseline')!.dataset.state).toBe('done');
    await m.run(5000);
    expect(m.calls.dots).toEqual(['centre', 'left', 'right']);
    expect(m.calls.end).toEqual([{ gazeRun: true, baselineAttempts: 1 }]);
    expect(m.calls.done).toBe(1);
    m.unmount();
  });

  it('shows a short dot again, on its own, and ticks each dot', async () => {
    fake();
    const m = mount({ baselines: [GOOD], dotEnough: [true, false, true, true] });
    await m.click('calibration-begin');
    await m.run(6400 + 1500 + 1500 + 300);
    // The left dot came out short: it is shown again, saying so.
    expect(m.q('calibration-gaze-dot')!.dataset.dot).toBe('left');
    expect(m.q('calibration-routine')!.textContent).toMatch(/Once more — look at the dot/);
    expect(m.q('calibration-step-centre')!.dataset.state).toBe('done');
    await m.run(5000);
    expect(m.calls.dots).toEqual(['centre', 'left', 'left', 'right']);
    expect(m.calls.done).toBe(1);
    m.unmount();
  });

  it('names a missing baseline with its reason, repeats only the baseline, and continuing without it is its own button', async () => {
    fake();
    const m = mount({ baselines: [NO_FACE, NO_FACE] });
    await m.click('calibration-begin');
    await m.run(6400);
    expect(m.q('calibration-no-baseline')!.dataset.reason).toBe('no_face');
    expect(m.q('calibration-reason')!.textContent).toBe(baselineReasonText(NO_FACE, 30));
    expect(m.q('calibration-reason')!.textContent).toMatch(/A face was found in only 20% of the 150 frames/);
    expect(m.calls.dots).toEqual([]); // the dots are not shown without a baseline
    await m.click('calibration-retry');
    await m.run(6400);
    expect(m.calls.baseline).toBe(2);
    await m.click('calibration-continue-anyway');
    await m.run(100);
    expect(m.calls.end).toEqual([{ gazeRun: false, baselineAttempts: 2 }]);
    expect(m.calls.done).toBe(1);
    m.unmount();
  });

  it('a gaze check that fell short is a calm notice; its retry repeats the dots, not the baseline', async () => {
    fake();
    const m = mount({ baselines: [GOOD], outcomes: [outcome(false, 'not_separable'), outcome(true)] });
    await m.click('calibration-begin');
    await m.run(6400 + 5000);
    const notice = m.q('calibration-gaze-incomplete')!;
    expect(notice.dataset.reason).toBe('not_separable');
    expect(notice.textContent).toMatch(/affects only a quality index/);
    expect(notice.textContent).toMatch(/blinks are measured normally/);
    expect(notice.textContent).not.toMatch(/primary outcome/);
    await m.click('calibration-retry-thin');
    await m.run(5000);
    expect(m.calls.baseline).toBe(1);
    expect(m.calls.dots).toEqual(['centre', 'left', 'right', 'centre', 'left', 'right']);
    expect(m.calls.done).toBe(1);
    m.unmount();
  });

  it('Continue on the notice goes on with the record already written', async () => {
    fake();
    const m = mount({ baselines: [GOOD], dotEnough: [true, false, false, false, true], outcomes: [outcome(false, 'too_few_samples', ['left'])] });
    await m.click('calibration-begin');
    await m.run(6400 + 8000);
    expect(m.q('calibration-step-left')!.dataset.state).toBe('short');
    expect(m.q('calibration-reason')!.textContent).toMatch(/not found often enough at the left dot/);
    await m.click('calibration-accept-thin');
    expect(m.calls.end).toHaveLength(1);
    expect(m.calls.done).toBe(1);
    m.unmount();
  });
});
