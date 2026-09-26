/** Thin top progress bar driven by the stage machine, with a neutral "Condition X of N" readout. */
interface Props {
  percent: number;
  label?: string;
  /** 1-based current condition within this sitting (omitted outside the loop). */
  conditionCurrent?: number;
  /** Total conditions in this sitting. */
  conditionTotal?: number;
  /** Rough minutes remaining in the sitting (neutral; no performance information). */
  timeRemainingMin?: number | null;
  /**
   * The screen under the label is dark (the gaze calibration and camera self-test overlays, which
   * sit below this bar). The label then takes a light ink: the usual #4a4a60 is ~2:1 on those.
   */
  onDark?: boolean;
}

export function ExperimentProgress({ percent, label, conditionCurrent, conditionTotal, timeRemainingMin, onDark = false }: Props) {
  const parts: string[] = [];
  if (conditionCurrent != null && conditionTotal != null) parts.push(`Condition ${conditionCurrent} of ${conditionTotal}`);
  if (label) parts.push(label);
  if (timeRemainingMin != null && timeRemainingMin > 0) parts.push(`~${timeRemainingMin} min left`);
  const text = parts.join(' · ');

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 }}>
      <div style={{ height: 4, background: '#e5e2dc' }}>
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            background: '#1a1a2e',
            transition: 'width 0.3s ease-out',
          }}
        />
      </div>
      {text && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontFamily: 'Roboto, ui-sans-serif, sans-serif',
            fontSize: 14,
            color: onDark ? '#c8d8f0' : '#4a4a60',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
