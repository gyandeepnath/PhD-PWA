/**
 * The participant code the app issues: letters, digits, '-' and '_', at most 20 characters.
 *
 * The session form has refused anything else since the first runnable build, so a longer code on a
 * stored record cannot have come from the app; it is a damaged or hand-edited record. The export
 * refuses such a sitting by name (storage/export.ts) rather than failing part-way: every file repeats
 * the code on every row, and 07c_ear_trace.csv has some 50,000 rows a sitting (Round 78), so a code
 * thousands of characters long makes that one file larger than a browser can hold as text.
 */
export const PARTICIPANT_ID_MAX_LENGTH = 20;
export const PARTICIPANT_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${PARTICIPANT_ID_MAX_LENGTH}}$`);
