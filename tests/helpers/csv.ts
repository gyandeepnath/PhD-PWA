/**
 * Minimal RFC-4180 row split for tests.
 *
 * A naive `line.split(',')` misreads any row containing a quoted field with a comma in it — which
 * 01_session_info.csv does — and shifts every column after it, so a test written that way asserts
 * about the wrong column and passes or fails for the wrong reason.
 */
export function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Header-keyed view of a single-row CSV. */
export function singleRow(content: string): Record<string, string> {
  const [head, row] = content.split('\n');
  const cols = splitCsvRow(head);
  const vals = splitCsvRow(row);
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
}
