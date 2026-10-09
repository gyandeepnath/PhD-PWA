/**
 * Thin top progress bar driven by the stage machine, with a neutral stage label.
 *
 * Shown on setup, break and closing screens only — never inside the condition-run (see showProgress
 * in Experiment.tsx). The label used to be 14 design px lowercase ("condition 6 of 10 · break"),
 * about 12 px on the tablet, over a bar 4 design px tall that read as a hairline; it is Title Case at
 * 15 px over a 6 px bar.
 *
 * AT THE BREAK it names the display that comes NEXT. It used to print "Condition 6 of 10 · break"
 * after the sixth had FINISHED, which a participant reasonably read as "I am on the sixth", while the
 * break text beneath it said six were done.
 */
import { CONFIG } from '@/experiment/config';

interface Props {
  percent: number;
  /** The stage, in Title Case (STAGE_LABEL in Experiment.tsx). */
  label?: string;
  /** 1-based number of the display that follows this screen (the break only). */
  nextDisplay?: number;
  /** Displays in this sitting. */
  displayTotal?: number;
  /** Rough minutes remaining in the sitting (neutral; no performance information). */
  timeRemainingMin?: number | null;
  /**
   * The screen under the label is dark (the gaze calibration overlay, which sits below this bar). The
   * label then takes a light ink: the usual #4a4a60 is ~2:1 on it.
   */
  onDark?: boolean;
  /**
   * The screen under the label is the grey field's #808080 (the camera self-test from Round 79). Neither
   * ink above is legible there (#4a4a60 about 2.2:1, #c8d8f0 about 2.7:1), so the bar and label take the
   * grey field's own black ink (5.3:1).
   */
  onGrey?: boolean;
}

export function ExperimentProgress({ percent, label, nextDisplay, displayTotal, timeRemainingMin, onDark = false, onGrey = false }: Props) {
  const parts: string[] = [];
  if (label) parts.push(label);
  if (nextDisplay != null && displayTotal != null) parts.push(`Next: Display ${nextDisplay} of ${displayTotal}`);
  if (timeRemainingMin != null && timeRemainingMin > 0) parts.push(`About ${timeRemainingMin} min left`);
  const text = parts.join(' · ');

  return (
    <div data-testid="experiment-progress" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40, pointerEvents: 'none' }}>
      <div style={{ height: 6, background: onGrey ? 'rgba(0,0,0,0.22)' : onDark ? '#3a3a52' : '#e5e2dc' }}>
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            background: onGrey ? CONFIG.ADAPTATION_INK : onDark ? '#c8d8f0' : '#1a1a2e',
            transition: 'width 0.3s ease-out',
          }}
        />
      </div>
      {text && (
        <div
          data-testid="progress-label"
          style={{
            position: 'absolute',
            top: 14,
            right: 16,
            fontFamily: 'Roboto, ui-sans-serif, sans-serif',
            fontSize: 15,
            fontWeight: 500,
            color: onGrey ? CONFIG.ADAPTATION_INK : onDark ? '#c8d8f0' : '#4a4a60',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
