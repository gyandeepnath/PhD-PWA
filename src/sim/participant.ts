/**
 * Synthetic participant generator.
 *
 * Produces a complete, data-model-shaped dataset for one participant by pushing the ground-truth
 * effects (effects.ts) through the SAME scoring code the real app uses (computeSdt, FCE,
 * summariseBlinks). The output feeds both the recovery/power analysis and DB/export round-trips.
 */
import { CONDITIONS } from '@/experiment/conditions';
import { QUESTIONS_PER_PASSAGE, PASSAGES } from '@/experiment/passages';
import { sessionPlan } from '@/experiment/counterbalance';
import { CONFIG } from '@/experiment/config';
import { computeSdt } from '@/lib/signalDetection';
import { mean } from '@/lib/stats';
import { summariseBlinks, type BlinkEvent } from '@/tracking/blink';
import { makeRng, gaussian, exGaussian, bernoulli, logistic, poissonEventTimes, type Rng } from './rng';
import { GROUND_TRUTH as GT } from './effects';

// Match the real task: a pure colour go/no-go block (no flanker congruency manipulation).
const RT_TRIALS = CONFIG.RT_TRIALS_PER_CONDITION;
const RT_GO_RATE = CONFIG.RT_GO_RATE;
const READING_MS = 60000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** One condition's analysis-ready row: predictors + key dependent variables. */
export interface ConditionRow {
  participant_id: string;
  enrolment_number: number;
  condition_label: string;
  session_position: number;
  polarity: 'positive' | 'negative';
  negative_polarity: 0 | 1;
  below_wcag_aa: 0 | 1;
  wcag_contrast_ratio: number;
  log_contrast: number;
  passage_id: number;
  // DVs
  mean_rt_hits_ms: number | null;
  d_prime: number | null;
  d_prime_se: number | null;
  /** Proportion of the three comprehension items correct: 0, 1/3, 2/3 or 1. */
  comprehension_correct: number;
  comprehension_rt_ms: number;
  fatigue_mean: number;
  blink_rate: number;
  blink_rate_full: number;
  search_time_ms: number;
  search_accuracy: number;
  comfort_score: number;
  clarity_score: number;
}

export interface SimParticipant {
  participant_id: string;
  enrolment_number: number;
  baseline_fatigue: number;
  rows: ConditionRow[];
}

function synthBlinkEvents(rng: Rng, ratePerMin: number, durationMs: number): BlinkEvent[] {
  return poissonEventTimes(rng, ratePerMin, durationMs).map((onset) => {
    // Most blinks are full; a minority incomplete. Durations 80-350 ms for full.
    const incomplete = bernoulli(rng, 0.18);
    const duration = incomplete ? 50 + rng() * 60 : 100 + rng() * 200;
    return {
      onset_ms: onset,
      duration_ms: duration,
      min_ear: incomplete ? 0.24 : 0.1,
      tier: incomplete ? 'incomplete' : 'full',
    };
  });
}

