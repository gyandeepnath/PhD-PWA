/**
 * The question after an export asks about the tablet the files are on, says what answering yes
 * releases, and is in the manual (audit 86 UI-11).
 *
 * The dialog said "Check the receiving computer NOW and confirm they all arrived". On the tablet the
 * files land in the tablet's own Downloads folder, so at that moment there is no receiving computer;
 * and confirming is the act that later lets a deleted session be purged from the recycle bin
 * (storage/gather.ts purgeExpired, export_confirmed_at), so a confirm given on seeing the files in the
 * tablet's Downloads gave up that protection while the only copies were still on the tablet. The
 * manual never mentioned the dialog. While it was open the analysis-dataset button read "Building…"
 * although nothing was being built: the three export buttons shared one busy flag.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BIN_RETENTION_MS } from '@/storage/gather';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const flat = (f: string) => read(f).replace(/\s+/g, ' ');
/** The dashboard's source, comments removed (a comment may quote the old wording), whitespace flattened. */
const dashboard = read('src/dashboard/Dashboard.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ');
const manual = flat('docs/OPERATOR_MANUAL.md');
const dialog = dashboard.slice(dashboard.indexOf("title: 'Did every file arrive?'"), dashboard.indexOf("testId: 'export-confirm-dialog'"));

describe('"Did every file arrive?"', () => {
  it('asks about the files copied off the tablet, not a receiving computer', () => {
    expect(dialog.length).toBeGreaterThan(50);
    expect(dashboard).not.toMatch(/receiving computer/i);
    expect(dialog).toMatch(/this tablet's Downloads folder/);
    expect(dialog).toMatch(/copied off (the|this) tablet/);
  });

  it('says what a yes releases: the purge of a deleted session after the bin\'s own retention', () => {
    expect(dialog).toMatch(/purged \$\{BIN_RETENTION_DAYS\} days later only if its export was confirmed/);
    expect(dashboard).toMatch(/const BIN_RETENTION_DAYS = Math\.round\(BIN_RETENTION_MS \/ \(24 \* 60 \* 60 \* 1000\)\)/);
    expect(BIN_RETENTION_MS / (24 * 60 * 60 * 1000)).toBe(30);
    expect(manual).toContain('purged from the recycle bin 30 days after the deletion');
  });

  it('the manual names the dialog and its two answers as the screen says them', () => {
    const confirm = /confirmLabel: '([^']+)'/.exec(dialog)![1];
    const cancel = /cancelLabel: '([^']+)'/.exec(dialog)![1];
    expect(manual).toContain('**Did every file arrive?**');
    expect(manual).toContain(`**${confirm}**`);
    expect(manual).toContain(`**${cancel}**`);
  });
});

describe('each export button says only what it is doing', () => {
  it('no button reads from the flag another button sets', () => {
    // One flag for three buttons made "Download analysis dataset" read "Building…" during a bundle export.
    expect(dashboard).not.toMatch(/exporting \? 'Building…'/);
    expect(dashboard).toMatch(/busy === 'analysis' \? 'Building…'/);
    expect(dashboard).toMatch(/busy === 'bundle' \? 'Exporting…'/);
  });
});
