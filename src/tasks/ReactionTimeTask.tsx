/**
 * Colour go/no-go reaction-time task, run IN the condition's display.
 *
 * A single dot appears at one of EIGHT FIXED LOCATIONS around the fixation cross — two rings, 4 and
 * 8 deg, on the diagonals; see src/lib/rtLocations.ts — on the active condition's own background; the
 * participant taps ONLY when it is the same colour as the text they have just been reading — the
 * condition's own text colour — and ignores dots in the other four text colours of that polarity.
 * So in the blue-text condition the go-dot is blue, in the yellow one it is yellow, and RT measures
 * speeded detection of the condition's own colour on its own background (see `rtStimulusColours`
 * in experiment/conditions.ts for why this replaced an achromatic target, and what it costs).
 * Design choices for accuracy & reliability:
 *  - onset is timestamped at the actual painted frame (rAF), not one frame early;
 *  - the response time comes from the hardware pointer-event timestamp (low jitter);
 *  - responses < RT_MIN_VALID_RT are anticipations — excluded from RT means, counted separately;
 *  - the trial ends the instant a response is made (only no-go trials wait the window out);
 *  - every location is used equally often in every block and recorded on every trial, so
 *    eccentricity is a balanced, modelled factor rather than noise (rtLocations.ts);
 *  - one unscored practice block (with feedback) runs once before the first scored condition;
 *  - metrics include RT mean/median/SD/CV, lapse rate, inverse efficiency, and first/second-half
 *    RT (within-block vigilance) — sensitive to fatigue-driven inconsistency (§12).
 */
import { useRef, useState } from 'react';
import { CONFIG, isE2ETimingActive } from '@/experiment/config';
import { nonAgingDelay } from '@/lib/foreperiod';
import { planRtBlock, eccentricityDeg, type RtLocation, type RtRing } from '@/lib/rtLocations';
import { currentScale } from '@/lib/viewportScale';
import { relativeLuminance } from '@/lib/contrast';
import { rafDelay, randInt, now } from '@/lib/timing';
import { median, stdSample } from '@/lib/stats';
import { computeSdt } from '@/lib/signalDetection';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { displayStepLabel, type DisplayPosition } from '@/experiment/taskSteps';
import type { RtAccuracy } from '@/storage/types';
import { TaskIntro } from './TaskIntro';
import { LOOP_TEXT_MIN_PX } from './loopChrome';

export interface RawTrial {
  trial_number: number;
  trial_category: 'signal' | 'noise';
  is_signal: boolean;
  /**
   * The dot's colour on this trial. Recorded because the go-target is now the condition's own text
   * colour and the no-go dots are the rest of that polarity's palette, so what was on screen can no
   * longer be reconstructed from a constant — and a no-go error on a hard-to-see distractor means
   * something different from one on an easy one.
   */
  stimulus_color: string;
  /**
   * Where the dot was: one of the eight fixed locations (1-4 the inner ring, 5-8 the outer, each in
   * quadrants up-right, up-left, down-left, down-right). The rest are that location spelled out, so
   * an analyst need not carry the table: ring, direction, the offset from the fixation cross in root
   * px (+ right, + down), its length, and its visual angle at the nominal 55 cm at the display scale
   * the dot was drawn at.
   */
  stim_location_id: number;
  stim_ring: RtRing;
  stim_angle_deg: number;
  stim_dx_px: number;
  stim_dy_px: number;
  stim_ecc_px: number;
  stim_ecc_deg_55cm: number;
  stimulus_onset_time: number;
  response_time_ms: number | null;
  accuracy: RtAccuracy;
  false_start: boolean;
  anticipatory: boolean;
}

