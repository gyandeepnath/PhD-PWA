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
    /**
     * RELATIVE to the stylesheet, not root-absolute.
     *
     * This used to assert `url('/fonts/…')` — and so locked in a real defect. vite.config.ts sets
     * `base: './'` precisely so the app can be served from a subdirectory, and DEPLOYMENT.md
     * recommends GitHub Pages, whose project sites are always https://user.github.io/repo/. A
     * root-absolute font URL 404s there, and the stimulus typeface — an experimental control —
     * silently falls back to whatever the tablet's default sans happens to be.
     */
    expect(css).toMatch(/src: url\('[A-Za-z][^'/]*\.woff2'\)/);
    expect(css).not.toMatch(/url\('\//);
    // Nothing in the generated stylesheet may reach back out to the network.
    expect(css).not.toMatch(/https?:/);
  });

  it('references its assets relatively everywhere, so a subdirectory deployment works', () => {
    // index.html and the MediaPipe loader had the same root-absolute assumption. MediaPipe is the
    // worst of the three: getUserMedia still succeeds and the preview still shows a face, so the
    // operator ticks every checklist box, and then every condition writes disabledEyeMetrics —
    // no primary outcome for any participant on that deployment, with nothing on screen saying so.
    // Only the <link> hrefs: the module entry `src="/src/main.tsx"` is Vite's dev-server path and
    // is rewritten to a relative asset URL at build time, which dist/index.html confirms.
    const html = read('index.html');
    expect(html).not.toMatch(/href="\/(?!\/)/);
    /*
     * Base-relative model paths now live in one place. Both the tracker and the setup-screen probe
     * had their own copy of this import, and that duplication is how a single packaging quirk
     * became two identical latent bugs; the loader owns the path resolution as well as the
     * constructor lookup. The assertion follows the logic rather than the file it used to live in.
     */
    const loader = read('src/tracking/faceMeshLoader.ts');
    expect(loader).toMatch(/BASE_URL/);
    expect(loader).not.toMatch(/`\/mediapipe\//);

    // And neither caller may go back to building the path itself.
    for (const f of ['src/tracking/useTracking.ts', 'src/screening/faceProbe.ts']) {
      const src = read(f);
      expect(src, `${f} must not resolve model assets itself`).not.toMatch(/locateFile:.*`\/mediapipe\//);
      expect(src, `${f} must go through faceMeshAssetPath`).toMatch(/faceMeshAssetPath/);
    }
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
