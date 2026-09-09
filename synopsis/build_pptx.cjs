/**
 * Synopsis presentation — Gyandeep Nath, PhD Optometry, Assam down town University.
 *
 * Follows the structure of the supplied AdtU format (title / overview / introduction / review /
 * aim & objectives / methods / expected outcome / references / thank you) on the same 15 x 9.5in
 * canvas, and carries the same title, names and university logo.
 *
 * The five figures are the SAME PNGs the synopsis document embeds — extract_figs.mjs pulls them
 * from GUIDE.html and svg2png.mjs rasterises them — so the deck cannot drift from the document.
 * Every number on these slides is taken from SYNOPSIS_AdtU.md; none is computed here.
 *
 *   node synopsis/extract_figs.mjs && node synopsis/svg2png.mjs   (only if the figures changed)
 *   node synopsis/build_pptx.cjs
 *
 * Palette is taken from the university's own logo rather than chosen: 37306F and FCCB00 are the
 * two colours in the crest.
 */
const pptx = require('pptxgenjs');
const path = require('path');

const A = (f) => path.join(__dirname, 'figures', f);

/* ------------------------------------------------------------------ design system */
const NAVY = '37306F';
const NAVY_D = '272153';
const INK = '1E1B36';
const GOLD = 'FCCB00';
const MUTED = '6E6B87';
const TINT = 'F3F2F8';
const LINE = 'DCDAE8';
const WHITE = 'FFFFFF';
const CRIM = '8E2F24';

const H = 'Cambria';
const B = 'Calibri';

const W = 15, HT = 9.5;
const M = 0.7;                       // page margin
const CW = W - 2 * M;                // content width = 13.6

const pres = new pptx();
pres.defineLayout({ name: 'ADTU', width: W, height: HT });
pres.layout = 'ADTU';
pres.author = 'Gyandeep Nath';
pres.title = 'Effects of Display Polarity and Text Colour on Visual Fatigue';

/** Fresh shadow object every call — pptxgenjs mutates options in place. */
const soft = () => ({ type: 'outer', color: '9C99B5', blur: 10, offset: 2, angle: 90, opacity: 0.22 });

/** Parse *italic* markers into pptxgenjs runs, for APA journal titles. */
function runs(md, opts = {}) {
  const out = [];
  for (const piece of md.split(/(\*[^*]+\*)/g)) {
    if (!piece) continue;
    const it = piece.startsWith('*') && piece.endsWith('*');
    out.push({ text: it ? piece.slice(1, -1) : piece, options: { ...opts, italic: it } });
  }
  return out;
}

/** Standard content-slide header: eyebrow label, title, and nothing decorative. */
function head(s, eyebrow, title, sub) {
  s.addText(eyebrow.toUpperCase(), {
    x: M, y: 0.42, w: CW, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, bold: true, color: GOLD, charSpacing: 2.4,
  });
  s.addText(title, {
    x: M, y: 0.74, w: CW, h: 0.72, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 34, bold: true, color: NAVY, valign: 'top',
  });
  if (sub) {
    s.addText(sub, {
      x: M, y: 1.52, w: CW, h: 0.42, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 17, color: MUTED, valign: 'top',
    });
  }
}

/** A tinted rounded card — the deck's one repeated motif. */
function card(s, x, y, w, h, fill = TINT) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.09, fill: { color: fill },
    line: { color: fill === TINT ? LINE : fill, width: 1 }, shadow: soft(),
  });
}

/** Gold numbered disc used for ordered lists. */
function disc(s, x, y, n, d = 0.46) {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: GOLD }, line: { color: GOLD, width: 0 } });
  s.addText(String(n), {
    x, y, w: d, h: d, isTextBox: true, margin: 0, align: 'center', valign: 'middle',
    fontFace: H, fontSize: 17, bold: true, color: NAVY_D,
  });
}

function slide(dark) {
  const s = pres.addSlide();
  s.background = { color: dark ? NAVY : WHITE };
  return s;
}

