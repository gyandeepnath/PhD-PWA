/**
 * The export says what its own version means (Round 92, audit 86 P2).
 *
 * The codebook's app_version entry was a hand-written sentence that stopped at 2.3.0 while the build
 * shipping was 2.4.0: the bump updated the manual and not the export. It is now built from one list
 * (lib/versionHistory.ts), and a bump without an entry fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VERSION_HISTORY, appVersionDescription } from '@/lib/versionHistory';
import { CODEBOOK } from '@/storage/export';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('app_version in the codebook', () => {
  it('the list ends at the version package.json ships', () => {
    const pkg = JSON.parse(src('package.json'));
    expect(VERSION_HISTORY[VERSION_HISTORY.length - 1].version).toBe(pkg.version);
  });

  it('the codebook entry describes every version, the shipping one and 2.3.1 included', () => {
    const d = CODEBOOK.find((r) => r.file === '01_session_info.csv' && r.column === 'app_version')!.description;
    expect(d).toBe(appVersionDescription());
    for (const v of VERSION_HISTORY) expect(d).toContain(`${v.version} from ${v.from}`);
    expect(d).toMatch(/2\.3\.1 from Round 76/);
    expect(d).toMatch(/2\.4\.0 from Round 85/);
  });

  it('the operator manual names every version and points to the list', () => {
    const manual = src('docs/OPERATOR_MANUAL.md');
    for (const v of VERSION_HISTORY) expect(manual, v.version).toContain(v.version);
    expect(manual).toContain('src/lib/versionHistory.ts');
  });
});
