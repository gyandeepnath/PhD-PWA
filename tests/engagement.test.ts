import { describe, it, expect } from 'vitest';
import { conditionEngagement, ENGAGEMENT } from '@/dashboard/aggregate';
import type { FatigueRecord, DisplayPerceptionRecord, ComprehensionRecord, RtSummaryRecord, EyeMetricsRecord } from '@/storage/types';

const fatigue = (over: Partial<FatigueRecord> = {}): FatigueRecord => ({
  fatigue_id: 'f', session_id: 'S', condition_id: 'A', stage: 'post_condition',
  eye_strain: 3, dryness: 2, blur: 4, burning: 1, headache: 2, fatigue_mean: 2.4,
  touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true },
  all_touched: true, response_time_ms: 8000, ...over,
});
const perception = (over: Partial<DisplayPerceptionRecord> = {}): DisplayPerceptionRecord => ({
  perception_id: 'p', session_id: 'S', condition_id: 'A', display_comfort_score: 70,
  text_clarity_score: 80, comfort_touched: true, clarity_touched: true, response_time_ms: 5000, ...over,
});
const comprehension = (correct: boolean): ComprehensionRecord[] => [{
  comprehension_id: 'c', session_id: 'S', condition_id: 'A', passage_id: 0,
  question_index: 0, question_kind: 'detail',
  selected_index: 0, correct_index: correct ? 0 : 1, is_correct: correct, response_time_ms: 3000,
}];
const rt = (over: Partial<RtSummaryRecord> = {}): RtSummaryRecord => ({
  condition_id: 'A', session_id: 'S', total_trials: 32, signal_trials: 20, hits: 18, false_alarms: 1,
  misses: 2, correct_rejections: 11, hit_rate: 0.9, false_alarm_rate: 0.08, error_rate: 0.1, rt_cv: 0.2,
  anticipations: 0, lapse_count: 0, lapse_rate: 0.05, inverse_efficiency_ms: 460,
  first_half_mean_rt_ms: 450, second_half_mean_rt_ms: 470, mean_rt_hits_ms: 460, median_rt_hits_ms: 455,
  rt_sd_ms: 50,
  d_prime: 2.8, d_prime_se: 0.4, d_prime_unstable: true, criterion: 0.1, d_prime_estimable: true, ...over,
});

describe('conditionEngagement', () => {
  it('a fully engaged condition scores 1.0 / good with no reasons', () => {
    const e = conditionEngagement({
      reading_time_ms: 60000, word_count: 280, // 280/400*60000 = 42000 ms floor → not a skim
      fatigue: fatigue(), perception: perception(), comprehension: comprehension(true), rt: rt(),
    });
    expect(e.engagement).toBe('good');
    expect(e.quality_score).toBe(1);
    expect(e.reasons).toHaveLength(0);
  });

  it('flags a skim when reading is faster than the WPM-ceiling floor', () => {
    const e = conditionEngagement({ reading_time_ms: 5000, word_count: 280 });
    expect(e.reading_skim).toBe(true);
    expect(e.reasons.join(' ')).toMatch(/skim/i);
  });

  it('flags RT disengagement from a high false-alarm rate', () => {
    const e = conditionEngagement({ reading_time_ms: 60000, word_count: 100, rt: rt({ false_alarm_rate: 0.5 }) });
    expect(e.rt_disengaged).toBe(true);
  });

  it('flags rushed + straight-lined fatigue ratings', () => {
    const e = conditionEngagement({
      reading_time_ms: 60000, word_count: 100,
      fatigue: fatigue({ eye_strain: 3, dryness: 3, blur: 3, burning: 3, headache: 3, response_time_ms: 1000 }),
    });
    expect(e.careless_straight_lined).toBe(true);
    expect(e.careless_rushed_fatigue).toBe(true);
  });

  it('drops to bad when several strong signals fire together', () => {
    const e = conditionEngagement({
      reading_time_ms: 1000, word_count: 280, // skim (0.3)
      rt: rt({ error_rate: 0.5 }),             // disengaged (0.3)
      fatigue: fatigue({ response_time_ms: 500 }), // rushed (0.2)
    });
    expect(e.quality_score).toBeLessThan(ENGAGEMENT.QUALITY_WARN);
    expect(e.engagement).toBe('bad');
  });

  it('a single weak signal (one wrong MCQ) only warns at worst, not bad', () => {
    const e = conditionEngagement({
      reading_time_ms: 60000, word_count: 100, fatigue: fatigue(), perception: perception(),
      comprehension: comprehension(false), rt: rt(),
    });
    expect(e.comprehension_wrong).toBe(true);
    expect(e.engagement).not.toBe('bad');
  });

  it('ignores camera face-presence when the camera is off', () => {
    const eyeOff = { camera_active: false, face_presence_ratio: 0 } as EyeMetricsRecord;
    const e = conditionEngagement({ reading_time_ms: 60000, word_count: 100, eye: eyeOff });
    expect(e.low_face_presence).toBe(false);
  });
});

