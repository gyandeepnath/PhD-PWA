/**
 * A number as the operator types it into a set-up form: the one rule for every typed number.
 *
 * The profile checked its two hour fields by `hours !== ''` and `Number.isFinite(Number(sinceSleep))`
 * and stored `Number(text)` (audit 86 UI-8, M4). So "abc" left Continue on and stored NaN, which the
 * CSV writes as a blank cell and the backup as null; a single space passed both checks and was stored
 * as 0 (`Number(' ') === 0`), a wrong value rather than a missing one; "6-8" passed as text; and 60
 * daily screen hours or 30 hours since waking were stored as typed. Daily screen hours is a
 * pre-specified moderator in both analysis templates. `Number()` also reads "0x14" as 20 and "1e1"
 * as 10, which nobody types on purpose.
 *
 * What is accepted: digits, with at most one decimal point or comma ("6.5", "6,5" — a tablet keyboard
 * set to a European locale offers the comma), surrounding spaces ignored, inside [min, max]. Anything
 * else is null: the form keeps Continue off and says why under the field.
 */
export function parseNumberEntry(text: string, min: number, max: number): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/**
 * Hours in a day, for the profile's "Daily screen hours" and "Hours since you woke up today": 0 to 24.
 * The range is the day's own, not a judgement about what is plausible: 24 hours awake is possible and
 * is recorded as typed.
 */
export const HOURS_IN_DAY = { min: 0, max: 24 } as const;

/** What the form says under an hour field whose text is not a number of hours. */
export const HOURS_ENTRY_PROBLEM = `Type a number of hours from ${HOURS_IN_DAY.min} to ${HOURS_IN_DAY.max}, such as 6 or 6.5.`;