/* =================================================================== 1. TITLE */
{
  const s = slide(true);

  // The crest is navy-on-white, so it needs a white field to sit on.
  s.addShape(pres.ShapeType.roundRect, {
    x: 4.35, y: 0.52, w: 6.3, h: 1.32, rectRadius: 0.12, fill: { color: WHITE }, line: { color: WHITE, width: 0 },
  });
  s.addImage({ path: A('adtu_logo.png'), x: 4.62, y: 0.71, w: 5.76, h: 0.94 });

  s.addText('Effects of Display Polarity and Text Colour\non Visual Fatigue, Ocular Behaviour\nand Task Performance,\nUnder Controlled Ambient Illumination', {
    x: 0.8, y: 2.1, w: 13.4, h: 2.85, isTextBox: true, margin: 0, align: 'center', valign: 'middle',
    fontFace: H, fontSize: 29, bold: true, color: WHITE, lineSpacing: 43,
  });

  s.addText('Synopsis presentation for partial fulfilment of the requirements for the award of\nDoctor of Philosophy (PhD) in Optometry', {
    x: 1.6, y: 5.05, w: 11.8, h: 0.85, isTextBox: true, margin: 0, align: 'center',
    fontFace: B, fontSize: 16, color: GOLD, lineSpacing: 24,
  });

  const panel = (x, label, lines) => {
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 6.2, w: 5.9, h: 1.85, rectRadius: 0.1,
      fill: { color: WHITE, transparency: 90 }, line: { color: 'FFFFFF', width: 1, transparency: 70 },
    });
    s.addText(label, {
      x: x + 0.4, y: 6.42, w: 5.1, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 12.5, bold: true, color: GOLD, charSpacing: 1.6,
    });
    s.addText(lines, {
      x: x + 0.4, y: 6.76, w: 5.1, h: 1.1, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 15, color: WHITE, lineSpacing: 21,
    });
  };
  panel(0.85, 'SUBMITTED BY', 'Mr. Gyandeep Nath\nProgramme of Optometry');
  panel(8.25, 'UNDER THE GUIDANCE OF', 'Dr. Susmita Saha\nAssociate Dean, Faculty of Allied and Healthcare Sciences');

  s.addText('Assam down town University · Shankar Madhab Path, Gandhinagar, Panikhaiti, Guwahati, Assam – 781026', {
    x: M, y: 8.4, w: CW, h: 0.34, isTextBox: true, margin: 0, align: 'center',
    fontFace: B, fontSize: 12.5, color: 'B9B5D6',
  });

  s.addNotes('Good morning. This synopsis proposes a within-subject experiment on how two freely changeable display settings — polarity and text colour — affect visual fatigue during prolonged tablet reading.');
}

/* =================================================================== 2. OVERVIEW */
{
  const s = slide();
  head(s, 'Contents', 'Overview');

  const items = [
    ['Introduction', 'Why display settings are a health question'],
    ['Review of Literature', 'What is established, and what is not'],
    ['Aim & Objectives', 'The four questions this study answers'],
    ['Methods & Methodology', 'Design, participants, measures'],
    ['Expected Outcome', 'What the results will let us say'],
    ['References', 'Key sources'],
  ];
  items.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 7.0, y = 2.45 + row * 2.02;
    card(s, x, y, 6.6, 1.62);
    disc(s, x + 0.42, y + 0.44, i + 1, 0.62);
    s.addText(it[0], {
      x: x + 1.28, y: y + 0.36, w: 5.0, h: 0.44, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 22, bold: true, color: NAVY,
    });
    s.addText(it[1], {
      x: x + 1.28, y: y + 0.86, w: 5.0, h: 0.4, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 15, color: MUTED,
    });
  });

  s.addNotes('Six parts. I will spend most of the time on the design and on why the measurement had to be built rather than bought.');
}

/* =================================================================== 3. INTRODUCTION — the problem */
{
  const s = slide();
  head(s, '01 · Introduction', 'A very common complaint, with no treatment that works');

  card(s, M, 2.3, 7.7, 6.3);
  const body = [
    { text: 'Reading has moved onto screens. ', options: { bold: true } },
    { text: 'A printed page reflects light and is fixed once printed. A screen emits its own light, and almost every property of what it shows can be changed in software — for free, by anyone.\n\n' },
    { text: 'Prolonged screen reading causes a recognised cluster of symptoms: ', options: {} },
    { text: 'dry or gritty eyes, blurred vision, slow refocusing, headache and neck ache. ', options: { italic: true } },
    { text: 'Together these are called digital eye strain, or computer vision syndrome.\n\n' },
    { text: 'The remedies that are promoted most — blue-blocking lenses above all — have no high-certainty trial evidence behind them.\n\n' },
    { text: 'Meanwhile the stimulus itself — how light or dark the screen is, and what colour the letters are — is upstream of the whole visual load, and is the least investigated thing in the field.', options: { bold: true, color: NAVY } },
  ];
  s.addText(body, {
    x: M + 0.45, y: 2.72, w: 6.8, h: 5.5, isTextBox: true, margin: 0, valign: 'top',
    fontFace: B, fontSize: 17, color: INK, lineSpacing: 26,
  });

  const stat = (y, big, cap, sub, colour) => {
    card(s, 8.85, y, 5.45, 2.95, WHITE);
    s.addShape(pres.ShapeType.roundRect, {
      x: 8.85, y, w: 5.45, h: 2.95, rectRadius: 0.09, fill: { color: WHITE }, line: { color: LINE, width: 1.2 }, shadow: soft(),
    });
    s.addText(big, {
      x: 9.25, y: y + 0.28, w: 4.7, h: 1.25, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 66, bold: true, color: colour,
    });
    s.addText(cap, {
      x: 9.25, y: y + 1.55, w: 4.7, h: 0.42, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 19, bold: true, color: NAVY,
    });
    s.addText(sub, {
      x: 9.25, y: y + 2.0, w: 4.7, h: 0.75, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14, color: MUTED, lineSpacing: 19,
    });
  };
  stat(2.3, '69%', 'of screen users affected',
    runs('Pooled across 103 studies and 66,577 people; 76% among university students (Ccami-Bernal *et al.*, 2024)'), NAVY);
  stat(5.65, '0 of 45', 'trials show clear benefit',
    runs('No therapy examined across 45 randomised trials and 4,497 people reached high-certainty evidence (Singh *et al.*, 2022)'), CRIM);

  s.addNotes('Two numbers frame the problem: it affects roughly seven in ten screen users, and nothing we currently offer them is proven to work.');
}

