import { useEffect, useRef, useState } from 'react';
import { now } from '@/lib/timing';
import { CONFIG, isE2ETimingActive } from '@/experiment/config';
import {
  SELF_TEST, scoreSelfTest, minHits, attemptSummary, type SelfTestResult, type SelfTestAttemptSummary,
} from '@/tracking/selfTest';
import { FPS_GATE } from '@/tracking/frameRateGate';
import { EAR_TIERS, MIN_GAP_MS } from '@/tracking/blink';
import type { SelfTestObservation } from '@/tracking/useTracking';
import { TRACKER_LABEL, type TrackerBackend } from '@/tracking/trackers';

/**
 * "Blink each time the dot flashes" — the camera self-test, run after calibration. See
 * tracking/selfTest.ts for why it exists and what a pass does and does not mean.
 *
 * ON THE GREY FIELD (Round 79, rule st-r2). It was shown on the dark ground of the calibration routine,
 * and under automatic exposure a dark screen is the one that slows a tablet camera most: the check ran
 * at the camera's worst rate and judged it against a floor the camera could not reach. It now runs on the
 * grey field's #808080 in its black ink — the screen every condition starts from — so the camera sees
 * the face lit as it will be before each reading (and, with the exposure fixed at camera setup, filmed
 * the same way). The flash is the dot turning from black to white.
 *
 * EACH ATTEMPT SAYS WHAT HAPPENED. The result lists the three criteria with the value measured and the
 * value needed, each flash with whether a blink was seen and how long after it began, and the eye's
 * openness through the check with the flashes and their matching windows marked — so an operator can
 * see which part failed (no blink at a flash, a blink too shallow to count, the face lost, a slow
 * camera) and fix that part before trying again. Earlier attempts in the same run are listed, and kept
 * with the one recorded. The operator chooses: continue, try again, or continue anyway; the result is
 * recorded in every case.
 */
