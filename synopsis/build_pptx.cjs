/**
 * Synopsis presentation — Gyandeep Nath, PhD Optometry, Assam down town University.
 *
 * Deliberately plain. Times New Roman throughout, white slides, black text, a numbered heading on
 * every slide, plain ruled tables and plain box-and-arrow flowcharts. No cards, no drop shadows,
 * no coloured discs, no tinted panels — an earlier version read as decorated rather than
 * scientific, and the content is the point.
 *
 * Structure follows the supplied AdtU format (title / overview / introduction / review /
 * aim & objectives / methods / expected outcome / references / thank you) on the same 15 x 9.5in
 * canvas, and carries the same title, names and university crest.
 *
 * Two tables are reproduced verbatim from SYNOPSIS_AdtU.md — Table 3.1 (eligibility) and Table 3.2
 * (the design against the published studies) — and keep their synopsis numbering, so a reader can
 * find them in the document. The three figures are the ones the synopsis document already embeds;
 * extract_figs.mjs pulls them from GUIDE.html and svg2png.mjs rasterises them, so the deck cannot
 * drift from the document. No number on these slides is computed here; all are taken from the
 * synopsis, and every reference was checked against docs/CITATION_VERIFICATION.md.
 *
 *   node synopsis/extract_figs.mjs && node synopsis/svg2png.mjs   (only if the figures changed)
 *   npm run synopsis:pptx
 */
const pptx = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const A = (f) => path.join(__dirname, 'figures', f);
// Output path is overridable so a test can build to a temporary file instead of overwriting the
// committed deck; without that, the only way to check the builder was to clobber the artefact.
const OUT = process.argv[2] || path.join(__dirname, 'Synopsis_Presentation_Gyandeep_Nath.pptx');

/* ---------------------------------------------------------------- typography and page */
const F = 'Times New Roman';
const BODY = 12;          // regular text, as specified
const SUB = 16;           // in-slide sub-heading
const HEAD = 24;          // slide heading
const TBL = 11;           // table text — tables step down one size, as in print
const CAP = 11;           // captions and footnotes

const INK = '000000';
const HEADCOL = '1F3864';
const GREY = '595959';
const RULE = '808080';
const SHADE = 'E8E8E8';

const W = 15, HT = 9.5;
const M = 0.8;
const CW = W - 2 * M;     // 13.4
const TOP = 1.4;
const BOT = 8.8;

const pres = new pptx();
pres.defineLayout({ name: 'ADTU', width: W, height: HT });
pres.layout = 'ADTU';
pres.author = 'Gyandeep Nath';
pres.title = 'Effects of Display Polarity and Text Colour on Visual Fatigue';

let n = 0;
const overflows = [];

/* ---------------------------------------------------------------- text helpers */

/** Parse *italic* markers into runs — journal titles, defined terms, and `et al.` */
function runs(md) {
  const out = [];
  for (const piece of String(md).split(/(\*[^*]+\*)/g)) {
    if (!piece) continue;
    const it = piece.startsWith('*') && piece.endsWith('*');
    out.push({ text: it ? piece.slice(1, -1) : piece, options: { italic: it } });
  }
  return out.length ? out : [{ text: '', options: {} }];
}

const plain = (md) => String(md).replace(/\*/g, '');

/**
 * Lines a string will occupy. Times New Roman runs at roughly 0.44 em per character across mixed
 * prose; the constant was calibrated against rendered slides rather than guessed, because an
 * over-estimate leaves ragged gaps between blocks and an under-estimate overlaps them.
 */
const EM = 0.44;
function lineCount(text, w, size) {
  const perLine = Math.max(8, (w * 72) / (EM * size));
  // A hard line break starts a new line whatever the measure says. Without this the title slide and
  // the closing slide — the only multi-line strings in the deck — were measured as a third of their
  // height, and the overflow gate was fed that same under-estimate and certified them clear.
  return String(text).split('\n')
    .reduce((acc, segment) => acc + Math.max(1, Math.ceil(plain(segment).length / perLine)), 0);
}

/**
 * The crest, centred, at its own aspect ratio.
 *
 * It was drawn 5.76 x 0.94in against an intrinsic 1158 x 290 — 53% too wide — so the circular
 * "Assam down town University, Estd. 2010" seal and the circular NAAC A+ badge rendered as
 * flattened ovals on the first and last slide of the deck. Reading the PNG header costs nothing and
 * removes the chance of ever typing a wrong pair of numbers again.
 */
function logoBox(y, h = 0.94) {
  const buf = fs.readFileSync(A('adtu_logo.png'));
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) throw new Error('adtu_logo.png is not a readable PNG');
  const w = h * (buf.readUInt32BE(16) / buf.readUInt32BE(20));
  return { x: (W - w) / 2, y, w, h };
}

/* ---------------------------------------------------------------- slide furniture */

function slide(heading, numbered = true) {
  const s = pres.addSlide();
  s.background = { color: 'FFFFFF' };
  n += 1;
  if (heading) {
    s.addText(heading, {
      x: M, y: 0.42, w: CW, h: 0.62, isTextBox: true, margin: 0, valign: 'top',
      fontFace: F, fontSize: HEAD, bold: true, color: HEADCOL,
    });
  }
  if (numbered) {
    s.addText(String(n), {
      x: W - M - 0.6, y: BOT + 0.2, w: 0.6, h: 0.3, isTextBox: true, margin: 0, align: 'right',
      fontFace: F, fontSize: CAP, color: GREY,
    });
  }
  s._num = n;
  return s;
}

/** Records anything that would run past the bottom margin, so it is caught at build time. */
function mark(s, y) {
  if (y > BOT) overflows.push(`slide ${s._num}: content reaches ${y.toFixed(2)}in (limit ${BOT})`);
  return y;
}

function subhead(s, text, x, y, w) {
  s.addText(text, {
    x, y, w, h: 0.32, isTextBox: true, margin: 0,
    fontFace: F, fontSize: SUB, bold: true, color: INK,
  });
  return y + 0.42;
}

/** A paragraph. Returns the y below it. */
function para(s, text, x, y, w, size = BODY, opts = {}) {
  const body = Array.isArray(text) ? text : runs(text);
  const ls = opts.lineSpacing || Math.round(size * 1.32);
  const lines = Array.isArray(text)
    ? lineCount(text.map((t) => t.text).join(''), w, size)
    : lineCount(text, w, size);
  const h = (lines * ls) / 72 + 0.08;
  s.addText(body, {
    x, y, w, h: Math.max(h, size / 72 + 0.1), isTextBox: true, margin: 0, valign: 'top',
    fontFace: F, fontSize: size, color: INK, lineSpacing: ls, ...opts,
  });
  return y + h;
}

/**
 * Bulleted list. Returns the y below it.
 *
 * pptxgenjs writes an <a:pPr> before EVERY run, so on a multi-run paragraph the bullet set on the
 * first run is cancelled by the `buNone` that follows it — which is why an italicised phrase used
 * to start a new bullet mid-sentence. Paragraph properties are therefore set on the first run of
 * each item only, and the stray trailing pPr elements are stripped from the XML after writing
 * (see `tidyParagraphProperties`).
 */
