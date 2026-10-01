/**
 * The researcher panel: collapsed by default on condition screens, an ink indicator there with no hue
 * and no text, openable only as the compact strip, never tappable where it is locked, docked with its
 * footprint reserved on set-up screens, and every moment it is open on a condition screen is reported
 * to the recorder.
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
    stageLabel: 'questions', onStimulus: false, locked: false, ink: null,
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

  it('on a condition screen it opens as a compact strip, not the full card', () => {
    const m = mount({ onStimulus: true, ink: { ink: '#000000', ground: '#FFFFFF' } });
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    expect(m.q('researcher-panel-strip')).not.toBeNull();
    expect(m.q('researcher-panel')).toBeNull();
    m.unmount();
  });

  it('the strip is two lines that never wrap, so it stays inside the reading footer\'s row', () => {
    // The longest camera state: wrapped, it made the strip three lines (71 px) and lifted it over the
    // footer's rule into the bottom of the passage.
    const m = mount({ onStimulus: true, ink: { ink: '#000000', ground: '#FFFFFF' } });
    m.push(stats({ blinks: null }));
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    const strip = m.q('researcher-panel-strip')!;
    expect(strip.textContent).toMatch(/blinks NOT counted/);
    const lines = Array.from(strip.children) as HTMLElement[];
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.style.whiteSpace).toBe('nowrap');
      expect(l.style.overflow).toBe('hidden');
      expect(l.style.textOverflow).toBe('ellipsis');
    }
    m.unmount();
  });

  it('on a condition screen it is an ink indicator: no text, no hue — whatever the camera is doing', () => {
    // Blue text on white, so a hue of the panel's own would differ from the ink. A fresh panel per
    // state: on a condition screen the panel takes at most one reading a second.
    const ink = { ink: '#2869FF', ground: '#FFFFFF' };
    const look = (s: LiveTrackingStats) => {
      const m = mount({ onStimulus: true, ink });
      m.push(s);
      const pill = m.q('researcher-panel-collapsed')!;
      const colours = [pill, ...Array.from(pill.querySelectorAll('*'))]
        .flatMap((e) => { const st = (e as HTMLElement).style; return [st.color, st.background, st.backgroundColor, st.borderColor, st.border]; })
        .join(' ');
      const out = { text: pill.textContent, colours, dot: (pill.firstElementChild as HTMLElement).style.background };
      m.unmount();
      return out;
    };
    const fine = look(stats());
    const noFace = look(stats({ facePresent: false, noFaceForMs: 16_000 }));
    const noBaseline = look(stats({ blinks: null }));
    for (const l of [fine, noFace, noBaseline]) {
      expect(l.text).toBe('');                                // no clock, no "No face for 16 s"
      expect(l.colours).not.toMatch(/224, 163, 60|229, 72, 77|34, 201, 122|154, 160, 180|e0a33c|e5484d|22c97a|9aa0b4/i);
    }
    // A problem is told by shape alone: the filled dot becomes an empty ring.
    expect(fine.dot).not.toBe('transparent');
    expect(noFace.dot).toBe('transparent');
    expect(noBaseline.dot).toBe('transparent');
  });

  it('rings only for a sustained problem: a face lost for a moment does not flicker the dot', () => {
    const dot = (s: LiveTrackingStats) => {
      const m = mount({ onStimulus: true, ink: { ink: '#000000', ground: '#FFFFFF' } });
      m.push(s);
      const bg = (m.q('researcher-panel-collapsed')!.firstElementChild as HTMLElement).style.background;
      m.unmount();
      return bg;
    };
    expect(cameraState({ cameraStatus: 'active', cameraBlocked: false, cameraLost: false, stale: false, s: stats({ facePresent: false, noFaceForMs: 3_000 }) }).level).toBe('warn');
    expect(dot(stats({ facePresent: false, noFaceForMs: 3_000 }))).not.toBe('transparent');
    expect(dot(stats({ facePresent: false, noFaceForMs: 9_000 }))).toBe('transparent');
  });

  it('holds still while a timed procedure runs, and catches up when it ends', () => {
    // The reaction-time trials are running (still) and the face is lost for good part-way through:
    // the indicator keeps the look it had when they began.
    const m = mount({ onStimulus: true, locked: true, ink: { ink: '#000000', ground: '#FFFFFF' }, still: true });
    const dot = () => (m.q('researcher-panel-collapsed')!.firstElementChild as HTMLElement).style.background;
    expect(dot()).not.toBe('transparent');
    m.push(stats({ facePresent: false, noFaceForMs: 20_000 }));
    expect(dot()).not.toBe('transparent');
    // The trials end: the problem shows at once.
    m.render({ still: false });
    expect(dot()).toBe('transparent');
    m.unmount();
  });

  it('a locked indicator over a set-up procedure is the same quiet look, in that screen\'s ink', () => {
    const m = mount({ onStimulus: false, locked: true, ink: { ink: '#ffffff', ground: '#0a0a12' } });
    m.push(stats({ facePresent: false, noFaceForMs: 16_000 }));
    const pill = m.q('researcher-panel-collapsed')!;
    expect(pill.textContent).toBe('');
    expect(pill.getAttribute('data-quiet')).toBe('true');
    expect(pill.style.pointerEvents).toBe('none');
    m.unmount();
  });

  it('on a set-up screen the open card reserves its footprint, and gives it back when it closes', () => {
    const dock = () => document.documentElement.style.getPropertyValue('--vl-panel-dock');
    const m = mount();
    expect(dock()).toBe('');
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    expect(m.q('researcher-panel')).not.toBeNull();
    expect(dock()).toBe('344px');
    act(() => { m.q('researcher-panel-close')!.click(); });
    expect(dock()).toBe('');
    // And a condition screen never docks: the strip is not reserved, it sits where nothing else is.
    m.render({ onStimulus: true, ink: { ink: '#000000', ground: '#FFFFFF' } });
    act(() => { m.q('researcher-panel-collapsed')!.click(); });
    expect(m.q('researcher-panel-strip')).not.toBeNull();
    expect(dock()).toBe('');
    m.unmount();
    expect(dock()).toBe('');
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
