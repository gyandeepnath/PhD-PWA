/**
 * A simulated COHORT, for running the analysis templates against something a model can estimate.
 *
 * WHY THIS EXISTS. scripts/verifyAnalysis.mjs used to build its multi-participant export by cloning
 * buildFixtureBundle() twelve times. Every clone kept the fixture's own Williams row (enrolment 7),
 * so serial position and passage were perfectly aliased with condition. In that design the primary
 * model is not estimable: position_c is a linear combination of the ten condition cells, the R fit
 * reported a rank-deficient design and non-estimable marginal means, and once the Python primary
 * sum-coded its colour factor (so that polarity_c is the average effect, as in R) its polarity
 * standard error came out at 2.2e7 — while the gate, which asked only that a standard error be
 * finite and above 1e-6, stayed green. The outcomes were also near-deterministic, so nothing
 * checked that either template recovers the SIGN of an effect, which is the one property
 * ANALYSIS_PLAN.md §5b requires the two toolchains to share. The Python comprehension model was
 * sign-inverted against R for exactly that reason, unnoticed.
 *
 * What this does instead, for each participant i:
 *  - the REAL counterbalancing: blockPlan(i + 1, 0) gives the Williams row and the passage rotation
 *    an enrolment of i + 1 would get, so position and passage vary across participants as they will
 *    in the study;
 *  - seeded random outcomes with participant random effects, and KNOWN polarity effects on the
 *    primary outcome and on comprehension, so a template can be checked for recovering their sign;
 *  - reaction-time trials rewritten to agree with the summary drawn for them, so the per-sitting
 *    integrity audit (summary_matches_trials) does not block every participant in the pooled verdict.
 *
 * Everything still goes through the app's real writers (buildExportFiles, buildAnalysisDataset) in
 * the caller, so what the templates read is what the app emits. Adapted from the Round 62 analysis
 * audit's cohort generator.
 */
import type { SessionBundle } from '@/storage/gather';
import type { RtAccuracy } from '@/storage/types';
import { buildFixtureBundle } from './bundleFixture';
import { makeRng, gaussian } from './rng';
import { blockPlan } from '@/experiment/counterbalance';
import { CONDITIONS, rtStimulusColours } from '@/experiment/conditions';
import { PASSAGES, countWords } from '@/experiment/passages';
import { computeSdt } from '@/lib/signalDetection';
import { scoreCvsq } from '@/scales/cvsq';
import { planRtBlock, eccentricityDeg } from '@/lib/rtLocations';
import { CONFIG } from '@/experiment/config';
import { ENGAGEMENT } from '@/dashboard/aggregate';