function bullets(s, items, x, y, w, size = BODY) {
  const gapPt = 7;
  const ls = Math.round(size * 1.32);
  const body = [];
  let h = 0;
  items.forEach((it, i) => {
    const isSub = it.startsWith('- ');
    const text = isSub ? it.slice(2) : it;
    const indent = isSub ? 0.55 : 0.26;
    const rs = runs(text);
    rs[0].options = {
      ...rs[0].options, bullet: { indent: 16 }, indentLevel: isSub ? 1 : 0, paraSpaceAfter: gapPt,
    };
    rs[rs.length - 1].options = { ...rs[rs.length - 1].options, breakLine: i < items.length - 1 };
    rs.forEach((r) => body.push(r));
    h += (lineCount(text, w - indent, size) * ls + gapPt) / 72;
  });
  s.addText(body, {
    x, y, w, h: h + 0.1, isTextBox: true, margin: 0, valign: 'top',
    fontFace: F, fontSize: size, color: INK, lineSpacing: ls,
  });
  return y + h;
}

/** Caption: above tables, below figures, as in print. Returns the y below it. */
function caption(s, text, x, y, w) {
  s.addText(runs(text), {
    x, y, w, h: 0.3, isTextBox: true, margin: 0,
    fontFace: F, fontSize: CAP, color: INK,
  });
  return y + 0.32;
}

/** A plain ruled table: bold shaded header row, hairline borders. */
function table(s, rows, opts) {
  const data = rows.map((r, i) => r.map((c) => {
    const cell = (c && typeof c === 'object' && 'text' in c) ? c : { text: c };
    return {
      text: cell.text,
      options: {
        bold: i === 0 || cell.bold, fill: { color: i === 0 ? SHADE : 'FFFFFF' },
        align: cell.align || 'left', valign: 'middle', color: INK,
      },
    };
  }));
  s.addTable(data, {
    fontFace: F, fontSize: TBL, color: INK,
    border: { type: 'solid', color: RULE, pt: 0.5 },
    margin: 0.05, ...opts,
  });
  /* rowH is a minimum, not a fixed height: a cell that wraps makes its row taller, and the caption
     or footnote placed below the table has to clear the real bottom. */
  const lead = (TBL * 1.22) / 72;
  const h = rows.reduce((acc, r) => {
    const lines = Math.max(...r.map((c, j) => {
      const t = (c && typeof c === 'object' && 'text' in c) ? c.text : c;
      const str = Array.isArray(t) ? t.map((x) => x.text).join('') : String(t);
      return lineCount(str, (opts.colW[j] || 1) - 0.12, TBL);
    }));
    return acc + Math.max(opts.rowH, lines * lead + 0.12);
  }, 0);
  return opts.y + h;
}

/** One box of a flowchart: plain rectangle, hairline border, no fill. */
function box(s, x, y, w, h, text, size = 11) {
  s.addShape(pres.ShapeType.rect, {
    x, y, w, h, fill: { color: 'FFFFFF' }, line: { color: INK, width: 0.75 },
  });
  s.addText(text, {
    x: x + 0.07, y, w: w - 0.14, h, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontFace: F, fontSize: size, color: INK,
    lineSpacing: Math.round(size * 1.22),
  });
}

function arrowRight(s, x, y, len) {
  s.addShape(pres.ShapeType.line, {
    x, y, w: len, h: 0, line: { color: INK, width: 0.75, endArrowType: 'triangle' },
  });
}

/* ============================================================== 1. TITLE */
{
  const s = slide(null, false);
  s.addImage({ path: A('adtu_logo.png'), ...logoBox(0.5) });

  para(s, 'ASSAM DOWN TOWN UNIVERSITY', 1.0, 1.66, 13.0, 17, { align: 'center', bold: true, charSpacing: 1.2 });
  para(s, 'Shankar Madhab Path, Gandhinagar, Panikhaiti, Guwahati, Assam – 781026',
    1.0, 2.06, 13.0, BODY, { align: 'center', color: GREY });

  s.addShape(pres.ShapeType.line, { x: 3.6, y: 2.58, w: 7.8, h: 0, line: { color: RULE, width: 0.75 } });

  para(s,
    'Effects of Display Polarity and Text Colour on Visual Fatigue,\n'
    + 'Ocular Behaviour and Task Performance,\n'
    + 'Under Controlled Ambient Illumination',
    1.2, 3.0, 12.6, HEAD, { align: 'center', bold: true, color: HEADCOL, lineSpacing: 36 });

  para(s,
    'Synopsis presentation for partial fulfilment of the requirements for the award of the degree of\n'
    + 'DOCTOR OF PHILOSOPHY (Ph.D.) IN OPTOMETRY',
    1.6, 4.95, 11.8, 14, { align: 'center', lineSpacing: 23 });

  para(s, 'Faculty of Allied and Healthcare Sciences  ·  Programme of Optometry',
    1.6, 5.75, 11.8, BODY, { align: 'center', color: GREY });

  para(s, [
    { text: 'Submitted by', options: { bold: true } },
    { text: '\nMr. Gyandeep Nath\nResearch Scholar, Programme of Optometry' },
  ], 1.4, 7.1, 5.6, BODY, { lineSpacing: 21 });

  para(s, [
    { text: 'Under the guidance of', options: { bold: true } },
    { text: '\nDr. Susmita Saha\nAssociate Dean, Faculty of Allied and Healthcare Sciences' },
  ], 8.0, 7.1, 5.6, BODY, { lineSpacing: 21 });

  s.addNotes('This synopsis proposes a within-subject experiment on how two freely changeable display '
    + 'settings — polarity and text colour — affect visual fatigue during prolonged tablet reading.');
}

/* ============================================================== 2. OVERVIEW */
{
  const s = slide('Overview');
  const items = [
    ['1.', 'Introduction', 'Background, definitions, burden of disease and the biophysiological basis'],
    ['2.', 'Review of Literature', 'Display polarity; text colour and the contrast confound; ambient illumination; the research gaps'],
    ['3.', 'Aim and Objectives', 'The aim, the four objectives, and the hypotheses attached to them'],
    ['4.', 'Methods and Methodology', 'Study design and display conditions; participants and eligibility; procedure, outcome measures and analysis'],
    ['5.', 'Expected Outcome', 'What the results are expected to establish, and the significance of the work'],
    ['6.', 'References', 'Sources cited in this presentation'],
  ];
  let y = TOP + 0.4;
  items.forEach((it) => {
    para(s, it[0], M + 0.2, y, 0.6, SUB, { bold: true });
    para(s, it[1], M + 0.85, y, 4.3, SUB, { bold: true });
    para(s, it[2], M + 5.3, y + 0.06, CW - 5.5, BODY);
    y += 1.1;
  });
  mark(s, y);
  s.addNotes('Six parts, following the prescribed synopsis structure.');
}

