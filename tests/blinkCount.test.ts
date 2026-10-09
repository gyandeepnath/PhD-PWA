/**
 * One way of counting blinks (Round 80, tracking/blinkCount.ts): the record, the live count in the
 * researcher panel and the marks on the live graph are the same function, on the same samples, against
 * the same baseline and cuts. The one stated difference — the live count leaves out a blink still in
 * progress — is pinned here, and so is what it fixes: the incomplete count no longer ticks up and back
 * down while a blink is under way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { blinkCuts, countBlinks, traceBlinkMarks, traceSamples } from '@/tracking/blinkCount';
import { classifyBlinks, EAR_TIERS, type EarSample } from '@/tracking/blink';
import { EyeMetricsAggregator } from '@/tracking/aggregator';

const BASE = 0.3;
const DT = 1000 / 24;
const T0 = 50_000;

/**
 * A lid closing to `depth` x open and reopening over 10 frames at 24 fps. The descent is gradual enough
 * that a complete blink spends a frame between the two cuts on its way down: counted at that frame, it
 * would read incomplete.
 */
function blink(depth: number): number[] {
  const shape = [0.95, 0.8, 0.7, 0.62, 0.45, 0.2, 0, 0.2, 0.5, 0.8];
  return shape.map((k) => BASE * (depth + (1 - depth) * k));
}

/**
 * 12 s at 24 fps: a complete blink (depth 0.10), an incomplete one (0.68), a complete one, an incomplete
 * one, then a complete one that is still closing at the last frame.
 */
function series(): EarSample[] {
  const ears: number[] = [];
  const open = (n: number) => { for (let i = 0; i < n; i++) ears.push(BASE * (1 + 0.01 * Math.sin(i))); };
  open(40); ears.push(...blink(0.10));
  open(40); ears.push(...blink(0.68));
  open(40); ears.push(...blink(0.15));
  open(40); ears.push(...blink(0.70));
  open(40); ears.push(...blink(0.12).slice(0, 4)); // still closing: the window ends inside it
  return ears.map((ear, k) => ({ t_ms: T0 + k * DT, ear }));
}

function aggregatorOf(s: EarSample[]): EyeMetricsAggregator {
  const agg = new EyeMetricsAggregator();
  for (const x of s) {
    agg.ingest({ t_ms: x.t_ms, ear: x.ear, pose: { pitch: 0, yaw: 0, roll: 0 }, zone: 'cc', isCenter: true, offAxis: false, facePresent: true, faceSize: 0.2, luma: null });
  }
  return agg;
}

const args = {
  conditionId: 'c', sessionId: 's', cameraActive: true, baselineEarValue: BASE,
  earThresholdUsed: blinkCuts(BASE)!.registration, earCompleteThreshold: blinkCuts(BASE)!.complete,
  gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null,
};

describe('the cuts', () => {
  it('are EAR_TIERS x baseline, and are the cuts the classifier applies', () => {
    const c = blinkCuts(BASE)!;
    expect(c.registration).toBeCloseTo(BASE * EAR_TIERS.partial, 12);
    expect(c.complete).toBeCloseTo(BASE * EAR_TIERS.full, 12);
    // A dip to just below the registration cut is a blink; to just above it is not.
    const dip = (min: number) => [BASE, BASE, min, BASE, BASE].map((ear, k) => ({ t_ms: k * DT, ear }));
    expect(classifyBlinks(dip(c.registration - 1e-6), BASE)).toHaveLength(1);
    expect(classifyBlinks(dip(c.registration + 1e-6), BASE)).toHaveLength(0);
    // Below the complete cut it is complete; just above, incomplete.
    expect(classifyBlinks(dip(c.complete - 1e-6), BASE)[0].tier).not.toBe('incomplete');
    expect(classifyBlinks(dip(c.complete + 1e-6), BASE)[0].tier).toBe('incomplete');
  });

  it('do not exist without a usable baseline — nothing is counted, and that is null, not zero', () => {
    for (const b of [null, undefined, 0, -1, NaN]) {
      expect(blinkCuts(b)).toBeNull();
      expect(countBlinks(series(), b, 'live')).toMatchObject({ blinks: null, incomplete: null, events: [] });
    }
  });
});

