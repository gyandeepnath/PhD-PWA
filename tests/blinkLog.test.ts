/**
 * The stored blink record (Round 78): every blink of a reading window, the camera self-test's cued
 * blinks, and the per-frame eye-openness trace behind them (tracking/blinkLog.ts).
 *
 * What these pin:
 *  - the rule version names the rules: changing a cut, the micro rule or the gap rule without
 *    changing BLINK_RULE_VERSION fails here, so old and new rows can always be told apart;
 *  - the trace survives its compact text encoding, frame for frame;
 *  - each per-blink field (R2 §G) measures what its codebook entry says, and is null rather than a
 *    guess when its frames are not there;
 *  - the record is built from the SAME blinks the eye-metrics row counts.
 */
import { describe, it, expect } from 'vitest';
import {
  BLINK_RULE_VERSION, EAR_TIERS, GAP_MULTIPLE, MIN_GAP_MS, classifyBlinks, type EarSample,
} from '@/tracking/blink';
import {
  blinkDetail, buildOcularEventsRecord, cueLag, decodeTrace, emptyTrace, encodeTrace, localFps, ocularRecordId, pageAt,
  tierCounts, fitBlinks, fitExposure, fittedIncompleteCount, OPEN_PRE_MIN_FRAMES, OPEN_PRE_WINDOW_MS, type DetailSample,
} from '@/tracking/blinkLog';
import { FIT_RULE_VERSION, templateClosure } from '@/tracking/blinkFit';
import { EyeMetricsAggregator } from '@/tracking/aggregator';

const BASE = 0.3;
const STEP = 40;
const T0 = 10_000;

/** 60 frames at 25 fps: open (0.290-0.294) to frame 29, a blink over frames 30-33, open again from 34. */
function series(): DetailSample[] {
  const out: DetailSample[] = [];
  for (let k = 0; k < 60; k++) {
    const blink: Record<number, number> = { 30: 0.2, 31: 0.1, 32: 0.12, 33: 0.21 };
    const ear = blink[k] ?? (k < 30 ? 0.29 + 0.001 * (k % 5) : 0.3);
    // Frame 32 is lopsided: the left eye nearly shut, the right barely below the cut.
    const [left, right] = k === 32 ? [0.05, 0.19] : [ear + 0.002, ear - 0.002];
    out.push({ t_ms: T0 + STEP * k, ear, left, right, pitch: k === 31 ? 7.2 : 1, yaw: k === 31 ? -3.4 : 0 });
  }
  return out;
}

describe('the rule version names the rules', () => {
  /*
   * A ratchet. If this fails because a cut or a rule below was changed ON PURPOSE, change
   * BLINK_RULE_VERSION too (tracking/blink.ts), record the change in docs/ANALYSIS_PLAN.md, and only
   * then update the expected values here. Ratios classified under two rule sets are not comparable.
   */
  it('blink-r1 is: register below 0.75, complete below 0.60, micro under 40 ms, gaps over max(250 ms, 4 x median)', () => {
    expect({ version: BLINK_RULE_VERSION, tiers: EAR_TIERS, gapMultiple: GAP_MULTIPLE, minGapMs: MIN_GAP_MS }).toEqual({
      version: 'blink-r1', tiers: { full: 0.6, partial: 0.75, micro: 0.88 }, gapMultiple: 4, minGapMs: 250,
    });
    const blinkOf = (reopenAt: number) => classifyBlinks(
      [{ t_ms: 0, ear: BASE }, { t_ms: 10, ear: 0.1 }, { t_ms: reopenAt, ear: BASE }], BASE,
    );
    expect(blinkOf(49)[0].tier).toBe('micro');
    expect(blinkOf(50)[0].tier).toBe('full');
  });
});