/* ============================================================== 3. INTRODUCTION — background */
{
  const s = slide('1. Introduction — Background and Burden');
  let y = TOP;

  y = subhead(s, 'The medium has changed', M, y, CW);
  y = bullets(s, [
    'Reading has moved from print to screens. Tablets are now a routine medium for study, work and leisure reading, often for hours at a time.',
    'A printed page reflects whatever light falls on it and is fixed once printed. A screen emits its own light, and almost every property of what it displays can be altered in software at no cost.',
    'These choices are made constantly — by interface designers, and by users every time a theme is switched — yet the evidence on their combined effect during prolonged reading remains limited.',
  ], M, y, CW) + 0.28;

  y = subhead(s, 'Terms used throughout', M, y, CW);
  y = bullets(s, [
    '*Display polarity* — which of the two elements is lighter. *Positive polarity* is dark text on a light background, the arrangement of a printed book; *negative polarity* is light text on a dark background, popularly "dark mode".',
    '*Text colour (chromaticity)* — the hue of the letters themselves, which need not be black or white.',
    '*Luminance contrast* — the difference in brightness between the letters and their background, and the property that decides whether text is easy to resolve. It is not the same as colour difference: two colours may look very different and still be hard to read against one another.',
  ], M, y, CW) + 0.28;

  y = subhead(s, 'The clinical burden', M, y, CW);
  y = bullets(s, [
    'Prolonged screen reading produces a recognised symptom cluster — dry or gritty eyes, blurred vision, delayed refocusing, headache and neck or shoulder ache — grouped as digital eye strain, or computer vision syndrome.',
    'Pooled prevalence across 103 cross-sectional studies (66,577 participants) is 69.0% (95% CI 62.3–75.3), rising to 76.1% among university students (Ccami-Bernal *et al.*, 2024).',
    'Across 45 randomised controlled trials (4,497 participants), no therapy examined — blue-blocking lenses included — reached high-certainty evidence (Singh *et al.*, 2022).',
    'The displayed stimulus is upstream of the visual load, costs nothing to change and can be deployed universally — and is the least investigated of the available levers.',
  ], M, y, CW);
  mark(s, y);

  s.addNotes('Two numbers frame the problem: roughly seven in ten screen users are affected, and nothing '
    + 'currently offered to them is proven to work.');
}

/* ============================================================== 4. INTRODUCTION — mechanism */
{
  const s = slide('1. Introduction — Biophysiological Basis');
  const colW = 5.0;

  let y = bullets(s, [
    'The symptoms arise by two routes, and separating them is what makes them measurable (Sheppard & Wolffsohn, 2018).',
    '*Accommodative and vergence route.* Sustained near focusing — a change in the shape of the lens together with inward rotation of both eyes — produces blur, difficulty refocusing, transient myopia after close work, and headache. It responds measurably to display parameters (Jiménez *et al.*, 2020; Redondo *et al.*, 2025), but is not measured in this study and is reviewed as mechanistic context.',
    '*Ocular-surface route.* A blink spreads fresh tear fluid across the surface and draws an oily secretion from the lid margins over it, which slows evaporation. Screen work lowers blink frequency and raises the proportion of blinks in which the lids approach one another but do not meet — incomplete blinks. These leave part of the surface unwetted, so the tear film thins and breaks up sooner, and the surface enters the recognised inflammatory cycle of dry eye disease (Fjaervoll *et al.*, 2022; Kamøy *et al.*, 2022).',
    'Mechanistic review attributes display-associated dry eye principally to impaired blinking, rather than to parasympathetic or blue-light contributions (Fjaervoll *et al.*, 2022).',
    'It is therefore the *completeness* of blinking, and not its frequency, that this study treats as its primary outcome.',
  ], M, TOP, colW);
  mark(s, y);

  const fw = 7.9, fh = fw * (548 / 780);
  s.addImage({ path: A('fig_pathways.png'), x: M + colW + 0.5, y: TOP, w: fw, h: fh });
  mark(s, caption(s, 'Figure 1. The two pathways from display configuration to measured outcome.',
    M + colW + 0.5, TOP + fh + 0.12, fw));

  s.addNotes('Both routes run at once from the same settings. The left route produces the performance '
    + 'measures; the right route produces the primary outcome.');
}

/* ============================================================== 5. REVIEW — polarity */
{
  const s = slide('2. Review of Literature — Display Polarity');

  let y = bullets(s, [
    '*The positive polarity advantage.* Reading is better for dark text on a light field than for light text on a dark one. This is the most consistently replicated finding in the field.',
    '*The accepted mechanism is pupillary, not aesthetic.* A positive-polarity screen is mostly white and so emits more light; more light constricts the pupil; a smaller pupil admits light through the optically cleaner centre of the lens and widens the depth of focus; the retinal image is consequently sharper (Buchner & Baumgartner, 2007; Piepenbrock *et al.*, 2014a, 2014b). Buchner *et al.* (2009) report that the advantage disappears when overall display luminance is equalised, so what is estimated is polarity together with its attendant luminance.',
    '*What the corpus does not show.* The paradigms are brief and threshold-limited and the stimuli almost entirely achromatic; none measures blinking, validated symptoms or fatigue accumulated over an hour. An advantage in legibility does not license an inference about visual fatigue.',
    'Sengsoon and Intaruk (2025), the most direct tablet test located, randomised thirty users between light and dark mode and found *no* difference in subjective visual fatigue, while critical flicker frequency and dry-eye symptoms did differ.',
  ], M, TOP, CW);

  const fw = 9.6, fh = fw * (292 / 760);
  const fy = y + 0.3;
  s.addImage({ path: A('fig_pupil.png'), x: (W - fw) / 2, y: fy, w: fw, h: fh });
  mark(s, caption(s, 'Figure 2. The pupil-mediated account of the positive polarity advantage.',
    (W - fw) / 2, fy + fh + 0.1, fw));

  s.addNotes('Nothing in this chain mentions colour. Ambient light drives pupil size the same way, which '
    + 'is why room light must be held constant rather than left to vary.');
}

