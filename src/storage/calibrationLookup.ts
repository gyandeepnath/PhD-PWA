/**
 * Which calibration a measurement was taken under — one definition for every export.
 *
 * A sitting can hold several calibration records: a retry inside the calibration routine adds one,
 * and every resume re-runs calibration and adds another. The records are only ever appended. The
 * blink thresholds on each eye-metrics row were always the ones in force when it was measured; what
 * was lost was the LINK. The pooled file stamped the latest calibration's gaze_trust onto every row of
 * the sitting, so conditions measured under a thin fit before a resume were exported as "good" — and
 * gaze_trust is the column the codebook tells an analyst to filter gaze measures on. The two exports
 * also picked "latest" differently for records without a timestamp (one took the last in document
 * order, the other the first), so 01_session_info and analysis_long.csv could name different
 * calibrations for the same sitting.
 */
import type { CalibrationRecord } from './types';

/** The last calibration taken: by time, and by document order among records with none. */
export function latestCalibration<T extends Pick<CalibrationRecord, 'calibrated_at'>>(cals: readonly T[]): T | undefined {
  // A stable ascending sort keeps document order among ties, so at(-1) is the last written.
  return [...cals].sort((a, b) => (a.calibrated_at ?? 0) - (b.calibrated_at ?? 0)).at(-1);
}

/**
 * The calibration an eye-metrics row was measured under.
 *
 * Rows written since the link existed carry `calibration_id` and are looked up by it; `null` there
 * means the camera was not running, and no calibration applies. Older rows carry no field, and the
 * calibration in force is recovered from time: the last one taken at or before the condition started.
 * When that cannot be decided — several calibrations and no timestamps — the answer is undefined, not
 * a guess.
 */
export function calibrationForRow<T extends Pick<CalibrationRecord, 'calibration_id' | 'calibrated_at'>>(
  cals: readonly T[],
  row: { calibration_id?: string | null } | undefined,
  conditionStartedAt: number | null | undefined,
): T | undefined {
  if (!row) return undefined;
  if (row.calibration_id !== undefined) {
    return row.calibration_id == null ? undefined : cals.find((c) => c.calibration_id === row.calibration_id);
  }
  if (cals.length === 1) return cals[0];
  if (conditionStartedAt == null || cals.some((c) => c.calibrated_at == null)) return undefined;
  return latestCalibration(cals.filter((c) => (c.calibrated_at as number) <= conditionStartedAt));
}