describe('the trace is stored compactly and read back frame for frame', () => {
  it('round-trips times, the face flag and both eyes, keeping missing eyes missing', () => {
    const buf = emptyTrace();
    const frames: [number, boolean, number | null, number | null][] = [
      [5000.004, true, 0.3123456789, 0.29],
      [5033.337, false, null, null],
      [5066.67, true, 0.25, null],
      [5100, true, 0.2, 0.21],
    ];
    for (const [t, f, l, r] of frames) { buf.t.push(t); buf.face.push(f); buf.left.push(l); buf.right.push(r); }
    const enc = encodeTrace(buf, 5000.004);
    expect(enc.frames).toBe(4);
    expect(enc.face).toBe('1011');
    const rows = decodeTrace(enc);
    expect(rows.map((r) => r.t_ms)).toEqual([0, 33.33, 66.67, 100]);
    expect(rows[0].left).toBe(0.312346);
    expect(rows[1]).toMatchObject({ face: false, left: null, right: null, ear: null });
    // One eye only: no mean, because the classifier needs both.
    expect(rows[2]).toMatchObject({ left: 0.25, right: null, ear: null });
    expect(rows[3].ear).toBeCloseTo(0.205, 12);
  });

  it('a short column yields nulls for the missing frames instead of shifting values onto the wrong frame', () => {
    const rows = decodeTrace({ frames: 3, t: '0,40,80', face: '111', left: '0.3,0.2', right: '0.3,0.2,0.3' });
    expect(rows[2]).toMatchObject({ frame: 3, t_ms: 80, left: null, right: 0.3, ear: null });
  });
});

describe('each blink carries what checking it needs', () => {
  const s = series();
  const [e] = classifyBlinks(s, BASE);

  it('finds the one blink, with its offset, deepest frame and length', () => {
    expect(classifyBlinks(s, BASE)).toHaveLength(1);
    expect(e).toMatchObject({
      onset_ms: T0 + 30 * STEP, offset_ms: T0 + 34 * STEP, min_at_ms: T0 + 31 * STEP, frames_below: 4,
      ended_by: 'reopened', min_ear: 0.1, tier: 'full',
    });
  });

  it("keeps each eye's own minimum, so a one-eyed dip is visible", () => {
    const d = blinkDetail(s, e, BASE);
    // Left: 0.202, 0.102, 0.05, 0.212 -> 0.05. Right: 0.198, 0.098, 0.19, 0.208 -> 0.098.
    expect(d.min_ear_left).toBe(0.05);
    expect(d.min_ear_right).toBe(0.098);
  });

  it('measures the open eye in the second before onset, and the depth against it', () => {
    const d = blinkDetail(s, e, BASE);
    // Frames 5-29 lie in [onset - 1000, onset): 25 open frames, five of each of 0.290-0.294.
    expect(OPEN_PRE_WINDOW_MS).toBe(1000);
    expect(d.open_pre).toBe(0.292);
    const rec = buildOcularEventsRecord({
      conditionId: 'c1', sessionId: 's1', baseline: BASE, events: [e], series: s, trace: emptyTrace(), pageMarks: [],
    });
    expect(rec.events[0].min_ratio_raw).toBeCloseTo(0.1 / BASE, 12);
    expect(rec.events[0].min_ratio_local_raw).toBeCloseTo(0.1 / 0.292, 12);
  });

  it('leaves the open level empty when fewer than five open frames precede the blink', () => {
    const early = series().slice(26);
    const [b] = classifyBlinks(early, BASE);
    // Frames 26-29 only: four open frames before onset.
    expect(OPEN_PRE_MIN_FRAMES).toBe(5);
    expect(blinkDetail(early, b, BASE).open_pre).toBeNull();
  });

  it('reports the widest sampling step across the blink, so a dropped frame shows', () => {
    expect(blinkDetail(s, e, BASE).max_gap_ms).toBe(STEP);
    const dropped = s.filter((_, k) => k !== 32);
    const [b] = classifyBlinks(dropped, BASE);
    expect(blinkDetail(dropped, b, BASE).max_gap_ms).toBe(2 * STEP);
    // The step INTO the blink counts too: a frame lost just before onset means its descent was missed.
    const late = s.filter((_, k) => k !== 29);
    const [c] = classifyBlinks(late, BASE);
    expect(blinkDetail(late, c, BASE).max_gap_ms).toBe(2 * STEP);
  });

  it('records the head pose at the deepest frame', () => {
    expect(blinkDetail(s, e, BASE)).toMatchObject({ pitch_at_min: 7.2, yaw_at_min: -3.4 });
    const noPose = s.map((x) => ({ ...x, pitch: null, yaw: null }));
    expect(blinkDetail(noPose, e, BASE)).toMatchObject({ pitch_at_min: null, yaw_at_min: null });
  });

  it('takes a blink still closed when the window ended up to and including the last frame', () => {
    const cut = s.slice(0, 33);
    const [b] = classifyBlinks(cut, BASE);
    expect(b).toMatchObject({ ended_by: 'window_end', offset_ms: T0 + 32 * STEP, frames_below: 3 });
    const d = blinkDetail(cut, b, BASE);
    expect(d.min_ear_left).toBe(0.05);
    expect(d.max_gap_ms).toBe(STEP);
  });

  it('gives nothing, rather than a neighbour, for a blink whose frames are not in the series', () => {
    expect(blinkDetail(s.slice(40), e, BASE)).toEqual({
      min_ear_left: null, min_ear_right: null, open_pre: null, max_gap_ms: null, pitch_at_min: null, yaw_at_min: null,
    });
  });
});

