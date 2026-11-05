/**
 * The one write path for a researcher's illuminance reading, from the sitting's own screens and from
 * the session manager.
 *
 * The end-of-sitting reading could be logged only on the thank-you screen (audit 86 F4). The sitting is
 * complete by then — recorded at the NASA-TLX, by design, so a closed app does not leave it looking
 * unfinished — and nothing resumes to that screen, so a thank-you screen lost to a reload, a crash or a
 * sleeping tablet left lux_end blank and lux_complete FALSE for good, with the meter still in the
 * operator's hand. The session manager now offers the missing end reading on a completed sitting, through
 * this function, and the reading carries the time it was logged: 01_session_info.csv says how long after
 * the sitting's end that was (lux_end_min_after_end), so a late reading is never read as an on-time one.
 */
import { get, put } from './db';
import type { SessionRecord } from './types';
import { summariseLux, type LuxCheckpoint } from '@/experiment/illumination';

/**
 * Store `lux` as this sitting's `checkpoint` reading, replacing an earlier one of the same checkpoint (a
 * resumed sitting may revisit the screen), and recompute lux_all_in_range. Returns the updated record,
 * or null when the sitting is not on the device or the value is not a number.
 */
export async function logLuxReading(
  sessionId: string, checkpoint: LuxCheckpoint, lux: number, at: number = Date.now(),
): Promise<SessionRecord | null> {
  if (!Number.isFinite(lux)) return null;
  const fresh = await get('sessions', sessionId);
  if (!fresh) return null;
  const readings = [
    ...(fresh.lux_readings ?? []).filter((r) => r.checkpoint !== checkpoint),
    { checkpoint, lux, at },
  ];
  const updated: SessionRecord = {
    ...fresh,
    lux_readings: readings,
    lux_all_in_range: summariseLux(fresh.ambient_illumination_level, readings).all_in_range,
  };
  await put('sessions', updated);
  return updated;
}

/**
 * A completed sitting with no end reading: the session manager offers to log it. Not a withdrawn
 * sitting (its row offers export and deletion only) and not one still running (its own screens will).
 */
export function endReadingMissing(s: Pick<SessionRecord, 'status' | 'lux_readings'> & { withdrawn_at?: number | null }): boolean {
  return s.status === 'complete' && s.withdrawn_at == null
    && !(s.lux_readings ?? []).some((r) => r.checkpoint === 'end' && Number.isFinite(r.lux));
}

/** Minutes from the sitting's end to its end reading; null without either. */
export function endReadingDelayMin(s: Pick<SessionRecord, 'session_end_time' | 'lux_readings'>): number | null {
  const end = (s.lux_readings ?? []).find((r) => r.checkpoint === 'end');
  if (s.session_end_time == null || !end || !Number.isFinite(end.at)) return null;
  return (end.at - s.session_end_time) / 60_000;
}