export function CameraSelfTest({ begin, end, onDone, onRunning, halted = false }: {
  begin: () => void;
  /** Ends the check; given the cue times, the check's blinks are held to be stored with the result. */
  end: (cueTimes?: number[]) => SelfTestObservation;
  onDone: (result: SelfTestResult) => void;
  /** True while the dot is flashing: the operator's Exit chip is withheld, as in calibration. */
  onRunning?: (running: boolean) => void;
  /**
   * The tablet is in portrait: a check in progress is stopped and what it saw discarded, as the
   * calibration routine does (CalibrationRoutine.tsx). It used to keep cueing under the portrait
   * block and score blinks the camera saw from the short edge, while the block said nothing was lost.
   */
  halted?: boolean;
}) {
  const [phase, setPhase] = useState<'intro' | 'running' | 'result'>('intro');
  useEffect(() => { onRunning?.(phase === 'running'); }, [phase, onRunning]);
  useEffect(() => () => onRunning?.(false), [onRunning]);
  const [flash, setFlash] = useState(false);
  const [cueCount, setCueCount] = useState(0);
  const [result, setResult] = useState<SelfTestResult | null>(null);
  const [seen, setSeen] = useState<{ obs: SelfTestObservation; cues: number[]; startedAt: number } | null>(null);
  const cues = useRef<number[]>([]);
  /** Scored attempts in this run of the check, and a summary of each one tried again. */
  const attempts = useRef(0);
  const earlier = useRef<SelfTestAttemptSummary[]>([]);
  /** Which check is current; a stopped one's animation frames see they are not and do nothing. */
  const run = useRef(0);
  const [stoppedByRotation, setStoppedByRotation] = useState(false);
  useEffect(() => {
    if (!halted || phase !== 'running') return;
    run.current += 1;
    end(); // closes the check's own aggregator; what it collected is not scored
    setFlash(false);
    setCueCount(0);
    setStoppedByRotation(true);
    setPhase('intro');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halted, phase]);

  // Collapsed timings under the test harness, like every other protocol duration.
  const fast = isE2ETimingActive();
  const first = fast ? 150 : SELF_TEST.FIRST_CUE_MS;
  const every = fast ? 150 : SELF_TEST.CUE_EVERY_MS;

  useEffect(() => {
    if (phase !== 'running') return;
    cues.current = [];
    begin();
    const mine = run.current;
    const t0 = now();
    let raf = 0;
    let shown = -1;
    const tick = () => {
      if (run.current !== mine) return;
      const el = now() - t0;
      const k = Math.floor((el - first) / every);
      // Advance one cue at a time: a late frame (a busy tablet) must delay a cue, never skip it, or
      // the test would score fewer cues than it announced.
      if (el >= first && shown + 1 < SELF_TEST.CUES && k > shown) {
        shown += 1;
        cues.current.push(now());
        setCueCount(shown + 1);
        setFlash(true);
        window.setTimeout(() => setFlash(false), 350);
      }
      // End only after the last cue has been shown AND its blink has had the full matching window.
      if (shown === SELF_TEST.CUES - 1 && el >= first + SELF_TEST.CUES * every + (fast ? 150 : 1500)
        && (fast || now() - cues.current[shown] >= SELF_TEST.WINDOW_MS)) {
        const obs = end(cues.current);
        attempts.current += 1;
        setResult({
          ...scoreSelfTest(cues.current, obs.blinkOnsets, obs),
          attempt: attempts.current,
          earlier: [...earlier.current],
        });
        setSeen({ obs, cues: [...cues.current], startedAt: t0 });
        setPhase('result');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const tryAgain = (r: SelfTestResult) => {
    earlier.current = [...earlier.current, attemptSummary(r)];
    setResult(null);
    setSeen(null);
    setCueCount(0);
    setPhase('running');
  };

  /*
   * The screen: the grey field, scrolling if the result is taller than the tablet. The content is
   * centred by an auto margin inside a scrolling box, not by justify-content, which would push the top
   * of a tall result (the verdict) above the scrollable area where it could not be reached.
   */
  const frame = (children: React.ReactNode) => (
    <div data-testid="camera-selftest" data-ground={SELF_TEST.GROUND} style={{
      // left: the column the researcher card takes when opened on the intro or the result (--vl-panel-dock).
      position: 'fixed', inset: 0, left: 'var(--vl-panel-dock, 0px)', background: SELF_TEST.GROUND, color: INK,
      display: 'flex', overflowY: 'auto', padding: '24px 32px',
    }}>
      <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', maxWidth: '100%' }}>
        {children}
      </div>
    </div>
  );
  const btn: React.CSSProperties = { padding: '14px 26px', borderRadius: 12, fontSize: 16, cursor: 'pointer', fontFamily: '"DM Mono", monospace' };
  const primary: React.CSSProperties = { ...btn, background: INK, color: '#ffffff', border: 'none' };
  const secondary: React.CSSProperties = { ...btn, background: 'transparent', color: INK, border: `1px solid ${INK}` };
  // Reasons and notes: one item each, with a bullet and a gap, so two reasons never read as one paragraph.
  const listStyle: React.CSSProperties = { listStyle: 'none', padding: 0, maxWidth: 760, margin: '6px 0 0', textAlign: 'left', lineHeight: 1.5 };
  const itemStyle: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 6 };

  if (phase === 'intro') {
    return frame(
      <>
        <h1 className="font-serif" style={{ fontSize: 34, fontWeight: 400 }}>Quick camera check</h1>
        {stoppedByRotation && (
          <p data-testid="selftest-stopped" className="font-sans" style={{ fontSize: 17, fontWeight: 500, maxWidth: 560, marginTop: 12, lineHeight: 1.55 }}>
            The check was stopped when the tablet turned to portrait, and nothing from it is kept.
            Start it again.
          </p>
        )}
        <p className="font-lab" style={{ fontSize: 17, maxWidth: 560, marginTop: 14, lineHeight: 1.6 }}>
          Look at the dot in the middle of the screen. Each time it flashes white, blink once — a normal,
          firm blink. It flashes {SELF_TEST.CUES} times and takes about {Math.round((SELF_TEST.FIRST_CUE_MS + SELF_TEST.CUES * SELF_TEST.CUE_EVERY_MS) / 1000)} seconds.
        </p>
        <button type="button" data-testid="selftest-start" onClick={() => { setStoppedByRotation(false); setPhase('running'); }}
          style={{ ...primary, marginTop: 26 }}>
          Start →
        </button>
      </>,
    );
  }

  if (phase === 'running') {
    return frame(
      <>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: flash ? '#ffffff' : INK, transform: flash ? 'scale(1.5)' : 'scale(1)', transition: 'transform 80ms, background 80ms' }} />
        <p className="font-lab" style={{ fontSize: 16, marginTop: 26 }}>
          Blink when the dot flashes · {cueCount} of {SELF_TEST.CUES}
        </p>
      </>,
    );
  }

  const r = result!;
  const num = (x: number | null | undefined) => (x == null ? '—' : String(Math.round(x)));
  const verdict = r.verdict ?? (r.pass ? 'working' : 'failed');
  const need = minHits(r.cued);
  const ex = r.pipeline?.camera_exposure_policy;
  return frame(
    <>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 400 }} data-testid="selftest-verdict" data-verdict={verdict}>
        {VERDICT_TEXT[verdict]}
      </h1>
      <p className="font-lab" data-testid="selftest-attempt" style={{ fontSize: 15, marginTop: 4 }}>
        Attempt {r.attempt ?? 1}{r.earlier?.length ? ` · earlier: ${r.earlier.map((a, i) => `${i + 1} ${a.verdict === 'failed' ? 'did not pass' : a.verdict}`).join(', ')}` : ''}
      </p>

      {/* The three criteria, each with the value measured and the value needed (rule st-r2). */}
      <ul data-testid="selftest-criteria" className="font-lab" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', fontSize: 16, lineHeight: 1.6, textAlign: 'left' }}>
        <Criterion ok={r.detected >= need} testid="selftest-crit-blinks">
          Blinks seen: {r.detected} of {r.cued} flashes (needs {need})
        </Criterion>
        <Criterion ok={r.facePresence != null && r.facePresence >= SELF_TEST.MIN_FACE} testid="selftest-crit-face">
          Face in view: {r.facePresence == null ? '—' : `${Math.round(r.facePresence * 100)}%`} of the time (needs {Math.round(SELF_TEST.MIN_FACE * 100)}%)
        </Criterion>
        <Criterion ok={r.tier === 'A' ? true : r.tier === 'B' ? 'reduced' : false} testid="selftest-crit-rate">
          {rateLine(r.samplingFps ?? null, r.tier ?? null)}
        </Criterion>
      </ul>

      {/* Each flash: a blink seen within 1.2 s, and when it began. */}
      <div data-testid="selftest-cues" className="font-lab" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10, fontSize: 15 }}>
        <span>Flashes:</span>
        {(r.cueLags ?? []).map((lag, i) => (
          <span key={i} data-seen={lag != null} style={{ padding: '3px 9px', borderRadius: 8, border: `1px solid ${INK}`, background: lag != null ? 'rgba(255,255,255,0.45)' : 'transparent' }}>
            {lag != null ? '✓' : '✗'} {i + 1} · {lag == null ? 'no blink seen' : lagText(lag)}
          </span>
        ))}
      </div>

      {seen && <SelfTestTrace obs={seen.obs} cues={seen.cues} startedAt={seen.startedAt} cueLags={r.cueLags ?? []} />}

      {/*
        The three stages behind the frame rate, so a low one says which stage is short (round 75): what
        the camera delivered, what the tracker processed and how long a frame took, which tracker ran,
        and the exposure in force. Shown on a pass as well — it is what the investigator reads off the
        tablet.
      */}
      {r.pipeline && (
        <p data-testid="selftest-pipeline" className="font-lab" style={{ fontSize: 14, marginTop: 8, maxWidth: 760, lineHeight: 1.5 }}>
          Camera delivered {num(r.pipeline.camera_fps_delivered)} fps
          {r.pipeline.camera_setting_width ? ` at ${r.pipeline.camera_setting_width}×${r.pipeline.camera_setting_height}` : ''} ·
          tracker processed {num(r.pipeline.tracker_fps)} fps, {num(r.pipeline.process_ms_p50)} ms a frame
          (95%: {num(r.pipeline.process_ms_p95)} ms) · {r.pipeline.tracker_backend ? (TRACKER_LABEL[r.pipeline.tracker_backend as TrackerBackend] ?? r.pipeline.tracker_backend) : '—'}
          {ex ? ` · ${ex === 'locked-v1' ? `exposure fixed${r.pipeline.camera_exposure_time_100us != null ? ` (${r.pipeline.camera_exposure_time_100us / 10} ms)` : ''}` : ex === 'compensated-v1' ? 'exposure compensated' : 'automatic exposure'}` : ''}
        </p>
      )}
      {!r.pass && (
        <ul data-testid="selftest-reasons" className="font-lab" style={{ ...listStyle, fontSize: 15 }}>
          {r.reasons.map((x) => <li key={x} style={itemStyle}><span aria-hidden>•</span><span>{x}</span></li>)}
        </ul>
      )}
      {r.pass && (r.notes?.length ?? 0) > 0 && (
        <ul data-testid="selftest-notes" className="font-lab" style={{ ...listStyle, fontSize: 15 }}>
          {r.notes!.map((x) => <li key={x} style={itemStyle}><span aria-hidden>•</span><span>{x}</span></li>)}
        </ul>
      )}
      <p className="font-lab" style={{ fontSize: 14, maxWidth: 760, marginTop: 8, lineHeight: 1.5 }}>
        Researcher: this checks that the camera sees this person&apos;s blinks. The result is recorded with the session, with any earlier attempts.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
        {r.pass ? (
          <>
            <button type="button" data-testid="selftest-continue" onClick={() => onDone(r)} style={primary}>
              Continue →
            </button>
            {verdict === 'reduced' && (
              <button type="button" data-testid="selftest-retry" onClick={() => tryAgain(r)} style={secondary}>
                Try again
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" data-testid="selftest-retry" onClick={() => tryAgain(r)} style={primary}>
              Try again
            </button>
            <button type="button" data-testid="selftest-continue-anyway" onClick={() => onDone(r)} style={secondary}>
              Continue anyway
            </button>
          </>
        )}
      </div>
    </>,
  );
}