describe('local frame rate and page', () => {
  it('counts face-solved frames within a second either side', () => {
    const s: EarSample[] = Array.from({ length: 100 }, (_, k) => ({ t_ms: k * 40, ear: BASE }));
    expect(localFps(s, 2000)).toBeCloseTo(25, 9);
    expect(localFps([{ t_ms: 0, ear: BASE }], 0)).toBeNull();
  });

  it('names the page on screen at a time, page 1 covering anything before its mark', () => {
    const marks: [number, number][] = [[100, 1], [5000, 2], [9000, 3]];
    expect(pageAt(marks, 50)).toBe(1);
    expect(pageAt(marks, 4999)).toBe(1);
    expect(pageAt(marks, 5000)).toBe(2);
    expect(pageAt(marks, 20_000)).toBe(3);
    expect(pageAt([], 0)).toBeNull();
  });

  it('measures a self-test blink from the nearest cue, signed', () => {
    expect(cueLag([1000, 4000], 1300)).toBe(300);
    expect(cueLag([1000, 4000], 3800)).toBe(-200);
    expect(cueLag(undefined, 10)).toBeNull();
  });
});

/** Ingest a series through the real aggregator, with a face-lost stretch and page turns. */
function aggregate(s: DetailSample[]) {
  const agg = new EyeMetricsAggregator();
  agg.markPage(1, T0 - 5);
  s.forEach((x, k) => {
    if (k === 10) {
      agg.ingest({ t_ms: x.t_ms - 20, ear: NaN, pose: { pitch: 0, yaw: 0, roll: 0 }, zone: 'cc', isCenter: false, offAxis: false, facePresent: false, faceSize: 0, luma: null });
    }
    if (k === 20) agg.markPage(2, x.t_ms);
    agg.ingest({
      t_ms: x.t_ms, ear: x.ear, earLeft: x.left ?? undefined, earRight: x.right ?? undefined,
      pose: { pitch: x.pitch ?? 0, yaw: x.yaw ?? 0, roll: 0 }, zone: 'cc', isCenter: true, offAxis: false,
      facePresent: true, faceSize: 0.2, luma: null,
    });
  });
  return agg;
}

describe('the record is built from the blinks the eye-metrics row counts', () => {
  const args = {
    conditionId: 'cond-x', sessionId: 'sess-x', cameraActive: true, baselineEarValue: BASE, earThresholdUsed: BASE * 0.75,
    gazeCalibrated: true, headPitchCalibrated: true, calibrationId: null,
  };

  it('stores the same blinks, by tier, as the row; one trace row per frame; the page each began on', () => {
    const agg = aggregate(series());
    const { record, events } = agg.finalizeWithEvents(args);
    const log = agg.blinkLog({ conditionId: 'cond-x', sessionId: 'sess-x', baseline: BASE, events });
    expect(tierCounts(log.events)).toEqual({
      full: record.blink_count_full, micro: record.blink_count_micro, incomplete: record.blink_count_incomplete,
    });
    expect(log).toMatchObject({ record_id: 'cond-x', condition_id: 'cond-x', window: 'reading', rule_version: BLINK_RULE_VERSION });
    expect(log.cues).toBeUndefined();
    // 60 face frames plus the one without a face; the face-solved ones are ear_sample_count.
    expect(log.trace.frames).toBe(61);
    expect(decodeTrace(log.trace).filter((f) => f.face && f.ear != null)).toHaveLength(record.ear_sample_count);
    // Times are from the first frame of the window, which is frame 1 of the trace.
    expect(log.events[0]).toMatchObject({ onset_ms: 30 * STEP, page: 2, min_ear_left: 0.05, pitch_at_min: 7.2, open_pre: 0.292 });
  });

  it('stores no blinks when there was no baseline, as the row counts none', () => {
    const agg = aggregate(series());
    const { record, events } = agg.finalizeWithEvents({ ...args, baselineEarValue: null });
    expect(record.blink_count_full).toBeNull();
    expect(events).toEqual([]);
  });

  it('files the self-test under the session, with no condition and its cue times', () => {
    const agg = aggregate(series());
    const events = agg.blinkEvents(BASE);
    const log = agg.blinkLog({ window: 'selftest', conditionId: null, sessionId: 'sess-x', baseline: BASE, events, cues: [T0 + 1100] });
    expect(log).toMatchObject({ record_id: ocularRecordId('selftest', 'sess-x'), condition_id: null, window: 'selftest' });
    expect(log.record_id).toBe('selftest:sess-x');
    expect(log.cues).toEqual([1100]);
    expect(cueLag(log.cues, log.events[0].onset_ms)).toBe(30 * STEP - 1100);
  });

  it('refuses to file a reading window under no condition', () => {
    expect(() => buildOcularEventsRecord({
      conditionId: null, sessionId: 's', baseline: BASE, events: [], series: [], trace: emptyTrace(), pageMarks: [],
    })).toThrow(/condition_id/);
  });
});

