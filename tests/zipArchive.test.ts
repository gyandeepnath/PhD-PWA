/**
 * The archive writer and reader (lib/zipArchive.ts, Round 97): what goes in comes out, a damaged
 * archive is refused, and the same files give the same archive. The archives are also opened by
 * Python's zipfile and R's utils::unzip in scripts/verifyAnalysis.mjs, where the templates read them.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { crc32, zipArchive, readZip, ZipBuilder, joinParts } from '@/lib/zipArchive';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc('123456789')).toString(16)).toBe('cbf43926');
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipArchive and readZip', () => {
  const entries = [
    { path: 'P001_abcd1234/01_session_info.csv', bytes: enc('participant_id,x\nP001,1\n') },
    { path: 'P001_abcd1234/02_conditions.csv', bytes: enc('a,b\n'.repeat(5000)) },
    { path: 'P001_abcd1234/empty.csv', bytes: new Uint8Array(0) },
    { path: 'P001_abcd1234/ünïcode — name.json', bytes: enc('{"k":"ß µ 日本"}') },
  ];

  it('round-trips every entry, in order, deflated and stored', async () => {
    for (const compress of [true, false]) {
      const out = await readZip(await zipArchive(entries, { compress }));
      expect(out.map((e) => e.path)).toEqual(entries.map((e) => e.path));
      out.forEach((e, i) => expect(dec(e.bytes)).toBe(dec(entries[i].bytes)));
    }
  });

  it('deflates what compresses and stores what does not', async () => {
    const deflated = await zipArchive(entries);
    const stored = await zipArchive(entries, { compress: false });
    expect(deflated.length).toBeLessThan(stored.length / 5);
  });

  it('gives the same bytes for the same files', async () => {
    const a = await zipArchive(entries);
    const b = await zipArchive(entries);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('refuses a truncated archive and a damaged entry', async () => {
    const whole = await zipArchive(entries, { compress: false });
    await expect(readZip(whole.subarray(0, whole.length - 30))).rejects.toThrow(/not a ZIP archive|incomplete|damaged/);
    const damaged = whole.slice();
    // Inside the first entry's content: local header (30) + its name, then a few bytes on.
    damaged[30 + entries[0].path.length + 5] ^= 0xff;
    await expect(readZip(damaged)).rejects.toThrow(/does not match its checksum/);
    await expect(readZip(enc('this is not an archive at all'))).rejects.toThrow(/not a ZIP archive/);
  });

  it('refuses a path that could leave the folder, and the same path twice', async () => {
    const b = new ZipBuilder();
    await expect(b.add('../up.csv', enc('x'))).rejects.toThrow(/not a path/);
    await expect(b.add('/abs.csv', enc('x'))).rejects.toThrow(/not a path/);
    await expect(b.add('a\\b.csv', enc('x'))).rejects.toThrow(/not a path/);
    await b.add('ok/a.csv', enc('x'));
    await expect(b.add('ok/a.csv', enc('y'))).rejects.toThrow(/twice/);
    expect(b.entries).toBe(1);
    expect((await readZip(joinParts(b.finish()))).length).toBe(1);
  });
});
