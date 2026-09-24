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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { trackHiddenTime, trackFieldBlockedTime } from '@/lib/hiddenTime';

const readFileSyncSync = (p: string) => readFileSync(p, 'utf8');

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
      // The adaptation field uses the hidden-OR-portrait variant, which is built on the same tracker.
      expect(src, `${file} does not use the shared tracker`).toMatch(/track(Hidden|FieldBlocked)Time\(/);
    }
  });

  it('the experiment tracks the whole condition, not only the tasks that opted in', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/experiment/Experiment.tsx', 'utf8');
    expect(src).toMatch(/conditionHidden\.current = trackHiddenTime\(\)/);
    expect(src).toMatch(/condition_hidden_ms: away\?\.hiddenMs/);
  });
});

describe('the reading exposure measures the same window it subtracts from', () => {
  const src = readFileSyncSync('src/tasks/ReadingTask.tsx');

  it('starts the hidden-time tracker when reading starts, not when the screen mounts', () => {
    /*
     * The tracker ran from mount, while the self-paced instruction card was still up, whereas
     * taskStart is set on "Begin reading". So the hidden window covered intro + reading while the
     * wall clock covered reading only, and the intro card is exactly where a participant puts the
     * tablet down. A 96 s absence there plus a normal 178 s read exported reading_time_ms = 82,200
     * — a reading speed of 439 wpm for someone reading at 202 — in a row that satisfied its own
     * codebook definition. Long enough an absence and the Math.max(0, ...) clamp exports a zero.
     */
    const effect = src.slice(src.indexOf('const t = trackHiddenTime();') - 1400, src.indexOf('const t = trackHiddenTime();') + 200);
    expect(effect).toMatch(/if \(!started\) return undefined;\s*\n\s*const t = trackHiddenTime\(\);/);
    expect(src).toMatch(/hidden\.current = t;[\s\S]{0,80}\}, \[started\]\);/);
  });

  it('still subtracts it from the reading clock, and still reports it', () => {
    const next = src.slice(src.indexOf('const next = ()'), src.indexOf('} else setPage'));
    expect(next).toMatch(/readingTimeMs: Math\.max\(0, Math\.round\(wall - away\)\)/);
    expect(next).toMatch(/hiddenMs: away/);
    expect(next).toMatch(/wallClockMs: Math\.round\(wall\)/);
  });
});

/**
 * PORTRAIT IS THE SAME INTERRUPTION ON AN EVENT THE VISIBILITY API DOES NOT REPORT.
 *
 * Rotating a tablet does not fire `visibilitychange`; the page stays visible, so nothing is
 * throttled and `trackHiddenTime` sees nothing. Meanwhile the blocking overlay Experiment.tsx draws
 * is a SIBLING of the running task, not a replacement — the reaction-time block is a bare async loop
 * with no abort path, the search timer is armed once and never paused, and the reading page clock
 * keeps accruing. So a rotation converts go trials into misses indistinguishable from inattention,
 * and the overlay used to tell the participant the task had paused.
 *
 * Measuring it is the smaller half of the bargain — pausing every task is a protocol question as
 * much as an engineering one — but a measured interruption can be excluded and a silent one cannot.
 */
describe('portrait time is tracked like hidden time, on its own event', () => {
  const fakeTarget = () => {
    const handlers: Record<string, (() => void)[]> = {};
    return {
      addEventListener: (n: string, h: () => void) => { (handlers[n] ??= []).push(h); },
      removeEventListener: (n: string, h: () => void) => {
        handlers[n] = (handlers[n] ?? []).filter((x) => x !== h);
      },
      fire: (n: string) => (handlers[n] ?? []).forEach((h) => h()),
      count: (n: string) => (handlers[n] ?? []).length,
    };
  };

  it('accumulates an interval and counts the rotations', async () => {
    const { trackPortraitTime } = await import('@/lib/hiddenTime');
    const target = fakeTarget();
    let t = 0;
    let portrait = false;
    const tr = trackPortraitTime({ target, isHidden: () => portrait, clock: () => t, eventName: 'change' });

    t = 100; portrait = true; target.fire('change');   // rotated
    t = 900; portrait = false; target.fire('change');  // rotated back
    t = 1000; portrait = true; target.fire('change');  // and again
    t = 1200;
    const r = tr.read();
    expect(r.hiddenMs).toBe(1000); // 800 closed + 200 still in progress
    expect(r.events).toBe(2);
  });

  it('counts a rotation that had already happened when the condition began', async () => {
    // The condition starts while the tablet is already sideways: the edge has passed, and a tracker
    // that only watched for edges would report zero for an interruption spanning the whole block.
    const { trackPortraitTime } = await import('@/lib/hiddenTime');
    const target = fakeTarget();
    let t = 0;
    const tr = trackPortraitTime({ target, isHidden: () => true, clock: () => t, eventName: 'change' });
    t = 500;
    expect(tr.read()).toEqual({ hiddenMs: 500, events: 1 });
  });

  it('listens on its own event and detaches that same one', async () => {
    // The shared implementation takes the event name as an option precisely so this does not become
    // a second copy of the tracker — two copies is how reading and adaptation once disagreed.
    const { trackPortraitTime } = await import('@/lib/hiddenTime');
    const target = fakeTarget();
    const tr = trackPortraitTime({ target, isHidden: () => false, clock: () => 0, eventName: 'change' });
    expect(target.count('change')).toBe(1);
    expect(target.count('visibilitychange')).toBe(0);
    tr.stop();
    expect(target.count('change')).toBe(0);
  });
});