/**
 * Two ways a condition could look like good data when it was not.
 *
 * The reading skim rule was almost unfirable: the four 20 s page unlocks guarantee at least 80 s,
 * while the corpus skim floor is 85.7-90.2 s, so the whole-passage flag lived in a 5.6-10.2 s band.
 * A participant who waited out each countdown and paused two seconds more per page was never
 * flagged; a genuinely fast reader at ~440 wpm was, and had their fastest conditions dropped.
 *
 * And the reading clock ran while the app was backgrounded, so a notification dealt with mid-passage
 * inflated the exposure — the same span that is the reading-speed denominator.
 */
describe('a waited-out page is detected even when the passage total looks normal', () => {
  const base = {
    word_count: 590,
    fatigue: undefined, perception: undefined, comprehension: undefined, rt: undefined, eye: undefined,
  };

  it('flags a page advanced at its own unlock, whatever the passage total', async () => {
    const { conditionEngagement } = await import('@/dashboard/aggregate');
    const { CONFIG } = await import('@/experiment/config');
    // 95 s total clears the 88.5 s whole-passage floor for 590 words, so the old rule saw nothing.
    const r = conditionEngagement({
      ...base,
      reading_time_ms: 95_000,
      reading_min_page_dwell_ms: CONFIG.READING_PAGE_MIN_MS + 200,
      reading_hidden_ms: 0,
    });
    expect(r.reading_skim).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/waited out/i);
  });

  it('does not flag a reader who simply read each page briskly but genuinely', async () => {
    const { conditionEngagement } = await import('@/dashboard/aggregate');
    const { CONFIG } = await import('@/experiment/config');
    const r = conditionEngagement({
      ...base,
      reading_time_ms: 120_000,
      reading_min_page_dwell_ms: CONFIG.READING_PAGE_MIN_MS + 6_000,
      reading_hidden_ms: 0,
    });
    expect(r.reading_skim).toBe(false);
  });

  it('flags a passage during which the app was hidden', async () => {
    const { conditionEngagement } = await import('@/dashboard/aggregate');
    const r = conditionEngagement({
      ...base,
      reading_time_ms: 100_000,
      reading_min_page_dwell_ms: 25_000,
      reading_hidden_ms: 90_000,
    });
    expect(r.reading_interrupted).toBe(true);
    expect(r.quality_score).toBeLessThan(1);
  });

  it('is silent when nothing about the reading is suspicious', async () => {
    const { conditionEngagement } = await import('@/dashboard/aggregate');
    const r = conditionEngagement({
      ...base, reading_time_ms: 178_000, reading_min_page_dwell_ms: 40_000, reading_hidden_ms: 0,
    });
    expect(r.reading_skim).toBe(false);
    expect(r.reading_interrupted).toBe(false);
  });
});

describe('visual search cannot be gamed by tapping everything', () => {
  it("gives a tap-everything strategy a poor d' despite a perfect accuracy_rate", async () => {
    const { computeSdt } = await import('@/lib/signalDetection');
    // 10 targets in a ~590-word passage. The gamer taps ~390 words: every target found, so
    // accuracy_rate = 1.0 and search_efficiency is their best of the study.
    const gamed = computeSdt({ hits: 10, misses: 0, falseAlarms: 380, correctRejections: 200 });
    const honest = computeSdt({ hits: 9, misses: 1, falseAlarms: 2, correctRejections: 578 });
    expect(honest.d_prime).not.toBeNull();
    expect(gamed.d_prime).not.toBeNull();
    expect(gamed.d_prime!).toBeLessThan(honest.d_prime!);
  });
});