/* ============================================================== 6. REVIEW — colour and ambient */
{
  const s = slide('2. Review of Literature — Text Colour, Contrast and Ambient Illumination');
  const half = 6.5, rx = M + half + 0.4;

  let y1 = subhead(s, 'Text colour and the contrast confound', M, TOP, half);
  y1 = bullets(s, [
    'The literature manipulating text chromaticity is small, and no located study has crossed colour with polarity while measuring fatigue.',
    'Jiménez *et al.* (2020) tested fourteen text–background colour combinations over 2-minute passages. Colour modulated accommodative and pupillary dynamics and low-contrast pairs were rated less legible, but no symptom outcome was recorded.',
    'Fan *et al.* (2024) tested colour under negative polarity only, reporting red worst and yellow best. That is precisely the ordering luminance contrast alone predicts for those hues on a black background, and a single-polarity design cannot exclude that explanation.',
    'Any manipulation of text colour also manipulates luminance contrast, because chromatic pigments differ intrinsically in relative luminance; chromatic contrast cannot substitute for luminance contrast (Buchner & Baumgartner, 2007).',
    'Hue and luminance contrast have therefore not been separated in the studies located.',
  ], M, y1, half);
  mark(s, y1);

  let y2 = subhead(s, 'Ambient illumination', rx, TOP, half);
  y2 = bullets(s, [
    'Illumination modulates the legibility cost of negative polarity (Dobres *et al.*, 2017) and the fatigue cost of coloured text under it (Fan *et al.*, 2024), consistent with a pupil-mediated account in which room light and display polarity trade against one another.',
    'The evidence is not uniform, and that disagreement determined the present design: the proofreading advantage was independent of ambient lighting (Buchner & Baumgartner, 2007) whereas threshold legibility showed a clear interaction (Dobres *et al.*, 2017). The performance-side effect of polarity appears not to depend on room light; the effects that do are concentrated in the ocular and tear-film measures.',
    'Lin, M., *et al.* (2025) is the most directly relevant work on that second point: reading in a dark room from a bright screen produced the greatest tear-film destabilisation and the largest blink changes, with incomplete blinking rising over time in every condition.',
    'Ambient illuminance is accordingly held constant here at a single measured level rather than manipulated. What that forfeits is stated plainly: Sethi and Ziat (2023) located the cognitive cost of negative polarity in younger adults specifically under dim conditions, and this design cannot speak to it.',
  ], rx, y2, half);
  mark(s, y2);

  let y3 = subhead(s, 'Why illumination is controlled here rather than manipulated', M, Math.max(y1, y2) + 0.35, CW);
  y3 = bullets(s, [
    'The ocular outcomes of this study are derived from the tablet’s own front camera rather than from dedicated instrumentation. In a darkened room the display is the dominant source of light falling on the reader’s face, and the two polarities differ greatly in how much light they emit: computed from the locked condition table, a positive-polarity screen casts roughly thirty times the illuminance of a negative-polarity one at the reading distance used.',
    'Against a 10 lux room that leaves the face lit about 2.3 times more brightly in positive than in negative polarity; against a 300 lux room the ratio falls to about 1.05. Camera exposure, and with it the achieved frame rate on which blink classification depends, would therefore have varied systematically with the primary independent variable.',
    'Undersampling biases the measured minimum eyelid aperture upward, inflating the incomplete-blink ratio in the direction the hypothesis predicts — and an artefact of that shape is indistinguishable from the effect it imitates. A narrower question answered with a trustworthy instrument was therefore preferred.',
  ], M, y3, CW);
  mark(s, y3);

  s.addNotes('The disagreement between Buchner & Baumgartner and Dobres is real, and is presented as such '
    + 'rather than resolved by selective citation. The bottom block is the measurement argument, which '
    + 'is the question a committee is most likely to press on.');
}

/* ============================================================== 7. REVIEW — gaps */
{
  const s = slide('2. Review of Literature — Research Gaps');

  let y = bullets(s, [
    'The positive polarity advantage is established for brief, achromatic legibility tasks, but is untested for prolonged reading with fatigue accumulation and ocular-surface outcomes.',
    'The interaction between polarity and text colour on visual fatigue appears unestimated: the only located text-colour fatigue study held polarity constant (Fan *et al.*, 2024), and hue has not been separated from luminance contrast in the studies located.',
    'No located study reports contrast metrics alongside measured display photometry, and the prevailing accessibility standard is polarity-blind (World Wide Web Consortium, 2023).',
    'Few studies co-register a validated symptom instrument with objective markers in the same condition, leaving the subjective–objective discrepancy unresolved (Sheppard & Wolffsohn, 2018).',
    'The incomplete-blink ratio does not appear to have been tested as an outcome of a display manipulation, despite its specificity — and no automated implementation located has been validated against manual annotation, so the measure does not scale.',
  ], M, TOP, CW) + 0.3;

  y = caption(s, 'Table 3.2 — The proposed design against the published studies from which its measures are drawn.', M, y, CW);
  y = table(s, [
    ['Study', 'Year', 'N', 'Conditions per participant', 'Total condition-runs', 'Ocular measure', 'Display parameter manipulated'],
    [{ text: runs('Hirota *et al.*') }, '2013', '11', '1', '11', 'Blink composition, tear break-up', 'None'],
    [{ text: runs('Jackson *et al.*') }, '2016', '12', '2', '24', 'PERCLOS', 'None'],
    [{ text: runs('Jiménez *et al.*') }, '2020', '20', '14', '280', 'Accommodation, pupil', 'Text–background colour'],
    [{ text: runs('Portello *et al.*') }, '2013', '21', '2', '42', 'Blink rate, completeness', 'None'],
    [{ text: runs('Cardona *et al.*') }, '2011', '25', '3', '75', 'Blink rate, amplitude', 'Task dynamism'],
    [{ text: runs('Lin, M., *et al.*') }, '2025', '30', '4', '120', 'Blink patterns, tear film', 'Ambient light × screen brightness'],
    [{ text: runs('Argilés *et al.*') }, '2015', '50', '6', '300', 'Blink rate, completeness', 'Reading medium'],
    [{ text: 'Proposed study', bold: true }, { text: '—', bold: true }, { text: '130', bold: true },
      { text: '10', bold: true }, { text: '1,300', bold: true },
      { text: 'Incomplete-blink ratio, blink rate, IBI, PERCLOS', bold: true },
      { text: 'Polarity × colour, illumination controlled', bold: true }],
  ], { x: M, y, w: CW, colW: [1.75, 0.7, 0.6, 1.7, 1.5, 3.35, 3.8], rowH: 0.33 });

  mark(s, para(s, 'Precision on the primary outcome follows the number of condition-runs, not the number of participants.',
    M, y + 0.14, CW, CAP, { italic: true, color: GREY }));

  s.addNotes('The table is the sample-size justification: 130 participants give 1,300 condition-runs, '
    + 'more than four times the largest comparable study.');
}