export function generateParticipant(enrolmentNumber: number, seed: number): SimParticipant {
  const rng = makeRng(seed + enrolmentNumber * 7919);
  const pid = `SIM${String(enrolmentNumber).padStart(4, '0')}`;

  // Per-participant random intercepts (the random effects a mixed model should absorb).
  const rtIntercept = gaussian(rng, 0, GT.rt.participant_sd_ms);
  const fatigueIntercept = gaussian(rng, 0, GT.fatigue.participant_sd);
  const blinkIntercept = gaussian(rng, 0, GT.blink.participant_sd);
  const baselineFatigue = clamp(GT.fatigue.base + fatigueIntercept + gaussian(rng, 0, 0.4), 0, 10);

  const rows: ConditionRow[] = [];

  for (const step of sessionPlan(enrolmentNumber)) {
    const cond = CONDITIONS[step.conditionIndex];
    const passage = PASSAGES[step.passageIndex];
    const pos = step.position;
    const logC = Math.log10(cond.wcag_contrast_ratio);
    const negPol = cond.polarity === 'negative' ? 1 : 0;
    const belowAA = cond.below_wcag_aa ? 1 : 0;

    // ---- Reaction-time (pure colour go/no-go: respond only to the go-target colour) ----
    const allHitRts: number[] = [];
    let hits = 0;
    let misses = 0;
    let falseAlarms = 0;
    let correctRejections = 0;

    const nGo = Math.round(RT_TRIALS * RT_GO_RATE);
    for (let i = 0; i < RT_TRIALS; i++) {
      const isSignal = i < nGo;
      const muBase =
        GT.rt.base_mu_ms +
        GT.rt.beta_log_contrast * logC +
        GT.rt.beta_negative_polarity * negPol +
        GT.rt.beta_position * pos +
        rtIntercept;

      if (isSignal) {
        const pHit = logistic(GT.hit.intercept + GT.hit.beta_log_contrast * logC + GT.hit.beta_position * pos);
        if (bernoulli(rng, pHit)) {
          const rt = exGaussian(rng, muBase, GT.rt.sigma_ms, GT.rt.tau_ms);
          hits++;
          allHitRts.push(rt);
        } else {
          misses++;
        }
      } else {
        const pFa = logistic(GT.falseAlarm.intercept + GT.falseAlarm.beta_below_aa * belowAA);
        if (bernoulli(rng, pFa)) falseAlarms++;
        else correctRejections++;
      }
    }

    const sdt = computeSdt({ hits, misses, falseAlarms, correctRejections });

    // ---- Comprehension ----
    const pCorrect = logistic(
      GT.comprehension.intercept + GT.comprehension.beta_log_contrast * logC + GT.comprehension.beta_position * pos,
    );
    // Three items per passage, each an independent draw at the same underlying probability.
    // The recorded outcome is the proportion correct, matching ComprehensionRecord aggregation.
    let nCorrect = 0;
    for (let q = 0; q < QUESTIONS_PER_PASSAGE; q++) if (bernoulli(rng, pCorrect)) nCorrect++;
    const correctProportion = nCorrect / QUESTIONS_PER_PASSAGE;
    const comprehensionRt = exGaussian(rng, 2600 + 120 * pos, 500, 900);

    // ---- Fatigue (5 VAS items) ----
    const fatigueMeanTarget = GT.fatigue.base + GT.fatigue.beta_position * pos + GT.fatigue.beta_below_aa * belowAA + fatigueIntercept;
    const items = Array.from({ length: 5 }, () => clamp(fatigueMeanTarget + gaussian(rng, 0, GT.fatigue.item_sd), 0, 10));
    const fatigueMean = mean(items);

    // ---- Blink (reading) ----
    const targetRate = Math.max(2, GT.blink.base_rate + GT.blink.beta_position * pos + blinkIntercept + gaussian(rng, 0, 1));
    const events = synthBlinkEvents(rng, targetRate, READING_MS);
    const blink = summariseBlinks(events, READING_MS);

    // ---- Visual search ----
    const targets = passage.searchTargetCount;
    const secPerTarget = GT.search.sec_per_target + (belowAA ? GT.search.below_aa_penalty_sec_per_target : 0);
    const searchTimeMs = Math.min(40000, targets * secPerTarget * 1000 + gaussian(rng, 0, 2500));
    const found = searchTimeMs >= 40000 ? Math.round(targets * (0.6 + 0.3 * rng())) : targets;
    const searchAccuracy = found / targets;

    // ---- Display perception ----
    const comfort = clamp(70 + 8 * logC - 3 * pos + gaussian(rng, 0, 6), 0, 100);
    const clarity = clamp(68 + 12 * logC - 2 * pos + gaussian(rng, 0, 6), 0, 100);

    rows.push({
      participant_id: pid,
      enrolment_number: enrolmentNumber,
      condition_label: cond.label,
      session_position: pos,
      polarity: cond.polarity,
      negative_polarity: negPol,
      below_wcag_aa: belowAA,
      wcag_contrast_ratio: cond.wcag_contrast_ratio,
      log_contrast: logC,
      passage_id: passage.id,
      mean_rt_hits_ms: allHitRts.length ? mean(allHitRts) : null,
      d_prime: sdt.d_prime,
      d_prime_se: sdt.d_prime_se,
      comprehension_correct: correctProportion,
      comprehension_rt_ms: comprehensionRt,
      fatigue_mean: fatigueMean,
      // The simulator always produces a full-length window, so these are never null here;
      // the ?? 0 keeps the synthetic row's type simple rather than encoding an absence.
      blink_rate: blink.blink_rate ?? 0,
      blink_rate_full: blink.blink_rate_full ?? 0,
      search_time_ms: searchTimeMs,
      search_accuracy: searchAccuracy,
      comfort_score: comfort,
      clarity_score: clarity,
    });
  }

  return { participant_id: pid, enrolment_number: enrolmentNumber, baseline_fatigue: baselineFatigue, rows };
}

/** Generate a cohort of N participants. */
export function generateCohort(n: number, seed = 20260613): SimParticipant[] {
  return Array.from({ length: n }, (_, i) => generateParticipant(i + 1, seed));
}
