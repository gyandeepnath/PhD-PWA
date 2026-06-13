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

  const start = async () => {
    beginGazeCalibration();
    setBusy(true);
    for (let i = 0; i < GAZE_TARGETS.length; i++) {
      setIdx(i);
      await new Promise((r) => setTimeout(r, 250)); // let the participant find the target
      await sampleGazeTarget(GAZE_TARGETS[i].id, DWELL_MS);
    }
    await endGazeCalibration(sessionId);
    setBusy(false);
    onDone();
  };

  const t = idx >= 0 ? GAZE_TARGETS[idx] : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a12', overflow: 'hidden' }}>
      {idx === -1 && (
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
