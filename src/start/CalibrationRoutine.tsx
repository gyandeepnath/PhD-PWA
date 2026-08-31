/**
 * 9-point gaze calibration routine (camera-active path). Shows a target at each of 9 screen
 * positions; the participant fixates and taps it, and the tracker samples iris offset during a
 * short dwell. After the last target, the fit is computed and a CalibrationRecord is stored.
 * If the fit is not separable, the run still proceeds but gaze metrics are flagged uncalibrated.
 */
import { useState } from 'react';
import { GAZE_TARGETS } from '@/tracking/gazeCalibration';

interface Props {
  sessionId: string;
  beginGazeCalibration: () => void;
  sampleGazeTarget: (targetId: string, ms: number) => Promise<void>;
  endGazeCalibration: (sessionId: string) => Promise<boolean>;
  onDone: () => void;
}

const DWELL_MS = 800;

export function CalibrationRoutine({ sessionId, beginGazeCalibration, sampleGazeTarget, endGazeCalibration, onDone }: Props) {
  const [idx, setIdx] = useState(-1); // -1 = intro, 0..8 targets, then done
  const [busy, setBusy] = useState(false);
  /** Calibration ran but produced no usable fit. */
  const [poorFit, setPoorFit] = useState(false);
  /** Calibration threw. Null while there is no error. */
  const [failure, setFailure] = useState<string | null>(null);

  const start = async () => {
    beginGazeCalibration();
    setPoorFit(false);
    setFailure(null);
    setBusy(true);
    for (let i = 0; i < GAZE_TARGETS.length; i++) {
      setIdx(i);
      await new Promise((r) => setTimeout(r, 250)); // let the participant find the target
      await sampleGazeTarget(GAZE_TARGETS[i].id, DWELL_MS);
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
    let ok = false;
    try {
      ok = await endGazeCalibration(sessionId);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!ok) { setFailure(null); setPoorFit(true); return; }
    onDone();
  };

  const t = idx >= 0 && !poorFit && failure == null ? GAZE_TARGETS[idx] : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a12', overflow: 'hidden' }}>
      {(poorFit || failure != null) && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center', padding: 24 }}>
          <h1 className="font-serif" style={{ fontSize: 28, fontWeight: 300 }}>Calibration did not succeed</h1>
          <p className="font-lab" style={{ fontSize: 14, color: '#f0d8c8', maxWidth: 520, marginTop: 12, lineHeight: 1.6 }}>
            {failure != null
              ? `Calibration failed: ${failure}`
              : 'Not enough targets were detected to fit this participant\u2019s gaze and open-eye baseline.'}
          </p>
          <p className="font-lab" style={{ fontSize: 14, color: '#c8d8f0', maxWidth: 520, marginTop: 12, lineHeight: 1.6 }}>
            Every blink threshold is a fraction of this participant\u2019s own open-eye baseline, so
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
      {idx === -1 && !poorFit && failure == null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center', padding: 24 }}>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300 }}>Eye calibration</h1>
          <p className="font-lab" style={{ fontSize: 14, color: '#c8d8f0', maxWidth: 460, marginTop: 12, lineHeight: 1.6 }}>
            A dot will appear at nine positions. Look directly at each dot and tap it. Keep your head
            still and only move your eyes.
          </p>
          <button onClick={start} disabled={busy} className="font-lab" style={{ marginTop: 24, background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 28px', fontSize: 14, cursor: 'pointer' }}>
            Begin calibration →
          </button>
        </div>
      )}
      {t && (
        <button
          aria-label={`target ${t.id}`}
          onClick={() => { /* tap is confirmation; sampling is time-based */ }}
          style={{
            position: 'absolute',
            left: `calc(${t.x * 100}% - 18px)`,
            top: `calc(${t.y * 100}% - 18px)`,
            width: 36, height: 36, borderRadius: '50%',
            background: '#4f8ef7', border: '3px solid #fff', cursor: 'pointer',
            boxShadow: '0 0 18px #4f8ef7',
          }}
        />
      )}
      {idx >= 0 && (
        <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', color: '#c8d8f0', fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
          {idx + 1} / {GAZE_TARGETS.length}
        </div>
      )}
    </div>
  );
}