/* ============================================================== 8. AIM AND OBJECTIVES */
{
  const s = slide('3. Aim and Objectives');
  let y = TOP;

  y = subhead(s, 'Aim', M, y, CW);
  y = para(s,
    'To determine the effects and interaction of display polarity and text colour on visual fatigue, ocular behaviour and visual '
    + 'task performance during prolonged tablet-based reading under controlled ambient illumination, and, as a secondary '
    + 'methodological objective, to evaluate the validity and feasibility of camera-based blink assessment as an objective '
    + 'measure of ocular response.',
    M + 0.3, y, CW - 0.3) + 0.36;

  y = subhead(s, 'Primary objectives', M, y, CW);
  const objs = [
    'To investigate the individual and interactive effects of display polarity and text colour on subjective visual fatigue, ocular behaviour, cognitive workload and task performance during prolonged tablet reading, with ambient illumination held constant at a single controlled level.',
    'To model the contribution of luminance contrast and to distinguish it from residual, hue-specific effects, by computing standards-based contrast metrics for every condition and entering contrast explicitly alongside colour.',
    'To determine the combination of polarity and text colour that minimises visual fatigue and maximises task performance at that illumination level, and to examine how participant characteristics moderate these effects.',
  ];
  objs.forEach((o, i) => {
    para(s, `${i + 1}.`, M + 0.3, y, 0.4, BODY);
    y = para(s, o, M + 0.78, y, CW - 0.96) + 0.16;
  });
  y += 0.22;

  y = subhead(s, 'Methodological objective', M, y, CW);
  para(s, '4.', M + 0.3, y, 0.4, BODY);
  y = para(s,
    'To establish the feasibility and criterion validity of tablet-based camera metrology for this purpose, including the agreement '
    + 'of automated blink classification against manual annotation, and the correspondence between subjective and objective indices.',
    M + 0.78, y, CW - 0.96);
  mark(s, y);

  s.addNotes('Objective 2 is what makes the design unusual: it is what allows a statement about whether '
    + 'colour matters, or only contrast.');
}

/* ============================================================== 9. HYPOTHESES */
{
  const s = slide('3. Aim and Objectives — Hypotheses');
  let y = TOP;

  y = para(s, [
    { text: 'Null hypothesis (H₀).  ', options: { bold: true } },
    { text: 'Display polarity and text colour, individually or in combination, have no significant effect on visual fatigue, '
      + 'ocular behaviour or visual task performance during prolonged tablet reading at a controlled ambient illumination of 300 lux.' },
  ], M, y, CW) + 0.18;

  y = para(s, [
    { text: 'Alternative hypothesis (H₁).  ', options: { bold: true } },
    { text: 'At least one of these factors, individually or in combination, significantly affects these outcomes.' },
  ], M, y, CW) + 0.36;

  y = subhead(s, 'Hypotheses linked to the objectives', M, y, CW);

  const hs = [
    ['H₁ₐ  (Objective 1, main effects).',
      'Positive polarity and higher luminance contrast are each associated with a lower incomplete-blink ratio, lower subjective visual fatigue and better task performance.'],
    ['H₁ᵦ  (Objective 1, interaction).',
      'The effect of text colour depends on polarity. The further prediction that negative polarity costs more under dim illumination (Dobres *et al.*, 2017) is not tested here, illumination being held constant; it is retained as a stated limitation.'],
    ['H₁ᵪ  (Objective 2, contrast mediation).',
      'Colour-related variance is largely accounted for by luminance contrast. Because the computed contrast ordering reverses between the two polarities, contrast mediation predicts a matching reversal of the colour ordering, whereas a residual hue-specific effect predicts a consistent ordering — with red the a priori candidate exception (Fan *et al.*, 2024).'],
    ['H₁ᵨ  (Objective 3, moderation).',
      'Habitual display-mode preference, habitual screen exposure, typical ambient-lighting environment and digital literacy moderate the magnitude of these effects.'],
  ];
  hs.forEach((h) => {
    para(s, h[0], M + 0.3, y, 3.5, BODY, { bold: true });
    y = para(s, h[1], M + 3.95, y, CW - 4.15) + 0.24;
  });
  mark(s, y);

  s.addNotes('H1c is the testable core: the two rival results look completely different when plotted, so '
    + 'the study cannot return an ambiguous answer on that question.');
}

/* ============================================================== 10. METHODS — design */
{
  const s = slide('4. Methods and Methodology — Study Design and Display Conditions');

  let y = bullets(s, [
    '*Design.* A repeated-measures (within-subject) factorial design. Display polarity (positive, negative) is crossed with text colour (achromatic, blue, red, yellow, green), giving ten display conditions, each presented once in a single sitting. Each participant contributes ten condition-runs and serves as their own control; 130 analysed participants give 1,300 condition-runs.',
    '*Display conditions.* One tablet at a fixed white luminance, characterised photometrically before collection. Hex values are locked and WCAG contrast is computed from them, entering the analysis as a covariate. Because contrast on a white field falls as the text’s relative luminance rises while contrast on a black field rises with it, the rank order of the chromatic conditions is exactly inverted between the two polarities; the achromatic pair is contrast-matched at 21.00 : 1 in both, giving the one comparison in which a polarity effect cannot be attributed to contrast.',
    '*Ambient illumination.* Held constant at 300 lux (accepted 250–350), verified at the eye position and the display plane with a calibrated meter and logged three times per sitting. It is a controlled variable with a manipulation check, not a factor, and the level is high enough that room light rather than the display dominates the illuminance on the reader’s face — necessary because the ocular measures are camera-derived.',
    '*Counterbalancing.* A balanced Williams-type Latin square over the ten conditions: each condition occupies each serial position equally often, and precedes and follows every other equally often. Participants are assigned to rows by enrolment number, with complete balance in blocks of ten. Ten reading passages cover the ten runs, each read exactly once, so no practice effect requires adjustment.',
  ], M, TOP, CW);

  const fw = 8.6, fh = fw * (300 / 760);
  const fy = y + 0.28;
  s.addImage({ path: A('fig_design.png'), x: (W - fw) / 2, y: fy, w: fw, h: fh });
  mark(s, caption(s, 'Figure 3. The ten display conditions one participant sees within a single sitting.',
    (W - fw) / 2, fy + fh + 0.1, fw));

  s.addNotes('Every participant sees all ten conditions, so each person is their own control, and order '
    + 'follows a Williams square so each condition sits in each serial position equally often.');
}

