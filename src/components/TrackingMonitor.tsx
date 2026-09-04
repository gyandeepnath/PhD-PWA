import { useEffect, useState } from 'react';
import type { LiveTrackingStats } from '@/tracking/useTracking';

/**
 * A live readout of the tracker, for the operator, in a corner.
 *
 * Until now the only confirmation that tracking worked was the face box at camera setup. After that
 * the operator ran ninety minutes on trust. Every way tracking can fail mid-session is silent: the
 * participant leans out of frame, the room dims below detection, the frame rate collapses under
 * thermal throttling. None of it surfaces until the export is opened, by which point the sitting
 * cannot be repeated.
 *
 * What it shows is chosen so a glance answers "is the primary outcome being collected?":
 *
 *   - the blink count, which IS the primary outcome accumulating, and which must keep climbing;
 *   - the incomplete count within it, the numerator of the outcome itself;
 *   - whether a face is currently detected at all;
 *   - the achieved frame rate, because the incomplete/complete distinction has a sampling floor
 *     below which the ratio is not measurable;
 *   - eye openness against the participant's own calibrated baseline, which shows the signal is
 *     live rather than merely present.
 *
 * DESIGN CONSTRAINTS, because this sits on screen during a measured task:
 *
 *   - It never overlaps the stimulus: pinned to a corner, small, and translucent.
 *   - It is `pointer-events: none`, so it cannot intercept a tap meant for the reaction task.
 *   - It does NOT render during reading. A moving number in peripheral vision is a competing
 *     stimulus, and reading is where the blink data actually comes from — an operator aid that
 *     changed reading behaviour would corrupt the very measurement it is there to protect.
 *   - Nulls render as "—", never as 0. A blink count of zero and a blink count that cannot be
 *     computed are completely different situations for the operator.
 */
export function TrackingMonitor({
  subscribe,
  visible,
  fpsFloor,
}: {
  subscribe: (fn: (s: LiveTrackingStats) => void) => () => void;
  /** False during reading and any other screen where a changing number would be a distractor. */
  visible: boolean;
  /** Below this achieved frame rate the incomplete-blink ratio is not reliably measurable. */
  fpsFloor: number;
}) {
  const [s, setS] = useState<LiveTrackingStats | null>(null);
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(() => 0);

  useEffect(() => {
    if (!visible) return;
    return subscribe((next) => { setS(next); setAt(Date.now()); });
  }, [subscribe, visible]);

  /*
   * Watch for a readout that has stopped updating.
   *
   * If the capture freezes without the track firing `ended` — a suspended camera, a stalled pump —
   * ingestResult simply stops being called and this component keeps painting its last value:
   * a green dot, "face", a plausible fps, indefinitely. That is the same fault the no-face branch
   * was rewritten to fix, left open for the no-frames case, and it is the one the operator is least
   * able to notice.
   */
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [visible]);

  const stale = at > 0 && now - at > 1500;

  if (!visible) return null;

  const face = s?.facePresent ?? false;
  /*
   * The EXPOSURE's frame rate is what belongs beside the ratio's sampling floor.
   *
   * The live figure is measured over the last two seconds of whatever screen is showing, and the
   * monitor is hidden during reading — so it structurally cannot describe the window the floor
   * applies to. Colouring it against that floor told the operator the exposure had cleared a gate
   * the number knew nothing about.
   */
  const exposureFps = s?.exposureFps ?? null;
  const fps = exposureFps;
  const fpsLow = fps != null && fps < fpsFloor;
  const num = (v: number | null | undefined, digits = 0) =>
    v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

  /*
   * Red means NOT MEASURING, and a null blink count is exactly that.
   *
   * The dot ignored `blinks` entirely, so the single worst outcome in the study — no EAR baseline
   * fitted, therefore no incomplete-blink ratio for any condition of a ninety-minute sitting —
   * rendered as the healthy state on the instrument built to catch it. That state is reachable with
   * the camera active: baselineEar leaves the ref null on short or non-finite sample sets, and the
   * calibration screen offers a deliberate "continue anyway".
   */
  const notCounting = s != null && s.blinks == null;
  const dot = (!face || notCounting) ? '#d14343' : fpsLow ? '#c98a22' : '#22c97a';

  return (
    <div
      aria-hidden
      style={{
        /*
         * Bottom-LEFT, because the top-right strip is already claimed three times over. Measured at
         * the design canvas: this chip spanned x 869-1184, y 10-36, while ExperimentProgress's text
         * sits at x 865-1182, y 8-22 with a higher z-index — a 313x12 px overlap that composited to
         * 1.14:1 and erased the progress readout. The wake-lock warning covers the same strip, and
         * the reaction task's trial counter sits entirely inside this chip and was hidden by it.
         * The Pause control holds top-left; bottom-left is free.
         */
        position: 'fixed', left: 10, bottom: 10, zIndex: 35,
        pointerEvents: 'none',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(20,20,30,0.72)', color: '#fff',
        borderRadius: 10, padding: '6px 10px',
        fontFamily: '"DM Mono", ui-monospace, monospace', fontSize: 11, lineHeight: 1.3,
        boxShadow: '0 2px 10px rgba(0,0,0,.2)',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: stale ? '#d14343' : dot, flex: '0 0 auto',
      }} />
      <span style={{ whiteSpace: 'nowrap', opacity: stale ? 0.55 : 1 }}>
        {stale ? 'NO FRAMES' : face ? 'face' : 'NO FACE'}
        {/* "blinks" while an exposure is running, "last" on the screens between exposures. The
            aggregator only exists during reading, so without the distinction the operator could not
            tell a live count from a stale one. */}
        {s?.blinksLive ? '  blinks ' : '  last '}
        <b>{num(s?.blinks)}</b>
        {' ('}
        {num(s?.incomplete)}
        {' inc)'}
        {'  '}
        {/* Labelled "exp" so it cannot be read as a live rate: it describes the reading exposure
            that just finished, which is the only window the ratio's floor applies to. */}
        <span style={{ opacity: fpsLow ? 1 : 0.75, color: fpsLow ? '#ffd27a' : undefined }}>
          {num(fps)} fps exp
        </span>
        {'  open '}
        {num(s?.earRatio, 2)}
      </span>
    </div>
  );
}