export interface RtResult {
  trials: RawTrial[];
  summary: {
    total_trials: number;
    signal_trials: number;
    hits: number;
    false_alarms: number;
    misses: number;
    correct_rejections: number;
    /** Null when the block held no signal trials — never 0, which would be a measurement. */
    hit_rate: number | null;
    /** Null when the block held no noise trials. */
    false_alarm_rate: number | null;
    mean_rt_hits_ms: number | null;
    median_rt_hits_ms: number | null;
    rt_sd_ms: number | null;
    error_rate: number | null;
    rt_cv: number | null;
    anticipations: number;
    lapse_count: number;
    lapse_rate: number | null;
    inverse_efficiency_ms: number | null;
    first_half_mean_rt_ms: number | null;
    second_half_mean_rt_ms: number | null;
    d_prime: number | null;
    d_prime_se: number | null;
    d_prime_unstable: boolean;
    criterion: number | null;
    d_prime_estimable: boolean;
  };
}

type Phase = 'instruction' | 'fixation' | 'delay' | 'stimulus' | 'feedback' | 'iti' | 'practice_done' | 'done';

interface Trial {
  signal: boolean;
  color: string;
  location: RtLocation;
}

/**
 * Achromatic ink for the FIXATION CROSS: black on a light field, white on a dark one.
 *
 * This used to be the go-target colour as well. The go-target is now the condition's own text
 * colour, but the cross is not the stimulus and must stay maximally visible in every condition: a
 * cross drawn in yellow on white (2.39:1) is one a participant cannot hold, so the dot would arrive
 * further into the periphery and the slower RT would be attributed to the display. Chosen by the
 * background's WCAG relative luminance rather than by the polarity label, so it stays correct for
 * any background the task is ever handed.
 */
export function fixationInkFor(background: string): string {
  return relativeLuminance(background) > 0.5 ? CONFIG.RT_FIXATION_LIGHT_BG : CONFIG.RT_FIXATION_DARK_BG;
}

/**
 * The go-target of the previous block in this sitting, or null before the first.
 *
 * Module scope, deliberately: the task component is remounted for every condition, so nothing in
 * component state survives to say what the rule was last time — and the whole point is to detect
 * the transition between blocks.
 */
let lastTargetColor: string | null = null;

/**
 * Reset between participants. A stale value would suppress the banner on a new participant's first
 * block, or raise it spuriously — and because this is module scope, a value genuinely survives from
 * one participant to the next in the same tab, with no page reload between them.
 */
export function resetRtTargetMemory(): void {
  lastTargetColor = null;
}

/**
 * Seed the memory from a known predecessor, for the RESUME path.
 *
 * A resume re-enters the sitting part-way through, so the previous block did happen and its rule is
 * recoverable from the plan. Clearing the memory would make the banner merely absent at a genuine
 * transition; seeding it makes the banner correct.
 */
export function setRtTargetMemory(color: string): void {
  lastTargetColor = color;
}

/**
 * Build a block: a go/no-go order with no long runs, and a place for every dot.
 *
 * The order is planRuns's, as before: an unconstrained shuffle of 20 go and 12 no-go let runs of six
 * or seven gos prime a response hard enough that the next no-go drew a false alarm reflecting the run
 * rather than the display, and left the tail of the block deterministic. The locations, and the
 * no-go colours (now split across the two rings), come from planRtBlock — see rtLocations.ts.
 */
