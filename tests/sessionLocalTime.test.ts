/**
 * The sitting is dated and timed by the tablet's clock (audit 86 D8).
 *
 * experiment_date was `toISOString().slice(0, 10)`, the UTC date: in India (UTC+05:30) a sitting
 * started at 04:30 on 29 October was dated 28 October, while the session manager and the dashboard
 * showed the 29th. No file carried the time of day. 01_session_info.csv now gives the start and end
 * as ISO 8601 with the device's offset, and experiment_date is the date part of the start.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildExportFiles, localIso, CODEBOOK } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';

function sessionInfo(content: string): Record<string, string> {
  // 01 is one row; no field in the columns read here holds a comma or a quote.
  const [head, row] = content.trim().split('\n');
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((f) => f.replace(/,$/, '').replace(/^"|"$/g, ''));
  const h = split(head);
  const r = split(row);
  return Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the sitting is dated by the tablet’s clock (audit 86 D8)', () => {
  const t = Date.parse('2026-10-29T04:30:00+05:30');

  it('localIso writes the wall clock with its offset, either side of UTC and at a half-hour offset', () => {
    expect(localIso(t, 330)).toBe('2026-10-29T04:30:00+05:30');
    expect(localIso(t, 0)).toBe('2026-10-28T23:00:00+00:00');
    expect(localIso(t, -300)).toBe('2026-10-28T18:00:00-05:00');
    expect(localIso(Date.parse('2026-10-29T23:59:59Z'), 345)).toBe('2026-10-30T05:44:59+05:45');
    // Round trip: the string names the same instant.
    expect(Date.parse(localIso(t, 330))).toBe(t);
  });

  it('a sitting started at 04:30 IST is dated the 29th in 01_session_info.csv, with its start and end times', () => {
    // The tablet's time zone, as the browser reports it (minutes WEST of UTC, so India is -330).
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);
    const b = buildFixtureBundle();
    b.session = { ...b.session, session_start_time: t, session_end_time: t + 95 * 60_000 };
    const f = buildExportFiles(b).find((x) => x.filename === '01_session_info.csv')!;
    const row = sessionInfo(f.content);
    expect(row.experiment_date).toBe('2026-10-29');
    expect(row.session_start_local).toBe('2026-10-29T04:30:00+05:30');
    expect(row.session_end_local).toBe('2026-10-29T06:05:00+05:30');
  });

  it('a sitting still running has no end time, and the codebook documents both columns', () => {
    const b = buildFixtureBundle();
    b.session = { ...b.session, session_end_time: null, status: 'in_progress' };
    const row = sessionInfo(buildExportFiles(b).find((x) => x.filename === '01_session_info.csv')!.content);
    expect(row.session_end_local).toBe('');
    expect(row.session_start_local).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(row.experiment_date).toBe(row.session_start_local.slice(0, 10));
    for (const c of ['session_start_local', 'session_end_local']) {
      expect(CODEBOOK.find((r) => r.file === '01_session_info.csv' && r.column === c)?.unit).toBe('ISO 8601');
    }
  });
});
