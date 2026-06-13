/**
 * Eriksen colour-flanker go/no-go reaction-time task (48 trials).
 *
 * Tap when the CENTRE dot is the target colour (red). 24 signal + 24 noise trials, each split into
 * congruent/incongruent flankers. Audit fix: stimuli render on a FIXED neutral grey background so
 * dot salience is identical across conditions (the red dot is 5.74:1 on white vs 3.66:1 on black).
 * Timing uses rAF (precise on Android WebView). Per-trial records + an SDT summary are emitted.
 */
import { useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { rafDelay, randInt, now } from '@/lib/timing';
import { mean, median, stdSample } from '@/lib/stats';
import { computeSdt, flankerCongruencyEffect } from '@/lib/signalDetection';
import type { RtAccuracy } from '@/storage/types';

export interface RawTrial {
  trial_number: number;
  trial_category: 'signal_congruent' | 'signal_incongruent' | 'noise_congruent' | 'noise_incongruent';
  is_signal: boolean;
  is_congruent: boolean;
  stimulus_onset_time: number;
  response_time_ms: number | null;
  accuracy: RtAccuracy;
  false_start: boolean;
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
    mean_rt_congruent_ms: number | null;
    mean_rt_incongruent_ms: number | null;
    flanker_congruency_effect_ms: number | null;
    d_prime: number;
    d_prime_se: number;
    d_prime_unstable: boolean;
  };
}

type Phase = 'instruction' | 'fixation' | 'delay' | 'stimulus' | 'iti' | 'done';

interface Trial {
  signal: boolean;
  congruent: boolean;
  centerColor: string;
  flankerColor: string;
}

function buildTrials(): Trial[] {
  const { RT_TARGET_COLOR: TARGET, RT_DISTRACTOR_COLORS: DIST } = CONFIG;
  const pick = () => DIST[Math.floor(Math.random() * DIST.length)];
  const trials: Trial[] = [];
  const perCell = CONFIG.RT_TRIALS_PER_CONDITION / 4;
  for (let i = 0; i < perCell; i++) {
    trials.push({ signal: true, congruent: true, centerColor: TARGET, flankerColor: TARGET });
    trials.push({ signal: true, congruent: false, centerColor: TARGET, flankerColor: pick() });
    const nc = pick();
    trials.push({ signal: false, congruent: true, centerColor: nc, flankerColor: nc });
    let nf = pick();
    while (nf === nc) nf = pick();
    trials.push({ signal: false, congruent: false, centerColor: nc, flankerColor: nf });
  }
  // Fisher-Yates shuffle.
  for (let i = trials.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [trials[i], trials[j]] = [trials[j], trials[i]];
  }
  return trials;
}

function category(t: Trial): RawTrial['trial_category'] {
  return `${t.signal ? 'signal' : 'noise'}_${t.congruent ? 'congruent' : 'incongruent'}` as RawTrial['trial_category'];
}

interface Props {
  onComplete: (r: RtResult) => void;
}