/* =================================================================== 4. HOW EYES TIRE */
{
  const s = slide();
  head(s, '01 · Introduction', 'How a screen tires the eyes — two separate routes');

  const notes = [
    ['Optical route', 'Screen brightness sets pupil size, which sets how sharp the retinal image is. This drives reading speed and comfort.'],
    ['Ocular-surface route', 'A blink must close fully to re-spread the tear film. Screen work makes blinks less frequent and less complete.'],
    ['Measured here', 'The second route, directly — the proportion of blinks that fail to close. That proportion is the study\u2019s primary outcome.'],
  ];
  notes.forEach((n, i) => {
    const y = 2.3 + i * 2.15;
    card(s, M, y, 3.55, 1.85);
    s.addText(n[0], {
      x: M + 0.3, y: y + 0.22, w: 3.0, h: 0.36, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 16.5, bold: true, color: i === 2 ? CRIM : NAVY,
    });
    s.addText(n[1], {
      x: M + 0.3, y: y + 0.62, w: 3.0, h: 1.1, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 13.5, color: MUTED, lineSpacing: 18,
    });
  });

  // 780 x 548
  s.addImage({ path: A('fig_pathways.png'), x: 4.75, y: 2.25, w: 8.6, h: 6.04 });

  s.addNotes('Both routes run at once from the same settings. The left one produces the performance measures; the right one produces the primary outcome.');
}

/* =================================================================== 5. REVIEW — polarity */
{
  const s = slide();
  head(s, '02 · Review of Literature', 'Polarity: the best-replicated finding in the field',
    'Dark text on a light screen reads better than light text on a dark one — the “positive polarity advantage”. The accepted explanation is about light, not taste.');

  // 760 x 292
  s.addImage({ path: A('fig_pupil.png'), x: M, y: 2.35, w: 13.6, h: 5.22 });

  card(s, M, 7.85, CW, 1.0, TINT);
  s.addText([
    { text: 'Why it matters here:  ', options: { bold: true, color: NAVY } },
    { text: 'nothing in that chain mentions colour. Ambient light drives pupil size the same way, so it must be held constant — otherwise a room-light effect would masquerade as a polarity effect.' },
  ], {
    x: M + 0.4, y: 8.05, w: CW - 0.8, h: 0.6, isTextBox: true, margin: 0, valign: 'middle',
    fontFace: B, fontSize: 16, color: INK,
  });

  s.addNotes('Buchner & Baumgartner 2007; Piepenbrock et al. 2014. The mechanism is pupillary, which is exactly why room light cannot be left to vary.');
}

/* =================================================================== 6. REVIEW — the gap */
{
  const s = slide();
  head(s, '02 · Review of Literature', 'What has not been done');

  const gaps = [
    'Polarity is established only for brief, black-and-white legibility tasks — not for prolonged reading, and never with tear-film outcomes.',
    'No located study has crossed polarity with text colour, so their interaction has never been estimated.',
    'Colour and luminance contrast have not been separated: an apparent colour effect may simply be a contrast effect.',
    'Blink completeness has been counted by hand, frame by frame — which is why every such study has 11 to 50 participants.',
  ];
  gaps.forEach((g, i) => {
    const y = 2.35 + i * 1.62;
    card(s, M, y, 6.5, 1.42);
    disc(s, M + 0.3, y + 0.28, i + 1, 0.5);
    s.addText(g, {
      x: M + 1.0, y: y + 0.22, w: 5.3, h: 1.05, isTextBox: true, margin: 0, valign: 'middle',
      fontFace: B, fontSize: 14, color: INK, lineSpacing: 19,
    });
  });

  const rows = [
    [{ text: 'Study', options: { bold: true } }, { text: 'N', options: { bold: true, align: 'center' } },
     { text: 'Condition-runs', options: { bold: true, align: 'center' } }, { text: 'Display parameter varied', options: { bold: true } }],
    ['Hirota et al. (2013)', '11', '11', 'None'],
    ['Jackson et al. (2016)', '12', '24', 'None'],
    ['Jiménez et al. (2020)', '20', '280', 'Text–background colour'],
    ['Portello et al. (2013)', '21', '42', 'None'],
    ['Cardona et al. (2011)', '25', '75', 'Task dynamism'],
    ['Lin, M., et al. (2025)', '30', '120', 'Ambient light × brightness'],
    ['Argilés et al. (2015)', '50', '300', 'Reading medium'],
    ['Proposed study', '130', '1,300', 'Polarity × text colour'],
  ].map((r, i) => r.map((c, j) => {
    const cell = typeof c === 'string' ? { text: c } : c;
    const last = i === 8;
    // "et al." is italicised here for the same reason it is in the synopsis.
    const body = j === 0 && cell.text.includes('et al.')
      ? runs(cell.text.replace('et al.', '*et al.*'))
      : cell.text;
    return {
      text: body,
      options: {
        bold: i === 0 || last, color: last ? WHITE : (i === 0 ? NAVY : INK),
        fill: { color: i === 0 ? TINT : (last ? NAVY : WHITE) },
        align: j === 1 || j === 2 ? 'center' : 'left',
      },
    };
  }));

  s.addText('Every study this design borrows a measure from, and what it produced', {
    x: 7.75, y: 2.35, w: 6.55, h: 0.34, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 16.5, bold: true, color: NAVY,
  });
  s.addTable(rows, {
    x: 7.75, y: 2.78, w: 6.55, colW: [2.25, 0.7, 1.35, 2.25],
    fontFace: B, fontSize: 12.5, color: INK, valign: 'middle',
    border: { type: 'solid', color: LINE, pt: 0.75 },
    rowH: 0.44, margin: 0.06,
  });
  s.addText('Precision on the primary outcome follows the number of condition-runs, not participants.', {
    x: 7.75, y: 7.5, w: 6.55, h: 0.6, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13.5, italic: true, color: MUTED, lineSpacing: 18,
  });

  s.addNotes('The right-hand table is the sample-size justification: 130 participants give 1,300 condition-runs, roughly four times the largest comparable study.');
}

