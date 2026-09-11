/**
 * The synopsis and the presentation are the two documents this project exists to produce, and until
 * this file existed nothing tested either of them.
 *
 * That gap shipped a defect that no inspection of the .docx could have found. `w:line` was set on
 * the document's default paragraph style with no `w:lineRule`. The attribute's omission is read as
 * `exact` by LibreOffice, and exact line spacing CLIPS inline content taller than the line — so
 * every embedded figure rendered as a 4 mm sliver showing only the bottom few pixels of the image,
 * while the `<wp:extent>` in the file said 4.38 x 1.68 inches and was perfectly correct. Nothing in
 * the package was malformed. It was visible only by rendering a page and looking at it.
 *
 * These tests therefore assert on the RENDERED CONSEQUENCES a reader would see, not on whether the
 * builder ran without throwing:
 *   - no paragraph anywhere specifies a line height without saying how to interpret it
 *   - every embedded image keeps the aspect ratio of the PNG it came from
 *   - every figure the markdown asks for is actually in the file
 *   - no authoring marker survives into the output as literal text
 *   - the builders report no warnings, and the deck reports no content past the bottom margin
 *
 * Both builders are run into a temporary directory, so running the tests never touches the
 * committed artefacts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SYNOPSIS_MD = join(ROOT, 'synopsis', 'SYNOPSIS_AdtU.md');
const FIGURES = join(ROOT, 'synopsis', 'figures');

let dir: string;
let docxPath: string;
let pptxPath: string;
let docxWarnings: string;
let pptxWarnings: string;

/** Read one part out of an OOXML package without unzipping the whole thing to disk. */
function part(pkg: string, name: string): string {
  return execFileSync('unzip', ['-p', pkg, name], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}

function parts(pkg: string, pattern: RegExp): string[] {
  const listing = execFileSync('unzip', ['-Z1', pkg]).toString('utf8').split('\n');
  return listing.filter((n) => pattern.test(n)).map((n) => part(pkg, n));
}

/** Intrinsic pixel size from a PNG's IHDR, which is always the first chunk. */
function pngSize(file: string): { w: number; h: number } {
  const buf = readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'synopsis-build-'));
  docxPath = join(dir, 'out.docx');
  pptxPath = join(dir, 'out.pptx');

  // stderr is captured rather than inherited: a builder warning is a test failure, not a log line.
  const run = (args: string[]) => {
    const chunks: string[] = [];
    try {
      const out = execFileSync('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      chunks.push(out.toString('utf8'));
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; message: string };
      throw new Error(`build failed: ${args.join(' ')}\n${err.stderr?.toString() ?? err.message}`);
    }
    return chunks.join('');
  };

  docxWarnings = run(['synopsis/build_docx.cjs', SYNOPSIS_MD, docxPath]);
  pptxWarnings = run(['synopsis/build_pptx.cjs', pptxPath]);
}, 120_000);

afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('the synopsis document', () => {
  it('matches the page specification the university sets', () => {
    /*
     * AdtU Annexure AdtU/PhD/A(i): left 3.0 cm, right 2.0 cm, top and bottom 2.54 cm, Times New
     * Roman, line spacing 1.5. That was recorded only as a comment in the builder the synopsis used
     * to be produced by; when it moved to build_docx.cjs the numbers were restated as one inch all
     * round with 1.42 spacing, and nothing compared the two. The binding margin was 0.46 cm short
     * of requirement — the kind of thing a submission is returned for before anyone reads a word.
     */
    const spec = require(join(ROOT, 'synopsis', 'adtu_spec.cjs'));
    const xml = part(docxPath, 'word/document.xml');

    const pgMar = /<w:pgMar\b[^>]*\/>/.exec(xml);
    expect(pgMar, 'the document declares no page margins').not.toBeNull();
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const got = new RegExp(`w:${side}="(\\d+)"`).exec(pgMar![0]);
      expect(Number(got?.[1]), `${side} margin`).toBe(spec.margin[side]);
    }

    const pgSz = /<w:pgSz\b[^>]*\/>/.exec(xml);
    expect(Number(/w:w="(\d+)"/.exec(pgSz![0])?.[1]), 'page width').toBe(spec.page.width);
    expect(Number(/w:h="(\d+)"/.exec(pgSz![0])?.[1]), 'page height').toBe(spec.page.height);

    // Body text at 1.5; the reference list is the one deliberate exception, set single with a
    // hanging indent as APA requires.
    const lines = new Set([...xml.matchAll(/<w:spacing[^>]*w:line="(\d+)"/g)].map((m) => Number(m[1])));
    expect([...lines].sort((a, b) => a - b), 'an unexpected line height is in use')
      .toEqual([spec.lineSingle, spec.line]);
  });

  it('never specifies a line height without saying how to interpret it', () => {
    /*
     * The regression this file exists for. `<w:spacing w:line="340"/>` with no `w:lineRule` is read
     * as `exact` by LibreOffice, which clips every inline image to the line height. The document
     * measured correct and rendered wrong.
     */
    const offenders: string[] = [];
    for (const xml of [part(docxPath, 'word/document.xml'), part(docxPath, 'word/styles.xml')]) {
      for (const m of xml.matchAll(/<w:spacing\b[^>]*\/>/g)) {
        if (/w:line="/.test(m[0]) && !/w:lineRule="/.test(m[0])) offenders.push(m[0]);
      }
    }
    expect([...new Set(offenders)],
      'a line height with no rule: readers disagree on the default, and "exact" clips inline images')
      .toEqual([]);
  });

  it('keeps every embedded figure at the aspect ratio of its source PNG', () => {
    const xml = part(docxPath, 'word/document.xml');
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)]
      .map((m) => Number(m[1]) / Number(m[2]));

    const wanted = [...readFileSync(SYNOPSIS_MD, 'utf8').matchAll(/<!--FIG:([A-Za-z0-9_.-]+)-->/g)]
      .map((m) => pngSize(join(FIGURES, `${m[1]}.png`)))
      .map((s) => s.w / s.h);

    expect(extents).toHaveLength(wanted.length);
    extents.forEach((got, i) => {
      // 1% tolerance absorbs the rounding to whole points; anything larger is a squashed figure.
      expect(Math.abs(got - wanted[i]) / wanted[i], `figure ${i + 1} is distorted`).toBeLessThan(0.01);
    });
  });

  it('embeds every figure the markdown asks for', () => {
    const asked = [...readFileSync(SYNOPSIS_MD, 'utf8').matchAll(/<!--FIG:([A-Za-z0-9_.-]+)-->/g)]
      .map((m) => m[1]);
    expect(asked.length, 'the synopsis references no figures at all').toBeGreaterThan(0);

    const missingSource = asked.filter((name) => !existsSync(join(FIGURES, `${name}.png`)));
    expect(missingSource, 'a referenced figure has no rasterised PNG').toEqual([]);

    const media = execFileSync('unzip', ['-Z1', docxPath]).toString('utf8')
      .split('\n').filter((n) => /^word\/media\/.+\.(png|jpe?g)$/i.test(n));
    expect(media).toHaveLength(asked.length);
  });

  it('leaves no authoring marker in the rendered text', () => {
    // A marker that reaches the reader means its handler did not fire. "Pagebreak" once appeared as
    // a word in the submitted draft for exactly this reason.
    const text = part(docxPath, 'word/document.xml').replace(/<[^>]+>/g, '');
    for (const marker of ['<!--', 'PAGEBREAK', 'FIG:', 'FLOW', '-->']) {
      expect(text.includes(marker), `the marker ${marker} survived into the document text`).toBe(false);
    }
  });

  it('renders every table without breaking a word across lines', () => {
    /*
     * A column narrower than its own longest word makes the reader hyphenate mid-syllable —
     * "Proxima / l mechani / sm". The builder now derives each column's floor from its longest
     * token and steps the table's font size down until the floors fit; if it cannot, it warns.
     * Any such warning is a defect, so the build output must be silent.
     */
    expect(docxWarnings.match(/^\s*!.*$/gm) ?? [], 'the document builder reported a problem').toEqual([]);
  });

  it('centres the title page instead of setting it as body prose', () => {
    /*
     * The title, degree, candidate and university were justified body paragraphs, so the title's
     * words were stretched to reach the right margin and the page sat in its top third against the
     * left edge. Everything before the first page break is title-page matter and is centred.
     */
    const xml = part(docxPath, 'word/document.xml');
    const firstBreak = xml.indexOf('<w:br w:type="page"/>');
    expect(firstBreak, 'the document has no page break, so the title page is unbounded')
      .toBeGreaterThan(0);
    const front = xml.slice(0, firstBreak);

    expect(front.includes('<w:jc w:val="both"/>'),
      'a title-page paragraph is justified, which stretches the title across the measure').toBe(false);
    expect((front.match(/<w:jc w:val="center"\/>/g) ?? []).length,
      'the title page is not centred').toBeGreaterThan(5);
    expect(front.includes('<w:b/>'), 'the title is not set in bold').toBe(true);
  });

  it('sets the reference list flush left with a hanging indent, as APA requires', () => {
    /*
     * The body of the synopsis is justified, and the reference list inherited that: long DOIs and
     * journal titles opened rivers of white space across the line, and with no hanging indent the
     * author column could not be scanned. APA 7 sets a reference list flush left with a half-inch
     * hanging indent, and an examiner checking format will look for exactly that.
     */
    const xml = part(docxPath, 'word/document.xml');
    const refs = xml.slice(xml.search(/<w:t[^>]*>REFERENCES<\/w:t>/));
    expect(refs.length, 'no REFERENCES heading was emitted').toBeGreaterThan(1000);

    const hanging = (refs.match(/<w:ind w:left="720" w:hanging="720"\/>/g) ?? []).length;
    expect(hanging, 'reference entries carry no hanging indent').toBeGreaterThan(20);

    // Nothing after the REFERENCES heading may still be justified.
    expect(refs.includes('<w:jc w:val="both"/>'),
      'a reference entry is still justified, which opens rivers inside DOIs').toBe(false);
  });

  it('declares a fixed table layout, so the computed column widths are honoured', () => {
    const xml = part(docxPath, 'word/document.xml');
    const tables = (xml.match(/<w:tbl>/g) ?? []).length;
    expect(tables, 'no tables were emitted at all').toBeGreaterThan(0);
    expect((xml.match(/<w:tblLayout w:type="fixed"\/>/g) ?? []).length,
      'a table without a fixed layout lets the reader autofit and ignore every computed width')
      .toBe(tables);
  });
});

