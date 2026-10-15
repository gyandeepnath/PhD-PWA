/**
 * Typography ty-v2 (Round 84; lib/fonts.ts TYPOGRAPHY_VERSION): what it pins, what it leaves alone, and
 * the size check that measures the passage as drawn.
 *
 * The reading face must not change: the 700 face Round 84 adds is the same variable Roboto file as the
 * 400 the passage is set in (Google serves one file for every weight), so adding it cannot alter a glyph
 * of the passage. That it renders the reading pages, questions and search excerpts pixel-identically was
 * measured in headless Chromium for Round 84 (docs/AUDIT_FINDINGS.md); this file holds the sources to it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PASSAGES } from '@/experiment/passages';
import { CONFIG } from '@/experiment/config';
import { TYPOGRAPHY_VERSION, TYPOGRAPHY_VERSION_V1 } from '@/lib/fonts';
import { expectedLinePx, linePitchOff, READING_LINE_TOLERANCE, renderedLinePitch } from '@/lib/renderedText';
import { auditBundle } from '@/storage/integrity';
import { buildExportFiles } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { splitCsvRow } from './helpers/csv';

const ROOT = resolve(__dirname, '..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('the faces and the rendering settings', () => {
  it('has a real Roboto 700 for the bold words, and it is the same file as the reading face', () => {
    const css = read('public/fonts/fonts.css');
    for (const subset of ['latin', 'latin-ext']) {
      expect(css).toContain(`src: url('Roboto-700-normal-${subset}.woff2')`);
      const bold = readFileSync(resolve(ROOT, `public/fonts/Roboto-700-normal-${subset}.woff2`));
      const regular = readFileSync(resolve(ROOT, `public/fonts/Roboto-400-normal-${subset}.woff2`));
      expect(bold.equals(regular), `${subset}: the 700 file is the 400 file`).toBe(true);
    }
    expect(readdirSync(resolve(ROOT, 'public/fonts')).filter((f) => f.startsWith('Roboto-'))).toHaveLength(8);
  });

  it('forbids synthetic bold, and writes out the size, kerning and ligature defaults', () => {
    const css = read('src/styles/theme.css');
    const html = css.slice(css.indexOf('\nhtml {'), css.indexOf('}', css.indexOf('\nhtml {')));
    expect(html).toMatch(/-webkit-text-size-adjust: 100%;/);
    expect(html).toMatch(/\btext-size-adjust: 100%;/);
    const body = css.slice(css.indexOf('\nbody {'), css.indexOf('}', css.indexOf('\nbody {')));
    expect(body).toMatch(/font-synthesis-weight: none;/);
    expect(body).toMatch(/font-kerning: normal;/);
    expect(body).toMatch(/font-variant-ligatures: common-ligatures;/);
    // Not added: no effect off macOS, or would move line breaks in a checked corpus.
    expect(css).not.toMatch(/-webkit-font-smoothing|text-rendering:|text-wrap:/);
  });

  it('names the version the app records, and the one before it', () => {
    expect(TYPOGRAPHY_VERSION).toBe('ty-v2');
    expect(TYPOGRAPHY_VERSION_V1).toBe('ty-v1');
    expect(read('src/experiment/Experiment.tsx')).toMatch(/typography_version: TYPOGRAPHY_VERSION,/);
  });
});

describe('the passage itself is not re-spaced or hyphenated', () => {
  it('keeps the declared size, line height and paragraph gap (they decide the three pages)', () => {
    expect([CONFIG.READING_FONT_SIZE_PX, CONFIG.READING_LINE_HEIGHT, CONFIG.READING_PARAGRAPH_GAP_EM]).toEqual([22, 1.4, 0.7]);
    for (const f of ['src/tasks/ReadingTask.tsx', 'src/tasks/VisualSearchTask.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/textAlign: 'justify', hyphens: 'manual', WebkitHyphens: 'manual'/);
      expect(src, f).not.toMatch(/letterSpacing|wordSpacing/);
    }
  });

  it('has no soft hyphen or hidden break anywhere in the corpus, so "manual" hyphenation splits no word', () => {
    // hyphens: manual breaks a word only at a soft hyphen (U+00AD). With none in the text it is no
    // hyphenation at all, in every condition.
    const text = JSON.stringify(PASSAGES);
    expect(text).not.toMatch(/\u00ad|\u200b|\u2011/);
  });
});

describe('the size check: page 1 as drawn', () => {
  const original = (globalThis as { Range?: { prototype: { getClientRects?: unknown } } }).Range?.prototype.getClientRects;
  afterEach(() => { if (original) (Range.prototype as unknown as { getClientRects: unknown }).getClientRects = original; });

  it('expects 22 x 1.4 x the display scale, and calls more than 2% off a mismatch', () => {
    expect(READING_LINE_TOLERANCE).toBe(0.02);
    expect(expectedLinePx(1)).toBeCloseTo(30.8, 10);
    expect(expectedLinePx(1.66)).toBeCloseTo(51.128, 10);
    expect(linePitchOff(30.8, 1)).toBe(false);
    expect(linePitchOff(31.4, 1)).toBe(false);   // 1.9%
    expect(linePitchOff(31.5, 1)).toBe(true);    // 2.3%
    expect(linePitchOff(36.96, 1)).toBe(true);   // a 120% system text size
    expect(linePitchOff(null, 1)).toBeNull();
    expect(linePitchOff(30.8, null)).toBeNull();
  });

  it('measures from the first paragraph that runs to two lines, first line to last', () => {
    const block = document.createElement('div');
    block.innerHTML = '<p>one line</p><p>a paragraph long enough to wrap</p>';
    document.body.appendChild(block);
    // jsdom lays nothing out: give each text node's range the line boxes a browser would.
    (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = function (this: Range) {
      const text = this.startContainer.textContent ?? '';
      const tops = text === 'one line' ? [100] : [130.8, 161.6, 161.6, 192.4];   // two fragments on line 2
      return tops.map((top) => ({ top, left: 0, width: 50, height: 25 } as DOMRect));
    };
    expect(renderedLinePitch(block)).toBe(30.8);
    expect(renderedLinePitch(null)).toBeNull();
    block.remove();
  });
});

describe('the record: typography_version and the measured size', () => {
  it('exports the version (ty-v1 where a row has none), the measured pitch and the expected one', () => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => (i === 0 ? { ...c, typography_version: 'ty-v2', reading_line_px_rendered: 30.8, stimulus_scale: 1 } : c));
    const file = buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!;
    const [head, ...rows] = file.content.trim().split('\n').map(splitCsvRow);
    const col = (r: string[], k: string) => r[head.indexOf(k)];
    expect(col(rows[0], 'typography_version')).toBe('ty-v2');
    expect(col(rows[0], 'reading_line_px_rendered')).toBe('30.8');
    expect(col(rows[0], 'reading_line_px_expected')).toBe('30.8');
    expect(col(rows[1], 'typography_version')).toBe('ty-v1');
    expect(col(rows[1], 'reading_line_px_rendered')).toBe('');
  });

  it('warns when the passage was drawn at another size, naming the condition', () => {
    const b = buildFixtureBundle();
    const checks = () => auditBundle(b).findings.filter((f) => f.check === 'reading_text_size');
    b.conditions = b.conditions.map((c) => ({ ...c, stimulus_scale: 1, reading_line_px_rendered: 30.8 }));
    expect(checks()).toEqual([]);
    b.conditions = b.conditions.map((c, i) => (i === 2 ? { ...c, reading_line_px_rendered: 36.96 } : c));
    const [f] = checks();
    expect(f.severity).toBe('warning');
    expect(f.refs).toEqual([b.conditions[2].condition_label]);
    expect(f.detail).toMatch(/36\.96 px a line where 30\.80 was expected/);
  });
});