/* ============================================================== 11. METHODS — participants */
{
  const s = slide('4. Methods and Methodology — Participants and Eligibility');
  const left = 7.2, rx = M + left + 0.6, rw = CW - left - 0.6;

  let yl = caption(s, 'Table 3.1 — Eligibility criteria.', M, TOP, left);
  yl = table(s, [
    ['Inclusion', 'Exclusion'],
    ['Age 18 to 35 years', 'Refractive error beyond ±3.00 D'],
    ['Distance visual acuity 6/6 or better, with or without correction', 'Manifest binocular vision disorder'],
    ['Habitual screen use of at least four hours daily', 'Colour-vision deficiency on screening'],
    ['No known ocular, systemic or neurological illness', 'History of photosensitivity or migraine'],
    ['Able to give written informed consent', 'Medication affecting vision, accommodation or tear film'],
    ['Able to attend one sitting of approximately 100 minutes', 'Diagnosed learning or psychiatric disorder'],
    ['—', 'Contact-lens wear on test days; ocular surgery within six months'],
  ], { x: M, y: yl, w: left, colW: [3.6, 3.6], rowH: 0.55 });
  mark(s, yl);

  let y = subhead(s, 'Setting and sampling', rx, TOP, rw);
  y = bullets(s, [
    'A controlled laboratory room at Assam down town University, in which ambient illuminance can be held constant and daylight is excluded.',
    'Purposive sampling of university students and staff meeting the criteria opposite.',
    '*145 enrolled, 130 analysed.* The target is a multiple of ten, as the Williams counterbalancing requires, and was set by simulation rather than by a formula assuming independent observations.',
    '130 participants contribute *1,300 condition-runs*. Precision on the primary outcome follows the number of condition-runs, not the number of participants.',
    'One sitting per participant. Simulation over 2,000 synthetic participants gives a median of 98 minutes and a 95th percentile of 119 — also the total contact time, there being one visit.',
    'A pilot of ten precedes the main study. Failing a 120-minute median, one withdrawal in ten, or 0.90 face presence in a tenth of runs, the conditions are split across two sittings of five, with the Williams row continuing rather than restarting.',
  ], rx, y, rw);
  mark(s, y);

  let ye = subhead(s, 'Ethical considerations', M, yl + 0.45, left);
  ye = bullets(s, [
    'Institutional Ethics Committee approval obtained before recruitment; conducted in accordance with the Declaration of Helsinki.',
    'Written informed consent, with photography and video capture consented separately and refusable without affecting participation.',
    'No video leaves the tablet unless separately consented; data are pseudonymised, and a participant may withdraw at any point.',
  ], M, ye, left);
  mark(s, ye);

  s.addNotes('Eligibility is reproduced from Table 3.1 of the synopsis without alteration.');
}

/* ============================================================== 12. METHODS — procedure and measures */
{
  const s = slide('4. Methods and Methodology — Procedure, Outcome Measures and Analysis');
  let y = subhead(s, 'The sequence within one condition-run, repeated ten times in Williams order', M, TOP, CW);

  const steps = [
    'Adaptation on\nneutral grey\n60 s (120 s when\npolarity switches)',
    'Reading task\nthe exposure that\nproduces the\nprimary outcome',
    'Comprehension,\n3 questions ·\ndisplay rating ·\nvisual-fatigue VAS',
    'Visual search\ntap every\noccurrence of a\ntarget word',
    'Go/no-go\nreaction time\n32 trials on the\nactive background',
  ];
  const bw = 2.36, gap = 0.35, bh = 1.05;
  steps.forEach((t, i) => {
    const x = M + i * (bw + gap);
    box(s, x, y, bw, bh, t, 10.5);
    if (i < steps.length - 1) arrowRight(s, x + bw + 0.04, y + bh / 2, gap - 0.08);
  });
  y += bh + 0.12;
  y = para(s, 'A self-paced rest follows every second condition and no performance feedback is given. The sitting closes with the '
    + 'CVS-Q repeated and the NASA Task Load Index administered once.', M, y, CW, CAP, { italic: true, color: GREY }) + 0.3;

  const half = 6.5, rx = M + half + 0.4, cy = y;

  let yl = subhead(s, 'Outcome measures', M, cy, half);
  yl = bullets(s, [
    '*Primary.* Incomplete-blink ratio, derived from the tablet’s front camera by facial-landmark tracking.',
    '*Key secondary.* Change in CVS-Q score from baseline (Seguí *et al.*, 2015).',
    '*Secondary.* Blink rate and inter-blink interval; a five-item visual-fatigue VAS with display comfort and clarity ratings per condition; NASA-TLX once per sitting (Hart & Staveland, 1988).',
    '*Performance.* Reading rate, comprehension accuracy, visual-search accuracy and efficiency, and reaction-time mean, variability, lapse rate, d′ and criterion.',
    '*Covariates.* Serial position, measured illuminance and display luminance, computed contrast, PERCLOS, achieved sampling rate, and refractive and binocular status.',
    'Confirmatory inference is confined to the primary outcome.',
  ], M, yl, half, 11.5);
  mark(s, yl);

  let yr = subhead(s, 'Blink classification and analysis', rx, cy, half);
  yr = caption(s, 'Eye-aspect ratio (Soukupová & Čech, 2016), expressed relative to the open-eye baseline set at calibration.', rx, yr, half);
  yr = table(s, [
    ['Eye-aspect ratio at its minimum', 'Classification'],
    ['Never falls below 0.75 × baseline', 'No blink registered'],
    ['Reaches 0.60 × baseline or lower', 'Complete blink'],
    ['Between 0.60 and 0.75 × baseline', 'Incomplete blink'],
  ], { x: rx, y: yr, w: half, colW: [4.0, 2.5], rowH: 0.33 }) + 0.16;
  yr = bullets(s, [
    'Incomplete-blink ratio = incomplete blinks ÷ all detected blinks, per condition. Counting blinks alone would miss this: a lid that descends but never meets is still one blink.',
    '*Validation.* Twenty participants contribute two 3-minute segments each for masked frame-by-frame annotation. Criteria: Cohen’s κ ≥ 0.60, and Bland–Altman bias within ±5 percentage points.',
    '*Analysis.* A binomial mixed-effects model of the incomplete-blink counts, with fixed effects for polarity, text colour, their interaction and serial position, and a random intercept for participant. Counts are modelled rather than the ratio, because a proportion from five blinks and one from sixty are not equally informative.',
  ], rx, yr, half, 11.5);
  mark(s, yr);

  s.addNotes('The classification thresholds and the validation criteria are the methodological '
    + 'contribution: no located study has validated a camera-based incomplete-blink measure against '
    + 'manual annotation.');
}

/* ============================================================== 13. EXPECTED OUTCOME */
{
  const s = slide('5. Expected Outcome and Significance');
  let y = TOP;

  y = subhead(s, 'Expected outcomes', M, y, CW);
  y = bullets(s, [
    'Quantified effects, with confidence intervals, of display polarity and text colour on subjective visual fatigue, ocular behaviour, cognitive workload and task performance at a controlled ambient illuminance — and, to the best of the available evidence, among the first estimates of the polarity-by-colour interaction on fatigue outcomes.',
    'A determination of whether the positive polarity advantage extends from brief legibility tasks to prolonged reading and ocular-surface outcomes.',
    'A separation of contrast from hue. Because the contrast ordering of the colours reverses across polarity, a crossover interaction would support contrast mediation, while a preserved ordering would indicate residual hue-specific effects — with red the a priori candidate exception.',
    'Identification of the configurations that minimise and maximise fatigue, and an indication of whether a polarity-blind contrast criterion adequately predicts measured readability.',
    'An account of subjective–objective correspondence, and a camera-based blink measure whose agreement with manual annotation is reported rather than assumed.',
  ], M, y, CW) + 0.32;

  y = subhead(s, 'Significance', M, y, CW);
  y = bullets(s, [
    'Display configuration is a preventive measure that costs nothing to change and can be deployed at population scale, for a condition affecting roughly seven in ten screen users.',
    'For interface and product design, an empirically grounded specification of text presentation and dark-mode implementation for reading applications, e-readers, e-learning platforms and operating-system themes.',
    'For accessibility standards, evidence on whether and how polarity must enter a contrast criterion that at present ignores it.',
    'For optometric practice, actionable device-configuration advice in an area where practitioners are documented to lack quality evidence.',
    'Methodologically, a scalable instrument that would relieve the manual-annotation bottleneck which has confined this literature to samples of eleven to fifty participants.',
  ], M, y, CW);
  mark(s, y);

  s.addNotes('The practical point is that, unlike every therapy trialled so far, this intervention is free.');
}

