/**
 * "The camera has stopped" / "The camera cannot see anything": the notice that stops a sitting when the
 * camera is lost or its picture goes black.
 *
 * ITS OWN FILE, UNDER THE OPERATOR TYPE RULES (audit 86 UI-3, UI-9). It was written inline in
 * Experiment.tsx, outside every size and font check, and set entirely in DM Mono; and the one sentence
 * that says what "Continue without the camera" costs — every remaining condition recorded with no eye
 * measurements — was 12 px in #8fa0c0, the smallest and faintest text on a blocking screen whose whole
 * job is that choice. Now: sentences and buttons in Roboto, nothing under 15 px, and the cost sits
 * directly under the two buttons, named after the button it belongs to. tests/contrast.test.ts holds the
 * file to the operator colours and the 14 px floor; tests/operatorType.test.ts to the face. The words
 * are the notice's own, unchanged but for that sentence's opening.
 */
import { UI_TEXT } from '@/lib/uiPalette';

/** The notice's colours: light ink on the app's dark ink ground, each at least 4.5:1 on it. */
export const CAMERA_NOTICE_COLOURS = {
  ground: UI_TEXT.ink,
  heading: '#ffffff',
  body: '#dbe6f7',
  researcher: '#c8d8f0',
} as const;

export function CameraLostNotice({ blocked, onSetup, pauseAfterFinished, rtSaving, onLeave, onContinueWithout }: {
  /** The picture is black (covered, or camera access switched off), not lost. */
  blocked: boolean;
  /** Raised on a set-up screen after camera set-up, where the way back is Exit, not Pause. */
  onSetup: boolean;
  /** The condition under way has finished: a resume goes on at the next one. */
  pauseAfterFinished: boolean;
  /** The reaction task's results are being saved. */
  rtSaving: boolean;
  /** Exit (set-up) or Pause (a display) and resume from the session manager. */
  onLeave: () => void;
  onContinueWithout: () => void;
}) {
  const c = CAMERA_NOTICE_COLOURS;
  const exitFromSetup = onSetup && !blocked;
  const p = { maxWidth: 560, marginTop: 14, lineHeight: 1.6 } as const;
  const button = { minHeight: 44, padding: '10px 20px', borderRadius: 10, cursor: 'pointer' } as const;
  return (
    <div
      data-testid="camera-lost"
      className="font-sans"
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: c.ground, color: c.heading, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 }}
    >
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300 }}>
        {blocked ? 'The camera cannot see anything' : 'The camera has stopped'}
      </h1>
      {blocked ? (
        <p data-testid="camera-blocked" style={{ ...p, fontSize: 17, color: c.body }}>
          The picture is black. The camera may be covered, or camera access may be switched off in
          the tablet&apos;s quick settings. Uncover it or switch camera access back on — this message
          closes by itself as soon as the picture returns.
        </p>
      ) : (
        <p style={{ ...p, fontSize: 17, color: c.body }}>
          Eye measurements are not being recorded. This happens when a call or another app takes the
          camera, or when the tablet sleeps or is put in the background.
        </p>
      )}
      {exitFromSetup ? (
        <p style={{ ...p, maxWidth: 540, marginTop: 10, fontSize: 15, color: c.researcher }}>
          <strong>Researcher:</strong> exit and resume from the session manager. The camera is set up and
          calibrated again, and the sitting continues at the first set-up screen not yet completed.
        </p>
      ) : (
        <p style={{ ...p, maxWidth: 540, marginTop: 10, fontSize: 15, color: c.researcher }}>
          <strong>Researcher:</strong> pause and resume from the session manager. The camera is set up and
          calibrated again, and {pauseAfterFinished
            ? 'the session continues at the next condition'
            : rtSaving
              ? 'the session continues at the next condition once this one\'s results have saved (if they do not, this condition starts again)'
              : 'this condition starts again'}.
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* From a set-up screen no resume pointer is written: the resume re-derives where to start
            from what is stored (Experiment.tsx exitSitting; see onOperatorChip). */}
        <button onClick={onLeave} className="font-sans text-[15px] font-medium"
          style={{ ...button, border: '1px solid #fff', background: '#fff', color: c.ground }}>
          {exitFromSetup ? 'Exit — resume later (camera set up again)' : 'Pause and restart the camera'}
        </button>
        <button onClick={onContinueWithout} className="font-sans text-[15px]"
          style={{ ...button, border: `1px solid ${c.researcher}`, background: 'transparent', color: c.researcher }}>
          Continue without the camera
        </button>
      </div>
      {/* The cost of the second button, under the buttons and at the researcher line's size and colour. */}
      <p data-testid="camera-lost-cost" style={{ ...p, maxWidth: 540, fontSize: 15, color: c.researcher }}>
        {blocked
          ? 'Continue without the camera: the time the picture stays black is recorded against this condition (camera_blocked_ms).'
          : onSetup
            ? 'Continue without the camera: the calibration is skipped and every condition is recorded with no eye measurements, marked as camera lost.'
            : 'Continue without the camera: every remaining condition is recorded with no eye measurements, marked as camera lost.'}
      </p>
    </div>
  );
}
