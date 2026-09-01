/**
 * Colour go/no-go reaction-time task — customised for the fatigue / attention-stability hypothesis.
 *
 * A single dot appears at a RANDOM location, on the active condition's own background; the
 * participant taps ONLY when it is the ACHROMATIC target — black on a light background, white on
 * a dark one — ignoring the four chromatic distractors. Target contrast is 21:1 in both
 * polarities, so go-signal salience is constant across display conditions (synopsis §3.6). Design
 * choices for accuracy & reliability:
 *  - onset is timestamped at the actual painted frame (rAF), not one frame early;
 *  - the response time comes from the hardware pointer-event timestamp (low jitter);
 *  - responses < RT_MIN_VALID_RT are anticipations — excluded from RT means, counted separately;
 *  - the trial ends the instant a response is made (only no-go trials wait the window out);
 *  - one unscored practice block (with feedback) runs once before the first scored condition;
 *  - metrics include RT mean/median/SD/CV, lapse rate, inverse efficiency, and first/second-half
 *    RT (within-block vigilance) — sensitive to fatigue-driven inconsistency (§12).
 */
import { useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { relativeLuminance } from '@/lib/contrast';
import { rafDelay, randInt, now } from '@/lib/timing';
import { median, stdSample } from '@/lib/stats';
import { computeSdt } from '@/lib/signalDetection';
import type { RtAccuracy } from '@/storage/types';

export interface RawTrial {
  trial_number: number;
  trial_category: 'signal' | 'noise';
  is_signal: boolean;
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
    hit_rate: number;
    false_alarm_rate: number;
    mean_rt_hits_ms: number | null;
    median_rt_hits_ms: number | null;
    rt_sd_ms: number | null;
    error_rate: number;
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
}

/**
 * Achromatic go-target for the active background: black on a light field, white on a dark one.
 * Chosen by the background's WCAG relative luminance rather than by the condition's polarity
 * label, so the rule stays correct for any background the task is ever handed.
 */
export function goTargetColor(background: string): string {
  return relativeLuminance(background) > 0.5 ? CONFIG.RT_TARGET_LIGHT_BG : CONFIG.RT_TARGET_DARK_BG;
}

function buildTrials(n: number, goRate: number, background: string): Trial[] {
  const TARGET = goTargetColor(background);
  const { RT_DISTRACTOR_COLORS: DIST } = CONFIG;
  const pick = () => DIST[Math.floor(Math.random() * DIST.length)];
  const nGo = Math.round(n * goRate);
  const trials: Trial[] = [];
  for (let i = 0; i < n; i++) trials.push(i < nGo ? { signal: true, color: TARGET } : { signal: false, color: pick() });
  for (let i = trials.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [trials[i], trials[j]] = [trials[j], trials[i]];
  }
  return trials;
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

interface Props {
  background: string;
  text: string;
  /** Unscored practice trials to run before the scored block (0 = none). */
  practiceTrials?: number;
  onComplete: (r: RtResult) => void;
}

export function ReactionTimeTask({ background, text, practiceTrials = 0, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('instruction');
  const [trialNum, setTrialNum] = useState(0);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const scored = useRef<Trial[]>(buildTrials(CONFIG.RT_TRIALS_PER_CONDITION, CONFIG.RT_GO_RATE, background));
  const practice = useRef<Trial[]>(buildTrials(practiceTrials, CONFIG.RT_GO_RATE, background));
  const records = useRef<RawTrial[]>([]);
  const phaseRef = useRef<Phase>('instruction');
  const onsetRef = useRef(0);
  const respondedAtRef = useRef<number | null>(null);
  const falseStartRef = useRef(false);
  const current = useRef<Trial | null>(null);
  const clusterPos = useRef<{ x: number; y: number }>({ x: 50, y: 50 });
  // Achromatic go-target, resolved from the active background (black on light, white on dark).
  const targetColor = goTargetColor(background);
  const targetName = targetColor === CONFIG.RT_TARGET_LIGHT_BG ? 'black' : 'white';
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
    setTrialNum(index + 1);
    respondedAtRef.current = null;
    falseStartRef.current = false;

    setPhaseSync('fixation');
    await rafDelay(randInt(Math.random, CONFIG.RT_FIXATION_MIN_MS, CONFIG.RT_FIXATION_MAX_MS));
    setPhaseSync('delay');
    await rafDelay(randInt(Math.random, CONFIG.RT_DELAY_MIN_MS, CONFIG.RT_DELAY_MAX_MS));

    clusterPos.current = { x: randInt(Math.random, 25, 75), y: randInt(Math.random, 28, 72) };
    // Render the stimulus, but do NOT accept responses yet: phaseRef flips inside markOnsetAtPaint,
    // together with the onset timestamp.
    setPhase('stimulus');
    force((n) => n + 1);
    await markOnsetAtPaint();
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

  const run = async () => {
    for (let i = 0; i < practice.current.length; i++) await runTrial(practice.current[i], i, true);
    if (practice.current.length > 0) {
      setPhaseSync('practice_done');
      await rafDelay(1400);
    }
    for (let i = 0; i < scored.current.length; i++) await runTrial(scored.current[i], i, false);
    finish();
  };

  const finish = () => {
    setPhaseSync('done');
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
    const errorRate = scoredTrials ? (misses + fa) / scoredTrials : 0;
    const lapseCount = validHitRts.filter((rt) => rt > CONFIG.RT_LAPSE_THRESHOLD_MS).length;
    const accuracyProp = 1 - errorRate;
    const ies = meanRt != null && accuracyProp > 0 ? meanRt / accuracyProp : null;

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

  return (
    <div
      onPointerDown={handleResponse}
      style={{ position: 'fixed', inset: 0, background, touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
    >
      {phase === 'instruction' && (
        <div style={{ textAlign: 'center', color: text, fontFamily: '"DM Mono", monospace', maxWidth: 540, padding: 24 }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Task 4 of 4 · Reaction</h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 24 }}>
            A dot will appear at a random spot. Tap the screen as fast as you can ONLY when it is{' '}
            <span style={{ color: targetColor, fontWeight: 700, textShadow: `0 0 1px ${text}` }}>{targetName}</span>.
            Do not tap for any coloured dot.{practiceTrials > 0 ? ' A short practice comes first.' : ''}
          </p>
          <button
            onPointerDown={(e) => { e.stopPropagation(); void run(); }}
            style={{ background: text, color: background, border: 'none', borderRadius: 12, padding: '14px 28px', fontFamily: '"DM Mono", monospace', fontSize: 14, cursor: 'pointer' }}
          >
            {practiceTrials > 0 ? 'Start practice →' : `Start (${totalScored} trials) →`}
          </button>
        </div>
      )}

      {(phase === 'fixation' || phase === 'delay') && (
        <div style={{ width: 24, height: 24, position: 'relative' }}>
          {/* Achromatic and full-opacity, chosen by background luminance exactly as the go-target is.
              Drawn in the condition ink at 50% opacity it ranged from 1.52:1 (P4) to 5.32:1 (N1)
              across conditions - so the marker that holds fixation immediately BEFORE every stimulus
              varied with both experimental factors, while the stimulus itself was carefully
              contrast-matched. A cross the participant cannot hold means the dot arrives further into
              the periphery, which shows up as a slower RT attributed to the display. */}
          <div style={{ position: 'absolute', top: 11, left: 0, width: 24, height: 2, background: targetColor }} />
          <div style={{ position: 'absolute', left: 11, top: 0, width: 2, height: 24, background: targetColor }} />
        </div>
      )}

      {showStim && (
        <div style={{ position: 'fixed', left: `${clusterPos.current.x}%`, top: `${clusterPos.current.y}%`, transform: 'translate(-50%, -50%)', width: dot, height: dot, borderRadius: '50%', background: t!.color }} />
      )}

      {/* Practice only, and drawn in the condition ink rather than a fixed green/red: those
          measured 2.16:1 and 2.35:1 against the light backgrounds, so the one screen that teaches
          the task was hardest to read in exactly the conditions where legibility is the variable
          under study. The tick and cross carry the valence. */}
      {phase === 'feedback' && feedback && (
        <div style={{ textAlign: 'center', fontFamily: '"DM Mono", monospace', fontSize: 20, color: text }}>
          {feedback.msg}
        </div>
      )}

      {/* The 'done' phase used to render nothing at all — a blank condition-coloured screen. The
          block's completion handler then awaits ~35 database writes with no try/catch, and Pause is
          deliberately hidden during REACTION_TIME, so a single rejected write left the participant
          facing an empty screen with no control and no browser chrome. Only a force-quit recovered,
          losing the condition. */}
      {phase === 'done' && (
        <div style={{ textAlign: 'center', color: text, fontFamily: '"DM Mono", monospace', maxWidth: 480, padding: 24 }}>
          <p style={{ fontSize: 18 }}>Block complete.</p>
          <p style={{ fontSize: 14, opacity: 0.7, marginTop: 8 }}>Saving — this takes a moment.</p>
        </div>
      )}

      {phase === 'practice_done' && (
        <div style={{ textAlign: 'center', color: text, fontFamily: '"DM Mono", monospace', maxWidth: 480, padding: 24 }}>
          <p style={{ fontSize: 18 }}>Practice complete.</p>
          <p style={{ fontSize: 14, opacity: 0.7, marginTop: 8 }}>The real task begins now — go as fast and accurately as you can.</p>
        </div>
      )}

      {(phase === 'fixation' || phase === 'delay' || phase === 'stimulus' || phase === 'iti') && (
        <div style={{ position: 'fixed', top: 12, right: 14, color: text, opacity: 0.5, fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
          {phaseRef.current && trialNum > 0 ? `${Math.min(trialNum, totalScored)}/${totalScored}` : ''}
        </div>
      )}
    </div>
  );
}