/* ============================================================== 14-15. REFERENCES */
const REFS = [
  'Argilés, M., Cardona, G., Pérez-Cabré, E., & Rodríguez, M. (2015). Blink rate and incomplete blinks in six different controlled hard-copy and electronic reading conditions. *Investigative Ophthalmology & Visual Science, 56*(11), 6679–6685.',
  'Buchner, A., & Baumgartner, N. (2007). Text–background polarity affects performance irrespective of ambient illumination and colour contrast. *Ergonomics, 50*(7), 1036–1063.',
  'Buchner, A., Mayr, S., & Brandt, M. (2009). The advantage of positive text–background polarity is due to high display luminance. *Ergonomics, 52*(7), 882–886.',
  'Cardona, G., García, C., Serés, C., Vilaseca, M., & Gispets, J. (2011). Blink rate, blink amplitude, and tear film integrity during dynamic visual display terminal tasks. *Current Eye Research, 36*(3), 190–197.',
  'Ccami-Bernal, F., Soriano-Moreno, D. R., Romero-Robles, M. A., Barriga-Chambi, F., Tuco, K. G., Castro-Diaz, S. D., Nuñez-Lupaca, J. N., Pacheco-Mendoza, J., Galvez-Olortegui, T., & Benites-Zapata, V. A. (2024). Prevalence of computer vision syndrome: A systematic review and meta-analysis. *Journal of Optometry, 17*(1), 100482.',
  'Dobres, J., Chahine, N., & Reimer, B. (2017). Effects of ambient illumination, contrast polarity, and letter size on text legibility under glance-like reading. *Applied Ergonomics, 60*, 68–73.',
  'Fan, Q., Xie, J., Dong, Z., & Wang, Y. (2024). The effect of ambient illumination and text color on visual fatigue under negative polarity. *Sensors, 24*(11), 3516.',
  'Fjaervoll, K., Fjaervoll, H., Magno, M., Nøland, S. T., Dartt, D. A., Vehof, J., & Utheim, T. P. (2022). Review on the possible pathophysiological mechanisms underlying visual display terminal-associated dry eye disease. *Acta Ophthalmologica, 100*(8), 861–877.',
  'Hart, S. G., & Staveland, L. E. (1988). Development of NASA-TLX (Task Load Index): Results of empirical and theoretical research. In P. A. Hancock & N. Meshkati (Eds.), *Human mental workload* (pp. 139–183). North-Holland.',
  'Hirota, M., Uozato, H., Kawamorita, T., Shibata, Y., & Yamamoto, S. (2013). Effect of incomplete blinking on tear film stability. *Optometry and Vision Science, 90*(7), 650–657.',
  'Jackson, M. L., Raj, S., Croft, R. J., Hayley, A. C., Downey, L. A., Kennedy, G. A., & Howard, M. E. (2016). Slow eyelid closure as a measure of driver drowsiness and its relationship to performance. *Traffic Injury Prevention, 17*(3), 251–257.',
  'Jiménez, R., Redondo, B., Molina, R., Martínez-Domingo, M. Á., Hernández-Andrés, J., & Vera, J. (2020). Short-term effects of text-background color combinations on the dynamics of the accommodative response. *Vision Research, 166*, 33–42.',
  'Kamøy, B., Magno, M., Nøland, S. T., Moe, M. C., Petrovski, G., Vehof, J., & Utheim, T. P. (2022). Video display terminal use and dry eye: Preventive measures and future perspectives. *Acta Ophthalmologica, 100*(7), 723–739.',
  'Lin, M., Zheng, X., He, C., Li, M., Lu, F., & Hu, L. (2025). Effects of ambient illuminance and mobile phone screen brightness on tear film stability, visual fatigue, and blink patterns during reading. *Contact Lens and Anterior Eye, 49*(1), 102515.',
  'Piepenbrock, C., Mayr, S., & Buchner, A. (2014a). Positive display polarity is particularly advantageous for small character sizes: Implications for display design. *Human Factors, 56*(5), 942–951.',
  'Piepenbrock, C., Mayr, S., & Buchner, A. (2014b). Smaller pupil size and better proofreading performance with positive than with negative polarity displays. *Ergonomics, 57*(11), 1670–1677.',
  'Portello, J. K., Rosenfield, M., & Chu, C. A. (2013). Blink rate, incomplete blinks and computer vision syndrome. *Optometry and Vision Science, 90*(5), 482–487.',
  'Redondo, B., Jiménez, R., Vera, J., & Rosenfield, M. (2025). The impact of break schedules on digital eye strain symptoms and ocular accommodation during prolonged near work. *Experimental Eye Research, 258*, 110463.',
  'Seguí, M. del M., Cabrero-García, J., Crespo, A., Verdú, J., & Ronda, E. (2015). A reliable and valid questionnaire was developed to measure computer vision syndrome at the workplace. *Journal of Clinical Epidemiology, 68*(6), 662–673.',
  'Sengsoon, P., & Intaruk, R. (2025). Immediate effects of light mode and dark mode features on visual fatigue in tablet users. *International Journal of Environmental Research and Public Health, 22*(4), 609.',
  'Sethi, T., & Ziat, M. (2023). Dark mode vogue: Do light-on-dark displays have measurable benefits to users? *Ergonomics, 66*(12), 1814–1828.',
  'Sheppard, A. L., & Wolffsohn, J. S. (2018). Digital eye strain: Prevalence, measurement and amelioration. *BMJ Open Ophthalmology, 3*(1), e000146.',
  'Singh, S., McGuinness, M. B., Anderson, A. J., & Downie, L. E. (2022). Interventions for the management of computer vision syndrome: A systematic review and meta-analysis. *Ophthalmology, 129*(10), 1192–1215.',
  'Soukupová, T., & Čech, J. (2016). *Real-time eye blink detection using facial landmarks* [Paper presentation]. 21st Computer Vision Winter Workshop, Rimske Toplice, Slovenia.',
  'World Wide Web Consortium. (2023, October 5). *Web content accessibility guidelines (WCAG) 2.2*. https://www.w3.org/TR/WCAG22/',
];

