/**
 * Camera calibration routine (camera-active path).
 *
 * Two windows, in this order, driven by calibrationSequence():
 *
 *   1. OPEN-EYE BASELINE. A centre fixation dot, six seconds, participant blinking normally. This
 *      is the only window the EAR baseline is fitted from, and it is first because the posture it
 *      measures — looking straight at the screen — is the posture the reading task is performed in.
 *      It used to be taken from the nine-point frames below, a third of which are spent looking up
 *      at the top row of targets with the lid raised and the fissure wide; the baseline is a 90th
 *      percentile, so it settled on exactly those frames, and both blink thresholds are fractions
 *      of it. See calibrationSequence.ts for what that did to the primary outcome.
 *
 *   2. NINE-POINT GAZE. A target at each of 9 screen positions; the participant fixates and taps,
 *      and the tracker samples iris offset during a short dwell. The fit is computed after the last
 *      target and a CalibrationRecord is stored.
 *
 * Either half can fail on its own and the screen says which. Continuing anyway remains available,
 * because a participant who is already in the room and cannot be calibrated still yields every
 * non-ocular measure — but it has to be a deliberate choice, so it is a separate button.
 */
import { useState } from 'react';
import { calibrationSequence, type CalibrationStep } from '@/tracking/calibrationSequence';
import type { CalibrationOutcome } from '@/tracking/useTracking';

interface Props {
  sessionId: string;
  measureEarBaseline: (ms: number) => Promise<{ baseline: number | null; usable: number }>;
  beginGazeCalibration: () => void;
  sampleGazeTarget: (targetId: string, ms: number) => Promise<void>;
  endGazeCalibration: (sessionId: string) => Promise<CalibrationOutcome>;
  onDone: () => void;
}