/* =================================================================== 7. AIM & OBJECTIVES */
{
  const s = slide();
  head(s, '03 · Aim & Objectives', 'Aim & Objectives');

  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 2.25, w: CW, h: 1.72, rectRadius: 0.1, fill: { color: NAVY }, line: { color: NAVY, width: 0 }, shadow: soft(),
  });
  s.addText('AIM', {
    x: M + 0.45, y: 2.46, w: 2.0, h: 0.32, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, bold: true, color: GOLD, charSpacing: 2.4,
  });
  s.addText('To determine the effects and interaction of display polarity and text colour on visual fatigue, ocular behaviour and visual task performance during prolonged tablet reading at a controlled level of room light — and to test whether a tablet’s own camera can measure blinking well enough to do it.', {
    x: M + 0.45, y: 2.82, w: CW - 0.9, h: 1.0, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 17.5, color: WHITE, lineSpacing: 25,
  });

  const objs = [
    ['Effects and interaction', 'Measure how polarity and text colour — separately and together — change visual fatigue, blinking, workload and task performance.'],
    ['Contrast or hue?', 'Separate the part of any colour effect that is really luminance contrast from any effect of hue itself, by computing contrast for every condition.'],
    ['Best and worst settings', 'Identify which polarity-and-colour combination minimises fatigue and maximises performance, and for whom.'],
    ['A measurement that scales', 'Establish whether tablet-camera blink classification agrees with manual annotation well enough to replace it.'],
  ];
  objs.forEach((o, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 7.0, y = 4.3 + row * 2.25;
    card(s, x, y, 6.6, 1.95);
    disc(s, x + 0.4, y + 0.34, i + 1, 0.58);
    s.addText(o[0], {
      x: x + 1.22, y: y + 0.3, w: 5.0, h: 0.4, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 19, bold: true, color: i === 3 ? CRIM : NAVY,
    });
    s.addText(o[1], {
      x: x + 1.22, y: y + 0.76, w: 5.05, h: 1.05, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14, color: INK, lineSpacing: 19,
    });
  });
  s.addText('Objectives 1–3 are primary; objective 4 is methodological.', {
    x: M, y: 8.85, w: CW, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, italic: true, color: MUTED,
  });

  s.addNotes('Objective 2 is the one that makes the design unusual — it is what lets us say whether colour matters, or only contrast.');
}

