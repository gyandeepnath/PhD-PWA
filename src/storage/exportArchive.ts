/**
 * The exports as single files (Round 97): one archive per sitting, one for the pooled analysis
 * dataset, and one for everything on the tablet.
 *
 * Each is a ZIP (lib/zipArchive.ts) of the same files the app has always written, unchanged: the
 * archive adds a unique name and a folder, nothing else. What it replaces is 23 loose downloads with
 * the same names for every sitting, which no step turned into the one-folder-per-sitting layout the
 * analysis reads.
 *
 *   visulab_<code>_<session>.zip            one sitting: <code>_<session>/ + its files
 *   visulab_pooled_<n>sittings_<sum>.zip    the pooled dataset: _pooled/ + its files
 *   visulab_everything_<n>sittings_<sum>.zip
 *       data/<code>_<session>/...           every sitting on the tablet, as its own archive holds it
 *       data/_pooled/...                    the pooled dataset over exactly those sittings
 *       analysis/...                        the analysis scripts of the build that wrote the archive
 *       START_HERE.txt                      what the archive is and what to do with it
 *
 * The analysis templates read all three, and loose folders, alike (src/analysis). `<session>` is the
 * first eight characters of the session id, as in backup_*.json; `<sum>` is a checksum of the pooled
 * analysis_long.csv, so two pooled exports of different data cannot share a name.
 *
 * Pure: nothing here touches the DOM or the database. The caller gathers the sittings and downloads
 * the result.
 */
import type { SessionBundle } from './gather';
import type { SessionRecord } from './types';
import { buildExportFiles, safeFilePart, fnv1a, backupExportFile, DamagedParticipantCodeError, type ExportFile } from './export';
import { buildAnalysisDataset, type AnalysisDataset } from './analysisExport';
import { ZipBuilder, joinParts } from '@/lib/zipArchive';

export const ARCHIVE_MIME = 'application/zip';
/** The folder the pooled dataset sits in, inside its own archive and under data/ in the whole one. */
export const POOLED_FOLDER = '_pooled';

const text = (s: string) => new TextEncoder().encode(s);

/** `<code>_<session>`: the folder one sitting's files sit in, and the stem of its archive's name. */
export function sittingFolderName(session: Pick<SessionRecord, 'participant_id' | 'session_id'>): string {
  return `${safeFilePart(session.participant_id)}_${session.session_id.slice(0, 8)}`;
}

export function sittingArchiveName(session: Pick<SessionRecord, 'participant_id' | 'session_id'>): string {
  return `visulab_${sittingFolderName(session)}.zip`;
}

export interface BuiltArchive {
  filename: string;
  /** The archive, as parts for `new Blob(parts)`. */
  parts: Uint8Array[];
  bytes: number;
  /** Files inside, not counting START_HERE.txt. */
  fileCount: number;
}

const built = (filename: string, parts: Uint8Array[], fileCount: number): BuiltArchive =>
  ({ filename, parts, bytes: parts.reduce((n, p) => n + p.length, 0), fileCount });

/** One sitting: the files buildExportFiles returns, in a folder named for the sitting. */
export async function buildSittingArchive(bundle: SessionBundle, files: ExportFile[] = buildExportFiles(bundle)): Promise<BuiltArchive> {
  const zip = new ZipBuilder();
  const folder = sittingFolderName(bundle.session);
  for (const f of files) await zip.add(`${folder}/${f.filename}`, text(f.content));
  return built(sittingArchiveName(bundle.session), zip.finish(), files.length);
}

/** `<n>sittings_<sum>`: what tells one pooled export from another. */
function pooledStamp(dataset: AnalysisDataset, sittings: number): string {
  const long = dataset.files.find((f) => f.filename === 'analysis_long.csv');
  return `${sittings}sittings_${fnv1a(long?.content ?? '')}`;
}

/** The pooled dataset over `sittings` sittings. */
export async function buildPooledArchive(dataset: AnalysisDataset, sittings: number): Promise<BuiltArchive> {
  const zip = new ZipBuilder();
  for (const f of dataset.files) await zip.add(`${POOLED_FOLDER}/${f.filename}`, text(f.content));
  return built(`visulab_pooled_${pooledStamp(dataset, sittings)}.zip`, zip.finish(), dataset.files.length);
}

