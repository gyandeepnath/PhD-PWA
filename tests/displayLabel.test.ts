/**
 * The operator's session label must not leave the tablet.
 *
 * "Rename session" is an unbounded free-text prompt pre-filled with the participant code, offered
 * on a screen where an operator is keeping twenty sittings straight. It invites "Priya S - Tue am",
 * and the export used to spread the entire session record into `session_*.json` and
 * `backup_*.json` — so whatever was typed there travelled inside a bundle the protocol treats as
 * de-identified, in the two files least likely to be opened, and inside the backup that is the
 * designated OFF-device copy.
 *
 * The obvious-looking fix is to restrict the label's charset. It would have been theatre: the
 * participant_id finding next to this one in the audit was closed for exactly that reason, because
 * `PriyaSharma` passes any character class a human-readable label can have. A charset check cannot
 * read content. What software CAN guarantee is that the field does not cross the boundary, and
 * nothing downstream wants it — no CSV column carries it and no analysis reads it.
 *
 * So these tests assert the boundary, not the charset: the label is bounded on the way in, and
 * absent from every exported byte on the way out.
 */
import { describe, it, expect } from 'vitest';
import { buildExportFiles, fnv1a } from '@/storage/export';
import { sanitiseDisplayLabel, sessionForExport, MAX_DISPLAY_LABEL } from '@/storage/gather';
import { buildSessionBackup, parseSessionBackup } from '@/storage/backup';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { SessionBundle } from '@/storage/gather';

/** The kind of string the prompt actually invites, which is the whole problem. */
const IDENTIFYING = 'Priya Sharma (roll 21BOPT045)';

function labelled(label: string | null): SessionBundle {
  const b = buildFixtureBundle();
  (b.session as unknown as Record<string, unknown>).display_label = label;
  return b;
}

describe('sanitiseDisplayLabel bounds what is stored', () => {
  it('caps the length, so a label cannot become a notes field', () => {
    const long = 'x'.repeat(MAX_DISPLAY_LABEL + 50);
    expect(sanitiseDisplayLabel(long)!.length).toBe(MAX_DISPLAY_LABEL);
  });

  it('neutralises control characters a paste can carry', () => {
    expect(sanitiseDisplayLabel('Pilot 1\nbench\t2')).toBe('Pilot 1 bench 2');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitiseDisplayLabel('  Pilot    1  ')).toBe('Pilot 1');
  });

  it('reports absence for an empty or whitespace-only label rather than storing ""', () => {
    // Falling back to participant_id is the documented behaviour of sessionLabel(); an empty
    // string would satisfy `||` by accident but is not the same statement as "no label".
    expect(sanitiseDisplayLabel('')).toBeNull();
    expect(sanitiseDisplayLabel('   \n  ')).toBeNull();
  });

  it('does NOT pretend to judge the content', () => {
    // Stated as a property so nobody later mistakes this function for a privacy control and
    // removes the export-boundary strip that actually is one.
    expect(sanitiseDisplayLabel(IDENTIFYING)).toBe(IDENTIFYING);
  });
});

describe('the label does not cross the export boundary', () => {
  it('appears in no byte of any exported file', () => {
    const files = buildExportFiles(labelled(IDENTIFYING));
    for (const f of files) {
      expect(f.content, `${f.filename} carries the operator's label`).not.toContain('Priya');
      expect(f.content, `${f.filename} carries the operator's label`).not.toContain(IDENTIFYING);
    }
  });

  it('is null in the analysis JSON, not merely missing', () => {
    // Same SHAPE whether or not the sitting was renamed: a key that vanishes for some sessions and
    // not others is a difference a reader has to explain.
    const files = buildExportFiles(labelled(IDENTIFYING));
    const json = files.find((f) => f.filename.startsWith('session_') && f.filename.endsWith('.json'))!;
    expect(JSON.parse(json.content).session.display_label).toBeNull();
  });

  it('is null in the backup, which is the designated off-device copy', () => {
    const files = buildExportFiles(labelled(IDENTIFYING));
    const backup = files.find((f) => f.filename.startsWith('backup_'))!;
    const parsed = JSON.parse(backup.content);
    expect(parsed.data.session.display_label).toBeNull();
  });

  it('leaves the backup checksum valid, so stripping did not damage the restore path', () => {
    // The checksum is computed over the stripped record, so it still certifies what the file holds.
    const files = buildExportFiles(labelled(IDENTIFYING));
    const backup = files.find((f) => f.filename.startsWith('backup_'))!;
    const result = parseSessionBackup(backup.content);
    expect(result.error ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  it('changes no other field of the session record', () => {
    const b = labelled(IDENTIFYING);
    const stripped = sessionForExport(b.session);
    const { display_label: _a, ...restStripped } = stripped as unknown as Record<string, unknown>;
    const { display_label: _b, ...restOriginal } = b.session as unknown as Record<string, unknown>;
    expect(restStripped).toEqual(restOriginal);
    // And the record in the database is untouched: the label is still there for the operator.
    expect(b.session.display_label).toBe(IDENTIFYING);
  });
});

describe('renaming a sitting does not change what its export says', () => {
  it('produces byte-identical files whether renamed or not', () => {
    // The manifest checksum is supposed to be a statement about CONTENT. If typing a nickname
    // changed the bytes, two exports of the same data would fail to match for a reason that has
    // nothing to do with the data.
    const plain = new Map(buildExportFiles(labelled(null)).map((f) => [f.filename, f.content]));
    const renamed = new Map(buildExportFiles(labelled('bench 2, Tuesday')).map((f) => [f.filename, f.content]));
    expect([...renamed.keys()]).toEqual([...plain.keys()]);
    for (const [name, content] of plain) {
      if (name === 'export_manifest.json') continue; // carries the export timestamp
      expect(fnv1a(content), `${name} differs after a rename`).toBe(fnv1a(renamed.get(name)!));
    }
  });

  it('keeps the standalone backup builder in step with the export', () => {
    // buildSessionBackup is called directly by the manual backup control as well as by the export,
    // so the strip has to live in the builder rather than in the export's copy of it.
    const built = buildSessionBackup(labelled(IDENTIFYING));
    expect((built.data.session as { display_label: unknown }).display_label).toBeNull();
  });
});
