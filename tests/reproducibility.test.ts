/**
 * Reproducibility and order-invariance of the export.
 *
 * The manifest carries a checksum per file. Those checksums are only meaningful if the same data
 * always produces the same bytes - otherwise they certify nothing about content identity, which is
 * the one thing they exist for. IndexedDB returns rows in primary-key order, which for uuid keys
 * is arbitrary and can differ between an export and a re-export after a reload, so reproducibility
 * has to be enforced rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import { buildExportFiles, fnv1a } from '@/storage/export';
import { normaliseBundle } from '@/storage/gather';
import { buildFixtureBundle } from '@/sim/bundleFixture';

const contents = (b = buildFixtureBundle()) =>
  new Map(buildExportFiles(b).map((f) => [f.filename, f.content]));

/** Deterministic shuffle so a failure is reproducible. */
function shuffle<T>(xs: T[], seed = 11): T[] {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const STORES = ['eyeMetrics', 'rtSummaries', 'comprehension', 'visualSearch',
  'perception', 'fatigue', 'cvsq', 'reactionTrials', 'conditions'] as const;

describe('export reproducibility', () => {
  it('produces byte-identical output for the same bundle twice', () => {
    const a = contents();
    const b = contents();
    for (const [name, content] of a) {
      if (name === 'export_manifest.json') continue; // carries the export timestamp
      expect(content, `${name} differs between two exports`).toBe(b.get(name));
    }
  });

  it('keeps the data bundle free of an export timestamp, so its checksum identifies content', () => {
    const json = [...contents()].find(([n]) => n.endsWith('.json') && !n.includes('manifest'))![1];
    expect(json).not.toMatch(/exported_at/);
    const again = [...contents()].find(([n]) => n.endsWith('.json') && !n.includes('manifest'))![1];
    expect(fnv1a(json)).toBe(fnv1a(again));
  });

  it('records the export time in the manifest, where provenance belongs', () => {
    const m = JSON.parse(contents().get('export_manifest.json')!);
    expect(m.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('export order-invariance', () => {
  it.each(STORES)('shuffling %s changes no exported byte', (store) => {
    const base = contents();
    const b = buildFixtureBundle();
    (b[store] as unknown[]) = shuffle(b[store] as unknown[]);
    const after = contents(b);
    for (const [name, content] of base) {
      if (name === 'export_manifest.json') continue;
      expect(content, `${name} changed when ${store} was reordered`).toBe(after.get(name));
    }
  });

  it('binds each condition to its own measurements regardless of array order', () => {
    const read = (csv: string) => {
      const lines = csv.split('\n');
      const h = lines[0].split(',');
      const li = h.indexOf('condition_label');
      const bi = h.indexOf('blink_rate');
      return new Map(lines.slice(1).map((l) => { const c = l.split(','); return [c[li], c[bi]]; }));
    };
    const base = read(contents().get('10_wide_summary.csv')!);
    const b = buildFixtureBundle();
    b.conditions = shuffle(b.conditions, 29);
    b.eyeMetrics = shuffle(b.eyeMetrics, 31);
    const after = read(contents(b).get('10_wide_summary.csv')!);
    for (const [label, v] of base) expect(after.get(label), `condition ${label}`).toBe(v);
  });
});

describe('normaliseBundle', () => {
  it('is idempotent', () => {
    const once = normaliseBundle(buildFixtureBundle());
    const twice = normaliseBundle(once);
    expect(twice.conditions.map((c) => c.condition_id)).toEqual(once.conditions.map((c) => c.condition_id));
    expect(twice.eyeMetrics.map((e) => e.condition_id)).toEqual(once.eyeMetrics.map((e) => e.condition_id));
  });

  it('orders child rows by the serial position of their condition', () => {
    const b = normaliseBundle(buildFixtureBundle());
    const pos = new Map(b.conditions.map((c) => [c.condition_id, c.session_position]));
    const seq = b.eyeMetrics.map((e) => pos.get(e.condition_id)!);
    expect(seq).toEqual([...seq].sort((x, y) => x - y));
  });

  it('puts the baseline fatigue record first', () => {
    const b = normaliseBundle(buildFixtureBundle());
    expect(b.fatigue[0].stage).toBe('baseline');
  });

  it('does not mutate the input bundle', () => {
    const b = buildFixtureBundle();
    const originalOrder = b.eyeMetrics.map((e) => e.condition_id);
    b.eyeMetrics = shuffle(b.eyeMetrics, 5);
    const shuffled = b.eyeMetrics.map((e) => e.condition_id);
    normaliseBundle(b);
    expect(b.eyeMetrics.map((e) => e.condition_id)).toEqual(shuffled);
    expect(shuffled).not.toEqual(originalOrder);
  });
});

describe('checksum sensitivity', () => {
  it('changes for any single-character difference', () => {
    for (const [name, content] of contents()) {
      if (!name.endsWith('.csv') || content.length < 10) continue;
      const i = Math.floor(content.length / 2);
      const flipped = content.slice(0, i) + (content[i] === 'x' ? 'y' : 'x') + content.slice(i + 1);
      expect(fnv1a(flipped), name).not.toBe(fnv1a(content));
    }
  });
});