function buildTrials(
  n: number, goRate: number, target: string, distractorPalette: readonly string[], blockIndex: number, practice: boolean,
): Trial[] {
  const nGo = Math.round(n * goRate);
  const plan = planRtBlock({
    nGo, nNoGo: n - nGo, maxRun: CONFIG.RT_MAX_RUN, target, distractors: distractorPalette, blockIndex, practice,
  });
  if (!plan.capRespected) {
    /*
     * Unreachable for every parameter set this app ships — tests/foreperiod.test.ts proves the
     * production, practice and end-to-end counts are all arrangeable within RT_MAX_RUN — so this is
     * a guard against a future change to RT_TRIALS_PER_CONDITION, RT_GO_RATE or RT_MAX_RUN that
     * quietly makes the cap unsatisfiable. planRuns returns the flag exactly so the caller need not
     * hope; discarding it meant a sequence that had broken its own predictability constraint would
     * have run, and been recorded, as though it had not.
     */
    console.error('[visulab] go/no-go run cap could not be honoured: trial predictability is not as configured.');
  }
  // The same kind of guard for the locations: both are unreachable for the shipped counts
  // (tests/rtLocations.test.ts), and both would otherwise change the design without a trace.
  if (!plan.noConsecutiveRepeat) {
    console.error('[visulab] reaction-time locations: a same-location repeat could not be avoided in this block.');
  }
  if (!practice && plan.layout !== 'balanced' && !isE2ETimingActive()) {
    console.error(`[visulab] reaction-time locations: a scored block of ${n} trials has no balanced layout (got '${plan.layout}').`);
  }
  return plan.trials;
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

interface Props {
  background: string;
  text: string;
  /** The go-target colour: this condition's text colour. */
  target: string;
  /** Its ink name, shown on the instruction card. */
  targetName: string;
  /** No-go colours: the other text colours of this polarity. */
  distractors: readonly string[];
  /** Unscored practice trials to run before the scored block (0 = none). */
  practiceTrials?: number;
  onComplete: (r: RtResult) => void;
  /**
   * Told true when the first trial starts and false when the last has ended. Experiment offers Pause
   * on the instruction card and while the results save, never while trials run (screen audit F15:
   * it was hidden for the whole stage, the card included, where nothing is running).
   */
  onTrialsRunning?: (running: boolean) => void;
  /** Which display of the sitting this is, for the instruction card's eyebrow. */
  display?: DisplayPosition;
  /**
   * The block's serial position in the participant's plan, 0-based (the condition's global
   * session_position). Odd blocks get the mirrored location pattern and the swapped colour split;
   * see rtLocations.ts.
   */
  blockIndex?: number;
}

/** Messages between trials — practice feedback, "Practice complete", "Block complete": the stimulus face, full ink. */
const message: React.CSSProperties = { textAlign: 'center', fontFamily: STIMULUS_FONT_STACK, maxWidth: 520, padding: 24 };

export function ReactionTimeTask({
  background, text, target, targetName, distractors, practiceTrials = 0, onComplete, onTrialsRunning, display,
  blockIndex = 0,
}: Props) {
  const [phase, setPhase] = useState<Phase>('instruction');
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  // useState's initialiser, not useRef(buildTrials(...)): a ref's argument is evaluated on every
  // render, and the planner runs a search, so it would be re-planned and discarded at every trial.
  const [scored] = useState<Trial[]>(() => buildTrials(CONFIG.RT_TRIALS_PER_CONDITION, CONFIG.RT_GO_RATE, target, distractors, blockIndex, false));
  const [practice] = useState<Trial[]>(() => buildTrials(practiceTrials, CONFIG.RT_GO_RATE, target, distractors, blockIndex, true));
  const records = useRef<RawTrial[]>([]);
  const phaseRef = useRef<Phase>('instruction');
  const onsetRef = useRef(0);
  const respondedAtRef = useRef<number | null>(null);
  const falseStartRef = useRef(false);
  const current = useRef<Trial | null>(null);
  const targetColor = target;
  // The fixation cross is NOT the stimulus; it stays achromatic. See fixationInkFor.
  const fixationInk = fixationInkFor(background);
  /*
   * Whether the go rule inverted since the previous block of this sitting.
   *
   * Held at module scope because this component is remounted per condition, so component state
   * cannot remember the previous block. Captured once on mount, before `run()` updates it, so the
   * banner reflects the transition into THIS block rather than the block itself.
   */
  const targetChanged = useRef(lastTargetColor !== null && lastTargetColor !== targetColor).current;
  const [, force] = useState(0);

  const setPhaseSync = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // Use the hardware pointer-event timestamp (same performance clock as onset) for low-jitter RT.
  const handleResponse = (e: React.PointerEvent) => {
    const ph = phaseRef.current;
    if (ph === 'fixation' || ph === 'delay') falseStartRef.current = true;
    else if (ph === 'stimulus' && respondedAtRef.current == null) {
      respondedAtRef.current = e.timeStamp;
      force((n) => n + 1);
    }
  };

  const waitForResponseOrTimeout = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const start = now();
      const tick = () => {
        if (respondedAtRef.current != null || now() - start >= ms) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  /**
   * Timestamp the onset AFTER the stimulus frame has been painted, and open the response window at
   * the same instant.
   *
   * Two defects lived here. A single requestAnimationFrame callback runs BEFORE style, layout and
   * paint in that frame, so `now()` was taken about a frame early and every reaction time was
   * inflated by roughly 17-50 ms once the display pipeline is included. That offset is constant
   * across conditions, so it does not confound the contrasts — but it silently moved two ABSOLUTE
   * thresholds: the 600 ms PVT-style lapse cutoff was really cutting at ~550-583 ms of true
   * latency, and the 150 ms anticipation cutoff moved the same way. The nested rAF resolves after
   * the frame is composited.
   *
   * Worse, `phaseRef` was flipped to 'stimulus' synchronously while `onsetRef` was written a frame
   * later, so a tap landing in between was accepted as a response and timestamped BEFORE the onset
   * — producing a negative reaction time, scored as a hit or a false alarm, with false_start still
   * reading false. The phase flip now happens in the same callback as the timestamp, so no response
   * can be accepted before an onset exists.
   */
  const markOnsetAtPaint = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      onsetRef.current = now();
      phaseRef.current = 'stimulus';
      resolve();
    })));

  const runTrial = async (t: Trial, index: number, isPractice: boolean) => {
    current.current = t;
    respondedAtRef.current = null;
    falseStartRef.current = false;

    setPhaseSync('fixation');
    await rafDelay(randInt(Math.random, CONFIG.RT_FIXATION_MIN_MS, CONFIG.RT_FIXATION_MAX_MS));
    setPhaseSync('delay');
    /*
     * Truncated exponential, not uniform. A bounded uniform has a rising hazard: on the previous
     * 400-900 ms the chance of onset within the next 100 ms went from 5% to 100% across the range,
     * so a participant learned the timing implicitly and RT fell with foreperiod length. Constant
     * hazard means having waited tells them nothing. See src/lib/foreperiod.ts.
     */
    await rafDelay(nonAgingDelay(CONFIG.RT_DELAY_MIN_MS, CONFIG.RT_DELAY_MAX_MS, CONFIG.RT_DELAY_MEAN_MS));

    // Render the stimulus, but do NOT accept responses yet: phaseRef flips inside markOnsetAtPaint,
    // together with the onset timestamp.
    setPhase('stimulus');
    force((n) => n + 1);
    await markOnsetAtPaint();
    // The scale the dot was actually drawn at. Frozen for the condition, but it may shrink if the
    // screen genuinely did (viewportScale.ts), so it is read per trial rather than assumed.
    const scaleAtOnset = currentScale();
    await waitForResponseOrTimeout(CONFIG.RT_RESPONSE_WINDOW_MS);

    const rawRt = respondedAtRef.current != null ? respondedAtRef.current - onsetRef.current : null;
    /**
     * A latency outside [0, response window] is not a measurement of anything — it is a clock
     * fault. Recorded as a false start with a null time rather than exported as a reaction time,
     * so an analyst cleaning on `response_time_ms > 0` cannot silently disagree with the summary
     * file, which used to keep counting the same trial as a hit or a false alarm.
     */
    const outOfRange = rawRt != null && (rawRt < 0 || rawRt > CONFIG.RT_RESPONSE_WINDOW_MS);
    if (outOfRange) falseStartRef.current = true;
    const rt = outOfRange ? null : rawRt;
    const responded = rt != null;

    /**
     * An ANTICIPATION is not a detection.
     *
     * A response faster than the anticipation cutoff cannot reflect stimulus processing, so scoring
     * it as a hit or a false alarm credited a participant who had stopped watching. It was already
     * excluded from the RT means — the header said so — but it still entered hit_rate,
     * false_alarm_rate, d-prime, criterion and error_rate, all of which are exported as detection
     * measures. The credit was largest exactly where disengagement was largest, attenuating the
     * fatigue effect the task exists to detect toward null.
     *
     * It gets its own accuracy level so the trial stays auditable, and is excluded from both signal
     * detection pools rather than dropped from the file.
     */
    const anticipatory = rt != null && rt < CONFIG.RT_MIN_VALID_RT_MS;
    const accuracy: RtAccuracy = anticipatory
      ? 'anticipation'
      : t.signal
        ? responded ? 'hit' : 'miss'
        : responded ? 'false_alarm' : 'correct_rejection';

    if (!isPractice) {
      records.current.push({
        trial_number: index + 1,
        trial_category: t.signal ? 'signal' : 'noise',
        is_signal: t.signal,
        stimulus_color: t.color,
        stim_location_id: t.location.id,
        stim_ring: t.location.ring,
        stim_angle_deg: t.location.angleDeg,
        stim_dx_px: t.location.dx,
        stim_dy_px: t.location.dy,
        stim_ecc_px: t.location.eccPx,
        stim_ecc_deg_55cm: eccentricityDeg(t.location.eccPx, scaleAtOnset),
        stimulus_onset_time: onsetRef.current,
        response_time_ms: rt,
        accuracy,
        false_start: falseStartRef.current,
        anticipatory,
      });
    } else {
      // Practice feedback only.
      let msg: string;
      let ok: boolean;
      if (t.signal) {
        if (!responded) { msg = `Too slow — tap when the dot is ${targetName}`; ok = false; }
        else if (anticipatory) { msg = 'Wait until the dot appears'; ok = false; }
        else { msg = '✓ Good'; ok = true; }
      } else {
        if (responded) { msg = `✗ That wasn’t ${targetName} — don’t tap`; ok = false; }
        else { msg = '✓ Good (correctly ignored)'; ok = true; }
      }
      setFeedback({ msg, ok });
      setPhaseSync('feedback');
      await rafDelay(700);
      setFeedback(null);
    }

    setPhaseSync('iti');
    await rafDelay(randInt(Math.random, CONFIG.RT_ITI_MIN_MS, CONFIG.RT_ITI_MAX_MS));
  };

  const started = useRef(false);
  const run = async () => {
    // One block per mount: a second tap on Start must not launch a second, interleaved run.
    if (started.current) return;
    started.current = true;
    onTrialsRunning?.(true);
    // Record the rule for this block only once it actually starts, so the next block compares
    // against a block that was really presented rather than one merely rendered and abandoned.
    lastTargetColor = targetColor;
    for (let i = 0; i < practice.length; i++) await runTrial(practice[i], i, true);
    if (practice.length > 0) {
      setPhaseSync('practice_done');
      await rafDelay(1400);
    }
    for (let i = 0; i < scored.length; i++) await runTrial(scored[i], i, false);
    finish();
  };

  const finish = () => {
    setPhaseSync('done');
    onTrialsRunning?.(false);
    const recs = records.current;
    const hits = recs.filter((r) => r.accuracy === 'hit');
    const misses = recs.filter((r) => r.accuracy === 'miss').length;
    const fa = recs.filter((r) => r.accuracy === 'false_alarm').length;
    const cr = recs.filter((r) => r.accuracy === 'correct_rejection').length;
    const anticipations = recs.filter((r) => r.anticipatory).length;
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

    onComplete({
      trials: recs,
      summary: {
        total_trials: recs.length,
        signal_trials: hits.length + misses,
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
        anticipations,
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
      },
    });
  };

  const dot = CONFIG.RT_DOT_PX;
  const t = current.current;
  const showStim = phase === 'stimulus' && t;
  const totalScored = CONFIG.RT_TRIALS_PER_CONDITION;

  if (phase === 'instruction') {
    /*
     * The shared intro card (TaskIntro), like reading and word search: it used to be its own card in
     * DM Mono with a 24 px "Task 4 of 4 · Reaction" as the heading and a 14 px button (screen audit
     * F15). What only this task needs — the target dot at full size, and the banner when the target
     * colour has changed — goes in the card's `children` slot. Rendered instead of the trial field,
     * not inside it, so the tap on Start can never reach the field's response handler.
     */
    return (
      <TaskIntro
        eyebrow={displayStepLabel('REACTION_TIME', display)}
        title="Tap for your colour"
        lines={[
          <>
            A dot will appear somewhere around the cross in the middle of the screen. Tap the screen as
            fast as you can ONLY when it is{' '}
            <span style={{ color: targetColor, fontWeight: 700 }}>{targetName}</span> — the same
            colour as the text you have just read. Do not tap for a dot of any other colour.
          </>,
          /*
           * Where to look. Every trial's eccentricity (stim_ecc_px, stim_ecc_deg_55cm, stim_ring) is
           * measured from the cross, so it means what the codebook says only if the eyes are on the
           * cross when the dot comes on. The cross is the only thing on the screen before each dot, so
           * fixation was likely, but it was never asked for. Plain text in the card's own face, size and
           * ink, the same words in every condition.
           */
          'Keep your eyes on the cross between dots.',
          /*
           * Tap anywhere, so the response carries no aiming movement whose length would depend on
           * where the dot was rather than on the display. The hand waits BELOW the screen so it never
           * covers the lower dots: those sit 68 px from the bottom edge on the tablet.
           */
          'Rest your hand just below the bottom edge of the screen. Tap anywhere.',
          ...(practiceTrials > 0 ? ['A short practice comes first.'] : []),
        ]}
        buttonLabel={practiceTrials > 0 ? 'Start practice →' : `Start (${totalScored} trials) →`}
        background={background}
        text={text}
        onBegin={() => { void run(); }}
      >
        {/*
          Show the actual target, at the size it will appear, and name it.

          The target is this condition's text colour, so it changes from block to block. A missed
          switch does not look like an error in the data — it looks like a colour or polarity
          effect on d-prime, which is precisely the comparison this study makes — so the dot is
          drawn here at full size and the change banner below fires whenever it differs from the
          previous block's.
        */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '6px 0 4px' }}>
          <div aria-hidden style={{
            width: CONFIG.RT_DOT_PX, height: CONFIG.RT_DOT_PX, borderRadius: '50%', flex: '0 0 auto',
            background: targetColor, border: `1px solid ${fixationInk}`,
          }} />
          <span style={{ fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX, lineHeight: 1.5, textAlign: 'left' }}>
            this dot → tap<br />any other colour → do not tap
          </span>
        </div>

        {targetChanged && (
          /* Only when the target colour actually differs from the previous block's. Two
             consecutive conditions can share a text colour across polarities (P2 then N2), and
             a banner shown when nothing changed trains the participant to ignore it. */
          <p role="alert" style={{
            fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX, lineHeight: 1.5, margin: '14px 0 0', padding: '10px 14px',
            border: `2px solid ${fixationInk}`, borderRadius: 10, fontWeight: 700,
          }}>
            The target colour has CHANGED for this block — it is now {targetName}.
          </p>
        )}
      </TaskIntro>
    );
  }

  return (
    <div
      onPointerDown={handleResponse}
      style={{ position: 'fixed', inset: 0, background, touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
    >
      {(phase === 'fixation' || phase === 'delay') && (
        <div data-testid="rt-fixation" style={{ width: 24, height: 24, position: 'relative' }}>
          {/* Achromatic and full-opacity, chosen by background luminance — NOT the go-target colour.
              Drawn in the condition ink it would range from 2.39:1 (P4, yellow on white) upward, so
              the marker that holds fixation immediately BEFORE every stimulus would vary with both
              experimental factors. A cross the participant cannot hold means the dot arrives further
              into the periphery, which shows up as a slower RT attributed to the display. */}
          <div style={{ position: 'absolute', top: 11, left: 0, width: 24, height: 2, background: fixationInk }} />
          <div style={{ position: 'absolute', left: 11, top: 0, width: 2, height: 24, background: fixationInk }} />
        </div>
      )}

      {showStim && (
        /*
         * The dot is placed by a FIXED OFFSET in root px from the centre — where the fixation cross
         * was — not by a percentage of any box.
         *
         * It used to be a percentage position inside a box the size of the design canvas, because a
         * percentage of the ROOT box, which takes the device's aspect ratio, had made eccentricity vary
         * by device (0.148 to 0.071 in dot size per unit eccentricity, at the same stimulus_scale).
         * An offset in root px has no such dependence at all: on every device the dot is the same
         * number of root px from the cross, and stimulus_scale is the whole of the difference. The
         * container is the full root, so the 50% is the cross's own centre.
         */
        <div
          aria-hidden
          data-testid="rt-dot"
          data-location={t!.location.id}
          style={{
            position: 'absolute', left: `calc(50% + ${t!.location.dx}px)`, top: `calc(50% + ${t!.location.dy}px)`,
            transform: 'translate(-50%, -50%)', width: dot, height: dot, borderRadius: '50%', background: t!.color,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Practice only, and drawn in the condition ink rather than a fixed green/red: those
          measured 2.16:1 and 2.35:1 against the light backgrounds, so the one screen that teaches
          the task was hardest to read in exactly the conditions where legibility is the variable
          under study. The tick and cross carry the valence. */}
      {phase === 'feedback' && feedback && (
        <div style={{ ...message, fontSize: 20, color: text }}>
          {feedback.msg}
        </div>
      )}

      {/* The 'done' phase used to render nothing at all — a blank condition-coloured screen. The
          block's completion handler then awaits ~35 database writes with no try/catch, and Pause is
          deliberately hidden during the trials, so a single rejected write left the participant
          facing an empty screen with no control and no browser chrome. Only a force-quit recovered,
          losing the condition. Pause comes back here (onTrialsRunning). */}
      {phase === 'done' && (
        <div style={{ ...message, color: text }}>
          <p style={{ fontSize: 20 }}>Block complete.</p>
          <p style={{ fontSize: 17, marginTop: 8 }}>Saving — this takes a moment.</p>
        </div>
      )}

      {phase === 'practice_done' && (
        <div style={{ ...message, color: text }}>
          <p style={{ fontSize: 20 }}>Practice complete.</p>
          <p style={{ fontSize: 17, marginTop: 8 }}>The real task begins now — go as fast and accurately as you can.</p>
        </div>
      )}

      {/*
        NO TRIAL COUNTER. There was one at the top right, "k/32" in 12 px DM Mono at half opacity,
        and it counted the six practice trials against the 32 scored ones ("1/32 … 6/32", then "1/32"
        again; screen audit F16). Rather than enlarge it to the condition-screen floor (16 px, full
        ink), it is gone: it was the only chrome in the reaction field, it changed at the onset of
        every trial — a transient in the ink, in the periphery, timed with the fixation cross — and at
        full ink it would have been a larger and brighter one, its salience following each
        condition's contrast. The block is about a minute long; the card says how many trials it has
        and "Block complete" says when it is over. The top-right corner is now simply empty.
      */}
    </div>
  );
}
