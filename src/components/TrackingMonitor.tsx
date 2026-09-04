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

  useEffect(() => {
    if (!visible) return;
    return subscribe(setS);
  }, [subscribe, visible]);

  if (!visible) return null;

  const face = s?.facePresent ?? false;
  const fps = s?.fps ?? null;
  const fpsLow = fps != null && fps < fpsFloor;
  const num = (v: number | null | undefined, digits = 0) =>
    v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

  // Amber for "measuring but degraded", red for "not measuring", otherwise unobtrusive.
  const dot = !face ? '#d14343' : fpsLow ? '#c98a22' : '#22c97a';

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', right: 10, top: 10, zIndex: 35,
        pointerEvents: 'none',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(20,20,30,0.72)', color: '#fff',
        borderRadius: 10, padding: '6px 10px',
        fontFamily: '"DM Mono", ui-monospace, monospace', fontSize: 11, lineHeight: 1.3,
        boxShadow: '0 2px 10px rgba(0,0,0,.2)',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flex: '0 0 auto' }} />
      <span style={{ whiteSpace: 'nowrap' }}>
        {face ? 'face' : 'NO FACE'}
        {/* "blinks" while an exposure is running, "last" on the screens between exposures. The
            aggregator only exists during reading, so without the distinction the operator could not
            tell a live count from a stale one. */}
        {s?.blinksLive ? '  blinks ' : '  last '}
        <b>{num(s?.blinks)}</b>
        {' ('}
        {num(s?.incomplete)}
        {' inc)'}
        {'  '}
        <span style={{ opacity: fpsLow ? 1 : 0.75, color: fpsLow ? '#ffd27a' : undefined }}>
          {num(fps)} fps
        </span>
        {'  open '}
        {num(s?.earRatio, 2)}
      </span>
    </div>
  );
}