export interface EverythingProgress { done: number; total: number; participant: string }

export interface EverythingResult extends BuiltArchive {
  sittings: number;
  /** Sittings whose data files were refused (a damaged participant code): only their backup is in. */
  backupOnly: string[];
}

/**
 * Everything on the tablet in one archive: each sitting as its own archive holds it, the pooled
 * dataset over exactly those sittings, and the analysis scripts.
 *
 * `lean` are the sittings gathered without their blink records (what the pooled dataset is built
 * from); `full(id)` gathers one sitting completely. One sitting is held uncompressed at a time: a
 * sitting's files are about 5 MB, and 130 of them at once would not fit a tablet's memory.
 */
export async function buildEverythingArchive(
  lean: SessionBundle[],
  full: (sessionId: string) => Promise<SessionBundle | null>,
  kit: { path: string; content: string }[],
  onProgress?: (p: EverythingProgress) => void,
): Promise<EverythingResult> {
  const zip = new ZipBuilder();
  const dataset = buildAnalysisDataset(lean);
  const stamp = pooledStamp(dataset, lean.length);
  const backupOnly: string[] = [];
  const listed: string[] = [];
  let files = 0;

  let done = 0;
  for (const l of lean) {
    onProgress?.({ done, total: lean.length, participant: l.session.participant_id });
    const bundle = await full(l.session.session_id);
    done += 1;
    if (!bundle) continue; // deleted while the archive was being built
    const folder = sittingFolderName(bundle.session);
    let sittingFiles: ExportFile[];
    let refused = false;
    try {
      sittingFiles = buildExportFiles(bundle);
    } catch (e) {
      if (!(e instanceof DamagedParticipantCodeError)) throw e;
      // As the single-sitting export does: the data files are refused, the backup keeps every record.
      sittingFiles = [backupExportFile(bundle)];
      refused = true;
      backupOnly.push(folder);
    }
    for (const f of sittingFiles) await zip.add(`data/${folder}/${f.filename}`, text(f.content));
    files += sittingFiles.length;
    listed.push(`  data/${folder}/  ${sittingFiles.length} file(s)${refused ? '  BACKUP ONLY: its data files were refused (a damaged participant code)' : ''}`);
  }
  onProgress?.({ done: lean.length, total: lean.length, participant: '' });

  for (const f of dataset.files) await zip.add(`data/${POOLED_FOLDER}/${f.filename}`, text(f.content));
  files += dataset.files.length;
  for (const k of kit) await zip.add(`analysis/${k.path}`, text(k.content));
  files += kit.length;

  await zip.add('START_HERE.txt', text([
    'VisuLab: everything recorded on one tablet, in one archive.',
    '',
    `Sittings: ${lean.length}. Pooled dataset: ${dataset.rowCount} rows, `
      + `${dataset.integrity.analysable_participants} of ${dataset.integrity.total_participants} participants analysable.`,
    '',
    'WHAT IS HERE',
    '  data/<participant>_<session>/   one folder per sitting: its data tables, codebook, backup and manifest',
    `  data/${POOLED_FOLDER}/                  the pooled analysis dataset over exactly these sittings`,
    '  analysis/                       the analysis scripts of the app build that wrote this archive',
    '',
    'WHAT TO DO WITH IT',
    '  1. Copy this file off the tablet and keep it somewhere safe. Do not rename the folders inside.',
    '  2. To analyse: unzip it, then follow analysis/READ_ME_FIRST.txt.',
    '  3. This archive is complete on its own. Do not put older exports of the same sittings beside it.',
    '',
    'THE SITTINGS IN THIS ARCHIVE',
    ...listed,
    '',
  ].join('\n')));

  return {
    ...built(`visulab_everything_${stamp}.zip`, zip.finish(), files),
    sittings: lean.length,
    backupOnly,
  };
}

/** The archive as one byte array (tests, scripts). */
export const archiveBytes = (a: BuiltArchive): Uint8Array => joinParts(a.parts);
