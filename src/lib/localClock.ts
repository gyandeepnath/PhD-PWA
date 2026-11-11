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