describe('the fitted-minimum sensitivity (Round 79, fit-r1)', () => {
  /**
   * 20 s at 24 fps with one blink of the mean shape (100/220 ms) whose true depth is 0.58 of the open
   * eye — complete — placed so that its lowest frame reads just above the 0.60 cut: the primary rule
   * calls it incomplete, the fit does not. No noise, so the numbers are exact.
   */
  function slowBlink(): DetailSample[] {
    const out: DetailSample[] = [];
    const dt = 1000 / 24;
    const start = T0 + 10_000 - 0.63 * dt; // frames fall 0.63 of a frame after its start: the sampling phase that is worst for the lowest frame (tests/blinkFit.test.ts)
    for (let k = 0; k < 480; k++) {
      const t = T0 + k * dt;
      let g = 0;
      for (let i = 0; i < 200; i++) g += templateClosure(t - 40 + (40 * (i + 0.5)) / 200 - start, 100, 220);
      const ear = BASE * (1 - 0.42 * (g / 200));
      out.push({ t_ms: t, ear, left: ear, right: ear, pitch: 0, yaw: 0 });
    }
    return out;
  }
  const args = {
    conditionId: 'cond-f', sessionId: 'sess-f', cameraActive: true, baselineEarValue: BASE, earThresholdUsed: BASE * 0.75,
    gazeCalibrated: true, headPitchCalibrated: true, calibrationId: null,
  };

  it('re-judges a blink its lowest frame misread, and leaves the primary count alone', () => {
    const agg = aggregate(slowBlink());
    // A 40-ms exposure fixed at camera setup (400 x 100 µs).
    const { record, events, fits, fitExposure: ex } = agg.finalizeWithEvents({ ...args, lockedExposure100us: 400 });
    expect(events).toHaveLength(1);
    expect(events[0].min_ear / BASE).toBeGreaterThan(0.6); // the lowest frame: incomplete
    expect(record.blink_count_incomplete).toBe(1);          // the primary, unchanged
    expect(ex).toEqual({ ms: 40, known: true });
    expect(fits[0]!.min_ear / BASE).toBeCloseTo(0.58, 3);   // the fit: complete
    expect(record).toMatchObject({
      blink_count_incomplete_fit: 0, incomplete_blink_ratio_fit: 0, blinks_not_fitted: 0,
      fit_exposure_ms: 40, fit_exposure_known: true, fit_rule_version: FIT_RULE_VERSION,
    });
    const log = agg.blinkLog({ conditionId: 'cond-f', sessionId: 'sess-f', baseline: BASE, events, fits, fitExposure: ex });
    expect(log.events[0].min_ratio_fit).toBeCloseTo(0.58, 3);
    expect(log).toMatchObject({ fit_rule_version: 'fit-r1', fit_exposure_ms: 40, fit_exposure_known: true });
    // The count from the stored blinks is the row's: what the integrity report checks.
    const recount = log.events.filter((e) => (e.min_ratio_fit != null ? e.min_ratio_fit >= EAR_TIERS.full : e.tier === 'incomplete')).length;
    expect(recount).toBe(record.blink_count_incomplete_fit);
  });

  it('assumes the frame interval when the exposure was not fixed, and says so', () => {
    expect(fitExposure(null, 24)).toEqual({ ms: 1000 / 24, known: false });
    expect(fitExposure(300, 30)).toEqual({ ms: 30, known: true });
    // Never longer than a frame: a 50-ms lock at 25 fps cannot expose for more than 40 ms.
    expect(fitExposure(500, 25)).toEqual({ ms: 40, known: true });
    expect(fitExposure(undefined, null)).toEqual({ ms: 0, known: false });
    const agg = aggregate(slowBlink());
    const { record } = agg.finalizeWithEvents(args);
    expect(record.fit_exposure_known).toBe(false);
    expect(record.fit_exposure_ms).toBeCloseTo(1000 / 24, 1);
  });

  it('keeps the primary class of a blink it cannot fit, and counts it', () => {
    const s = series(); // only four frames below the cut and an irregular shape: fitted, or not, per frame window
    const events = classifyBlinks(s, BASE);
    // No open eye before the blink (the series is cut at onset): no fit, the tier stands.
    const cut = s.slice(30);
    const ev = classifyBlinks(cut, BASE);
    const fits = fitBlinks(cut, ev, BASE, 0);
    expect(fits).toEqual([null]);
    expect(fittedIncompleteCount(ev, fits, BASE)).toEqual({ incomplete: ev.filter((e) => e.tier === 'incomplete').length, notFitted: 1 });
    expect(fittedIncompleteCount(events, [null], null)).toEqual({ incomplete: null, notFitted: 1 });
  });

  it('writes nothing about a fit on a record that was not fitted (the self-test)', () => {
    const agg = aggregate(series());
    const log = agg.blinkLog({ window: 'selftest', conditionId: null, sessionId: 's', baseline: BASE, events: agg.blinkEvents(BASE), cues: [] });
    expect(log.fit_rule_version).toBeUndefined();
    expect('min_ratio_fit' in log.events[0]).toBe(false);
  });
});

