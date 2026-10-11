/**
 * Camera calibration routine (camera-active path), rules cal-r2 and gaze-r2 (Round 80).
 *
 * Two steps, in this order, driven by calibrationSequence(), both on the grey field in its black ink:
 *
 *   1. OPEN-EYE BASELINE. A centre dot; the participant looks at it and blinks normally. This is the
 *      only window the EAR baseline is fitted from, and it is first because the posture it measures —
 *      looking straight at the screen — is the posture the reading task is performed in. It runs at
 *      least 6 s, then on until 30 usable frames, at most 12 s (cal-r2), and says while it runs whether
 *      the eyes are found, whether they are being measured steadily, and when it is done.
 *
 *   2. GAZE CHECK. Three dots across a mid-height reading line — its middle and its two ends. Each is
 *      shown 0.5 s to settle and sampled 1 s; a dot that collects too few open-eye frames is shown
 *      again on its own (up to 3 times in all). A tick per dot. The fit gives the on-screen range
 *      (gazeCalibration.ts): a QUALITY CHECK, not an outcome.
 *
 * Each step fails on its own, says why, and is repeated on its own:
 *   - no baseline: the screen names the reason (no frames, no face, the eyes not measured, too few
 *     frames) with its evidence. "Try the eye baseline again" repeats that step (and then the gaze
 *     check); "Continue without blink measures" is a separate, deliberate button, because a
 *     participant who is already in the room and cannot be calibrated still yields every non-ocular
 *     measure;
 *   - gaze check incomplete: a calm notice — it affects only the quality index, and blinks are
 *     measured normally. "Repeat the gaze check" repeats the three dots alone; "Continue" goes on.
 *
 * It used to be nine tap targets on a dark ground, judged against an assumed 30 fps, with one bar for
 * both axes and a failure screen that said the primary outcome would be empty when only the gaze fit
 * had failed (Round 78 research report R2, C1). See gazeCalibration.ts and calibrationSequence.ts.
 */
import { useEffect, useRef, useState } from 'react';
import {
  calibrationSequence, CALIBRATION_GROUND, CALIBRATION_INK, GAZE_DOTS, STEP_SETTLE_MS,
  type BaselineProgress, type BaselineResult, type EarBaselineStep, type EyeState, type GazeDotStep,
} from '@/tracking/calibrationSequence';
import type { GazeDotId } from '@/tracking/gazeCalibration';
import type { CalibrationOutcome, GazeDotResult } from '@/tracking/useTracking';
import { InfoTip } from '@/components/InfoTip';

interface Props {
  sessionId: string;
  measureEarBaseline: (step: Pick<EarBaselineStep, 'ms' | 'maxMs' | 'minSamples'>, onProgress?: (p: BaselineProgress) => void) => Promise<BaselineResult>;
  beginGazeCalibration: () => void;
  sampleGazeTarget: (dot: GazeDotId, ms: number, onProgress?: (p: { eyes: EyeState; steady: boolean }) => void) => Promise<GazeDotResult>;
  endGazeCalibration: (sessionId: string, opts?: { gazeRun?: boolean; baselineAttempts?: number }) => Promise<CalibrationOutcome>;
  onDone: () => void;
  /**
   * True from "Begin calibration" until the result is reported. The operator's Exit chip is withheld
   * meanwhile: it would sit in the top-left corner, near where a gaze dot appears, and leaving
   * mid-calibration is a restart anyway (experiment/navigation.ts).
   */
  onRunning?: (running: boolean) => void;
  /**
   * The tablet is in portrait. A run in progress is STOPPED and its samples are discarded.
   *
   * It used to carry on under the portrait block, a fixed loop with no orientation check, and finish
   * on its own: the stored calibration row — the open-eye baseline every blink threshold is a
   * fraction of, and the gaze mapping — could be taken wholly or partly in portrait, where the camera
   * sits on the short edge and the landmark frame is turned 90 degrees, and nothing recorded that.
   * The block meanwhile told the operator "Nothing is lost". Now the run stops, the screen returns to
   * its start and says why, and the calibration is begun again in landscape.
   */
  halted?: boolean;
}

type Phase =
  | { kind: 'intro' }
  | { kind: 'baseline'; progress: BaselineProgress | null }
  | { kind: 'gaze'; dot: GazeDotId; attempt: number; sampling: boolean; eyes: EyeState | null }
  | { kind: 'no_baseline'; result: BaselineResult }
  | { kind: 'gaze_incomplete'; outcome: CalibrationOutcome }
  | { kind: 'error'; message: string };

