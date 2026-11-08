/**
 * The pre-flight storage check is kept with the sitting (Round 92, audit 86 P5).
 *
 * storage/storageHealth.ts said its result was "stamped into the session record, so the analyst can tell
 * whether a given sitting ran on durable storage". It was not: the verdict lived in the pre-flight
 * screen's state and was dropped with it, and a sitting run after 'warn' (durable storage not granted:
 * the browser may clear the device's data before an export) or 'unknown' exported exactly like one on
 * durable storage. Pre-flight hands the check on, the sitting keeps it, and 01_session_info.csv carries
 * it. That the screen's own verdict is what is stored is checked end to end in e2e/storageVerdict.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { splitCsvRow } from './helpers/csv';

const cells = (b: ReturnType<typeof buildFixtureBundle>) => {
  const [head, row] = buildExportFiles(b).find((f) => f.filename === '01_session_info.csv')!.content.trim().split(/\r?\n/);
  const h = splitCsvRow(head);
  const r = splitCsvRow(row);
  return (c: string) => r[h.indexOf(c)];
};

describe('the storage check in 01_session_info.csv', () => {
  it('carries the verdict, the durable-storage grant and the free space the sitting ran with', () => {
    const b = buildFixtureBundle();
    b.session = { ...b.session, storage_verdict: 'warn', storage_persisted: false, storage_free_mb: 2048 };
    const get = cells(b);
    expect(get('storage_verdict')).toBe('warn');
    expect(get('storage_persisted')).toBe('false');
    expect(get('storage_free_mb')).toBe('2048');
  });

  it('is blank for a sitting recorded before it was kept, never a guessed "ok"', () => {
    const b = buildFixtureBundle();
    const s = { ...b.session } as Record<string, unknown>;
    delete s.storage_verdict; delete s.storage_persisted; delete s.storage_free_mb;
    b.session = s as unknown as typeof b.session;
    const get = cells(b);
    expect([get('storage_verdict'), get('storage_persisted'), get('storage_free_mb')]).toEqual(['', '', '']);
  });

  it('is documented, and says what only "ok" means', () => {
    for (const c of ['storage_verdict', 'storage_persisted', 'storage_free_mb']) {
      expect(CODEBOOK.find((r) => r.file === '01_session_info.csv' && r.column === c), c).toBeTruthy();
    }
    expect(CODEBOOK.find((r) => r.column === 'storage_verdict')!.description).toMatch(/Only ok means the sitting ran on storage the browser had promised to keep/);
  });

  it('pre-flight hands the check on and the sitting writes it', () => {
    const setup = readFileSync(resolve(__dirname, '../src/start/setupStages.tsx'), 'utf8');
    expect(setup).toMatch(/storage: storage \? \{ verdict: storage\.verdict, persisted: storage\.persisted, availableMb: storage\.availableMb \} : null,/);
    const exp = readFileSync(resolve(__dirname, '../src/experiment/Experiment.tsx'), 'utf8');
    expect(exp).toMatch(/storage_verdict: storage\?\.verdict \?\? null,\s*storage_persisted: storage\?\.persisted \?\? null,\s*storage_free_mb: storage\?\.availableMb \?\? null,/);
  });
});