export function CalibrationRoutine({ sessionId, measureEarBaseline, beginGazeCalibration, sampleGazeTarget, endGazeCalibration, onDone }: Props) {
  const STEPS = calibrationSequence();
  /** -1 = intro; otherwise the index into STEPS currently running. */
  const [idx, setIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  /** Calibration ran but produced no usable fit. Null while there is nothing to report. */
  const [poorFit, setPoorFit] = useState<CalibrationOutcome | null>(null);
  /** Calibration threw. Null while there is no error. */
  const [failure, setFailure] = useState<string | null>(null);

  const start = async () => {
    setPoorFit(null);
    setFailure(null);
    setBusy(true);
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      setIdx(i);
      await new Promise((r) => setTimeout(r, 250)); // let the participant settle on what just appeared
      if (step.kind === 'ear_baseline') {
        await measureEarBaseline(step.ms);
        beginGazeCalibration();
      } else {
        await sampleGazeTarget(step.id, step.ms);
      }
    }
    /**
     * The result of calibration is REPORTED, not discarded.
     *
     * The return value was thrown away and the routine advanced regardless. Every blink threshold
     * in the study is a fraction of this participant's own open-eye EAR baseline, so a calibration
     * that produced no baseline means the primary outcome is null for the entire sitting — and the
     * operator learned that only at export, if at all, by which time the participant has gone home.
     * A rejection was worse: the promise never resolved, onDone never fired, and the operator was
     * stranded on a 9/9 target screen with no control at all.
     */
    let outcome: CalibrationOutcome;
    try {
      outcome = await endGazeCalibration(sessionId);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    /*
     * BOTH halves must succeed, and the missing one must be named.
     *
     * This used to branch on a single boolean that carried the GAZE verdict alone, while the copy
     * below already told the operator that continuing without an open-eye baseline empties the
     * primary outcome. So the one failure the screen exists to prevent was the one it could not
     * detect: a clean nine-of-nine gaze fit with no EAR baseline advanced silently.
     */
    if (!outcome.gazeValid || outcome.earBaseline == null) { setFailure(null); setPoorFit(outcome); return; }
    onDone();
  };

  const step: CalibrationStep | null = idx >= 0 && poorFit == null && failure == null ? STEPS[idx] : null;
  const target = step?.kind === 'gaze_target' ? step : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a12', overflow: 'hidden' }}>
      {(poorFit != null || failure != null) && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center', padding: 24 }}>
          <h1 className="font-serif" style={{ fontSize: 28, fontWeight: 300 }}>Calibration did not succeed</h1>
          <p className="font-lab" style={{ fontSize: 14, color: '#f0d8c8', maxWidth: 520, marginTop: 12, lineHeight: 1.6 }}>
            {failure != null
              ? `Calibration failed: ${failure}`
              : poorFit != null && poorFit.earBaseline == null && poorFit.gazeValid
                ? `The gaze mapping fitted, but no open-eye baseline could be measured `
                  + `(${poorFit.earSamplesUsable} usable frames). This is usually glare on the lid `
                  + `margin \u2014 spectacles, a window or a lamp behind the tablet.`
                : poorFit != null && poorFit.earBaseline != null
                  ? 'The open-eye baseline was measured, but not enough targets were detected to fit '
                    + 'this participant\u2019s gaze.'
                  : 'Not enough targets were detected to fit this participant\u2019s gaze and open-eye baseline.'}
          </p>
          <p className="font-lab" style={{ fontSize: 14, color: '#c8d8f0', maxWidth: 520, marginTop: 12, lineHeight: 1.6 }}>
            Every blink threshold is a fraction of this participant’s own open-eye baseline, so
            continuing without one means the ocular measures — including the primary outcome — will
            be empty for this whole sitting. Check the lighting, the distance and that the face is
            not backlit, then try again. Continuing anyway is a valid choice; it must be a deliberate
            one.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={start} className="font-lab" data-testid="calibration-retry" style={{ background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 28px', fontSize: 14, cursor: 'pointer' }}>
              Try calibration again →
            </button>
            <button onClick={onDone} className="font-lab" data-testid="calibration-continue-anyway" style={{ background: 'transparent', color: '#c8d8f0', border: '1px solid #46506a', borderRadius: 12, padding: '14px 28px', fontSize: 14, cursor: 'pointer' }}>
              Continue without ocular measures
            </button>
          </div>
        </div>
      )}
      {idx === -1 && poorFit == null && failure == null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center', padding: 24 }}>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300 }}>Eye calibration</h1>
          <p className="font-lab" style={{ fontSize: 14, color: '#c8d8f0', maxWidth: 460, marginTop: 12, lineHeight: 1.6 }}>
            First, a dot in the centre of the screen: look straight at it and blink as you normally
            would. Then the dot will appear at nine positions in turn — look directly at each one
            and tap it. Keep your head still throughout and move only your eyes.
          </p>
          <button onClick={start} disabled={busy} className="font-lab" style={{ marginTop: 24, background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 28px', fontSize: 14, cursor: 'pointer' }}>
            Begin calibration →
          </button>
        </div>
      )}
      {step?.kind === 'ear_baseline' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {/* A fixation dot, not a tap target: this window measures the eye at rest, looking straight
              ahead. Nothing is asked of the participant except to look and to blink normally. */}
          <div
            data-testid="calibration-fixation"
            style={{ width: 18, height: 18, borderRadius: '50%', background: '#4f8ef7', border: '3px solid #fff', boxShadow: '0 0 18px #4f8ef7' }}
          />
          <p className="font-lab" style={{ fontSize: 14, color: '#c8d8f0', maxWidth: 420, marginTop: 28, lineHeight: 1.6, textAlign: 'center' }}>
            Look at the dot and blink normally.
          </p>
        </div>
      )}
      {target && (
        <button
          aria-label={`target ${target.id}`}
          onClick={() => { /* tap is confirmation; sampling is time-based */ }}
          style={{
            position: 'absolute',
            left: `calc(${target.x * 100}% - 18px)`,
            top: `calc(${target.y * 100}% - 18px)`,
            width: 36, height: 36, borderRadius: '50%',
            background: '#4f8ef7', border: '3px solid #fff', cursor: 'pointer',
            boxShadow: '0 0 18px #4f8ef7',
          }}
        />
      )}
      {idx >= 0 && step != null && (
        <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', color: '#c8d8f0', fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
          {idx + 1} / {STEPS.length}
        </div>
      )}
    </div>
  );
}