/** Each dot's state on the tick row: not yet shown, being shown, collected enough, or short after its retries. */
type DotMark = 'todo' | 'now' | 'done' | 'short';

const INK = CALIBRATION_INK;
const DOT_LABEL: Record<GazeDotId, string> = { centre: 'middle', left: 'left', right: 'right' };

const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`;

/** Why the baseline window gave no baseline, in a sentence the operator can act on, with its evidence. */
export function baselineReasonText(r: BaselineResult, needed: number): string {
  const facePct = r.frames > 0 ? Math.round((100 * r.faceFrames) / r.frames) : 0;
  switch (r.reason) {
    case 'no_frames':
      return `The tracker produced no frames in the ${secs(r.ms)} window. The camera or the tracker stopped: check the picture in the researcher card.`;
    case 'no_face':
      return `A face was found in only ${facePct}% of the ${r.frames} frames in ${secs(r.ms)}. Check the seating and framing: the whole face in the picture, at about 55 cm.`;
    case 'eyes_not_measured':
      return `A face was found, but the eyes could be measured in only ${r.usable} of its ${r.faceFrames} frames. Usually glare (spectacles, a window or a lamp behind the tablet), or the eyes half-closed.`;
    case 'too_few_frames':
      return `Only ${r.usable} usable frames in ${secs(r.ms)}; the baseline needs ${needed}. The camera delivered too few frames: more light on the face, and close other apps.`;
    default:
      return `No baseline could be fitted (${r.usable} usable frames; ${needed} needed).`;
  }
}

/** Why the gaze check fell short, in a sentence. */
export function gazeReasonText(o: CalibrationOutcome): string {
  const g = o.gaze;
  if (!g) return 'The gaze check was not run.';
  if (g.reason === 'too_few_samples') {
    const dots = g.shortDots.map((d) => DOT_LABEL[d]).join(' and ');
    return `The eyes were not found often enough at the ${dots} dot${g.shortDots.length === 1 ? '' : 's'}, even after showing ${g.shortDots.length === 1 ? 'it' : 'them'} again.`;
  }
  return 'The eyes did not move far enough between the dots to tell the left end of the line from the right. Ask the participant to keep the head still and move only the eyes.';
}

/** The live state of the step in words: eyes found, steady, done. */
function eyesText(eyes: EyeState | null, steady: boolean): string {
  if (eyes === 'found') return steady ? 'Eyes found · steady' : 'Eyes found · hold still';
  if (eyes === 'face_only') return 'Face found · the eyes are not clear yet';
  return 'Looking for the eyes…';
}

export function CalibrationRoutine({ sessionId, measureEarBaseline, beginGazeCalibration, sampleGazeTarget, endGazeCalibration, onDone, onRunning, halted = false }: Props) {
  const STEPS = calibrationSequence();
  const baselineStep = STEPS.find((s): s is EarBaselineStep => s.kind === 'ear_baseline')!;
  const dotSteps = STEPS.filter((s): s is GazeDotStep => s.kind === 'gaze_dot');
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [busy, setBusy] = useState(false);
  const [marks, setMarks] = useState<Record<GazeDotId, DotMark>>({ centre: 'todo', left: 'todo', right: 'todo' });
  /** How many times the baseline window has run since Begin; recorded with the calibration. */
  const baselineAttempts = useRef(0);

  /*
   * The routine is async and outlives its screen if the screen is replaced mid-run — the camera being
   * lost swaps this component for the plain calibration screen. It then went on to call onDone when
   * its interrupted fit finished, and if the operator had already continued from the replacement
   * screen, that was a SECOND advance: a fresh sitting skipped the baseline CVS-Q, and a resume
   * jumped past the grey field. An unmounted routine reports nothing.
   */
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { onRunning?.(busy); }, [busy, onRunning]);
  useEffect(() => () => onRunning?.(false), [onRunning]);

  /*
   * Which run is current. A run checks after every step that it still is, and stops when it is not —
   * which is how a rotation to portrait ends it (see `halted`). It stops at the end of the step in
   * hand, not in the middle of it: the tracker is still filling that step's window, and a new run
   * begun before it closes would share it. So `busy` stays set — Begin disabled, Exit withheld — until
   * the stopped run has actually let go of the tracker.
   */
  const run = useRef(0);
  /** A step is sampling: the part a rotation invalidates. The fit after it is not. */
  const sampling = useRef(false);
  /** A run was stopped by a rotation; said on the start screen, which is where it begins again. */
  const [stoppedByRotation, setStoppedByRotation] = useState(false);
  useEffect(() => {
    if (!halted || !sampling.current) return;
    sampling.current = false;
    run.current += 1;
    setStoppedByRotation(true);
  }, [halted]);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Run the gaze check's three dots, then write the record and report. `mine` is the run it belongs to. */
  const gazeCheck = async (mine: number): Promise<void> => {
    const current = () => mounted.current && run.current === mine;
    const abandon = () => { if (mounted.current) { setPhase({ kind: 'intro' }); setBusy(false); } };
    beginGazeCalibration();
    setMarks({ centre: 'todo', left: 'todo', right: 'todo' });
    for (const d of dotSteps) {
      let enough = false;
      for (let attempt = 1; attempt <= d.attempts && !enough; attempt++) {
        setMarks((m) => ({ ...m, [d.id]: 'now' }));
        setPhase({ kind: 'gaze', dot: d.id, attempt, sampling: false, eyes: null });
        await wait(d.settleMs); // the eye arrives at the dot; these frames are not kept
        if (!current()) { abandon(); return; }
        setPhase({ kind: 'gaze', dot: d.id, attempt, sampling: true, eyes: null });
        const r = await sampleGazeTarget(d.id, d.ms, (p) => {
          if (mounted.current && run.current === mine) setPhase({ kind: 'gaze', dot: d.id, attempt, sampling: true, eyes: p.eyes });
        });
        if (!current()) { abandon(); return; }
        enough = r.enough;
      }
      setMarks((m) => ({ ...m, [d.id]: enough ? 'done' : 'short' }));
    }
    sampling.current = false;
    await finish({ gazeRun: true });
  };

  /**
   * Write the calibration record and report. The result of calibration is REPORTED, not discarded: a
   * rejection used to strand the operator on the last target with no control at all, and a missing
   * baseline was learned of only at export. Every completed attempt writes its record — a missing
   * baseline too, with its reason — so 01 calibration_runs counts the attempts and the last record
   * is the one the sitting went on with.
   */
  const finish = async (opts: { gazeRun: boolean }): Promise<CalibrationOutcome | null> => {
    if (!mounted.current) return null;
    let outcome: CalibrationOutcome;
    try {
      outcome = await endGazeCalibration(sessionId, { ...opts, baselineAttempts: baselineAttempts.current });
    } catch (err) {
      if (!mounted.current) return null;
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      setBusy(false);
      return null;
    }
    if (!mounted.current) return null;
    setBusy(false);
    if (!opts.gazeRun) return outcome;
    /*
     * A gaze check that fell short is a NOTICE, not a failure screen. It affects only the on-screen
     * ratio, a quality index; the baseline was measured and every blink is counted. The red screen
     * used to say the ocular measures "including the primary outcome" would be empty here (R2, C1.6).
     */
    if (!outcome.gazeValid) { setPhase({ kind: 'gaze_incomplete', outcome }); return outcome; }
    onDone();
    return outcome;
  };

  /** The baseline window, then the gaze check. A retry from the no-baseline screen starts here too. */
  const start = async () => {
    const mine = ++run.current;
    const current = () => mounted.current && run.current === mine;
    // A stopped run hands back to the start screen only once its last step has closed.
    const abandon = () => { if (mounted.current) { setPhase({ kind: 'intro' }); setBusy(false); } };
    setStoppedByRotation(false);
    setBusy(true);
    sampling.current = true;
    setPhase({ kind: 'baseline', progress: null });
    await wait(STEP_SETTLE_MS); // let the participant settle on the dot that just appeared
    if (!current()) { abandon(); return; }
    baselineAttempts.current += 1;
    const result = await measureEarBaseline(baselineStep, (p) => {
      if (mounted.current && run.current === mine) setPhase({ kind: 'baseline', progress: p });
    });
    if (!mounted.current) return;
    if (!current()) { abandon(); return; }
    if (result.baseline == null) {
      // Stop here and say why: no point asking the eyes to move when they could not be measured still.
      // The attempt is recorded (no baseline, its reason, the gaze check not run) before it is shown.
      sampling.current = false;
      if (await finish({ gazeRun: false }) == null) return;
      setPhase({ kind: 'no_baseline', result });
      return;
    }
    await gazeCheck(mine);
  };

  /** Repeat only the three dots, keeping the baseline already measured. */
  const repeatGaze = async () => {
    const mine = ++run.current;
    setStoppedByRotation(false);
    setBusy(true);
    sampling.current = true;
    await gazeCheck(mine);
  };


  const beginAgain = () => { baselineAttempts.current = 0; void start(); };

  // ---- the screen ----
  const btn: React.CSSProperties = { padding: '14px 28px', borderRadius: 12, fontSize: 16, cursor: 'pointer' };
  const primary: React.CSSProperties = { ...btn, background: INK, color: '#ffffff', border: 'none' };
  const secondary: React.CSSProperties = { ...btn, background: 'transparent', color: INK, border: `1px solid ${INK}` };
  const centred: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, overflowY: 'auto' };
  const para: React.CSSProperties = { fontSize: 17, maxWidth: 680, marginTop: 12, lineHeight: 1.6 };
  /** The fixation dot: black on the grey field, with a white ring so its edge is crisp. */
  const dotStyle = (size: number): React.CSSProperties => ({ width: size, height: size, borderRadius: '50%', background: INK, border: '3px solid #ffffff', boxSizing: 'content-box' });

  const showIntro = phase.kind === 'intro' || stoppedByRotation;

  return (
    // Leaves the column the researcher card takes when the operator opens it on the intro or result
    // (--vl-panel-dock, ResearcherPanel.tsx); the dots themselves run with the card locked shut.
    <div data-testid="calibration-routine" data-ground={CALIBRATION_GROUND} data-phase={showIntro ? 'intro' : phase.kind}
      style={{ position: 'fixed', inset: 0, left: 'var(--vl-panel-dock, 0px)', background: CALIBRATION_GROUND, color: INK, overflow: 'hidden' }}>
      {showIntro && (
        <div style={centred}>
          <h1 className="font-serif" style={{ fontSize: 34, fontWeight: 400, display: 'flex', alignItems: 'center', gap: 10 }}>
            Eye calibration
            <InfoTip label="eye calibration">
              Two steps on the grey field. The centre dot measures how open this participant&apos;s eyes
              are at rest: at least 6 seconds, longer if the eyes are not found steadily, at most 12.
              Every blink line is a fraction of it. The three dots then check where the eyes point at the
              two ends of a line of text, for the on-screen ratio — a quality check only. A step that
              falls short says why, and can be repeated on its own.
            </InfoTip>
          </h1>
          {stoppedByRotation && (
            <p data-testid="calibration-stopped" className="font-sans" style={{ fontSize: 17, fontWeight: 500, maxWidth: 600, marginTop: 12, lineHeight: 1.55 }}>
              The calibration was stopped when the tablet turned to portrait, and nothing from it is kept.
              Begin it again from the start.
            </p>
          )}
          <p className="font-lab" style={{ ...para, maxWidth: 600 }}>
            First, look at the dot in the middle of the screen and blink as you normally would. Then the
            dot moves along a line: the middle, the left end, the right end. Look at it each time — you do
            not need to touch it. Keep your head still and move only your eyes.
          </p>
          <button onClick={beginAgain} disabled={busy} data-testid="calibration-begin" className="font-lab" style={{ ...primary, marginTop: 24, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Stopping…' : 'Begin calibration →'}
          </button>
        </div>
      )}

      {!showIntro && phase.kind === 'baseline' && (
        <div style={{ ...centred, padding: 0 }}>
          {/* A fixation dot, not a tap target: this window measures the eye at rest, looking straight
              ahead. Nothing is asked of the participant except to look and to blink normally. */}
          <div data-testid="calibration-fixation" style={dotStyle(18)} />
          <BaselineStatus progress={phase.progress} />
        </div>
      )}

      {!showIntro && phase.kind === 'gaze' && (
        <>
          <div
            data-testid="calibration-gaze-dot"
            data-dot={phase.dot}
            aria-label={`gaze dot ${phase.dot}`}
            style={{
              ...dotStyle(22), position: 'absolute', top: 'calc(50% - 14px)',
              left: `calc(50% + ${GAZE_DOTS.find((d) => d.id === phase.dot)!.dx}px - 14px)`,
            }}
          />
          {phase.attempt > 1 && (
            <p className="font-lab" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(50% + 34px)', textAlign: 'center', fontSize: 15 }}>
              Once more — look at the dot
            </p>
          )}
        </>
      )}

      {/* Drawn while the participant looks at the dots, at the foot of the screen: the tick per dot. It
          stays on the gaze-check notice, where it shows which dot fell short. */}
      {!showIntro && (phase.kind === 'gaze' || phase.kind === 'baseline' || phase.kind === 'gaze_incomplete') && (
        <div data-testid="calibration-steps" style={{ position: 'absolute', bottom: 18, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 16, fontFamily: '"DM Mono", monospace', fontSize: 14 }}>
          <span data-testid="calibration-step-baseline" data-state={phase.kind === 'baseline' ? 'now' : 'done'}>
            {phase.kind === 'baseline' ? '●' : '✓'} centre, eyes at rest
          </span>
          {dotSteps.map((d) => (
            <span key={d.id} data-testid={`calibration-step-${d.id}`} data-state={marks[d.id]}>
              {marks[d.id] === 'done' ? '✓' : marks[d.id] === 'short' ? '✗' : marks[d.id] === 'now' ? '●' : '○'} {DOT_LABEL[d.id]}
            </span>
          ))}
        </div>
      )}

      {!showIntro && phase.kind === 'no_baseline' && (
        <div style={centred} data-testid="calibration-no-baseline" data-reason={phase.result.reason ?? ''}>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 400 }}>No eye baseline</h1>
          <p className="font-lab" data-testid="calibration-reason" style={{ ...para, fontWeight: 500 }}>
            {baselineReasonText(phase.result, baselineStep.minSamples)}
          </p>
          <p className="font-lab" style={para}>
            Every blink line is a fraction of this baseline, so without it no blink is counted in this
            sitting — the primary outcome included. Fix the cause and try again. Continuing without it
            is allowed, but it must be a deliberate choice.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => { void start(); }} disabled={busy} className="font-lab" data-testid="calibration-retry" style={primary}>
              Try the eye baseline again →
            </button>
            <button onClick={onDone} disabled={busy} className="font-lab" data-testid="calibration-continue-anyway" style={secondary}>
              Continue without blink measures
            </button>
          </div>
        </div>
      )}

      {!showIntro && phase.kind === 'gaze_incomplete' && (
        <div style={centred} data-testid="calibration-gaze-incomplete" data-reason={phase.outcome.gaze?.reason ?? ''}>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 400 }}>Gaze check incomplete</h1>
          <p className="font-lab" data-testid="calibration-reason" style={{ ...para, fontWeight: 500 }}>{gazeReasonText(phase.outcome)}</p>
          <p className="font-lab" style={para}>
            This affects only a quality index (the on-screen ratio). The eye baseline was measured, and
            blinks are measured normally.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => { void repeatGaze(); }} disabled={busy} className="font-lab" data-testid="calibration-retry-thin" style={primary}>
              Repeat the gaze check →
            </button>
            <button onClick={onDone} disabled={busy} className="font-lab" data-testid="calibration-accept-thin" style={secondary}>
              Continue
            </button>
          </div>
        </div>
      )}

      {!showIntro && phase.kind === 'error' && (
        <div style={centred}>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 400 }}>Calibration could not be saved</h1>
          <p className="font-lab" style={para}>Calibration failed: {phase.message}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={beginAgain} className="font-lab" data-testid="calibration-retry" style={primary}>Try calibration again →</button>
            <button onClick={onDone} className="font-lab" data-testid="calibration-continue-anyway" style={secondary}>Continue without blink measures</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Under the centre dot while the baseline window runs: eyes found, steady, done — and the frames so
 * far. Small and close under the dot, so reading it does not move the eye far from where it is measured.
 */
function BaselineStatus({ progress: p }: { progress: BaselineProgress | null }) {
  const timeShare = p ? Math.min(1, p.elapsedMs / p.minMs) : 0;
  const framesShare = p ? Math.min(1, p.usable / p.needed) : 0;
  return (
    <div data-testid="calibration-baseline-status" data-eyes={p?.eyes ?? 'searching'} data-steady={p?.steady ? 'true' : 'false'}
      className="font-lab" style={{ marginTop: 22, fontSize: 15, lineHeight: 1.5, textAlign: 'center' }}>
      <div>Look at the dot and blink normally.</div>
      <div data-testid="calibration-eyes" style={{ fontWeight: 600, marginTop: 4 }}>{eyesText(p?.eyes ?? null, p?.steady ?? false)}</div>
      <div style={{ width: 220, height: 5, margin: '8px auto 0', background: 'rgba(0,0,0,0.22)', borderRadius: 3 }}>
        <div style={{ width: `${Math.round(100 * Math.min(timeShare, framesShare))}%`, height: '100%', background: '#000000', borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 14, marginTop: 4 }}>
        {p ? `${p.usable} usable frames (needs ${p.needed}) · ${Math.floor(p.elapsedMs / 1000)} of at least ${Math.round(p.minMs / 1000)} s` : 'Starting…'}
      </div>
    </div>
  );
}