/* =================================================================== 8. HYPOTHESES */
{
  const s = slide();
  head(s, '03 · Aim & Objectives', 'Hypotheses');

  const pair = (x, tag, txt, colour) => {
    card(s, x, 2.3, 6.6, 1.75, WHITE);
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 2.3, w: 6.6, h: 1.75, rectRadius: 0.09, fill: { color: WHITE }, line: { color: colour, width: 1.5 }, shadow: soft(),
    });
    s.addText(tag, {
      x: x + 0.4, y: 2.5, w: 5.8, h: 0.36, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 19, bold: true, color: colour,
    });
    s.addText(txt, {
      x: x + 0.4, y: 2.9, w: 5.8, h: 1.0, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14.5, color: INK, lineSpacing: 20,
    });
  };
  pair(M, 'Null hypothesis (H₀)', 'Polarity and text colour, alone or together, have no significant effect on visual fatigue, ocular behaviour or task performance at 300 lux.', MUTED);
  pair(M + 7.0, 'Alternative hypothesis (H₁)', 'At least one of them does.', NAVY);

  const subs = [
    ['H₁ₐ  Main effects', 'Positive polarity and higher luminance contrast each give a lower incomplete-blink ratio, less fatigue and better performance.'],
    ['H₁ᵦ  Interaction', 'The effect of text colour depends on polarity.'],
    ['H₁ᵪ  Contrast mediation', 'Most colour-related variance is luminance contrast. Because the contrast ordering reverses between polarities, contrast mediation predicts the colour ordering reverses too; a real hue effect predicts it does not.'],
    ['H₁ᵨ  Moderation', 'Habitual dark-mode preference, daily screen exposure, usual lighting environment and digital literacy change the size of these effects.'],
  ];
  subs.forEach((h, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 7.0, y = 4.35 + row * 2.25;
    card(s, x, y, 6.6, 1.95);
    s.addText(h[0], {
      x: x + 0.4, y: y + 0.24, w: 5.8, h: 0.4, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 18, bold: true, color: NAVY,
    });
    s.addText(h[1], {
      x: x + 0.4, y: y + 0.7, w: 5.8, h: 1.1, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14, color: INK, lineSpacing: 19,
    });
  });

  s.addNotes('H1c is the testable core: the two rival results look completely different on a graph, so the study cannot come back ambiguous on that question.');
}

/* =================================================================== 9. DESIGN */
{
  const s = slide();
  head(s, '04 · Methods & Methodology', 'The design in one picture');

  const chips = [
    ['2 × 5', '10 display conditions'],
    ['1 sitting', '≈ 98 min, one visit'],
    ['300 lux', 'room light held constant'],
    ['1,300', 'condition-runs in total'],
  ];
  chips.forEach((c, i) => {
    const x = M + i * 3.44;
    card(s, x, 2.25, 3.24, 1.28, WHITE);
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 2.25, w: 3.24, h: 1.28, rectRadius: 0.09, fill: { color: TINT }, line: { color: LINE, width: 1 }, shadow: soft(),
    });
    s.addText(c[0], {
      x: x + 0.2, y: 2.4, w: 2.84, h: 0.58, isTextBox: true, margin: 0, align: 'center',
      fontFace: H, fontSize: 28, bold: true, color: NAVY,
    });
    s.addText(c[1], {
      x: x + 0.2, y: 3.0, w: 2.84, h: 0.38, isTextBox: true, margin: 0, align: 'center',
      fontFace: B, fontSize: 13.5, color: MUTED,
    });
  });

  // 760 x 300
  s.addImage({ path: A('fig_design.png'), x: M, y: 3.85, w: 13.6, h: 5.37 });

  s.addNotes('Repeated measures: every participant sees all ten conditions, so each person is their own control. Order follows a Williams square, so each condition sits in each position equally often.');
}

/* =================================================================== 10. THE TEN CONDITIONS */
{
  const s = slide();
  head(s, '04 · Methods & Methodology', 'Ten conditions — where the arithmetic does the work');

  // 720 x 430
  s.addImage({ path: A('fig_contrast_curve.png'), x: M, y: 2.3, w: 7.3, h: 4.36 });

  const cond = [
    ['Code', 'Text', 'Background', 'Contrast'],
    ['P1', 'Black', 'White', '21.00 : 1'],
    ['P2', 'Blue', 'White', '6.70 : 1'],
    ['P3', 'Red', 'White', '5.74 : 1'],
    ['P4', 'Yellow', 'White', '2.39 : 1'],
    ['P5', 'Green', 'White', '3.19 : 1'],
    ['N1', 'White', 'Black', '21.00 : 1'],
    ['N2', 'Blue', 'Black', '3.14 : 1'],
    ['N3', 'Red', 'Black', '3.66 : 1'],
    ['N4', 'Yellow', 'Black', '8.79 : 1'],
    ['N5', 'Green', 'Black', '6.57 : 1'],
  ].map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      bold: i === 0 || i === 1 || i === 6,
      color: i === 0 ? NAVY : INK,
      fill: { color: i === 0 ? TINT : ((i === 1 || i === 6) ? 'FFF8DA' : WHITE) },
      align: j === 0 || j === 3 ? 'center' : 'left',
    },
  })));
  s.addTable(cond, {
    x: 8.5, y: 2.3, w: 5.8, colW: [0.95, 1.55, 1.75, 1.55],
    fontFace: B, fontSize: 13, color: INK, valign: 'middle',
    border: { type: 'solid', color: LINE, pt: 0.75 }, rowH: 0.385, margin: 0.06,
  });
  s.addText('The two highlighted rows are the achromatic anchor.', {
    x: 8.5, y: 6.72, w: 5.8, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, italic: true, color: MUTED,
  });

  card(s, M, 7.28, CW, 1.78);
  s.addText([
    { text: 'Contrast on white falls as the text gets lighter; contrast on black rises. ', options: { bold: true, color: NAVY } },
    { text: 'So the five colours occupy exactly reversed rank orders in the two polarities — that is arithmetic, not design, and it is what makes contrast separable from hue. Black-on-white and white-on-black are both 21.00 : 1, giving the one comparison in which a polarity effect cannot be blamed on contrast.' },
  ], {
    x: M + 0.4, y: 7.48, w: CW - 0.8, h: 1.4, isTextBox: true, margin: 0, valign: 'top',
    fontFace: B, fontSize: 15, color: INK, lineSpacing: 22,
  });

  s.addNotes('If colour effects are really contrast effects, the lines cross over between polarities. If hue matters in its own right, the ordering is preserved. Two different-looking answers.');
}