/** The grey field's ink: black on #808080 is 5.3:1 (config.ts ADAPTATION_INK). */
const INK = CONFIG.ADAPTATION_INK;

const VERDICT_TEXT: Record<'working' | 'reduced' | 'failed', string> = {
  working: 'The camera is working',
  reduced: 'The camera is working, at a reduced frame rate',
  failed: 'The camera check did not pass',
};

/** How long after (or before) its flash a blink began, in seconds. */
export function lagText(lagMs: number): string {
  // Rounded half up in tenths first: toFixed alone reads 0.15 s (binary 0.1499…) as 0.1.
  const s = (Math.round(Math.abs(lagMs) / 100) / 10).toFixed(1);
  return lagMs < 0 ? `blink ${s} s before` : `blink ${s} s after`;
}

/** The rate criterion in words: the rate, its tier, and the floor that applies. */
export function rateLine(fps: number | null, tier: 'A' | 'B' | 'C' | null): string {
  if (fps == null || tier == null) return 'Eye sampled: no rate could be measured (no face seen for long enough)';
  const r = Math.round(fps);
  if (tier === 'A') return `Eye sampled ${r} times a second while the face was seen — adequate (${FPS_GATE.ADEQUATE} or more)`;
  if (tier === 'B') return `Eye sampled ${r} times a second — reduced (${FPS_GATE.REDUCED} to ${FPS_GATE.ADEQUATE}): passes, flagged`;
  return `Eye sampled ${r} times a second — too slow (needs ${FPS_GATE.REDUCED})`;
}