export interface CohortOptions {
  /** Participants, P001..Pnnn, enrolments 1..n. */
  n: number;
  seed?: number;
  /**
   * Log-odds added to the incomplete-blink probability under NEGATIVE polarity. The sum-coded
   * polarity coefficient (positive minus negative) therefore has the OPPOSITE sign.
   */
  polarityEffectOnIncomplete?: number;
  /**
   * Log-odds added to the probability of a correct comprehension answer under POSITIVE polarity.
   * The sum-coded polarity coefficient (positive minus negative) has the SAME sign.
   */
  polarityEffectOnComprehension?: number;
  /**
   * Added to d' (probit units) under POSITIVE polarity, so the polarity effect on sensitivity
   * (positive minus negative) has the SAME sign. Default 0.
   */
  polarityEffectOnDprime?: number;
  /** Added to d' on the OUTER ring of target locations (negative = harder at 8 deg). Default -0.4. */
  outerRingEffectOnDprime?: number;
  /** 0-based participant indices who withdrew. */
  withdrawn?: number[];
  /** 0-based participant indices whose last condition was started and never finished. */
  pausedLast?: number[];
  /** Camera off for every participant, or for the listed 0-based indices. */
  cameraOff?: 'all' | number[];
  /**
   * Every run is shown in THIS polarity, its colour kept: ten complete runs per participant, so the
   * exporter's verdict admits them, and not one in the other polarity — the export of a build whose
   * condition table lost a polarity, or of a pilot run in one. (Dropping the other five runs instead
   * leaves every participant with an incomplete set, and the verdict excludes them all first.)
   * Nothing in it can estimate the contrast the study asks about, and both templates must say so.
   */
  onePolarity?: 'positive' | 'negative';
  /**
   * 0-based participant indices whose FIRST run was done disengaged, as the app's own scorer
   * (conditionEngagement) sees it: a page advanced just after its unlock (a skim, 0.3), the fatigue
   * rating rushed (0.2) and the perception rating rushed (0.1) leave a quality score of 0.4, under
   * QUALITY_WARN, so 10_wide_summary.csv flags the run 'bad'. Only those QC timings change — no outcome
   * moves — so the runs are confirmatory like any other, and a template that drops them is selecting on
   * the flag alone. Without them no run is 'bad', and DROP_DISENGAGED could be set back to TRUE (the
   * Round 62 audit's M2) with the gate green.
   */
  disengaged?: number[];
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
/** Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) — ample for drawing simulated responses. */
function erf(x: number): number {
  const s = Math.sign(x); const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
/** JSON-escaped form: the fixture's participant id carries a comma and a quote on purpose. */
const esc = (v: string) => JSON.stringify(v).slice(1, -1);

export function simulateCohort(opts: CohortOptions): SessionBundle[] {
  const rng = makeRng(opts.seed ?? 20260402);
  const binom = (n: number, p: number) => { let x = 0; for (let k = 0; k < n; k++) if (rng() < p) x++; return x; };
  const poisson = (lambda: number) => {
    const limit = Math.exp(-lambda);
    let k = 0; let prod = 1;
    do { k++; prod *= rng(); } while (prod > limit);
    return k - 1;
  };
  const polInc = opts.polarityEffectOnIncomplete ?? 0.4;
  const polComp = opts.polarityEffectOnComprehension ?? 0.6;
  const polDp = opts.polarityEffectOnDprime ?? 0;
  const outerDp = opts.outerRingEffectOnDprime ?? -0.4;
  const passageEffect = PASSAGES.map(() => gaussian(rng, 0, 0.15));
  const colourEffect: Record<string, number> = { achromatic: 0, blue: 0.1, red: 0.05, yellow: -0.1, green: 0 };
  const bundles: SessionBundle[] = [];

  for (let i = 0; i < opts.n; i++) {
    const base = buildFixtureBundle();
    const pid = 'P' + String(i + 1).padStart(3, '0');
    const sid = 'S' + String(i + 1).padStart(3, '0');
    let json = JSON.stringify(base)
      .split(esc(base.session.participant_id)).join(pid)
      .split(esc(base.session.session_id)).join(sid);
    // Condition ids are fixed values in the fixture; unique per participant, or every join on
    // condition_id across the pooled folders fans out.
    for (const c of base.conditions) json = json.split(esc(c.condition_id)).join(`${pid}-${c.condition_id}`);
    const b = JSON.parse(json) as SessionBundle;
    const enrolment = i + 1;
    b.session.enrolment_number = enrolment;
    if (b.participant) {
      b.participant.enrolment_number = enrolment;
      b.participant.age = 18 + Math.floor(rng() * 17);
      b.participant.daily_screen_hours = 4 + Math.round(rng() * 80) / 10;
      // The pre-specified moderators (synopsis Objective 3) vary, so a moderation term can be fitted.
      b.participant.device_familiarity = (['low', 'moderate', 'high'] as const)[Math.floor(rng() * 3)];
      b.participant.lighting_habit = (['bright', 'moderate', 'dim'] as const)[Math.floor(rng() * 3)];
    }

    // The participant's own Williams row and passage rotation.
    const plan = blockPlan(enrolment, 0);
    b.conditions.forEach((c, k) => {
      const step = plan[k];
      const planned = CONDITIONS[step.conditionIndex];
      const def = opts.onePolarity
        ? CONDITIONS.find((d) => d.colorName === planned.colorName && d.polarity === opts.onePolarity)!
        : planned;
      Object.assign(c, {
        session_position: step.position, condition_label: def.label, polarity: def.polarity,
        background_color: def.background, text_color: def.text, color_name: def.colorName,
        ink_name: def.inkName, passage_id: step.passageIndex, wcag_contrast_ratio: def.wcag_contrast_ratio,
        wcag_level: def.wcag_level, michelson_contrast: def.michelson_contrast, below_wcag_aa: def.below_wcag_aa,
        reading_time_ms: 150_000 + Math.round(rng() * 60_000),
      });
    });
    b.session.condition_order = plan.map((p) => p.conditionIndex);
    const byId = new Map(b.conditions.map((c) => [c.condition_id, c]));

    const u = gaussian(rng, 0, 0.5);        // participant intercept, incomplete-blink log-odds
    const uSlope = gaussian(rng, 0, 0.15);  // participant polarity slope
    const uComp = gaussian(rng, 0, 0.4);    // participant comprehension ability
    const rtU = gaussian(rng, 0, 40);
    const fatU = gaussian(rng, 0, 0.8);

    for (const m of b.eyeMetrics) {
      const c = byId.get(m.condition_id)!;
      const neg = c.polarity === 'negative' ? 1 : 0;
      const eta = Math.log(0.16 / 0.84) + u + neg * (polInc + uSlope) + (colourEffect[c.color_name] ?? 0)
        + passageEffect[c.passage_id] + 0.03 * c.session_position + gaussian(rng, 0, 0.25);
      const dur = c.reading_time_ms ?? 180_000;
      const total = Math.max(3, poisson(15 * (dur / 60_000) * Math.exp(u * 0.3)));
      const inc = binom(total, logistic(eta));
      const micro = binom(total - inc, 0.05);
      const observed = Math.round(dur * (0.93 + rng() * 0.07));
      const fps = Math.round((22 + rng() * 9) * 10) / 10;
      Object.assign(m, {
        blink_count_incomplete: inc, blink_count_micro: micro, blink_count_full: total - inc - micro,
        incomplete_blink_ratio: Math.round((inc / total) * 10_000) / 10_000,
        observed_duration_ms: observed,
        blink_rate: Math.round((total / (observed / 60_000)) * 100) / 100,
        mean_inter_blink_interval_ms: Math.round((observed / total) * Math.exp(gaussian(rng, 0, 0.1))),
        blink_rate_full: Math.round(((total - inc - micro) / (observed / 60_000)) * 100) / 100,
        effective_fps: fps, fps_adequate_for_ratio: fps >= 24, fps_adequate_for_tiers: fps >= 20,
        perclos_p80: Math.round(Math.max(0, 0.03 + gaussian(rng, 0, 0.015)) * 1000) / 1000,
        face_presence_ratio: Math.round(Math.min(1, 0.9 + rng() * 0.1) * 1000) / 1000,
        off_axis_ratio: Math.round(rng() * 0.15 * 1000) / 1000,
      });
    }

    /*
     * Reaction time, TRIAL BY TRIAL. Every block is laid out by the app's own planner (planRtBlock:
     * 20 go and 12 no-go, 10 and 6 per ring), so the go/no-go split per ring is the real one — the
     * fixture's fixed layout put every no-go trial on the inner ring, which aliases ring with
     * signal and leaves a trial-level ring term unestimable. Each trial's response is then drawn from
     * an equal-variance signal-detection model, P(respond) = Phi(+-d'/2 - c), with KNOWN effects of
     * polarity and ring on d', so the templates' trial-level probit model can be checked for
     * recovering their sign; the summary row is recomputed from the trials, so the two agree.
     *
     * EVERY BLOCK HAS ITS OWN LEVEL, shared by all its trials: a criterion, a d', an RT offset and a
     * lapse propensity drawn once per block (attention, arousal, the minute of the session). Polarity,
     * colour and position vary only BETWEEN blocks, so a trial-level model without a condition-run
     * random effect treats a block's 32 correlated trials as 32 independent pieces of evidence about
     * them. This cohort drew every trial independently, so the gate could not tell such a model from a
     * correct one (Round 73); the block SDs here are the ones the review's null simulations used.
     */
    const dpU = gaussian(rng, 0, 0.3);
    const critU = gaussian(rng, 0, 0.2);
    const lapseU = gaussian(rng, 0, 0.4);   // participants differ in how often they lapse, as in d' and c
    const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
    for (const r of b.rtSummaries) {
      const c = byId.get(r.condition_id)!;
      const def = CONDITIONS.find((d) => d.label === c.condition_label)!;
      const colours = rtStimulusColours(def);
      const plan = planRtBlock({
        nGo: 20, nNoGo: 12, maxRun: CONFIG.RT_MAX_RUN, target: colours.target, distractors: colours.distractors,
        blockIndex: c.session_position, practice: false, rand: rng,
      });
      const trials = b.reactionTrials.filter((t) => t.condition_id === r.condition_id);
      const blockCrit = gaussian(rng, 0, 0.25);
      const blockDp = gaussian(rng, 0, 0.25);
      const blockRt = gaussian(rng, 0, 25);
      const blockLapse = logistic(Math.log(0.05 / 0.95) + lapseU + gaussian(rng, 0, 0.5));
      let hits = 0; let misses = 0; let fas = 0; let crs = 0;
      const hitRts: number[] = [];
      trials.forEach((t, k) => {
        const p = plan.trials[k];
        const outer = p.location.ring === 'outer';
        const dp = 2.6 + dpU + blockDp + (c.polarity === 'positive' ? 0.5 : -0.5) * polDp + (outer ? outerDp : 0);
        const crit = 0.15 + critU + blockCrit;
        const responded = rng() < phi((p.signal ? dp / 2 : -dp / 2) - crit);
        const accuracy: RtAccuracy = p.signal ? (responded ? 'hit' : 'miss') : (responded ? 'false_alarm' : 'correct_rejection');
        // A few slow responses beyond the 600 ms lapse threshold, so the lapse model has events to fit.
        const lapse = responded && p.signal && rng() < blockLapse;
        const rt = responded
          ? Math.max(160, Math.round((lapse ? 720 : 380 + rtU + blockRt + 4 * c.session_position + (outer ? 20 : 0)) + gaussian(rng, 0, 45)))
          : null;
        Object.assign(t, {
          is_signal: p.signal, trial_category: p.signal ? 'signal' : 'noise', stimulus_color: p.color,
          stim_location_id: p.location.id, stim_ring: p.location.ring, stim_angle_deg: p.location.angleDeg,
          stim_dx_px: p.location.dx, stim_dy_px: p.location.dy, stim_ecc_px: p.location.eccPx,
          stim_ecc_deg_55cm: eccentricityDeg(p.location.eccPx, 1),
          accuracy, response_time_ms: rt,
        });
        if (accuracy === 'hit') { hits++; hitRts.push(rt!); } else if (accuracy === 'miss') misses++;
        else if (accuracy === 'false_alarm') fas++; else crs++;
      });
      const sdt = computeSdt({ hits, misses, falseAlarms: fas, correctRejections: crs });
      const mean = hitRts.length ? hitRts.reduce((a, x) => a + x, 0) / hitRts.length : null;
      const sd = hitRts.length > 1 && mean != null
        ? Math.sqrt(hitRts.reduce((a, x) => a + (x - mean) ** 2, 0) / (hitRts.length - 1)) : null;
      const sorted = [...hitRts].sort((a, x) => a - x);
      const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
      const lapses = hitRts.filter((x) => x > CONFIG.RT_LAPSE_THRESHOLD_MS).length;
      Object.assign(r, {
        median_rt_hits_ms: median, rt_sd_ms: sd == null ? null : Math.round(sd * 100) / 100,
        rt_cv: sd != null && mean ? Math.round((sd / mean) * 10_000) / 10_000 : null,
        lapse_count: lapses, lapse_rate: hitRts.length ? lapses / hitRts.length : null,
        hits, misses, false_alarms: fas, correct_rejections: crs,
        hit_rate: sdt.hit_rate, false_alarm_rate: sdt.false_alarm_rate,
        mean_rt_hits_ms: mean == null ? null : Math.round(mean * 100) / 100,
        d_prime: sdt.d_prime, d_prime_se: sdt.d_prime_se, d_prime_unstable: sdt.d_prime_unstable,
        criterion: sdt.criterion, d_prime_estimable: sdt.estimable,
      });
    }

    // Post-condition fatigue rises with position. The five items of one rating share the run's own
    // level as well as the participant's, as items rated together do (the stacked ordinal model).
    for (const f of b.fatigue) {
      if (f.stage !== 'post_condition' || f.condition_id == null) continue;
      const c = byId.get(f.condition_id)!;
      const level = (x: number) => Math.max(0, Math.min(10, Math.round(x)));
      const m0 = 1.5 + fatU + 0.25 * c.session_position + gaussian(rng, 0, 0.6);
      Object.assign(f, {
        eye_strain: level(m0 + gaussian(rng)), dryness: level(m0 + gaussian(rng)), blur: level(m0 - 0.5 + gaussian(rng)),
        burning: level(m0 - 0.7 + gaussian(rng)), headache: level(m0 - 1 + gaussian(rng)),
      });
      f.fatigue_mean = (f.eye_strain + f.dryness + f.blur + f.burning + f.headache) / 5;
    }

    // Comfort and clarity ratings (0-100 sliders), with participant scale use and no condition effect.
    const comfortU = gaussian(rng, 0, 10);
    for (const pr of b.perception) {
      const slider = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
      pr.display_comfort_score = slider(60 + comfortU + gaussian(rng, 0, 12));
      pr.text_clarity_score = slider(65 + comfortU * 0.5 + gaussian(rng, 0, 12));
      pr.comfort_touched = rng() > 0.03;
    }

    // CVS-Q at the close and NASA-TLX vary between participants, so their intervals can be computed.
    // The close is re-scored by the real scorer, so 13_cvsq.csv stays consistent with its items.
    for (const q of b.cvsq) {
      if (q.stage !== 'session_end') continue;
      q.frequency = q.frequency.map(() => (rng() < 0.6 ? 1 : rng() < 0.5 ? 0 : 2));
      q.intensity = q.intensity.map((_, k) => (q.frequency[k] === 0 ? 0 : 1 + (rng() < 0.3 ? 1 : 0)));
      const scored = scoreCvsq(q.frequency, q.intensity);
      q.total_score = scored.total; q.symptomatic = scored.symptomatic;
    }
    for (const t of b.tlx) {
      const r = () => Math.max(0, Math.min(100, Math.round(50 + gaussian(rng, 0, 15))));
      Object.assign(t, { mental_demand: r(), physical_demand: r(), temporal_demand: r(), performance: r(), effort: r(), frustration: r() });
      t.raw_tlx = (t.mental_demand + t.physical_demand + t.temporal_demand + t.performance + t.effort + t.frustration) / 6;
    }

    // Comprehension, regenerated for the passage actually read, with the known polarity effect.
    b.comprehension = b.conditions.flatMap((c, k) => PASSAGES[c.passage_id].questions.map((q, qi) => {
      const correct = rng() < logistic(0.95 + uComp + (c.polarity === 'positive' ? 0.5 : -0.5) * polComp);
      return {
        comprehension_id: `comp-${pid}-${k}-${qi}`, session_id: sid, condition_id: c.condition_id,
        passage_id: c.passage_id, question_index: qi, question_kind: q.kind,
        selected_index: correct ? q.correctIndex : (q.correctIndex + 1) % 4, correct_index: q.correctIndex,
        is_correct: correct, response_time_ms: 6000 + Math.round(rng() * 6000),
      };
    }));

    // Visual search for the passage actually read.
    for (const v of b.visualSearch) {
      const c = byId.get(v.condition_id)!;
      const p = PASSAGES[c.passage_id];
      const inSet = p.searchTargetCount;
      const draw = rng();
      const mode = draw < 0.8 ? 'voluntary_full' as const : draw < 0.9 ? 'time_limit' as const : 'voluntary_early' as const;
      const found = mode === 'voluntary_full' ? inSet : Math.max(0, inSet - 1 - Math.floor(rng() * 2));
      const time = mode === 'time_limit' ? CONFIG.VS_TIME_LIMIT_MS : Math.round(20_000 + rng() * 35_000);
      const distractors = countWords([p.searchExcerpt]) - inSet;
      const fa = rng() < 0.2 ? 1 : 0;
      const sd = computeSdt({ hits: found, misses: inSet - found, falseAlarms: fa, correctRejections: distractors - fa });
      Object.assign(v, {
        passage_id: c.passage_id, search_target: p.searchTarget, targets_in_set: inSet,
        search_time_ms: time, targets_found: found, targets_missed: inSet - found, false_detections: fa,
        search_d_prime: sd.d_prime, search_d_prime_se: sd.d_prime_se, distractor_words: distractors,
        accuracy_rate: inSet > 0 ? found / inSet : null, search_efficiency: found / (time / 60_000),
        termination_mode: mode, mean_inter_target_interval_ms: found > 1 ? 4000 : null,
      });
    }

    // --- states a real cohort reaches ----------------------------------------------------------
    const cameraOff = opts.cameraOff === 'all' || (Array.isArray(opts.cameraOff) && opts.cameraOff.includes(i));
    if (cameraOff) {
      // Declined: no consent, so no ocular measurement may exist (ocular_requires_consent).
      b.session.media_consent = { ...b.session.media_consent, camera_metrics: false };
      for (const m of b.eyeMetrics) {
        Object.assign(m, {
          camera_active: false, camera_inactive_reason: 'not_running', effective_fps: null,
          fps_adequate_for_ratio: false, fps_adequate_for_tiers: false, blink_count_incomplete: null,
          blink_count_full: null, blink_count_micro: null, blink_rate: null, blink_rate_full: null,
          incomplete_blink_ratio: null, perclos_p80: null, face_presence_ratio: null,
          observed_duration_ms: null, off_axis_ratio: null, calibration_id: null, gaze_calibrated: false,
        });
      }
    }
    if (opts.disengaged?.includes(i)) {
      const first = b.conditions.reduce((a, c) => (c.session_position < a.session_position ? c : a));
      first.reading_min_page_dwell_ms = CONFIG.READING_PAGE_MIN_MS + Math.round(ENGAGEMENT.PAGE_UNLOCK_GRACE_MS / 3);
      const fat = b.fatigue.find((f) => f.stage === 'post_condition' && f.condition_id === first.condition_id);
      if (fat) fat.response_time_ms = Math.round(ENGAGEMENT.FATIGUE_RUSHED_MS / 2);
      const perc = b.perception.find((pr) => pr.condition_id === first.condition_id);
      if (perc) perc.response_time_ms = Math.round(ENGAGEMENT.PERCEPTION_RUSHED_MS / 2);
    }
    if (opts.withdrawn?.includes(i)) b.session.withdrawn_at = b.session.session_start_time + 3_600_000;
    if (opts.pausedLast?.includes(i)) {
      const last = b.conditions.reduce((a, c) => (c.session_position > a.session_position ? c : a));
      last.completed_at = null;
    }
    bundles.push(b);
  }
  return bundles;
}