/* =================================================================== 11. PARTICIPANTS, PROCEDURE, MEASURES */
{
  const s = slide();
  head(s, '04 · Methods & Methodology', 'Participants, procedure and measures');

  const cols = [
    ['Participants', NAVY, [
      '145 enrolled · 130 analysed',
      'Adults 18–35, purposive sampling from the university',
      'Acuity 6/6 or better; refractive error within ±3.00 D',
      'Normal colour vision; ≥ 4 h daily screen use',
      'Excluded: binocular vision disorder, ocular or systemic illness, photosensitivity, contact lenses on test day',
    ]],
    ['One sitting, ten runs', NAVY, [
      'Seated 50–60 cm from a single fixed tablet',
      'Room metered at 300 lux (250–350) at start, middle and end',
      'Each run: 60 s grey adaptation → reading → comprehension, comfort and fatigue ratings → visual search → reaction time',
      'Rest after every second condition; no feedback given',
      'CVS-Q repeated and NASA-TLX once at the close',
    ]],
    ['Measures', CRIM, [
      'Primary — incomplete-blink ratio, from the tablet camera',
      'Key secondary — change in CVS-Q from baseline',
      'Secondary — blink rate, inter-blink interval, visual-fatigue VAS, comfort and clarity ratings',
      'Performance — reading rate, comprehension, visual search, reaction time and lapses',
      'Analysis — binomial mixed-effects model; participant as random intercept',
    ]],
  ];
  cols.forEach((c, i) => {
    const x = M + i * 4.62;
    card(s, x, 2.3, 4.32, 5.0);
    s.addText(c[0], {
      x: x + 0.34, y: 2.55, w: 3.7, h: 0.42, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 21, bold: true, color: c[1],
    });
    s.addText(c[2].map((t, j) => ({
      text: t, options: { bullet: { code: '2022' }, breakLine: j < c[2].length - 1, paraSpaceAfter: 9 },
    })), {
      x: x + 0.34, y: 3.08, w: 3.64, h: 4.05, isTextBox: true, margin: 0, valign: 'top',
      fontFace: B, fontSize: 13.5, color: INK, lineSpacing: 18,
    });
  });

  card(s, M, 7.62, CW, 1.25, WHITE);
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 7.62, w: CW, h: 1.25, rectRadius: 0.09, fill: { color: 'FFF8DA' }, line: { color: GOLD, width: 1.2 }, shadow: soft(),
  });
  s.addText([
    { text: 'Feasibility is checked before, not after.  ', options: { bold: true, color: NAVY } },
    { text: 'Simulation over 2,000 synthetic participants puts the sitting at a median of 98 minutes and a 95th percentile of 119. A pilot of ten confirms it; if the median exceeds 120 minutes, the ten conditions split across two shorter sittings and the counterbalancing order simply continues.' },
  ], {
    x: M + 0.45, y: 7.82, w: CW - 0.9, h: 0.88, isTextBox: true, margin: 0, valign: 'middle',
    fontFace: B, fontSize: 14.5, color: INK, lineSpacing: 21,
  });

  s.addNotes('Simulation over 2,000 synthetic participants puts the sitting at a median of 98 minutes. A pilot of ten confirms it before the main study; if it overruns, the ten conditions split across two shorter sittings.');
}

