/**
 * Colour go/no-go reaction-time task — customised for the fatigue / attention-stability hypothesis.
 *
 * A single dot appears at a RANDOM location, on the active condition's own background; the
 * participant taps ONLY when it is the target colour (green), ignoring red/blue/yellow. Design
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
    lapse_rate: number;
    inverse_efficiency_ms: number | null;
    first_half_mean_rt_ms: number | null;
    second_half_mean_rt_ms: number | null;
    d_prime: number;
    d_prime_se: number;
    d_prime_unstable: boolean;
    criterion: number;
  };
}

type Phase = 'instruction' | 'fixation' | 'delay' | 'stimulus' | 'feedback' | 'iti' | 'practice_done' | 'done';

interface Trial {
  signal: boolean;
  color: string;
}

function buildTrials(n: number, goRate: number): Trial[] {
  const { RT_TARGET_COLOR: TARGET, RT_DISTRACTOR_COLORS: DIST } = CONFIG;
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
  const scored = useRef<Trial[]>(buildTrials(CONFIG.RT_TRIALS_PER_CONDITION, CONFIG.RT_GO_RATE));
  const practice = useRef<Trial[]>(buildTrials(practiceTrials, CONFIG.RT_GO_RATE));
  const records = useRef<RawTrial[]>([]);
  const phaseRef = useRef<Phase>('instruction');
  const onsetRef = useRef(0);
  const respondedAtRef = useRef<number | null>(null);
  const falseStartRef = useRef(false);
  const current = useRef<Trial | null>(null);
  const clusterPos = useRef<{ x: number; y: number }>({ x: 50, y: 50 });
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

  // Timestamp the onset on the frame the stimulus is actually painted.
  const markOnsetAtPaint = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => { onsetRef.current = now(); resolve(); }));

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
    setPhaseSync('stimulus');
    force((n) => n + 1);
    await markOnsetAtPaint();
    await waitForResponseOrTimeout(CONFIG.RT_RESPONSE_WINDOW_MS);

    const responded = respondedAtRef.current != null;
    const rt = responded ? respondedAtRef.current! - onsetRef.current : null;
    const anticipatory = rt != null && rt < CONFIG.RT_MIN_VALID_RT_MS;
    const accuracy: RtAccuracy = t.signal
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
        if (!responded) { msg = 'Too slow — tap when the dot is green'; ok = false; }
        else if (anticipatory) { msg = 'Wait until the dot appears'; ok = false; }
        else { msg = '✓ Good'; ok = true; }
      } else {
        if (responded) { msg = '✗ That wasn’t green — don’t tap'; ok = false; }
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
    const errorRate = recs.length ? (misses + fa) / recs.length : 0;
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
        lapse_rate: hits.length ? lapseCount / hits.length : 0,
        inverse_efficiency_ms: ies,
        first_half_mean_rt_ms: halfRt(0, mid),
        second_half_mean_rt_ms: halfRt(mid, recs.length),
        d_prime: sdt.d_prime,
        d_prime_se: sdt.d_prime_se,
        d_prime_unstable: sdt.d_prime_unstable,
        criterion: sdt.criterion,
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
            A coloured dot will appear at a random spot. Tap the screen as fast as you can ONLY when
            it is <span style={{ color: CONFIG.RT_TARGET_COLOR, fontWeight: 700 }}>green</span>. Do not
            tap for any other colour.{practiceTrials > 0 ? ' A short practice comes first.' : ''}
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
          <div style={{ position: 'absolute', top: 11, left: 0, width: 24, height: 2, background: text, opacity: 0.5 }} />
          <div style={{ position: 'absolute', left: 11, top: 0, width: 2, height: 24, background: text, opacity: 0.5 }} />
        </div>
      )}

      {showStim && (
        <div style={{ position: 'fixed', left: `${clusterPos.current.x}%`, top: `${clusterPos.current.y}%`, transform: 'translate(-50%, -50%)', width: dot, height: dot, borderRadius: '50%', background: t!.color }} />
      )}

      {phase === 'feedback' && feedback && (
        <div style={{ textAlign: 'center', fontFamily: '"DM Mono", monospace', fontSize: 20, color: feedback.ok ? '#22c97a' : '#e64c4c' }}>
          {feedback.msg}
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