function Criterion({ ok, testid, children }: { ok: boolean | 'reduced'; testid: string; children: React.ReactNode }) {
  return (
    <li data-testid={testid} data-ok={String(ok)} style={{ display: 'flex', gap: 10 }}>
      <span aria-hidden style={{ width: 18, textAlign: 'center', fontWeight: 500 }}>{ok === true ? '✓' : ok === 'reduced' ? '!' : '✗'}</span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Where the trace's lines go, as SVG coordinates: the eye's openness as a fraction of this participant's
 * open-eye baseline, against time from the start of the check. A gap longer than the classifier's
 * shortest dropout (MIN_GAP_MS) breaks the line, so time without a face shows as a gap, not a slope.
 * Pure, for the test.
 */
export function traceGeometry(
  trace: ReadonlyArray<{ t_ms: number; ear: number }>,
  baseline: number,
  cues: number[],
  startedAt: number,
  w: number,
  h: number,
): { path: string; x: (t: number) => number; y: (ratio: number) => number; endMs: number } {
  const last = Math.max(trace.length ? trace[trace.length - 1].t_ms : startedAt, cues.length ? cues[cues.length - 1] + SELF_TEST.WINDOW_MS : startedAt);
  const span = Math.max(1, last - startedAt);
  const TOP = 1.2;
  const x = (t: number) => Math.round(((t - startedAt) / span) * w * 10) / 10;
  const y = (ratio: number) => Math.round((1 - Math.min(TOP, Math.max(0, ratio)) / TOP) * h * 10) / 10;
  let path = '';
  let prev: number | null = null;
  for (const s of trace) {
    if (s.t_ms < startedAt) continue;
    const pen = prev == null || s.t_ms - prev > MIN_GAP_MS ? 'M' : 'L';
    path += `${pen}${x(s.t_ms)} ${y(s.ear / baseline)} `;
    prev = s.t_ms;
  }
  return { path: path.trim(), x, y, endMs: last };
}

/**
 * The eye's openness through the check, with each flash, its ±1.2 s matching window, and the blink
 * matched to it. Drawn in the grey field's ink; nothing here is stored (the stored trace is 07c).
 */
function SelfTestTrace({ obs, cues, startedAt, cueLags }: {
  obs: SelfTestObservation; cues: number[]; startedAt: number; cueLags: Array<number | null>;
}) {
  if (obs.baseline == null || !(obs.baseline > 0) || obs.trace.length < 2) {
    return (
      <p data-testid="selftest-trace" data-empty="true" className="font-lab" style={{ fontSize: 14, marginTop: 10 }}>
        No eye-openness trace to show: {obs.baseline == null ? 'no open-eye baseline was measured' : 'the face was not found'}.
      </p>
    );
  }
  const W = 760;
  const H = 96;
  /** Room above the plot for each flash's number. */
  const TOP_PAD = 18;
  const g = traceGeometry(obs.trace, obs.baseline, cues, startedAt, W, H);
  const win = SELF_TEST.WINDOW_MS;
  return (
    <figure data-testid="selftest-trace" style={{ margin: '10px 0 0', width: W, maxWidth: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H + TOP_PAD}`} width="100%" role="img" aria-label="Eye openness through the check, with the five flashes marked" style={{ display: 'block' }}>
        {cues.map((c, i) => (
          <g key={i}>
            <rect x={g.x(c - win)} y={TOP_PAD} width={Math.max(0, g.x(c + win) - g.x(c - win))} height={H} fill="rgba(255,255,255,0.28)" />
            <line x1={g.x(c)} x2={g.x(c)} y1={TOP_PAD} y2={H + TOP_PAD} stroke={INK} strokeWidth={1} />
            <text x={g.x(c)} y={14} fontSize={14} textAnchor="middle" fill={INK}>{i + 1}{cueLags[i] != null ? ' ✓' : ' ✗'}</text>
            {cueLags[i] != null && <circle cx={g.x(c + cueLags[i]!)} cy={TOP_PAD + g.y(EAR_TIERS.partial)} r={3.5} fill={INK} />}
          </g>
        ))}
        <g transform={`translate(0 ${TOP_PAD})`}>
          <line x1={0} x2={W} y1={g.y(EAR_TIERS.partial)} y2={g.y(EAR_TIERS.partial)} stroke={INK} strokeWidth={1} strokeDasharray="5 4" />
          <line x1={0} x2={W} y1={g.y(EAR_TIERS.full)} y2={g.y(EAR_TIERS.full)} stroke={INK} strokeWidth={1} strokeDasharray="1 3" />
          <path d={g.path} fill="none" stroke={INK} strokeWidth={1.6} />
        </g>
      </svg>
      <figcaption className="font-lab" style={{ fontSize: 14, lineHeight: 1.45, marginTop: 4 }}>
        Eye openness (top = this person&apos;s open eye). Light bands: 1.2 s either side of each flash, where a blink counts.
        Dashed: the blink line; dotted: the complete-blink line; a dot marks where a counted blink began.
      </figcaption>
    </figure>
  );
}
