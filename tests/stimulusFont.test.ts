/**
 * The stimulus typeface as an experimental control.
 *
 * The reading passage was set in `font-family: 'Roboto'` with no fallback, loaded from Google
 * Fonts. Every session is run in aeroplane mode, so on a tablet that had not already cached the
 * file the passage rendered in the platform default — a serif on one device, a different sans on
 * another. Letter shape and stroke weight bear on reading speed and on how a colour reads against
 * its background, so that is a change to the display condition, and nothing recorded it.
 *
 * What these check is that the fix cannot quietly come undone: the faces are served from the app's
 * own origin, every place that sets the stimulus text names a full fallback stack, and the session
 * records whether the face was actually there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { STIMULUS_FONT_STACK, STIMULUS_FONT_FAMILY, stimulusFontLoaded } from '@/lib/fonts';
import { buildExportFiles } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { singleRow } from './helpers/csv';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('the stimulus typeface is served from this origin', () => {
  it('loads no font from a third-party host', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(html).toContain('/fonts/fonts.css');
  });

  it('ships the vendored face the passage is actually set in', () => {
    const files = readdirSync(resolve(root, 'public/fonts'));
    expect(files).toContain('Roboto-400-normal-latin.woff2');
    const css = read('public/fonts/fonts.css');
    expect(css).toMatch(/src: url\('\/fonts\/[^']+\.woff2'\)/);
    // Nothing in the generated stylesheet may reach back out to the network.
    expect(css).not.toMatch(/https?:/);
  });

  it('blocks rather than swaps, so the face cannot change mid-passage', () => {
    // A swap would repaint the passage in a different typeface part-way through the measurement
    // window, which is a change of stimulus during the measurement.
    expect(read('public/fonts/fonts.css')).toMatch(/font-display: block;/);
  });
});

describe('every stimulus surface names a fallback', () => {
  const surfaces = [
    'src/tasks/ReadingTask.tsx',
    'src/tasks/ComprehensionTask.tsx',
    'src/tasks/VisualSearchTask.tsx',
    'src/tasks/TaskIntro.tsx',
  ];

  it('sets the shared stack rather than a bare family name', () => {
    for (const f of surfaces) {
      const src = read(f);
      expect(src).toContain('STIMULUS_FONT_STACK');
      expect(src, `${f} still sets a bare family with no fallback`).not.toMatch(/fontFamily: '(Roboto|Roboto, sans-serif)'/);
    }
  });

  it('the stack starts with the intended face and ends in a generic', () => {
    expect(STIMULUS_FONT_STACK.startsWith(`'${STIMULUS_FONT_FAMILY}'`)).toBe(true);
    expect(STIMULUS_FONT_STACK.trimEnd().endsWith('sans-serif')).toBe(true);
  });
});

describe('whether the face loaded is recorded, not assumed', () => {
  it('reports absence rather than a failure when the browser cannot answer', async () => {
    // Node has no document.fonts. The contract is that a check that did not happen reports null,
    // never false, so an analyst is not told the stimulus was wrong on no evidence.
    await expect(stimulusFontLoaded()).resolves.toBeNull();
  });

  it('carries the answer into the export as a quality flag', () => {
    const b = buildFixtureBundle();
    const info = (s: typeof b) =>
      singleRow(buildExportFiles(s).find((x) => x.filename === '01_session_info.csv')!.content);

    expect(info(b)).toHaveProperty('stimulus_font_ok');
    expect(info({ ...b, session: { ...b.session, stimulus_font_ok: false } }).stimulus_font_ok).toBe('false');
    expect(info({ ...b, session: { ...b.session, stimulus_font_ok: true } }).stimulus_font_ok).toBe('true');
    // Unknown must export as empty, not as "false" and not as the literal "null": a check that
    // did not happen is not evidence that the stimulus was wrong.
    expect(info({ ...b, session: { ...b.session, stimulus_font_ok: null } }).stimulus_font_ok).toBe('');
  });
});
