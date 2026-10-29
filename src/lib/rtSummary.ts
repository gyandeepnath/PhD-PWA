/**
 * The reaction-time block summary: ONE derivation from the trial rows, used by everything that needs it.
 *
 * WHY ONE (Round 86). There were three. The task computed its summary in its own `finish()`, the
 * integrity audit re-counted the trial rows its own way, and the test fixture built its summary a third
 * way — and they disagreed on what a "signal trial" is. The task (and the codebook, 09 signal_trials)
 * counts the go trials that were SCORED, hits plus misses, because that is hit_rate's denominator and an
 * anticipation is neither. The audit counted every go trial presented. So a single go-dot tapped faster
 * than the 150 ms anticipation cutoff, anywhere in a participant's ten blocks, raised
 * `summary_matches_trials` as an ERROR ("reports signal_trials=19 but 20 trials are signals"), and that
 * check blocks the participant from the analysis: excluded from the confirmatory AND the sensitivity set
 * for a summary that was in fact correct. With 200 go trials per participant, a 0.5% anticipation rate
 * reaches most of a cohort. The fixture never produced an anticipation, so no gate could see it.
 *
 * Now the task writes its summary with `summariseRtBlock`, the audit re-derives the counts with
 * `rtBlockCounts` from the stored rows, and the fixture and the analysis cohort build theirs with
 * `summariseRtBlock` from their own trials — so the four can no longer disagree about a definition.
 *
 * The arithmetic is the task's, moved here unchanged (every rule and its reason is kept below); nothing
 * a sitting records or exports changes.
 */
import { CONFIG } from '@/experiment/config';
import { median, stdSample } from '@/lib/stats';
import { computeSdt } from '@/lib/signalDetection';
import type { RtAccuracy, RtSummaryRecord } from '@/storage/types';

/** What a summary needs from a trial row: the task's RawTrial and the stored ReactionTrialRecord both have it. */
export interface RtTrialForSummary {
  is_signal: boolean;
  accuracy: RtAccuracy;
  response_time_ms: number | null;
  anticipatory: boolean;
}

/** The summary row as stored in rt_summaries, without its two keys. */
export type RtBlockSummary = Omit<RtSummaryRecord, 'condition_id' | 'session_id'>;

/** The counts of a block, by outcome. */
export interface RtBlockCounts {
  total_trials: number;
  /** Go trials SCORED: hits plus misses. Not the go trials presented — see the module note. */
  signal_trials: number;
  hits: number;
  misses: number;
  false_alarms: number;
  correct_rejections: number;
  anticipations: number;
}

