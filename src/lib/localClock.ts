/**
 * The device's UTC offset at an instant, in minutes EAST of UTC (India +330, New York in summer -240):
 * the sign ISO 8601 writes, the opposite of `Date.prototype.getTimezoneOffset`'s. It follows daylight
 * saving, because it is asked for that instant.
 *
 * Stored with a sitting's start and end on the tablet (SessionRecord session_start_utc_offset_min,
 * session_end_utc_offset_min; Round 93, review R3), so the export dates the sitting by the tablet's clock
 * rather than by the clock of whatever device a backup was restored and exported on.
 */
export function utcOffsetMin(epochMs: number): number {
  // `|| 0` turns -0 (UTC) into 0, so a stored offset never reads "-0".
  return -new Date(epochMs).getTimezoneOffset() || 0;
}

/** The stored offsets of a sitting (SessionRecord's own fields; a structural type keeps this module light). */
export interface SittingOffsetFields {
  session_start_time: number;
  session_end_time?: number | null;
  session_start_utc_offset_min?: number | null;
  session_end_utc_offset_min?: number | null;
}

/**
 * Which UTC offset a sitting's start and end are shown and exported on (Round 93, review R3): each the one
 * the tablet stored when it was stamped; a sitting that stored only one uses it for both; one that stored
 * neither has none (undefined), and the caller falls back to the offset of the device it runs on.
 */
export function sittingOffsets(s: SittingOffsetFields): { start: number | undefined; end: number | undefined } {
  const ok = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);
  const start = ok(s.session_start_utc_offset_min) ? s.session_start_utc_offset_min : ok(s.session_end_utc_offset_min) ? s.session_end_utc_offset_min : undefined;
  const end = ok(s.session_end_utc_offset_min) ? s.session_end_utc_offset_min : start;
  return { start, end };
}

/** "+05:30", "-04:00", "+00:00". */
export function offsetText(offsetMin: number): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const abs = Math.abs(offsetMin);
  return `${offsetMin < 0 ? '-' : '+'}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

/**
 * A time for the screen, on a stated clock, with that clock's offset printed: "2026-10-29 05:00 UTC+05:30".
 * Without `offsetMin`, the clock of the device running this code at that instant (Round 94, review B93-6:
 * the sitting picker and the restore messages wrote toLocaleString(), the viewing device's clock with no
 * offset, so on a device a backup was restored to in another time zone the picker gave a different date
 * and time from the experiment_date and session_start_local its own export writes).
 */
export function clockText(epochMs: number, offsetMin: number = utcOffsetMin(epochMs)): string {
  const shifted = new Date(epochMs + offsetMin * 60_000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p2(shifted.getUTCMonth() + 1)}-${p2(shifted.getUTCDate())} `
    + `${p2(shifted.getUTCHours())}:${p2(shifted.getUTCMinutes())} UTC${offsetText(offsetMin)}`;
}

/** A sitting's start on the clock 01 session_start_local is written on: the tablet's, where it stored one. */
export function sittingStartText(s: SittingOffsetFields): string {
  return clockText(s.session_start_time, sittingOffsets(s).start);
}

/** A sitting's end on the clock 01 session_end_local is written on; null when it has not ended. */
export function sittingEndText(s: SittingOffsetFields): string | null {
  return s.session_end_time != null ? clockText(s.session_end_time, sittingOffsets(s).end) : null;
}
