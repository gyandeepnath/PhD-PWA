/**
 * Time the app spent in the background, measured once and measured correctly.
 *
 * Two copies of this existed — one in the reading task, one in the adaptation screen — and they did
 * not agree. The adaptation copy seeded its "hidden since" from the CURRENT visibility state; the
 * reading copy seeded it to null. So a reading page that began while the tablet was already
 * backgrounded (which is what happens when the participant switches away during the adaptation
 * field and the reading task mounts behind it) had its whole absence dropped: the visible→hidden
 * edge had passed before the listener existed, and the hidden→visible edge found nothing to
 * subtract from. reading_hidden_ms then understated the interruption it exists to report.
 *
 * It matters beyond bookkeeping. A hidden tab has its timers and animation frames throttled, so
 * anything clocked while hidden is clocking the throttling — the visual-search limit, the response
 * times, and above all the reaction-time block, whose one-second trials and one-second response
 * windows come back as misses and lapses belonging to the operating system.
 */
import { describe, it, expect } from 'vitest';
import { trackHiddenTime } from '@/lib/hiddenTime';

/** A page whose visibility and clock a test drives directly. */
function fakePage(startHidden = false) {
  let hidden = startHidden;
  let t = 1000;
  const listeners = new Set<() => void>();
  const target = {
    addEventListener: (_: string, fn: EventListenerOrEventListenerObject) => { listeners.add(fn as () => void); },
    removeEventListener: (_: string, fn: EventListenerOrEventListenerObject) => { listeners.delete(fn as () => void); },
  };
  return {
    opts: { target, isHidden: () => hidden, clock: () => t },
    advance: (ms: number) => { t += ms; },
    hide: () => { hidden = true; listeners.forEach((f) => f()); },
    show: () => { hidden = false; listeners.forEach((f) => f()); },
    listenerCount: () => listeners.size,
  };
}

describe('an ordinary, uninterrupted condition', () => {
  it('reports nothing', () => {
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    page.advance(120_000);
    expect(t.stop()).toEqual({ hiddenMs: 0, events: 0 });
  });
});

describe('an interruption', () => {
  it('is measured from the moment the app goes away to the moment it comes back', () => {
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    page.advance(5_000);
    page.hide();
    page.advance(8_000);
    page.show();
    page.advance(5_000);
    expect(t.stop()).toEqual({ hiddenMs: 8_000, events: 1 });
  });

  it('counts separate absences separately — six flickers are not one long one', () => {
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    for (let i = 0; i < 6; i++) {
      page.hide();
      page.advance(500);
      page.show();
      page.advance(2_000);
    }
    expect(t.stop()).toEqual({ hiddenMs: 3_000, events: 6 });
  });

  it('ignores a repeated hidden event without an intervening return', () => {
    // Some platforms fire visibilitychange more than once for one transition. Restarting the clock
    // on the second would discard the time already accrued.
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    page.hide();
    page.advance(3_000);
    page.hide();
    page.advance(3_000);
    page.show();
    expect(t.stop()).toEqual({ hiddenMs: 6_000, events: 1 });
  });
});

describe('an absence that had already begun when tracking started', () => {
  it('is counted — this is the interval the reading task used to lose entirely', () => {
    const page = fakePage(true);
    const t = trackHiddenTime(page.opts);
    page.advance(9_000);
    page.show();
    expect(t.stop()).toEqual({ hiddenMs: 9_000, events: 1 });
  });

  it('counts as an interruption even though its start was never observed', () => {
    const page = fakePage(true);
    const t = trackHiddenTime(page.opts);
    page.advance(1_000);
    expect(t.read().events).toBe(1);
  });
});

describe('reading the total while an absence is still in progress', () => {
  it('includes the open interval, so a task that ends while hidden is not understated', () => {
    // The reading task closed out without flushing an interval still open; a page submitted the
    // instant the participant returned lost its final stretch.
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    page.hide();
    page.advance(4_000);
    expect(t.read()).toEqual({ hiddenMs: 4_000, events: 1 });
    page.advance(1_000);
    expect(t.stop()).toEqual({ hiddenMs: 5_000, events: 1 });
  });

  it('does not keep accruing after stop, however long the page stays hidden', () => {
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    page.hide();
    page.advance(2_000);
    const first = t.stop();
    page.advance(60_000);
    expect(t.stop()).toEqual(first);
  });
});

describe('the listener', () => {
  it('is detached on stop, so a finished condition cannot keep reacting to the page', () => {
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    expect(page.listenerCount()).toBe(1);
    t.stop();
    expect(page.listenerCount()).toBe(0);
  });

  it('survives a second stop without throwing', () => {
    const page = fakePage();
    const t = trackHiddenTime(page.opts);
    t.stop();
    expect(() => t.stop()).not.toThrow();
  });
});

describe('the two screens that grew their own copies now share this one', () => {
  it('neither keeps a private visibilitychange listener', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/tasks/ReadingTask.tsx', 'src/start/setupStages.tsx']) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} still tracks visibility itself`).not.toMatch(/addEventListener\('visibilitychange'/);
      expect(src, `${file} does not use the shared tracker`).toMatch(/trackHiddenTime\(/);
    }
  });

  it('the experiment tracks the whole condition, not only the tasks that opted in', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/experiment/Experiment.tsx', 'utf8');
    expect(src).toMatch(/conditionHidden\.current = trackHiddenTime\(\)/);
    expect(src).toMatch(/condition_hidden_ms: away\?\.hiddenMs/);
  });
});
