/**
 * The camera self-test screen (Round 79, rule st-r2): on the grey field, each attempt reported criterion
 * by criterion and flash by flash, with the eye's openness through the check, and earlier attempts kept
 * with the one recorded. Rendered for real in jsdom with faked clocks.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { CameraSelfTest, traceGeometry, lagText, rateLine } from '@/start/CameraSelfTest';
import { SELF_TEST, type SelfTestResult } from '@/tracking/selfTest';
import type { SelfTestObservation } from '@/tracking/useTracking';
import { CONFIG } from '@/experiment/config';
import { MIN_GAP_MS } from '@/tracking/blink';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = 0.3;
/** What the tracker "saw": a blink `lag` ms after each of the first `hits` flashes, at `fps`. */
function observer(hits: number, fps = 24, lag = 300) {
  return (cueTimes?: number[]): SelfTestObservation => {
    const cues = cueTimes ?? [];
    const onsets = cues.slice(0, hits).map((c) => c + lag);
    const t0 = (cues[0] ?? 0) - SELF_TEST.FIRST_CUE_MS;
    const trace: Array<{ t_ms: number; ear: number }> = [];
    for (let t = t0; t < t0 + 19_000; t += 1000 / fps) {
      const dip = onsets.some((o) => t >= o && t < o + 250);
      trace.push({ t_ms: t, ear: dip ? BASE * 0.2 : BASE });
    }
    return {
      blinkOnsets: onsets, fps: fps - 1.5, samplingFps: fps, facePresence: 0.97, trace, baseline: BASE,
      pipeline: { camera_fps_delivered: fps, tracker_fps: fps, process_ms_p50: 20, process_ms_p95: 30, camera_setting_width: 1280, camera_setting_height: 720, tracker_backend: 'tasks-cpu', frame_count_source: 'presented-frames', camera_exposure_policy: 'locked-v1', camera_exposure_time_100us: 300 },
    };
  };
}