describe('the stored size docs/ANALYSIS_PLAN.md states', () => {
  /*
   * §5 item 6 tells the investigator what these records cost: about 1.7 MB per ten-condition sitting.
   * Measured here on a synthetic sitting the way the app stores it — ten 3-minute reading windows at
   * 30 fps, EAR noise in every decimal kept, 3% of frames without a face, a blink every 4 s — so the
   * figure in the document cannot drift from the encoding without this failing.
   */
  it('is under 2 MB per sitting in the database and in a backup', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let bytes = 0;
    let blinks = 0;
    for (let c = 0; c < 10; c++) {
      const agg = new EyeMetricsAggregator();
      const t0 = 600_000 + c * 400_000;
      for (let k = 0; k < 180 * 30; k++) {
        const face = rnd() > 0.03;
        const ear = k % 120 < 4 ? 0.1 + rnd() * 0.12 : 0.3 + (rnd() - 0.5) * 0.02;
        agg.ingest({
          t_ms: t0 + k * (1000 / 30) + rnd() * 2, ear: face ? ear : NaN,
          earLeft: face ? ear + (rnd() - 0.5) * 0.01 : undefined, earRight: face ? ear - (rnd() - 0.5) * 0.01 : undefined,
          pose: { pitch: rnd() * 10, yaw: rnd() * 5, roll: 0 }, zone: 'cc', isCenter: true, offAxis: false,
          facePresent: face, faceSize: 0.2, luma: null,
        });
      }
      const id = `00000000-0000-4000-8000-00000000000${c}`;
      const { events } = agg.finalizeWithEvents({
        conditionId: id, sessionId: 's', cameraActive: true, baselineEarValue: 0.3, earThresholdUsed: 0.225,
        gazeCalibrated: true, headPitchCalibrated: true, calibrationId: null,
      });
      const rec = agg.blinkLog({ conditionId: id, sessionId: 's', baseline: 0.3, events });
      blinks += rec.events.length;
      bytes += JSON.stringify(rec).length;
    }
    expect(blinks).toBe(450);
    expect(bytes).toBeGreaterThan(1.5e6);
    expect(bytes).toBeLessThan(2e6);
  });
});