describe('live and final counts', () => {
  it('final counts the blink the window ended inside (blink-r1); live leaves it out and says so', () => {
    const s = series();
    const fin = countBlinks(s, BASE, 'final');
    const live = countBlinks(s, BASE, 'live');
    expect(fin.blinks).toBe(5);
    expect(fin.events[4].ended_by).toBe('window_end');
    expect(live).toMatchObject({ blinks: 4, incomplete: 2, complete: 2, inProgress: true });
    expect(fin.incomplete! + fin.complete!).toBe(fin.blinks);
  });

  it('the live count never takes back a blink: blinks and incomplete only ever rise, frame by frame', () => {
    const s = series();
    let blinks = 0;
    let incomplete = 0;
    for (let n = 1; n <= s.length; n++) {
      const c = countBlinks(s.slice(0, n), BASE, 'live');
      expect(c.blinks!).toBeGreaterThanOrEqual(blinks);
      expect(c.incomplete!).toBeGreaterThanOrEqual(incomplete);
      blinks = c.blinks!;
      incomplete = c.incomplete!;
    }
  });

  it('the aggregator’s live count is countBlinks on its samples; the record is countBlinks final', () => {
    const s = series();
    for (const n of [50, 45, 100, 150, s.length]) {
      const agg = aggregatorOf(s.slice(0, n));
      const c = countBlinks(s.slice(0, n), BASE, 'live');
      expect(agg.liveCounts(BASE)).toEqual({ blinks: c.blinks, incomplete: c.incomplete, inProgress: c.inProgress });
    }
    const agg = aggregatorOf(s);
    const { record, events } = agg.finalizeWithEvents(args);
    const fin = countBlinks(s, BASE, 'final');
    expect(events).toEqual(fin.events);
    expect(record.blink_count_incomplete).toBe(fin.incomplete);
    expect((record.blink_count_full ?? 0) + (record.blink_count_micro ?? 0)).toBe(fin.complete);
    // The self-test's blinks are the same function too.
    expect(agg.blinkEvents(BASE)).toEqual(fin.events);
  });

  it('once the eye reopens, the live count and the record agree', () => {
    const s = series().slice(0, 4 * (40 + 10) + 10); // ends with the eye open
    const live = countBlinks(s, BASE, 'live');
    const { record } = aggregatorOf(s).finalizeWithEvents(args);
    expect(live.inProgress).toBe(false);
    expect(live.blinks).toBe((record.blink_count_full ?? 0) + (record.blink_count_micro ?? 0) + (record.blink_count_incomplete ?? 0));
    expect(live.incomplete).toBe(record.blink_count_incomplete);
  });
});

describe('the live graph', () => {
  it('marks exactly the blinks the live count counts, at their deepest frame, with their tier', () => {
    const s = series();
    // The trace as useTracking keeps it: [capture time, EAR or null], frames without a face as null.
    const trace: Array<[number, number | null]> = s.map((x) => [x.t_ms, x.ear]);
    trace.splice(20, 0, [s[19].t_ms + DT / 2, null]);
    expect(traceSamples(trace)).toEqual(s);
    const marks = traceBlinkMarks(trace, BASE);
    const live = countBlinks(s, BASE, 'live');
    expect(marks.map((k) => k.at)).toEqual(live.events.map((e) => e.min_at_ms));
    expect(marks.map((k) => k.complete)).toEqual(live.events.map((e) => e.tier !== 'incomplete'));
    expect(traceBlinkMarks(trace, null)).toEqual([]);
  });

  it('draws its lines from blinkCuts, and the record’s thresholds come from blinkCuts', () => {
    const card = readFileSync('src/components/LiveCamera.tsx', 'utf8');
    expect(card).toMatch(/blinkCuts\(base\)/);
    expect(card).not.toMatch(/EAR_TIERS/);
    const hook = readFileSync('src/tracking/useTracking.ts', 'utf8');
    expect(hook).toMatch(/earThresholdUsed: cuts\?\.registration/);
    expect(hook).toMatch(/earCompleteThreshold: cuts\?\.complete/);
    expect(hook).toMatch(/traceBlinkMarks\(earTraceRef\.current, baselineEarRef\.current\)/);
    // The panel's count after a window is the record's, not a recount.
    expect(hook).toMatch(/lastConditionCounts\.current = \{ blinks: total, incomplete: record\.blink_count_incomplete \}/);
  });
});