/**
 * THE READING TASK'S PAGE ADVANCE IS LATCHED ON A REF, NOT ON RENDERED STATE.
 *
 * `unlocked` is React state, re-locked in a passive effect that React schedules AFTER the commit. So
 * the commit from the first tap renders the next page with the button still live, and a second tap
 * inside that window passed the guard. Reading is when the window is widest — FaceMesh inference runs
 * every frame — and a participant who taps, sees nothing, and taps again is behaving normally.
 *
 * The cost was invisible in the export: `pageStart` had not been reset either, so both pushes
 * measured from the same page's start. Page N+1 was credited with a dwell it never had while being
 * on screen for a couple of hundred milliseconds, the minimum-dwell QC looked normal, the skim floor
 * was not tripped, and the comprehension items drawn from that page were simply failed.
 *
 * There is no DOM-rendering harness in this project, so this is a STATIC assertion over the source —
 * the technique tests/pwaPolicy.test.ts uses against vite.config.ts. It proves the latch exists, is
 * checked before any dwell is recorded, and is released in the same effect that re-locks the button.
 * It does NOT prove the component renders correctly; a render test would be stronger.
 */
describe('the reading page advance cannot fire twice for one page', () => {
  const source = () => readFileSync(resolve(__dirname, '..', 'src/tasks/ReadingTask.tsx'), 'utf8');

  it('checks a ref latch, not only the unlocked state', () => {
    const src = source();
    expect(src).toMatch(/if \(!unlocked \|\| advancing\.current\) return;/);
  });

  it('sets the latch before recording the dwell or advancing', () => {
    const src = source();
    const guard = src.indexOf('advancing.current) return;');
    const set = src.indexOf('advancing.current = true;', guard);
    const push = src.indexOf('pageDwells.current.push', guard);
    expect(set).toBeGreaterThan(guard);
    expect(push).toBeGreaterThan(set);
  });

  it('releases the latch where the button is re-locked and the clock restamped', () => {
    // Held for exactly the window during which those two are stale, and no longer.
    const src = source();
    const release = src.indexOf('advancing.current = false;');
    const relock = src.indexOf('setUnlocked(false);', release);
    const restamp = src.indexOf('pageStart.current = now();', release);
    expect(relock).toBeGreaterThan(release);
    expect(restamp).toBeGreaterThan(release);
    expect(restamp - release).toBeLessThan(200); // same effect body, not a distant one
  });
});

describe('the grey field counts only time it was actually in front of the participant', () => {
  /*
   * It subtracted hidden time only, so a rotation to portrait — the navy blocking overlay drawn over
   * the grey — counted as adaptation delivered.
   */
  const rig = () => {
    const doc = fakePage();
    const orient = fakePage();
    let t = 1000;
    const tracker = trackFieldBlockedTime({
      documentTarget: doc.opts.target, orientationTarget: orient.opts.target,
      isDocumentHidden: doc.opts.isHidden, isPortrait: orient.opts.isHidden, clock: () => t,
    });
    return { doc, orient, tracker, advance: (ms: number) => { t += ms; } };
  };

  it('subtracts portrait time', () => {
    const r = rig();
    r.advance(10_000);
    r.orient.hide();            // rotated to portrait
    r.advance(15_000);
    r.orient.show();            // back to landscape
    r.advance(5_000);
    expect(r.tracker.stop()).toEqual({ hiddenMs: 15_000, events: 1 });
  });

  it('still subtracts hidden time', () => {
    const r = rig();
    r.doc.hide(); r.advance(8_000); r.doc.show();
    expect(r.tracker.stop().hiddenMs).toBe(8_000);
  });

  it('counts an interval that is both hidden and portrait once, not twice', () => {
    const r = rig();
    r.orient.hide();            // portrait from t=0
    r.advance(4_000);
    r.doc.hide();               // then backgrounded as well
    r.advance(6_000);
    r.orient.show();            // landscape again while still hidden
    r.advance(3_000);
    r.doc.show();
    r.advance(2_000);
    expect(r.tracker.stop()).toEqual({ hiddenMs: 13_000, events: 1 });
  });

  it('detaches from both sources on stop', () => {
    const r = rig();
    r.tracker.stop();
    expect(r.doc.listenerCount()).toBe(0);
    expect(r.orient.listenerCount()).toBe(0);
  });

  it('is what the adaptation screen uses', () => {
    const src = readFileSyncSync(resolve(__dirname, '..', 'src/start/setupStages.tsx'));
    const screen = src.slice(src.indexOf('export function AdaptationScreen'), src.indexOf('// ---- INSTRUCTIONS'));
    expect(screen).toMatch(/trackFieldBlockedTime\(\)/);
    expect(screen).not.toMatch(/trackHiddenTime\(/);
  });
});