export function rtBlockCounts(trials: readonly RtTrialForSummary[]): RtBlockCounts {
  const n = (a: RtAccuracy) => trials.filter((r) => r.accuracy === a).length;
  const hits = n('hit');
  const misses = n('miss');
  return {
    total_trials: trials.length,
    signal_trials: hits + misses,
    hits,
    misses,
    false_alarms: n('false_alarm'),
    correct_rejections: n('correct_rejection'),
    anticipations: trials.filter((r) => r.anticipatory).length,
  };
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** The block's summary, from its scored trials in the order they ran. */
export function summariseRtBlock(trials: readonly RtTrialForSummary[]): RtBlockSummary {
  const recs = trials;
  const counts = rtBlockCounts(recs);
  const { misses, false_alarms: fa, correct_rejections: cr } = counts;
  const hits = recs.filter((r) => r.accuracy === 'hit');
  const validHitRts = hits.filter((r) => !r.anticipatory && r.response_time_ms != null).map((r) => r.response_time_ms!);
  const meanRt = avg(validHitRts);
  const sdRt = validHitRts.length > 1 ? stdSample(validHitRts) : null;
  /**
   * Over SCORED trials, not over all trials. An anticipation is neither an error nor a correct
   * response — it is a trial on which no detection judgement was made — so leaving it in the
   * denominator diluted the error rate of exactly the participants who were producing them.
   */
  const scoredTrials = hits.length + misses + fa + cr;
  /*
   * NULL when nothing was scored, not 0.
   *
   * 0 is a perfect score, and the block that produces an empty denominator is the opposite of a
   * perfect one: a participant tapping rhythmically has every response land inside the 150 ms
   * anticipation cutoff, so every trial is an anticipation and all four detection pools are empty.
   * The codebook names that phenotype as the one this task exists to detect.
   *
   * The fabricated 0 then silenced the detector. conditionEngagement's rt_disengaged test
   * null-guards false_alarm_rate and lapse_rate — with a comment saying an unmeasured rate "is not
   * evidence of engagement OR of disengagement" — and left error_rate unguarded because its type
   * said it could not be null. So the one rate that could be fabricated was the one without a
   * guard, `0 > 0.3` was false, no penalty was charged, and the condition passed the engagement
   * filter with its ocular data intact.
   */
  const errorRate = scoredTrials > 0 ? (misses + fa) / scoredTrials : null;
  const lapseCount = validHitRts.filter((rt) => rt > CONFIG.RT_LAPSE_THRESHOLD_MS).length;
  // Inverse efficiency needs an accuracy to divide by; without a scored trial there is none, and
  // an IES computed against an assumed perfect accuracy would be the same fabrication one layer on.
  const accuracyProp = errorRate != null ? 1 - errorRate : null;
  const ies = meanRt != null && accuracyProp != null && accuracyProp > 0 ? meanRt / accuracyProp : null;

  // Within-block vigilance: valid hit RTs in the first vs second half of the (chronological) block.
  const mid = recs.length / 2;
  const halfRt = (lo: number, hi: number) =>
    avg(recs.filter((r, i) => i >= lo && i < hi && r.accuracy === 'hit' && !r.anticipatory && r.response_time_ms != null).map((r) => r.response_time_ms!));

  const sdt = computeSdt({ hits: hits.length, misses, falseAlarms: fa, correctRejections: cr });

  return {
    total_trials: counts.total_trials,
    signal_trials: counts.signal_trials,
    hits: hits.length,
    false_alarms: fa,
    misses,
    correct_rejections: cr,
    hit_rate: sdt.hit_rate,
    false_alarm_rate: sdt.false_alarm_rate,
    mean_rt_hits_ms: meanRt,
    median_rt_hits_ms: validHitRts.length ? median(validHitRts) : null,
    rt_sd_ms: sdRt,
    error_rate: errorRate,
    rt_cv: meanRt && sdRt != null && meanRt > 0 ? sdRt / meanRt : null,
    anticipations: counts.anticipations,
    lapse_count: lapseCount,
    /**
     * Denominator = VALID hits, matching the numerator and matching the codebook.
     *
     * lapseCount is counted among validHitRts (non-anticipatory, with a recorded RT) while the
     * denominator was all hits. The deflation scales with the anticipation count, and
     * anticipations rise with disengagement — so the index the codebook calls a fatigue-
     * sensitive measure was shrunk hardest exactly where fatigue was greatest, attenuating the
     * position and condition effects toward null. It also feeds the disengagement flag, which
     * therefore under-fired for the most disengaged blocks.
     *
     * Null, not 0, for an empty denominator: a condition in which the participant stopped
     * responding altogether used to export the best possible lapse rate as a measurement.
     */
    lapse_rate: validHitRts.length ? lapseCount / validHitRts.length : null,
    inverse_efficiency_ms: ies,
    first_half_mean_rt_ms: halfRt(0, mid),
    second_half_mean_rt_ms: halfRt(mid, recs.length),
    d_prime: sdt.d_prime,
    d_prime_se: sdt.d_prime_se,
    d_prime_unstable: sdt.d_prime_unstable,
    criterion: sdt.criterion,
    d_prime_estimable: sdt.estimable,
  };
}
