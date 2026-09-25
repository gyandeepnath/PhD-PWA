/**
 * The researcher panel: collapsed by default on condition screens, openable, never tappable over the
 * speeded tasks, and every moment it is open on a condition screen is reported to the recorder.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearcherPanel, cameraState, clock, type ResearcherPanelProps } from '@/components/ResearcherPanel';
import { isMonitorOpen } from '@/lib/hiddenTime';
import type { LiveTrackingStats } from '@/tracking/useTracking';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stats = (over: Partial<LiveTrackingStats> = {}): LiveTrackingStats => ({
  facePresent: true, ear: 0.3, earRatio: 1, blinks: 12, incomplete: 3, blinksLive: true, fps: 31,
  exposureFps: 30, faceSize: 0.2, onScreen: true, sessionBlinks: 40, gazeZone: 'cc', noFaceForMs: 0,
  luma: 120, blocked: false, ...over,
});

function mount(over: Partial<ResearcherPanelProps> = {}) {
  let push: ((s: LiveTrackingStats) => void) | null = null;
  const props: ResearcherPanelProps = {
    subscribe: (fn) => { push = fn; return () => { push = null; }; },
    cameraStatus: 'active', cameraBlocked: false, cameraLost: false, fpsFloor: 30,
    stageLabel: 'questions', onStimulus: false, onReading: false, locked: false, ink: null,
    sittingStartedAt: Date.now() - 125_000, sessionStartedAt: Date.now() - 600_000,
    stageStartedAt: Date.now() - 5_000, conditionsDone: 3, conditionsTotal: 10, minutesLeft: 49, ...over,
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (p: Partial<ResearcherPanelProps> = {}) => act(() => { root.render(createElement(ResearcherPanel, { ...props, ...p })); });
  render();
  return {
    host, render,
    push: (s: LiveTrackingStats) => act(() => { push?.(s); }),
    q: (id: string) => host.querySelector(`[data-testid=${id}]`) as HTMLElement | null,
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe('researcher panel', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

  it('starts collapsed with the sitting clock, and opens on tap', () => {
    const m = mount();
    expect(m.q('researcher-panel-collapsed')?.textContent).toMatch(/2:0\d/);
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    expect(m.q('researcher-panel')).not.toBeNull();
    m.push(stats());
    expect(m.host.textContent).toMatch(/Working/);
    expect(m.host.textContent).toMatch(/12\s*· 3 inc\./);
    expect(m.host.textContent).toMatch(/3 of 10/);
    m.unmount();
  });

  it('closes when a condition screen starts, unless kept open — and reports open time only on condition screens', () => {
    const m = mount();
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    expect(isMonitorOpen()).toBe(false);                    // open, but not on a condition screen
    m.render({ onStimulus: true, stageStartedAt: Date.now() });
    expect(m.q('researcher-panel')).toBeNull();             // closed by itself
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    expect(isMonitorOpen()).toBe(true);                     // opened on a condition screen: recorded
    m.unmount();
    expect(isMonitorOpen()).toBe(false);
  });

  it('on reading it opens as a compact strip, not the full card', () => {
    const m = mount({ onStimulus: true, onReading: true, ink: { ink: '#000000', ground: '#FFFFFF' } });
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    expect(m.q('researcher-panel-strip')).not.toBeNull();
    expect(m.q('researcher-panel')).toBeNull();
    m.unmount();
  });

  it('cannot be opened during the speeded tasks', () => {
    const m = mount({ onStimulus: true, locked: true });
    const pill = m.q('researcher-panel-collapsed')!;
    expect(pill.style.pointerEvents).toBe('none');
    act(() => { pill.click(); });                            // even a programmatic click does not open it
    expect(m.q('researcher-panel')).toBeNull();
    m.unmount();
  });
});

describe('camera state in words', () => {
  const base = { cameraStatus: 'active', cameraBlocked: false, cameraLost: false, stale: false };
  it('names each problem', () => {
    expect(cameraState({ ...base, s: stats() }).level).toBe('ok');
    expect(cameraState({ ...base, cameraBlocked: true, s: stats() }).text).toMatch(/black/);
    expect(cameraState({ ...base, cameraLost: true, s: stats() }).text).toMatch(/stopped/);
    expect(cameraState({ ...base, stale: true, s: stats() }).text).toMatch(/No frames/);
    expect(cameraState({ ...base, s: stats({ facePresent: false, noFaceForMs: 9000 }) })).toEqual({ text: 'No face for 9 s', level: 'bad' });
    expect(cameraState({ ...base, s: stats({ blinks: null }) }).text).toMatch(/NOT counted/);
    expect(cameraState({ ...base, cameraStatus: 'unavailable', s: null }).level).toBe('off');
  });
  it('formats the clock', () => {
    expect(clock(125_000)).toBe('2:05');
    expect(clock(3_725_000)).toBe('1:02:05');
    expect(clock(125_000, false)).toBe('2 min');
    expect(clock(null)).toBe('—');
  });
});
