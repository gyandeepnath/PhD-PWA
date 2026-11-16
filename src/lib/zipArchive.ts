/**
 * A ZIP writer and reader, small enough to read in one sitting and with no dependency.
 *
 * WHY THE APP WRITES ARCHIVES (Round 97). An export used to be 23 separate downloads with the SAME
 * names for every sitting (01_session_info.csv, 02_conditions.csv, ...), all into the tablet's one
 * Downloads folder. The second sitting's files could only land beside the first's under names the
 * browser changes ("01_session_info (1).csv"), most of them carry no participant code in their name,
 * and the analysis templates read one FOLDER per sitting, by exact file name. Nothing in the app or
 * the manual turned the one into the other: pointed at a Downloads folder holding 130 sittings, both
 * templates read one sitting and stopped (measured on a simulated cohort, Round 97). One sitting is now
 * one file with the participant code in its name, holding the same 23 files in a folder of its own.
 *
 * WHAT IT GUARANTEES.
 *   - The files inside are byte for byte what buildExportFiles returns: the archive is a container,
 *     and export_manifest.json's checksums are over those bytes, as before.
 *   - Every entry carries a CRC-32 of its content, which every unzip tool checks on extraction, and
 *     which readZip checks here: a truncated or damaged archive is refused, not half-read.
 *   - Fixed entry times (1980-01-01, the format's zero), so an archive says nothing about when it was
 *     written; that belongs in the manifest inside it.
 *   - Entries are deflated with the browser's own CompressionStream where there is one, and stored
 *     uncompressed where there is not. Both are plain ZIP: R's utils::unzip, Python's zipfile and the
 *     tablet's and the computer's file managers open them. The compressed BYTES can differ between
 *     browser versions (the deflate implementation is the browser's); the contents cannot.
 *   - No ZIP64: an entry or an archive of 4 GB or more, or more than 65,535 entries, is refused with
 *     a message rather than written wrongly. A whole study is about 0.1 GB (Round 97).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), as ZIP stores it. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type StreamCtor = new (format: string) => { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> };

/** Run bytes through a (De)CompressionStream; null when the browser has none or it fails. */
async function through(kind: 'CompressionStream' | 'DecompressionStream', bytes: Uint8Array): Promise<Uint8Array | null> {
  const Ctor = (globalThis as unknown as Record<string, StreamCtor | undefined>)[kind];
  if (!Ctor) return null;
  try {
    const stream = new Ctor('deflate-raw');
    const writer = stream.writable.getWriter();
    // Written and closed without awaiting: the readable side below is what applies back-pressure.
    const fed = writer.write(bytes).then(() => writer.close());
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await fed;
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  } catch {
    return null;
  }
}

const LIMIT_32 = 0xffffffff;
const LIMIT_16 = 0xffff;
/** 1980-01-01 00:00:00 in the format's packed date and time. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Bit 11: entry names are UTF-8. */
const FLAG_UTF8 = 0x0800;

export interface ZipEntry {
  /** Path inside the archive, '/' separated, no leading slash. */
  path: string;
  bytes: Uint8Array;
}

/**
 * Builds an archive one entry at a time, so a whole tablet's sittings can be added without holding
 * more than one sitting's files uncompressed.
 */
export class ZipBuilder {
  private parts: Uint8Array[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;
  private names = new Set<string>();
  private readonly compress: boolean;

  constructor(opts: { compress?: boolean } = {}) {
    this.compress = opts.compress !== false;
  }

  async add(path: string, bytes: Uint8Array): Promise<void> {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((p) => p === '..' || p === '')) {
      throw new Error(`zip: "${path}" is not a path an archive can hold`);
    }
    if (this.names.has(path)) throw new Error(`zip: "${path}" is in the archive twice`);
    this.names.add(path);
    const name = new TextEncoder().encode(path);
    const crc = crc32(bytes);
    let data = bytes;
    let method = 0;
    if (this.compress && bytes.length > 0) {
      const deflated = await through('CompressionStream', bytes);
      if (deflated && deflated.length < bytes.length) { data = deflated; method = 8; }
    }
    if (bytes.length >= LIMIT_32 || data.length >= LIMIT_32 || this.offset + data.length >= LIMIT_32 || this.count >= LIMIT_16 || name.length > LIMIT_16) {
      throw new Error('zip: the archive would pass 4 GB or 65,535 files, which this writer does not support');
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, FLAG_UTF8, true);
    local.setUint16(8, method, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    this.parts.push(new Uint8Array(local.buffer), name, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, FLAG_UTF8, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, DOS_TIME, true);
    cen.setUint16(14, DOS_DATE, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, bytes.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, this.offset, true);
    this.central.push(new Uint8Array(cen.buffer), name);

    this.offset += 30 + name.length + data.length;
    this.count += 1;
  }

  /** How many entries have been added. */
  get entries(): number { return this.count; }

  /** The archive's parts, in order: hand them to `new Blob(parts)` or join them. */
  finish(): Uint8Array[] {
    const centralSize = this.central.reduce((n, p) => n + p.length, 0);
    if (this.offset + centralSize >= LIMIT_32) throw new Error('zip: the archive would pass 4 GB, which this writer does not support');
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, this.offset, true);
    return [...this.parts, ...this.central, new Uint8Array(end.buffer)];
  }
}

export function joinParts(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** An archive of `entries`, in the order given. */
export async function zipArchive(entries: ZipEntry[], opts: { compress?: boolean } = {}): Promise<Uint8Array> {
  const b = new ZipBuilder(opts);
  for (const e of entries) await b.add(e.path, e.bytes);
  return joinParts(b.finish());
}

/**
 * The entries of an archive, each checked against its CRC-32. Throws on anything that is not a
 * complete archive this module could have written or an ordinary one from another tool (stored or
 * deflated entries, no encryption, no ZIP64).
 */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last 22 bytes unless the archive carries a comment; search back for it.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a ZIP archive, or its end is missing (the file may be incomplete)');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('the ZIP archive\'s index is damaged');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x0001) throw new Error(`"${path}" is encrypted, which this reader does not open`);
    if (packed === LIMIT_32 || size === LIMIT_32 || localAt === LIMIT_32) throw new Error('a ZIP64 archive, which this reader does not open');
    if (path.endsWith('/')) continue; // a folder entry from another tool
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== 0x04034b50) throw new Error(`"${path}": its place in the archive is damaged`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + packed > bytes.length) throw new Error(`"${path}" runs past the end of the archive (the file may be incomplete)`);
    const raw = bytes.subarray(dataAt, dataAt + packed);
    let content: Uint8Array | null;
    if (method === 0) content = raw.slice();
    else if (method === 8) content = await through('DecompressionStream', raw);
    else throw new Error(`"${path}" uses a compression (${method}) this reader does not open`);
    if (!content) throw new Error(`"${path}" could not be decompressed in this browser`);
    if (content.length !== size || crc32(content) !== crc) throw new Error(`"${path}" does not match its checksum: the archive is damaged`);
    out.push({ path, bytes: content });
  }
  return out;
}