export function ReactionTimeTask({ onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('instruction');
  const [trialNum, setTrialNum] = useState(0);
  const trials = useRef<Trial[]>(buildTrials());
  const records = useRef<RawTrial[]>([]);
  const phaseRef = useRef<Phase>('instruction');
  const onsetRef = useRef(0);
  const respondedRef = useRef<number | null>(null);
  const falseStartRef = useRef(false);
  const current = useRef<Trial | null>(null);
  const [, forceRender] = useState(0);

  const setPhaseSync = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const handleResponse = () => {
    const ph = phaseRef.current;
    if (ph === 'fixation' || ph === 'delay') {
      falseStartRef.current = true;
    } else if (ph === 'stimulus' && respondedRef.current == null) {
      respondedRef.current = now();
      forceRender((n) => n + 1);
    }
  };

  const run = async () => {
    setPhaseSync('fixation');
    const rng = Math.random;
    for (let i = 0; i < trials.current.length; i++) {
      const t = trials.current[i];
      current.current = t;
      setTrialNum(i + 1);
      respondedRef.current = null;
      falseStartRef.current = false;

      setPhaseSync('fixation');
      await rafDelay(randInt(rng, CONFIG.RT_FIXATION_MIN_MS, CONFIG.RT_FIXATION_MAX_MS));
      setPhaseSync('delay');
      await rafDelay(randInt(rng, CONFIG.RT_DELAY_MIN_MS, CONFIG.RT_DELAY_MAX_MS));

      onsetRef.current = now();
      setPhaseSync('stimulus');
      forceRender((n) => n + 1);
      await rafDelay(CONFIG.RT_RESPONSE_WINDOW_MS);

      const responded = respondedRef.current != null;
      const rt = responded ? respondedRef.current! - onsetRef.current : null;
      let accuracy: RtAccuracy;
      if (t.signal) accuracy = responded ? 'hit' : 'miss';
      else accuracy = responded ? 'false_alarm' : 'correct_rejection';

      records.current.push({
        trial_number: i + 1,
        trial_category: category(t),
        is_signal: t.signal,
        is_congruent: t.congruent,
        stimulus_onset_time: onsetRef.current,
        response_time_ms: rt,
        accuracy,
        false_start: falseStartRef.current,
      });

      setPhaseSync('iti');
      await rafDelay(randInt(rng, CONFIG.RT_ITI_MIN_MS, CONFIG.RT_ITI_MAX_MS));
    }
    finish();
  };

  const finish = () => {
    setPhaseSync('done');
    const recs = records.current;
    const hits = recs.filter((r) => r.accuracy === 'hit');
    const misses = recs.filter((r) => r.accuracy === 'miss').length;
    const fa = recs.filter((r) => r.accuracy === 'false_alarm').length;
    const cr = recs.filter((r) => r.accuracy === 'correct_rejection').length;
    const hitRts = hits.map((r) => r.response_time_ms!).filter((x) => x != null);
    const congHits = hits.filter((r) => r.is_congruent).map((r) => r.response_time_ms!);
    const incHits = hits.filter((r) => !r.is_congruent).map((r) => r.response_time_ms!);
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
        mean_rt_hits_ms: hitRts.length ? mean(hitRts) : null,
        median_rt_hits_ms: hitRts.length ? median(hitRts) : null,
        rt_sd_ms: hitRts.length ? stdSample(hitRts) : null,
        mean_rt_congruent_ms: congHits.length ? mean(congHits) : null,
        mean_rt_incongruent_ms: incHits.length ? mean(incHits) : null,
        flanker_congruency_effect_ms: flankerCongruencyEffect(congHits, incHits),
        d_prime: sdt.d_prime,
        d_prime_se: sdt.d_prime_se,
        d_prime_unstable: sdt.d_prime_unstable,
      },
    });
  };

  const bg = CONFIG.RT_STIMULUS_BACKGROUND;
  const dot = CONFIG.RT_FLANKER_DOT_PX;
  const gap = CONFIG.RT_FLANKER_SPACING_PX;

  const t = current.current;
  const showStim = phase === 'stimulus' && t;

  return (
    <div
      onPointerDown={handleResponse}
      style={{
        position: 'fixed',
        inset: 0,
        background: bg,
        touchAction: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      {phase === 'instruction' && (
        <div style={{ textAlign: 'center', color: '#fff', fontFamily: '"DM Mono", monospace', maxWidth: 520, padding: 24 }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Reaction task</h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 24 }}>
            Five dots will appear each trial. Tap anywhere as fast as you can ONLY when the centre
            dot is <span style={{ color: CONFIG.RT_TARGET_COLOR, fontWeight: 700 }}>red</span>. Do not
            tap for any other colour.
          </p>
          <button
            onPointerDown={(e) => { e.stopPropagation(); void run(); }}
            style={{ background: '#fff', color: bg, border: 'none', borderRadius: 12, padding: '14px 28px', fontFamily: '"DM Mono", monospace', fontSize: 14, cursor: 'pointer' }}
          >
            Start ({CONFIG.RT_TRIALS_PER_CONDITION} trials) →
          </button>
        </div>
      )}

      {(phase === 'fixation' || phase === 'delay') && (
        <div style={{ width: 24, height: 24, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 11, left: 0, width: 24, height: 2, background: '#ffffff80' }} />
          <div style={{ position: 'absolute', left: 11, top: 0, width: 2, height: 24, background: '#ffffff80' }} />
        </div>
      )}

      {showStim && (
        <div style={{ position: 'relative', width: gap * 2 + dot, height: gap * 2 + dot }}>
          {[
            { x: gap, y: gap, c: t!.centerColor },
            { x: 0, y: gap, c: t!.flankerColor },
            { x: gap * 2, y: gap, c: t!.flankerColor },
            { x: gap, y: 0, c: t!.flankerColor },
            { x: gap, y: gap * 2, c: t!.flankerColor },
          ].map((d, k) => (
            <div key={k} style={{ position: 'absolute', left: d.x, top: d.y, width: dot, height: dot, borderRadius: '50%', background: d.c }} />
          ))}
        </div>
      )}

      {phase !== 'instruction' && phase !== 'done' && (
        <div style={{ position: 'fixed', top: 12, right: 14, color: '#ffffff80', fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
          {trialNum}/{CONFIG.RT_TRIALS_PER_CONDITION}
        </div>
      )}
    </div>
  );
}
