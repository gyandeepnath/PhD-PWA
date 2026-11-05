/**
 * A manifest's sizes and checksums can be recomputed from the files on disk (audit 86 D1).
 *
 * The manifests are the only defence against a file truncated or altered on its way off the tablet: the
 * operator, or the examiner, recomputes each file's size and FNV-1a and compares. Both manifests hashed
 * the text as UTF-16 code units, and the pooled one also counted its "bytes" in code units, so for every
 * file with a non-ASCII character — the codebooks' en dashes, a typed note — the recomputed values never
 * matched (00_CODEBOOK.csv: manifest 2a02dab4, FNV-1a of the bytes b3847702). Here the files are written
 * to disk exactly as the download writes them (UTF-8, no byte-order mark) and measured with a plain FNV-1a
 * written out in the test.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildExportFiles, MANIFEST_CHECKSUM_BASIS } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { ExportFile } from '@/storage/export';

/** The standard FNV-1a 32-bit (offset basis 0x811c9dc5, prime 0x01000193) over raw bytes. */
function fnv1aFile(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function checkOnDisk(files: ExportFile[], manifestName: string): { checked: number; nonAscii: number } {
  const dir = mkdtempSync(join(tmpdir(), 'vl-manifest-'));
  try {
    const manifest = JSON.parse(files.find((f) => f.filename === manifestName)!.content) as {
      checksum_basis: string; files: { filename: string; bytes: number; checksum_fnv1a: string }[];
    };
    expect(manifest.checksum_basis).toBe(MANIFEST_CHECKSUM_BASIS);
    let nonAscii = 0;
    for (const entry of manifest.files) {
      const f = files.find((x) => x.filename === entry.filename)!;
      const path = join(dir, entry.filename.replace(/[/\\]/g, '_'));
      writeFileSync(path, f.content, 'utf8');
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7f]/.test(f.content)) nonAscii++;
      expect(entry.bytes, `${entry.filename} size`).toBe(statSync(path).size);
      expect(entry.checksum_fnv1a, `${entry.filename} checksum`).toBe(fnv1aFile(readFileSync(path)));
    }
    return { checked: manifest.files.length, nonAscii };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('both manifests can be checked against the files on disk (audit 86 D1)', () => {
  const bundle = buildFixtureBundle();
  // A typed note with non-ASCII characters, as an operator types them.
  bundle.session.lux_deviation_note = 'meter re-zeroed — café lights 5 × brighter';

  it('the per-sitting manifest (export_manifest.json)', () => {
    const { checked, nonAscii } = checkOnDisk(buildExportFiles(bundle), 'export_manifest.json');
    expect(checked).toBeGreaterThan(15);
    // The case that used to disagree is in the set: 00_CODEBOOK.csv and 01 (the note) at least.
    expect(nonAscii).toBeGreaterThanOrEqual(2);
  });

  it('the pooled manifest (analysis_manifest.json)', () => {
    const { checked, nonAscii } = checkOnDisk(buildAnalysisDataset([bundle]).files, 'analysis_manifest.json');
    expect(checked).toBeGreaterThanOrEqual(3);
    expect(nonAscii).toBeGreaterThanOrEqual(1);
  });
});