/**
 * The verification footnote is COMPUTED from docs/CITATION_VERIFICATION.md, never typed.
 *
 * It used to read "checked against its PubMed record or, where PubMed does not index it, against
 * the issuing authority" — which claimed more than the ledger supports: for the items PubMed does
 * not index, the issuing authority was unreachable from this environment and the ledger says in
 * terms that corroboration is not confirmation. Replacing one overstatement with a hand-counted
 * sentence only moves the problem: the first count written here, "20 of 25", was wrong — the true
 * figure is 22 and 3. A sentence about how carefully the work was done is exactly the sentence that
 * must not be guessed at, so it is derived, and a reference the ledger does not cover fails the
 * build rather than being quietly counted as verified.
 */
function verificationFootnote() {
  const ledger = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CITATION_VERIFICATION.md'), 'utf8');
  const statuses = new Map();
  for (const entry of ledger.split('\n### ').slice(1)) {
    const status = /\*\*Status:\s*([A-Z][^.*]*)/.exec(entry);
    const head = /^\d+\.\s*([^,(&—]+)/.exec(entry);
    if (status && head) statuses.set(head[1].trim().split(' ')[0], status[1].trim());
  }

  let confirmed = 0, notIndexed = 0;
  const unresolved = [];
  for (const ref of REFS) {
    const surname = /^([^,(]+)/.exec(ref)[1].trim().replace(/\.$/, '').split(' ')[0];
    const hits = [...statuses].filter(([k]) => k.startsWith(surname) || surname.startsWith(k)).map(([, v]) => v);
    if (!hits.length) { unresolved.push(surname); continue; }
    if (hits.some((h) => h.includes('NOT INDEXED'))) notIndexed += 1;
    else if (hits.some((h) => h.startsWith('CONFIRMED'))) confirmed += 1;
    else unresolved.push(`${surname} (${hits[0]})`);
  }
  if (unresolved.length) {
    throw new Error(`reference with no usable status in the verification ledger: ${unresolved.join(', ')}`);
  }

  const word = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
  return `${confirmed} of the ${REFS.length} references above are confirmed field by field against their PubMed `
    + `records. The remaining ${word(notIndexed)} are not indexed in PubMed; their metadata is corroborated by secondary `
    + `sources but was not verified at the issuing authority, which this environment could not reach. The verification `
    + `record accompanies the synopsis and states which is which.`;
}

[REFS.slice(0, 13), REFS.slice(13)].forEach((group, page) => {
  const s = slide(`6. References (${page + 1} of 2)`);
  let y = TOP;
  // One size down and tightly led, as a reference list is set in print.
  group.forEach((r) => { y = para(s, r, M, y, CW, CAP, { lineSpacing: 15 }) + 0.12; });
  mark(s, y);
  if (page === 1) {
    para(s, verificationFootnote(),
      M, BOT - 0.35, CW, CAP, { italic: true, color: GREY });
  }
});

/* ============================================================== 16. THANK YOU */
{
  const s = slide(null, false);
  s.addImage({ path: A('adtu_logo.png'), ...logoBox(2.7) });
  para(s, 'Thank you', 1.0, 4.5, 13.0, 32, { align: 'center', bold: true, color: HEADCOL });
  para(s, 'Questions and suggestions are welcome', 1.0, 5.4, 13.0, 14, { align: 'center' });
  para(s,
    'Gyandeep Nath  ·  Programme of Optometry  ·  Faculty of Allied and Healthcare Sciences\n'
    + 'Assam down town University, Guwahati',
    1.0, 6.4, 13.0, BODY, { align: 'center', color: GREY, lineSpacing: 21 });
}

/**
 * pptxgenjs writes an <a:pPr> before every run, which is invalid OOXML (paragraph properties may
 * appear once, first) and makes a renderer take the LAST one: the `buNone` from a following run
 * cancels the bullet set on the first, and an italicised phrase mid-sentence starts a new bullet.
 * Stripping every pPr but the first in each paragraph fixes it at the source.
 */
function tidyParagraphProperties(file) {
  for (const bin of ['unzip', 'zip']) {
    try { execFileSync(bin, ['-v'], { stdio: 'ignore' }); } catch {
      throw new Error(`\`${bin}\` is not on PATH; it is needed to rewrite the deck's paragraph properties`);
    }
  }

  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pptx-'));
  const staged = `${file}.tmp`;
  try {
    execFileSync('unzip', ['-qq', '-o', file, '-d', dir]);
    let touched = 0;
    const slidesDir = path.join(dir, 'ppt', 'slides');
    for (const f of fs.readdirSync(slidesDir).filter((x) => x.endsWith('.xml'))) {
      const p = path.join(slidesDir, f);
      const before = fs.readFileSync(p, 'utf8');
      const after = before.replace(/<a:p>[\s\S]*?<\/a:p>/g, (para_) => {
        let seen = false;
        return para_.replace(/<a:pPr[^>]*\/>|<a:pPr[^>]*>[\s\S]*?<\/a:pPr>/g, (m) => {
          if (seen) return '';
          seen = true;
          return m;
        });
      });
      if (after !== before) { fs.writeFileSync(p, after); touched += 1; }
    }

    /*
     * Assert the invariant rather than report a count.
     *
     * `touched` says how many files were rewritten, which is not the same as saying the deck is
     * correct: if pptxgenjs ever emits `<a:p attr="…">`, or renames the paragraph-property element,
     * every regex above misses, `touched` falls to zero, and the build still prints success while
     * shipping bullets that a renderer will drop. What must hold is that no paragraph carries more
     * than one <a:pPr>, so that is what is checked.
     */
    const offenders = [];
    for (const f of fs.readdirSync(slidesDir).filter((x) => x.endsWith('.xml'))) {
      const xml = fs.readFileSync(path.join(slidesDir, f), 'utf8');
      for (const para_ of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
        const n = (para_.match(/<a:pPr\b/g) ?? []).length;
        if (n > 1) offenders.push(`${f}: a paragraph carries ${n} <a:pPr> elements`);
      }
    }
    if (offenders.length) {
      throw new Error(`paragraph properties were not tidied — pptxgenjs's XML shape has probably `
        + `changed:\n  ${offenders.slice(0, 5).join('\n  ')}`);
    }

    /*
     * Stage and rename, never delete-then-recreate.
     *
     * This used to rmSync(file) before shelling out to zip. If zip was absent, or failed part way
     * through on a full disk, the finished deck had already been destroyed and there was nothing to
     * fall back to — the build reported an error and left no deliverable at all.
     */
    fs.rmSync(staged, { force: true });
    execFileSync('zip', ['-qXr', staged, '.'], { cwd: dir });
    if (!fs.existsSync(staged) || fs.statSync(staged).size < 1024) throw new Error('zip produced no usable archive');
    fs.renameSync(staged, file);
    return touched;
  } finally {
    fs.rmSync(staged, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

pres.writeFile({ fileName: OUT }).then((f) => {
  const touched = tidyParagraphProperties(f);
  console.log(`wrote ${f} (${n} slides; paragraph properties tidied in ${touched} slides)`);
  if (overflows.length) {
    console.error('\nCONTENT PAST THE BOTTOM MARGIN:');
    overflows.forEach((o) => console.error('  ' + o));
    process.exitCode = 1;
  }
});