function mount(end: (cueTimes?: number[]) => SelfTestObservation) {
  const done: SelfTestResult[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let endFn = end;
  act(() => { root.render(createElement(CameraSelfTest, { begin: () => {}, end: (c?: number[]) => endFn(c), onDone: (r: SelfTestResult) => done.push(r) })); });
  const q = (id: string) => host.querySelector(`[data-testid=${id}]`) as HTMLElement | null;
  return {
    done, q,
    setEnd: (e: typeof end) => { endFn = e; },
    click: (id: string) => act(() => { q(id)!.click(); }),
    /** Run one whole check: about 19 s of animation frames. */
    runCheck: () => { for (let i = 0; i < 1300; i++) act(() => { vi.advanceTimersByTime(16); }); },
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe('the camera self-test screen', () => {
  afterEach(() => { vi.useRealTimers(); });
  const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });

  it('runs on the grey field, in its ink', () => {
    fake();
    const m = mount(observer(5));
    expect(m.q('camera-selftest')!.dataset.ground).toBe(CONFIG.ADAPTATION_COLOR);
    expect(m.q('camera-selftest')!.style.background).toMatch(/128, 128, 128|#808080/);
    m.click('selftest-start');
    expect(m.q('camera-selftest')!.style.background).toMatch(/128, 128, 128|#808080/);
    m.unmount();
  });

  it('at 24 frames a second with every flash answered: working, each criterion and each flash shown, the trace drawn', () => {
    fake();
    const m = mount(observer(5));
    m.click('selftest-start');
    m.runCheck();
    expect(m.q('selftest-verdict')!.dataset.verdict).toBe('working');
    expect(m.q('selftest-verdict')!.textContent).toBe('The camera is working');
    expect(m.q('selftest-attempt')!.textContent).toBe('Attempt 1');
    expect(m.q('selftest-crit-blinks')!.textContent).toMatch(/Blinks seen: 5 of 5 flashes \(needs 4\)/);
    expect(m.q('selftest-crit-face')!.textContent).toMatch(/Face in view: 97% of the time \(needs 90%\)/);
    expect(m.q('selftest-crit-rate')!.textContent).toMatch(/24 times a second while the face was seen — adequate \(20 or more\)/);
    expect(m.q('selftest-crit-rate')!.dataset.ok).toBe('true');
    const chips = m.q('selftest-cues')!.querySelectorAll('[data-seen]');
    expect(chips.length).toBe(5);
    expect([...chips].every((c) => (c as HTMLElement).dataset.seen === 'true')).toBe(true);
    expect(chips[0].textContent).toMatch(/✓ 1 · blink 0\.3 s after/);
    const path = m.q('selftest-trace')!.querySelector('path')!.getAttribute('d')!;
    expect(path.startsWith('M')).toBe(true);
    expect(m.q('selftest-pipeline')!.textContent).toMatch(/Camera delivered 24 fps at 1280×720 · tracker processed 24 fps, 20 ms a frame/);
    expect(m.q('selftest-pipeline')!.textContent).toMatch(/exposure fixed \(30 ms\)/);
    m.click('selftest-continue');
    expect(m.done[0]).toMatchObject({ rule: 'st-r2', verdict: 'working', attempt: 1, earlier: [], ground: CONFIG.ADAPTATION_COLOR });
    m.unmount();
  });

  it('a failed attempt says which flashes went unanswered; trying again records attempt 2 with the first kept', () => {
    fake();
    const m = mount(observer(2));
    m.click('selftest-start');
    m.runCheck();
    expect(m.q('selftest-verdict')!.textContent).toBe('The camera check did not pass');
    expect(m.q('selftest-crit-blinks')!.dataset.ok).toBe('false');
    const chips = [...m.q('selftest-cues')!.querySelectorAll('[data-seen]')].map((c) => c.textContent);
    expect(chips[2]).toMatch(/✗ 3 · no blink seen/);
    expect(m.q('selftest-reasons')!.textContent).toMatch(/only 2 of 5 blinks were seen \(needs 4\)/);
    m.setEnd(observer(5));
    m.click('selftest-retry');
    m.runCheck();
    expect(m.q('selftest-attempt')!.textContent).toBe('Attempt 2 · earlier: 1 did not pass');
    m.click('selftest-continue');
    expect(m.done[0]).toMatchObject({ attempt: 2, verdict: 'working' });
    expect(m.done[0].earlier).toEqual([{ verdict: 'failed', cued: 5, detected: 2, samplingFps: 24, facePresence: 0.97 }]);
    m.unmount();
  });

  it('a reduced rate passes, says so, and still offers another try', () => {
    fake();
    const m = mount(observer(5, 17));
    m.click('selftest-start');
    m.runCheck();
    expect(m.q('selftest-verdict')!.textContent).toBe('The camera is working, at a reduced frame rate');
    expect(m.q('selftest-crit-rate')!.dataset.ok).toBe('reduced');
    expect(m.q('selftest-notes')!.textContent).toMatch(/Reduced frame rate/);
    expect(m.q('selftest-continue')).not.toBeNull();
    expect(m.q('selftest-retry')).not.toBeNull();
    m.unmount();
  });
});

describe('the result screen\'s words and trace', () => {
  it('says when a blink began relative to its flash', () => {
    expect(lagText(320)).toBe('blink 0.3 s after');
    expect(lagText(-150)).toBe('blink 0.2 s before');
  });

  it('states the rate with its tier and the floor that applies', () => {
    expect(rateLine(24.2, 'A')).toMatch(/24 times a second .* adequate \(20 or more\)/);
    expect(rateLine(17, 'B')).toMatch(/reduced \(15 to 20\): passes, flagged/);
    expect(rateLine(12, 'C')).toMatch(/too slow \(needs 15\)/);
    expect(rateLine(null, null)).toMatch(/no rate could be measured/);
  });

  it('draws openness as a fraction of the baseline, and breaks the line where the face was lost', () => {
    const trace = [0, 40, 80, 80 + MIN_GAP_MS + 10, 80 + MIN_GAP_MS + 50].map((t, i) => ({ t_ms: 1000 + t, ear: i === 1 ? 0.15 : 0.3 }));
    const g = traceGeometry(trace, 0.3, [1100], 1000, 600, 120);
    // Two pen-downs: the start, and after the gap.
    expect((g.path.match(/M/g) ?? []).length).toBe(2);
    expect(g.y(1)).toBe(20); // open eye at 1/1.2 of the height
    expect(g.y(0)).toBe(120);
    expect(g.x(1000)).toBe(0);
    expect(g.endMs).toBe(1100 + SELF_TEST.WINDOW_MS);
  });
});
