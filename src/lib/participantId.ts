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

/*
 * ONE PERSON, ONE CODE, HOWEVER IT IS TYPED (Round 87, audit 86 F2).
 *
 * The code was stored and looked up exactly as typed. "case1" on the day of a second sitting was not
 * "CASE1": the form showed no earlier record, gave the participant a NEW enrolment number — a new
 * Williams order, starting again at position 0 — and the export then held two participants, each with
 * half a protocol, for one person. The tablet's keyboard produces exactly these variants without
 * anyone choosing them: Gboard capitalises the first letter of a field, and accepting a suggestion
 * adds a space after the word. That trailing space did not even reach a lookup: it failed the pattern
 * and left "Begin setup" greyed out with no word as to why.
 *
 * So a code has one canonical form — no surrounding spaces, upper case — which the form shows as it is
 * typed and every new sitting stores, and codes are compared by that form wherever one is looked up
 * (storage/gather.ts sittingsOfParticipant). A code already on the device keeps the spelling it was
 * stored with, letter case included: it is on every row of that participant's data, and a split
 * participant's second half must carry the same one as the first or the export splits them in two.
 * Nothing stored is rewritten.
 */

/** The form a typed code is kept in: no surrounding whitespace, upper case. */
export function canonicalParticipantId(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Two codes name the same participant: they differ at most in letter case and surrounding spaces. */
export function sameParticipant(a: string, b: string): boolean {
  return canonicalParticipantId(a) === canonicalParticipantId(b);
}

/**
 * Why `code` is not a code the app issues, in words an operator can act on; null when it is one, and
 * for an empty field (nothing typed yet is not an error). The reason "Begin setup" stays disabled was
 * shown nowhere: the message the button's handler would have given could never run, because the
 * button was disabled.
 */
export function participantIdProblem(code: string): string | null {
  if (code === '' || PARTICIPANT_ID_PATTERN.test(code)) return null;
  if (code.length > PARTICIPANT_ID_MAX_LENGTH) {
    return `A participant code is at most ${PARTICIPANT_ID_MAX_LENGTH} characters; this one has ${code.length}.`;
  }
  if (/\s/.test(code)) return 'A participant code has no spaces in it.';
  const others = [...new Set(code.replace(/[A-Za-z0-9_-]/g, ''))].map((c) => `“${c}”`).join(' ');
  return `A participant code uses only letters, digits, - and _ (not ${others}).`;
}