/* =================================================================== 12. PRIMARY OUTCOME */
{
  const s = slide();
  head(s, '04 · Methods & Methodology', 'The primary outcome: a blink that does not close');

  card(s, M, 2.3, 4.15, 6.1);
  s.addText([
    { text: 'Why completeness, not rate.\n', options: { bold: true, color: NAVY, fontSize: 16 } },
    { text: 'A blink spreads the tear film only if the lids actually meet. One that stops short leaves part of the eye unwetted — so the film breaks up sooner. Counting blinks would miss this entirely: in the trace opposite, the total is three either way.\n\n' },
    { text: 'How it is measured.\n', options: { bold: true, color: NAVY, fontSize: 16 } },
    { text: 'Facial landmarks give an eye-aspect ratio. Two thresholds do the work: crossing 0.75 × baseline starts a blink; reaching 0.60 × baseline makes it complete. Anything between the two is incomplete.\n\n' },
    { text: 'Validation.\n', options: { bold: true, color: CRIM, fontSize: 16 } },
    { text: 'Twenty participants contribute segments for masked frame-by-frame annotation. Agreement must reach κ ≥ 0.60, with bias within ±5 percentage points.' },
  ], {
    x: M + 0.34, y: 2.62, w: 3.5, h: 5.5, isTextBox: true, margin: 0, valign: 'top',
    fontFace: B, fontSize: 13.5, color: INK, lineSpacing: 18,
  });

  // 720 x 326
  s.addImage({ path: A('fig_blink_trace.png'), x: 5.35, y: 2.85, w: 8.95, h: 4.05 });

  card(s, 5.35, 7.25, 8.95, 1.15, WHITE);
  s.addShape(pres.ShapeType.roundRect, {
    x: 5.35, y: 7.25, w: 8.95, h: 1.15, rectRadius: 0.09, fill: { color: 'FFF8DA' }, line: { color: GOLD, width: 1.2 }, shadow: soft(),
  });
  s.addText('The middle blink bottoms out at 0.68 — the lid clearly descended, but never fully closed. The study’s primary number is simply how often that happens.', {
    x: 5.7, y: 7.45, w: 8.3, h: 0.78, isTextBox: true, margin: 0, valign: 'middle',
    fontFace: B, fontSize: 15, color: INK, lineSpacing: 21,
  });

  s.addNotes('This is the methodological contribution. If it validates, the frame-by-frame annotation bottleneck that has kept this literature to fifty-participant studies disappears.');
}

/* =================================================================== 13. EXPECTED OUTCOME */
{
  const s = slide();
  head(s, '05 · Expected Outcome', 'What the results will let us say');

  const outs = [
    ['Numbers where there are none', 'Effect sizes with confidence intervals for polarity and text colour on fatigue, blinking, workload and performance — and, so far as the located evidence goes, the first estimate of how the two interact.'],
    ['A verdict on colour versus contrast', 'If the colour ordering flips between polarities, colour effects are really contrast effects. If it holds, hue matters in its own right. Red is the one colour expected to break the pattern.'],
    ['A setting to recommend', 'Which polarity-and-colour combination is best and worst for prolonged reading — and whether accessibility standards, which ignore polarity, actually predict what readers experience.'],
    ['A measure that scales', 'A camera-based blink measure reported against manual annotation, so later studies need not annotate by hand.'],
  ];
  outs.forEach((o, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 7.0, y = 2.35 + row * 2.65;
    card(s, x, y, 6.6, 2.35);
    disc(s, x + 0.4, y + 0.36, i + 1, 0.58);
    s.addText(o[0], {
      x: x + 1.22, y: y + 0.32, w: 5.0, h: 0.4, isTextBox: true, margin: 0,
      fontFace: H, fontSize: 19.5, bold: true, color: NAVY,
    });
    s.addText(o[1], {
      x: x + 1.22, y: y + 0.8, w: 5.05, h: 1.4, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14, color: INK, lineSpacing: 19,
    });
  });

  card(s, M, 7.75, CW, 1.1, WHITE);
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 7.75, w: CW, h: 1.1, rectRadius: 0.09, fill: { color: NAVY }, line: { color: NAVY, width: 0 }, shadow: soft(),
  });
  s.addText('Display configuration costs nothing to change and can be deployed at population scale — for a condition that affects roughly seven in ten screen users.', {
    x: M + 0.5, y: 7.95, w: CW - 1.0, h: 0.72, isTextBox: true, margin: 0, valign: 'middle', align: 'center',
    fontFace: H, fontSize: 18, italic: true, color: WHITE,
  });

  s.addNotes('The practical point at the bottom is the reason the work is worth doing: unlike every therapy that has been trialled, this one is free.');
}

