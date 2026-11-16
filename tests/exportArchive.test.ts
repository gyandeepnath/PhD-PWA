/**
 * The exports as single files (storage/exportArchive.ts, Round 97).
 *
 * An archive is a container and nothing else: the files inside are byte for byte what the loose
 * export wrote, each sitting has a name no other sitting can have, and the whole-tablet archive holds
 * every sitting, the pooled dataset over exactly those sittings, and the analysis scripts.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { simulateCohort } from '@/sim/analysisCohort';
import { buildExportFiles, integrityLine } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import {
  buildSittingArchive, buildPooledArchive, buildEverythingArchive, archiveBytes,
  sittingArchiveName, sittingFolderName, POOLED_FOLDER,
} from '@/storage/exportArchive';
import { readZip } from '@/lib/zipArchive';

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
/**
 * A manifest is stamped with the time it was written (exported_at), so two builds of one sitting
 * differ there and nowhere else: compared with the stamp taken out.
 */
const unstamped = (name: string, content: string | undefined): string | undefined =>
  content != null && /manifest\.json$/.test(name) ? content.replace(/"exported_at": "[^"]*"/, '"exported_at": ""') : content;
const cohort = simulateCohort({ n: 4, seed: 11 });

describe('one sitting, one file', () => {
  it('holds exactly the files of the loose export, unchanged, in a folder named for the sitting', async () => {
    const b = cohort[0];
    const files = buildExportFiles(b);
    const a = await buildSittingArchive(b, files);
    expect(a.filename).toBe(sittingArchiveName(b.session));
    expect(a.filename).toBe('visulab_P001_S001.zip');
    expect(a.fileCount).toBe(files.length);
    const inside = await readZip(archiveBytes(a));
    const folder = sittingFolderName(b.session);
    expect(inside.map((e) => e.path)).toEqual(files.map((f) => `${folder}/${f.filename}`));
    inside.forEach((e, i) => expect(dec(e.bytes)).toBe(files[i].content));
  });

  it('gives every sitting of a cohort a different name', () => {
    const names = cohort.map((b) => sittingArchiveName(b.session));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the pooled dataset, one file', () => {
  it('holds the pooled files in _pooled/, under a name that changes with the data', async () => {
    const all = buildAnalysisDataset(cohort);
    const a = await buildPooledArchive(all, cohort.length);
    expect(a.filename).toMatch(/^visulab_pooled_4sittings_[0-9a-f]{8}\.zip$/);
    const inside = await readZip(archiveBytes(a));
    expect(inside.map((e) => e.path)).toEqual(all.files.map((f) => `${POOLED_FOLDER}/${f.filename}`));
    inside.forEach((e, i) => expect(dec(e.bytes)).toBe(all.files[i].content));
    const fewer = await buildPooledArchive(buildAnalysisDataset(cohort.slice(0, 3)), 3);
    expect(fewer.filename).not.toBe(a.filename);
  });
});

describe('everything on the tablet, one file', () => {
  it('holds every sitting as its own archive does, the pooled dataset and the analysis scripts', async () => {
    const kit = [{ path: 'READ_ME_FIRST.txt', content: 'read me' }, { path: 'run_analysis.R', content: '# r' }];
    const seen: number[] = [];
    const a = await buildEverythingArchive(
      cohort,
      async (id) => cohort.find((b) => b.session.session_id === id) ?? null,
      kit,
      (p) => seen.push(p.done),
    );
    expect(a.sittings).toBe(4);
    expect(a.backupOnly).toEqual([]);
    expect(a.filename).toMatch(/^visulab_everything_4sittings_[0-9a-f]{8}\.zip$/);
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(4);

    const inside = new Map((await readZip(archiveBytes(a))).map((e) => [e.path, dec(e.bytes)]));
    for (const b of cohort) {
      for (const f of buildExportFiles(b)) {
        expect(unstamped(f.filename, inside.get(`data/${sittingFolderName(b.session)}/${f.filename}`)), f.filename).toBe(unstamped(f.filename, f.content));
      }
    }
    for (const f of buildAnalysisDataset(cohort).files) {
      expect(unstamped(f.filename, inside.get(`data/${POOLED_FOLDER}/${f.filename}`)), f.filename).toBe(unstamped(f.filename, f.content));
    }
    for (const k of kit) expect(inside.get(`analysis/${k.path}`)).toBe(k.content);
    const start = inside.get('START_HERE.txt') ?? '';
    expect(start).toContain('Sittings: 4.');
    for (const b of cohort) expect(start).toContain(`data/${sittingFolderName(b.session)}/`);
    // Nothing else: sittings x files + pooled + kit + START_HERE.
    expect(inside.size).toBe(cohort.reduce((n, b) => n + buildExportFiles(b).length, 0) + buildAnalysisDataset(cohort).files.length + kit.length + 1);
    expect(a.fileCount).toBe(inside.size - 1);
  });

  it('a sitting deleted while the archive is built is left out, not fatal', async () => {
    const a = await buildEverythingArchive(cohort, async (id) => (id === cohort[1].session.session_id ? null : cohort.find((b) => b.session.session_id === id) ?? null), []);
    const paths = (await readZip(archiveBytes(a))).map((e) => e.path);
    expect(paths.some((p) => p.startsWith(`data/${sittingFolderName(cohort[1].session)}/`))).toBe(false);
    expect(paths.some((p) => p.startsWith(`data/${sittingFolderName(cohort[0].session)}/`))).toBe(true);
  });
});

describe('the integrity verdict shown at export', () => {
  it('reads the sitting\'s own report: all passed, or the counts and where to look', () => {
    const files = buildExportFiles(cohort[0]);
    const withReport = (content: string) => files.map((f) => (f.filename === '16_integrity_report.csv' ? { ...f, content } : f));
    const head = 'participant_id,session_index,severity,check,detail,refs\n';
    expect(integrityLine(withReport(`${head}P001,1,info,all_checks_passed,"unique; no orphans",\n`)))
      .toBe('Integrity check of this sitting: all checks passed.');
    // The simulated sitting's own report is read without an exception, whatever it holds.
    expect(integrityLine(files)).toMatch(/^Integrity check of this sitting: (all checks passed\.|\d+ errors?, \d+ warnings?\. )/);
    const withFaults = withReport(`${head}P001,1,error,condition_id_unique,"two rows, one id",a | b\nP001,1,warning,coverage,"a detail, with a comma",\nP001,1,warning,x,y,\n`);
    expect(integrityLine(withFaults)).toBe('Integrity check of this sitting: 1 error, 2 warnings. Read 16_integrity_report.csv (inside the file) before the participant leaves.');
    expect(integrityLine([])).toMatch(/no report was written/);
  });
});
