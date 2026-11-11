/**
 * The sitting is dated and timed by the tablet's clock (audit 86 D8).
 *
 * experiment_date was `toISOString().slice(0, 10)`, the UTC date: in India (UTC+05:30) a sitting
 * started at 04:30 on 29 October was dated 28 October, while the session manager and the dashboard
 * showed the 29th. No file carried the time of day. 01_session_info.csv now gives the start and end
 * as ISO 8601 with the device's offset, and experiment_date is the date part of the start.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildExportFiles, localIso, sittingClock, CODEBOOK } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { utcOffsetMin } from '@/lib/localClock';

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

/*
 * BY THE TABLET'S CLOCK, WHEREVER IT IS EXPORTED (Round 93, review R3). D8 took the offset of the device
 * running the export, so a backup restored and exported in London or New York dated a Kolkata sitting by
 * that device's clock: experiment_date 2026-10-28 instead of the 29th, and three different 01 files for
 * one sitting. The tablet now stores its offset with the sitting's start and end, and the export uses it.
 */
describe('the sitting is dated by the offset the tablet stored, not the exporting device\'s (review R3)', () => {
  const start = Date.parse('2026-10-28T23:30:00Z'); // 05:00 on the 29th in Kolkata
  const sitting = () => {
    const b = buildFixtureBundle();
    b.session = { ...b.session, session_start_time: start, session_end_time: start + 95 * 60_000, session_start_utc_offset_min: 330, session_end_utc_offset_min: 330 };
    return b;
  };
  /*
   * The exporting device's zone, as the browser reports it (getTimezoneOffset: minutes WEST of UTC, for
   * that instant), which is all the old default read. Mocked: a vitest worker does not re-read TZ.
   */
  const ZONES = { 'Asia/Kolkata': -330, 'Europe/London': 0, 'America/New_York': 240 } as const;
  const exportUnder = (tz: keyof typeof ZONES, b = sitting()) => {
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(ZONES[tz]);
    try {
      return buildExportFiles(b);
    } finally {
      spy.mockRestore();
    }
  };

  it('one sitting exported under three time zones gives the same 01 file, and every other file the same', () => {
    const kolkata = exportUnder('Asia/Kolkata');
    const london = exportUnder('Europe/London');
    const newYork = exportUnder('America/New_York');
    const file = (fs: typeof kolkata, name: string) => fs.find((f) => f.filename === name)!.content;
    expect(file(london, '01_session_info.csv')).toBe(file(kolkata, '01_session_info.csv'));
    expect(file(newYork, '01_session_info.csv')).toBe(file(kolkata, '01_session_info.csv'));
    const row = sessionInfo(file(newYork, '01_session_info.csv'));
    expect(row.experiment_date).toBe('2026-10-29');
    expect(row.session_start_local).toBe('2026-10-29T05:00:00+05:30');
    expect(row.session_end_local).toBe('2026-10-29T06:35:00+05:30');
    expect(row.session_utc_offset_source).toBe('tablet');
    // Nothing else in the export reads the exporting device's zone either.
    for (const f of kolkata.filter((x) => x.filename.endsWith('.csv'))) {
      expect(file(newYork, f.filename), f.filename).toBe(f.content);
    }
  });

  it('a sitting recorded before the offset was stored falls back to the exporting device\'s, and says so', () => {
    const b = sitting();
    delete b.session.session_start_utc_offset_min;
    delete b.session.session_end_utc_offset_min;
    const kol = sessionInfo(exportUnder('Asia/Kolkata', b).find((f) => f.filename === '01_session_info.csv')!.content);
    const ny = sessionInfo(exportUnder('America/New_York', b).find((f) => f.filename === '01_session_info.csv')!.content);
    expect(kol).toMatchObject({ experiment_date: '2026-10-29', session_start_local: '2026-10-29T05:00:00+05:30', session_utc_offset_source: 'export_device' });
    expect(ny).toMatchObject({ experiment_date: '2026-10-28', session_start_local: '2026-10-28T19:30:00-04:00', session_utc_offset_source: 'export_device' });
    expect(CODEBOOK.find((r) => r.column === 'session_utc_offset_source')?.description).toMatch(/export_device = the sitting stored no offset/);
  });

  it('one stored offset serves both ends: a sitting started before the field and ended after it', () => {
    const base = { session_start_time: start, session_end_time: start + 60_000 };
    expect(sittingClock({ ...base, session_end_utc_offset_min: 330 })).toEqual({
      startLocal: '2026-10-29T05:00:00+05:30', endLocal: '2026-10-29T05:01:00+05:30', source: 'tablet',
    });
    expect(sittingClock({ ...base, session_start_utc_offset_min: -240 }).endLocal).toBe('2026-10-28T19:31:00-04:00');
    expect(sittingClock({ ...base, session_end_time: null, session_start_utc_offset_min: 330 }).endLocal).toBe('');
  });

  it('the tablet stores its offset when the sitting starts and when it ends', () => {
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);
    expect(utcOffsetMin(start)).toBe(330);
    spy.mockReturnValue(0);
    expect(Object.is(utcOffsetMin(start), 0)).toBe(true);   // never "-0"
    spy.mockRestore();
    const src = readFileSync(resolve(__dirname, '../src/experiment/Experiment.tsx'), 'utf8');
    expect(src).toMatch(/session_start_time: startedAt,[\s\S]{0,200}session_start_utc_offset_min: utcOffsetMin\(startedAt\)/);
    // Both places that end a sitting stamp the end's offset with it.
    expect(src.match(/session_end_utc_offset_min: (fresh\.session_end_utc_offset_min \?\? )?utcOffsetMin\(endedAt\)/g)).toHaveLength(2);
  });
});