/* =================================================================== 14. REFERENCES */
{
  const s = slide();
  head(s, '06 · References', 'References');

  const refs = [
    'Argilés, M., Cardona, G., Pérez-Cabré, E., & Rodríguez, M. (2015). Blink rate and incomplete blinks in six different controlled hard-copy and electronic reading conditions. *Investigative Ophthalmology & Visual Science, 56*(11), 6679–6685.',
    'Buchner, A., & Baumgartner, N. (2007). Text–background polarity affects performance irrespective of ambient illumination and colour contrast. *Ergonomics, 50*(7), 1036–1063.',
    'Buchner, A., Mayr, S., & Brandt, M. (2009). The advantage of positive text–background polarity is due to high display luminance. *Ergonomics, 52*(7), 882–886.',
    'Ccami-Bernal, F., Soriano-Moreno, D. R., Romero-Robles, M. A., Barriga-Chambi, F., Tuco, K. G., Castro-Diaz, S. D., … Benites-Zapata, V. A. (2024). Prevalence of computer vision syndrome: A systematic review and meta-analysis. *Journal of Optometry, 17*(1), 100482.',
    'Fan, Q., Xie, J., Dong, Z., & Wang, Y. (2024). The effect of ambient illumination and text color on visual fatigue under negative polarity. *Sensors, 24*(11), 3516.',
    'Fjaervoll, K., Fjaervoll, H., Magno, M., Nøland, S. T., Dartt, D. A., Vehof, J., & Utheim, T. P. (2022). Review on the possible pathophysiological mechanisms underlying visual display terminal-associated dry eye disease. *Acta Ophthalmologica, 100*(8), 861–877.',
    'Jiménez, R., Redondo, B., Molina, R., Martínez-Domingo, M. Á., Hernández-Andrés, J., & Vera, J. (2020). Short-term effects of text-background color combinations on the dynamics of the accommodative response. *Vision Research, 166*, 33–42.',
    'Lin, M., Zheng, X., He, C., Li, M., Lu, F., & Hu, L. (2025). Effects of ambient illuminance and mobile phone screen brightness on tear film stability, visual fatigue, and blink patterns during reading. *Contact Lens and Anterior Eye, 49*(1), 102515.',
    'Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Smaller pupil size and better proofreading performance with positive than with negative polarity displays. *Ergonomics, 57*(11), 1670–1677.',
    'Portello, J. K., Rosenfield, M., & Chu, C. A. (2013). Blink rate, incomplete blinks and computer vision syndrome. *Optometry and Vision Science, 90*(5), 482–487.',
    'Seguí, M. del M., Cabrero-García, J., Crespo, A., Verdú, J., & Ronda, E. (2015). A reliable and valid questionnaire was developed to measure computer vision syndrome at the workplace. *Journal of Clinical Epidemiology, 68*(6), 662–673.',
    'Sengsoon, P., & Intaruk, R. (2025). Immediate effects of light mode and dark mode features on visual fatigue in tablet users. *International Journal of Environmental Research and Public Health, 22*(4), 609.',
    'Sheppard, A. L., & Wolffsohn, J. S. (2018). Digital eye strain: Prevalence, measurement and amelioration. *BMJ Open Ophthalmology, 3*(1), e000146.',
    'Singh, S., McGuinness, M. B., Anderson, A. J., & Downie, L. E. (2022). Interventions for the management of computer vision syndrome: A systematic review and meta-analysis. *Ophthalmology, 129*(10), 1192–1215.',
    'Soukupová, T., & Čech, J. (2016). *Real-time eye blink detection using facial landmarks* [Paper presentation]. 21st Computer Vision Winter Workshop, Rimske Toplice, Slovenia.',
    'World Wide Web Consortium. (2023). *Web content accessibility guidelines (WCAG) 2.2.*',
  ];
  const half = 8;
  [refs.slice(0, half), refs.slice(half)].forEach((group, col) => {
    const x = M + col * 7.0;
    const body = [];
    group.forEach((r, j) => {
      const rr = runs(r);
      // breakLine ends the paragraph; paraSpaceAfter then actually separates the entries.
      rr[rr.length - 1].options = { ...rr[rr.length - 1].options, breakLine: j < group.length - 1, paraSpaceAfter: 9 };
      rr.forEach((run) => body.push(run));
    });
    s.addText(body, {
      x, y: 2.3, w: 6.6, h: 6.6, isTextBox: true, margin: 0, valign: 'top',
      fontFace: B, fontSize: 11.5, color: INK, lineSpacing: 15, paraSpaceAfter: 8,
    });
  });

  s.addNotes('The full reference list, with a verification record giving the PMID and DOI of every entry, accompanies the synopsis.');
}

/* =================================================================== 15. THANK YOU */
{
  const s = slide(true);
  s.addShape(pres.ShapeType.roundRect, {
    x: 4.35, y: 1.85, w: 6.3, h: 1.32, rectRadius: 0.12, fill: { color: WHITE }, line: { color: WHITE, width: 0 },
  });
  s.addImage({ path: A('adtu_logo.png'), x: 4.62, y: 2.04, w: 5.76, h: 0.94 });

  s.addText('Thank you', {
    x: 1.0, y: 3.9, w: 13.0, h: 1.3, isTextBox: true, margin: 0, align: 'center',
    fontFace: H, fontSize: 60, bold: true, color: WHITE,
  });
  s.addText('Questions and suggestions are welcome', {
    x: 1.0, y: 5.25, w: 13.0, h: 0.5, isTextBox: true, margin: 0, align: 'center',
    fontFace: B, fontSize: 20, color: GOLD,
  });
  s.addText('Gyandeep Nath  ·  Programme of Optometry  ·  Faculty of Allied and Healthcare Sciences\nAssam down town University, Guwahati', {
    x: 1.0, y: 6.6, w: 13.0, h: 0.9, isTextBox: true, margin: 0, align: 'center',
    fontFace: B, fontSize: 16, color: 'CFCBE6', lineSpacing: 24,
  });
}

pres.writeFile({ fileName: path.join(__dirname, 'Synopsis_Presentation_Gyandeep_Nath.pptx') })
  .then((f) => console.log('wrote', f));
