/**
 * The grey field is participant-paced: Continue appears at the minimum, the field ends by itself at
 * the maximum, and who ended it is reported. Rendered for real in jsdom with faked clocks.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdaptationScreen, type AdaptationResult } from '@/start/setupStages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(minMs: number, maxMs: number) {
  const results: AdaptationResult[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(AdaptationScreen, { minMs, maxMs, nextLabel: 'Next: Light background', onDone: (r) => results.push(r) })); });
  return {
    results,
    button: () => host.querySelector('[data-testid=adaptation-continue]') as HTMLButtonElement | null,
    text: () => host.textContent ?? '',
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('the participant-paced grey field', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('offers no Continue before the minimum, and says how long is left', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'Date', 'setTimeout'] });
    const m = mount(30_000, 120_000);
    advance(29_000);
    expect(m.button()).toBeNull();
    expect(m.text()).toMatch(/you can continue in \d+s/);
    expect(m.results).toHaveLength(0);
    m.unmount();
  });

  it('offers Continue from the minimum; tapping it ends the field as the participant', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'Date', 'setTimeout'] });
    const m = mount(30_000, 120_000);
    advance(31_000);
    expect(m.button()).not.toBeNull();
    act(() => { m.button()!.click(); });
    expect(m.results).toHaveLength(1);
    expect(m.results[0].endedBy).toBe('participant');
    expect(m.results[0].visibleMs).toBeGreaterThanOrEqual(30_000);
    expect(m.results[0].visibleMs).toBeLessThan(120_000);
    m.unmount();
  });

  it('ends by itself at the maximum, reported as the timer, exactly once', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'Date', 'setTimeout'] });
    const m = mount(30_000, 60_000);
    advance(61_000);
    expect(m.results).toHaveLength(1);
    expect(m.results[0].endedBy).toBe('timer');
    advance(10_000);
    expect(m.results).toHaveLength(1);
    m.unmount();
  });
});

describe('the grey field is wired and recorded', () => {
  it('passes the minimum and maximum, and records who ended it on the condition', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/experiment/Experiment.tsx', 'utf8');
    expect(src).toMatch(/<AdaptationScreen minMs=\{minDur\} maxMs=\{dur\}/);
    expect(src).toMatch(/adaptation_ms_min: adaptationMinimum, adaptation_ended_by: adaptationEnd/);
  });
  it('the audit judges delivered time against the minimum, so continuing at 30 s is not a shortfall', async () => {
    const { auditBundle } = await import('@/storage/integrity');
    const { buildFixtureBundle } = await import('@/sim/bundleFixture');
    const b = buildFixtureBundle();
    const conditions = b.conditions.map((c) => ({ ...c, adaptation_ms_planned: 120_000, adaptation_ms_min: 30_000, adaptation_ms_before: 31_000, adaptation_ended_by: 'participant' as const }));
    expect(auditBundle({ ...b, conditions }).findings.map((f) => f.check)).not.toContain('adaptation_delivered');
    const short = conditions.map((c) => ({ ...c, adaptation_ms_before: 10_000 }));
    expect(auditBundle({ ...b, conditions: short }).findings.map((f) => f.check)).toContain('adaptation_delivered');
  });
});