describe('the presentation', () => {
  it('gives each paragraph at most one set of paragraph properties', () => {
    /*
     * pptxgenjs writes an <a:pPr> before EVERY run. Paragraph properties may appear once, first;
     * with several, a renderer takes the last, so the `buNone` from a following run cancelled the
     * bullet set on the first and an italicised phrase started a new bullet mid-sentence. The
     * builder strips the strays after writing — this proves the strip actually ran.
     */
    const offenders: string[] = [];
    parts(pptxPath, /^ppt\/slides\/slide\d+\.xml$/).forEach((xml, slide) => {
      for (const p of xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
        const count = (p[0].match(/<a:pPr\b/g) ?? []).length;
        if (count > 1) offenders.push(`slide ${slide + 1}: a paragraph carries ${count} <a:pPr>`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it('reports no content past the bottom margin', () => {
    // The builder measures every block it lays out. A slide whose content runs off the page is a
    // build failure, not something to be found by squinting at a rendered thumbnail.
    expect(pptxWarnings.includes('PAST THE BOTTOM MARGIN'), pptxWarnings).toBe(false);
  });

  it('embeds every figure it references, at the source aspect ratio', () => {
    const src = readFileSync(join(ROOT, 'synopsis', 'build_pptx.cjs'), 'utf8');
    const asked = [...src.matchAll(/A\('([A-Za-z0-9_.-]+\.png)'\)/g)].map((m) => m[1]);
    expect(asked.length, 'the deck references no figures').toBeGreaterThan(0);

    const missing = asked.filter((f) => !existsSync(join(FIGURES, f)));
    expect(missing, 'the deck references a figure that does not exist').toEqual([]);

    const xml = parts(pptxPath, /^ppt\/slides\/slide\d+\.xml$/).join('');
    const ratios = [...xml.matchAll(/<a:ext cx="(\d+)" cy="(\d+)"\/>/g)]
      .map((m) => ({ cx: Number(m[1]), cy: Number(m[2]) }))
      .filter((e) => e.cx > 0 && e.cy > 0);
    const wanted = new Set(asked.map((f) => {
      const s = pngSize(join(FIGURES, f));
      return (s.w / s.h).toFixed(2);
    }));
    // Every distinct figure aspect must appear among the picture extents on some slide.
    const present = new Set(ratios.map((e) => (e.cx / e.cy).toFixed(2)));
    const unmatched = [...wanted].filter((r) => ![...present].some((p) => Math.abs(+p - +r) < 0.03));
    expect(unmatched, 'a figure is placed at an aspect ratio its source does not have').toEqual([]);
  });

  it('numbers every content slide and leaves the title and closing slides unnumbered', () => {
    const slides = parts(pptxPath, /^ppt\/slides\/slide\d+\.xml$/);
    expect(slides.length).toBeGreaterThan(10);
    const text = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    const first = text(slides[0]);
    const last = text(slides[slides.length - 1]);
    expect(first.some((t) => t.trim() === '1'), 'the title slide carries a page number').toBe(false);
    expect(last.some((t) => t.trim() === String(slides.length)),
      'the closing slide carries a page number').toBe(false);
  });
});

describe('the figures the two documents share', () => {
  it('has a rasterised PNG for every extracted SVG, and nothing orphaned', () => {
    const svgs = readdirSync(FIGURES).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, ''));
    const pngs = readdirSync(FIGURES).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''));
    // adtu_logo is a supplied asset with no SVG source; everything else is generated from GUIDE.html.
    const generated = pngs.filter((p) => p !== 'adtu_logo');
    expect(generated.filter((p) => !svgs.includes(p)), 'a PNG has no SVG source').toEqual([]);
    expect(svgs.filter((s) => !generated.includes(s)), 'an SVG was never rasterised').toEqual([]);
  });

  it('keeps every extracted SVG in step with GUIDE.html', () => {
    /*
     * The figures are authored once, in the guide, and extracted. If someone edits a figure in
     * synopsis/figures/ instead, or edits the guide and forgets to re-extract, the two drift and
     * the submitted document carries a figure the guide no longer draws.
     */
    const guide = readFileSync(join(ROOT, 'synopsis', 'GUIDE.html'), 'utf8');
    const drifted = readdirSync(FIGURES).filter((f) => f.endsWith('.svg')).filter((f) => {
      const svg = readFileSync(join(FIGURES, f), 'utf8').trim();
      return !guide.includes(svg);
    });
    expect(drifted, 'run `node synopsis/extract_figs.mjs && node synopsis/svg2png.mjs`').toEqual([]);
  });

  it('gives every figure a viewBox tall enough for its own content', () => {
    /*
     * An SVG whose content extends below its viewBox renders fine in a browser, which lets content
     * overflow, and is silently CROPPED by a screenshot. fig_pupil lost its bottom line of labels
     * that way, and nothing noticed until the PNG was looked at.
     */
    const clipped: string[] = [];
    for (const f of readdirSync(FIGURES).filter((x) => x.endsWith('.svg'))) {
      const svg = readFileSync(join(FIGURES, f), 'utf8');
      const vb = /viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg);
      if (!vb) { clipped.push(`${f}: no viewBox`); continue; }
      const height = Number(vb[1]);
      const ys: number[] = [];
      for (const m of svg.matchAll(/\by="([\d.]+)"/g)) ys.push(Number(m[1]));
      for (const m of svg.matchAll(/y="([\d.]+)"\s+width="[\d.]+"\s+height="([\d.]+)"/g)) {
        ys.push(Number(m[1]) + Number(m[2]));
      }
      for (const m of svg.matchAll(/cy="([\d.]+)"\s+r="([\d.]+)"/g)) ys.push(Number(m[1]) + Number(m[2]));
      const lowest = Math.max(0, ...ys);
      if (lowest + 4 > height) clipped.push(`${f}: content reaches y=${lowest} in a viewBox of ${height}`);
    }
    expect(clipped, 'the rasteriser will crop this figure').toEqual([]);
  });
});
