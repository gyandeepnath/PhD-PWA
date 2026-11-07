/**
 * The figures the README and the operator screens quote about an export are what the export writes
 * (audit 86 UI-2, M2).
 *
 * README said an export is "21 files: 18 CSVs"; the app writes 20 CSVs and 23 files, as its own
 * post-export dialog says. Its verification table quoted "364 unit and property tests" and "6 Playwright
 * E2E tests across 4 spec files" (24 spec files and over a thousand tests at the time) and "the 31
 * findings still open". Counts written by hand drift: the export's are held to buildExportFiles here,
 * and the README names what each gate checks instead of how many tests it holds (as PROTOCOL.md's
 * command table has since audit 86 D11, tests/protocolFigures.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildExportFiles } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const flat = (f: string) => read(f).replace(/\s+/g, ' ');

const files = buildExportFiles(buildFixtureBundle());
const csv = files.filter((f) => f.filename.endsWith('.csv')).length;

describe('what an export contains, as every document and screen says it', () => {
  it('the export is the CSVs, the analysis JSON, the backup and the manifest — nothing else', () => {
    const json = files.filter((f) => !f.filename.endsWith('.csv')).map((f) => f.filename.replace(/^(backup|session)_.*\.json$/, '$1_*.json'));
    expect(json.sort()).toEqual(['backup_*.json', 'export_manifest.json', 'session_*.json']);
  });

  it('README: the file and CSV counts', () => {
    expect(flat('README.md')).toContain(`${files.length} files: **${csv} CSVs**, an analysis JSON, a complete backup, and a provenance manifest`);
  });

  it('the dashboard\'s Export tab and the operator manual: the CSV count', () => {
    expect(flat('src/dashboard/Dashboard.tsx')).toContain(`Exports ${csv} CSVs`);
    expect(flat('docs/OPERATOR_MANUAL.md')).toContain(`This writes ${csv} CSVs`);
  });
});

describe('the README quotes no count that a round outdates', () => {
  const readme = read('README.md');

  it('no test, spec or check counts in the verification table', () => {
    const table = readme.slice(readme.indexOf('## Verification'), readme.indexOf('CI runs all of it'));
    expect(table.length).toBeGreaterThan(100);
    for (const row of table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Gate') && !l.startsWith('|---'))) {
      expect(row, row).not.toMatch(/\b\d[\d,]*\s+(unit|tests?|spec|checks?|scenarios|rounds|failures)\b/i);
    }
  });

  it('no count of open findings', () => {
    expect(readme).not.toMatch(/\b\d+ findings still open/);
  });
});
