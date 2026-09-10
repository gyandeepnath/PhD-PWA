/**
 * Build a formatted .docx (PhD synopsis style) from LITERATURE_REVIEW.md
 * Usage: node build_docx.cjs <input.md> <output.docx>
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  ExternalHyperlink, LevelFormat, convertInchesToTwip, PageBreak, ImageRun,
  LineRuleType, TableLayoutType,
} = require('docx');

const IN = process.argv[2];
const OUT = process.argv[3];
const md = fs.readFileSync(IN, 'utf8');

const FONT = 'Times New Roman';
const SIZE = 24;        // half-points => 12pt
const SIZE_SMALL = 20;  // 10pt for tables
const PAGE_W = 11906;   // A4 width in DXA
const MARGIN = 1440;    // 1 inch
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9026

/**
 * Paragraph spacing.
 *
 * `w:line` without `w:lineRule` is the single most expensive defect this builder has had. The
 * attribute's default is implementation-defined in practice: LibreOffice reads the omission as
 * `exact`, which CLIPS any inline content taller than the line — so every embedded figure in the
 * synopsis rendered as a 4 mm sliver showing only the bottom of the image, while the .docx itself
 * carried a perfectly correct <wp:extent>. Nothing in the file was wrong, so nothing that inspected
 * the file could find it; it was visible only by rendering a page.
 *
 * Every spacing object in this file goes through here, and `line` without `lineRule` is filled in
 * as `auto` rather than left to the reader to guess.
 */
function sp(o) {
  if (o.line !== undefined && o.lineRule === undefined) return { ...o, lineRule: LineRuleType.AUTO };
  return o;
}

/* ---------------- inline formatting ---------------- */
// Tokenise **bold**, *italic*, `code`, [text](url)
function inline(text, opts = {}) {
  const size = opts.size || SIZE;
  const baseBold = !!opts.bold;
  const baseItalic = !!opts.italics;
  const runs = [];
  // Split on links first, then handle emphasis inside each segment.
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, m;
  const pushPlain = (s) => { if (s) runs.push(...emphasis(s, size, baseBold, baseItalic)); };
  while ((m = linkRe.exec(text)) !== null) {
    pushPlain(text.slice(last, m.index));
    runs.push(new ExternalHyperlink({
      link: m[2],
      children: [new TextRun({
        text: m[1], font: FONT, size, color: '1155CC', underline: {},
        bold: baseBold, italics: baseItalic,
      })],
    }));
    last = linkRe.lastIndex;
  }
  pushPlain(text.slice(last));
  return runs.length ? runs : [new TextRun({ text: '', font: FONT, size })];
}

function emphasis(s, size, baseBold, baseItalic) {
  const out = [];
  // Order matters: ** before *
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  const plain = (t) => { if (t) out.push(new TextRun({ text: t, font: FONT, size, bold: baseBold, italics: baseItalic })); };
  while ((m = re.exec(s)) !== null) {
    plain(s.slice(last, m.index));
    const tok = m[1];
    if (tok.startsWith('**')) {
      out.push(new TextRun({ text: tok.slice(2, -2), font: FONT, size, bold: true, italics: baseItalic }));
    } else if (tok.startsWith('`')) {
      out.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas', size: size - 2, bold: baseBold, italics: baseItalic }));
    } else {
      out.push(new TextRun({ text: tok.slice(1, -1), font: FONT, size, italics: true, bold: baseBold }));
    }
    last = re.lastIndex;
  }
  plain(s.slice(last));
  return out;
}

/* ---------------- table helpers ---------------- */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}


/**
 * Render a FLOW block as a vertical flow diagram.
 *
 * Each step becomes a bordered, shaded, centred box; a downward arrow sits between consecutive
 * boxes. Built from table cells rather than a drawing, so it survives a round trip through Word
 * and can be edited there. A step written as "A | B" is rendered as two boxes side by side on one
 * rank, which is how the parallel stages of the participant flow are expressed.
 */
function buildFlow(steps) {
  const out = [];
  const arrow = () => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: '\u2193', font: FONT, size: 26, color: '5A6B7C' })],
  });
  const box = (text, widthTwips) => new Table({
    columnWidths: [widthTwips],
    layout: TableLayoutType.FIXED,
    width: { size: widthTwips, type: WidthType.DXA },
    alignment: AlignmentType.CENTER,
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
      left:   { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
      right:  { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: widthTwips, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: 'EEF3FA', color: 'auto' },
      margins: { top: 80, bottom: 80, left: 140, right: 140 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: sp({ before: 0, after: 0, line: 240 }),
        children: inline(text, { size: SIZE_SMALL }),
      })],
    })] })],
  });

  steps.forEach((step, n) => {
    if (n > 0) out.push(arrow());
    const parts = step.split('|').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) {
      // Parallel stages share a rank: one table, one cell per stage.
      const w = Math.floor((CONTENT_W - 400) / parts.length);
      out.push(new Table({
        columnWidths: parts.map(() => w),
        layout: TableLayoutType.FIXED,
        width: { size: w * parts.length, type: WidthType.DXA },
        alignment: AlignmentType.CENTER,
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
          left:   { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
          right:  { style: BorderStyle.SINGLE, size: 6, color: '5A6B7C' },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '9FB3C8' },
          insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: '9FB3C8' },
        },
        rows: [new TableRow({ children: parts.map((pt) => new TableCell({
          width: { size: w, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: 'EEF3FA', color: 'auto' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: sp({ before: 0, after: 0, line: 240 }),
            children: inline(pt, { size: SIZE_SMALL }),
          })],
        })) })],
      }));
    } else {
      out.push(box(step, Math.min(CONTENT_W - 800, 7200)));
    }
  });
  out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: '', font: FONT, size: SIZE })] }));
  return out;
}

function buildTable(rows) {
  const header = splitRow(rows[0]);
  const body = rows.slice(2).map(splitRow);
  const n = header.length;
  // Proportional widths from max content length, min 700 DXA
  const lens = new Array(n).fill(0);
  [header, ...body].forEach((r) => r.forEach((c, i) => {
    if (i < n) lens[i] = Math.max(lens[i], Math.min(c.replace(/\*\*|\[|\]\([^)]*\)/g, '').length, 90));
  }));
  const total = lens.reduce((a, b) => a + b, 0) || n;
  /*
   * Column widths must sum to exactly CONTENT_W, and none may go negative.
   *
   * The old code clamped every column up to a 700-twip minimum and then dumped the whole
   * correction on the LAST column. With enough narrow columns the clamped widths already exceed
   * CONTENT_W, so the correction is negative and the last column goes below zero — docx then
   * throws `Invalid value '-220' specified`, and the whole build dies with no indication that a
   * table was the cause. A seven-column comparison table was enough to trigger it.
   *
   * Excess is now taken from the columns that actually have room above the minimum, in proportion
   * to how much room each has, and the rounding remainder goes on the widest column rather than
   * the last one.
   */
  /*
   * A column's floor is set by its longest WORD, not by a flat constant.
   *
   * The proportional model weights a column by its longest cell, which is right for how much room a
   * column deserves and wrong for how little it can survive on. Table 1.1's first column holds
   * "Pathway" against six columns of prose, so it won by proportion a width of about 500 twips,
   * was clamped up to a flat 700, and still rendered as "Path / way" — broken mid-word, because
   * 700 twips less 200 twips of cell margin leaves 25pt for a 38pt word. Every narrow column in
   * every table had the same latent fault; only this one had a word long enough to show it.
   *
   * The floor is therefore derived: the longest unbreakable token in the column, measured at the
   * table font size, plus the cell margins. If the floors cannot all be met at once they are scaled
   * down together, so a pathological table degrades evenly instead of mangling one column.
   */
  const longestWord = new Array(n).fill(0);
  [header, ...body].forEach((r) => r.forEach((c, i) => {
    if (i >= n) return;
    for (const word of String(c).replace(/\*\*|\[|\]\([^)]*\)/g, '').split(/[\s\u00a0]+/)) {
      longestWord[i] = Math.max(longestWord[i], word.length);
    }
  }));

  /*
   * The table is set at the largest size at which its longest words still fit.
   *
   * Table 1.1 has seven columns and a 22-character token ("Accommodative/vergence"). At 10pt its
   * columns demand 10,864 twips against a 9,026-twip text column, so SOMETHING has to give. Scaling
   * the floors down proportionally, which is what this did first, gives every column a width its own
   * longest word does not fit into, and the reader breaks words mid-syllable: "Proxima / l mechani /
   * sm", "Piepenbr / ock". Setting a wide table a point or two smaller is what a typesetter does
   * instead, and it is reversible per table rather than a global compromise.
   */
  const pad = n >= 6 ? 60 : 100;                    // cell side margin in twips
  const cellMargins = 2 * pad;
  const chTwips = (halfPt) => Math.ceil((halfPt / 2) * 20 * 0.52);   // widest common glyph at that size
  const floorsFor = (halfPt) => longestWord.map((L) => Math.max(700, L * chTwips(halfPt) + cellMargins));
  const demand = (halfPt) => floorsFor(halfPt).reduce((a, b) => a + b, 0);

  let tblSize = SIZE_SMALL;                          // 10pt
  while (tblSize > 16 && demand(tblSize) > CONTENT_W) tblSize -= 1;   // floor at 8pt
  let mins = floorsFor(tblSize);
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum > CONTENT_W) {
    // Even at 8pt the words do not fit; scale the floors and say so rather than silently mangling.
    console.warn(`  ! table cannot fit its longest words even at 8pt `
      + `(demand ${minSum} twips vs ${CONTENT_W}); columns will break words`);
    mins = mins.map((m) => Math.floor((m / minSum) * CONTENT_W));
  }

  let widths = lens.map((l, i) => Math.max(mins[i], Math.round((l / total) * CONTENT_W)));
  const excess = widths.reduce((a, b) => a + b, 0) - CONTENT_W;
  if (excess > 0) {
    const slack = widths.map((w, i) => w - mins[i]);
    const totalSlack = slack.reduce((a, b) => a + b, 0);
    if (totalSlack > 0) {
      const take = Math.min(excess, totalSlack);
      widths = widths.map((w, i) => w - Math.round((slack[i] / totalSlack) * take));
    }
  }
  const diff = CONTENT_W - widths.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const widest = widths.indexOf(Math.max(...widths));
    widths[widest] = Math.max(mins[widest], widths[widest] + diff);
  }
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum !== CONTENT_W) {
    // The floors won: the table is wider than the page. Say so rather than letting Word reflow it
    // into something nobody chose.
    console.warn(`  ! table columns sum to ${sum} twips against a ${CONTENT_W} text column `
      + `(longest words: ${longestWord.join(', ')})`);
  }

  const cell = (txt, isHeader, i) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: 'E8EEF7', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: pad, right: pad },
    children: [new Paragraph({
      spacing: sp({ before: 20, after: 20, line: 240 }),
      children: inline(txt, { size: tblSize, bold: isHeader }),
    })],
  });

  return new Table({
    columnWidths: widths,
    // Without an explicit fixed layout the reader is free to autofit and ignore every width
    // computed above — which makes the computation above a decoration rather than a decision.
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '8899AA' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '8899AA' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '8899AA' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '8899AA' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'BBC4CC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'BBC4CC' },
    },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((c, i) => cell(c, true, i)) }),
      ...body.map((r) => new TableRow({
        children: Array.from({ length: n }, (_, i) => cell(r[i] ?? '', false, i)),
      })),
    ],
  });
}

/* ---------------- main parse ---------------- */
const lines = md.split('\n');
const children = [];
let i = 0;

const HEADINGS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

/**
 * True once the REFERENCES heading has been passed. APA 7 sets a reference list flush left with a
 * half-inch hanging indent; justifying it, as the body is justified, opens rivers of white space
 * inside long DOIs and journal titles, and without the hanging indent an examiner cannot scan the
 * author column. Both were wrong until this existed.
 */
let inReferences = false;

const HANGING = 720;   // 0.5 inch, as APA specifies

function bodyPara(text, extra = {}) {
  const reference = inReferences && !extra.alignment;
  return new Paragraph({
    spacing: sp(reference ? { after: 100, line: 340 } : { after: 140, line: 340 }),
    alignment: reference ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
    ...(reference ? { indent: { left: HANGING, hanging: HANGING } } : {}),
    children: inline(text),
    ...extra,
  });
}

while (i < lines.length) {
  const raw = lines[i];
  const line = raw.trimEnd();

  // blank
  if (!line.trim()) { i++; continue; }

  /*
   * Structural markers the source uses. Neither was handled, so both printed as literal text:
   * "PAGEBREAK" appeared as a word in the middle of the document, and each FLOW block rendered as
   * a run of bare lines rather than the diagram it describes.
   */
  /*
   * <!--FIG:name--> embeds figures/name.png, rasterised from the SVG of the same name by
   * svg2png.mjs. Word does not render SVG dependably across versions, and two of these figures are
   * CURVES, which a flow diagram built from table cells cannot express at all.
   */
  {
    const fig = /^<!--FIG:([A-Za-z0-9_.-]+)-->$/.exec(line.trim());
    if (fig) {
      const png = path.join(path.dirname(IN), 'figures', `${fig[1]}.png`);
      if (fs.existsSync(png)) {
        const buf = fs.readFileSync(png);
        // Intrinsic size from the PNG header, scaled to the text column so nothing overflows.
        const pw = buf.readUInt32BE(16), ph = buf.readUInt32BE(20);
        const maxPt = 420;                       // points across the A4 text column
        const wPt = Math.min(maxPt, pw / 3);     // rasterised at 3x
        const hPt = Math.round((ph / pw) * wPt);
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 140 },
          children: [new ImageRun({ type: 'png', data: buf, transformation: { width: Math.round(wPt), height: hPt } })],
        }));
      } else {
        console.warn(`  ! figure not found: ${png}`);
      }
      i++; continue;
    }
  }

  if (line.trim() === '<!--PAGEBREAK-->') {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    i++; continue;
  }

  // A flow block: consecutive lines between <!--FLOW--> and <!--/FLOW-->, each one a step.
  if (line.trim() === '<!--FLOW-->') {
    i++;
    const steps = [];
    while (i < lines.length && lines[i].trim() !== '<!--/FLOW-->') {
      const t = lines[i].trim();
      if (t) steps.push(t);
      i++;
    }
    i++; // consume the closing marker
    children.push(...buildFlow(steps));
    continue;
  }

  // horizontal rule
  if (/^---+$/.test(line.trim())) {
    children.push(new Paragraph({
      spacing: { before: 120, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } },
      children: [new TextRun({ text: '', font: FONT, size: SIZE })],
    }));
    i++; continue;
  }

  // heading
  const h = line.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    const lvl = h[1].length;
    // The reference list runs from its own heading to the next top-level one.
    if (lvl === 1) inReferences = /^references$/i.test(h[2].trim());
    children.push(new Paragraph({
      heading: HEADINGS[lvl],
      spacing: { before: lvl === 1 ? 320 : 280, after: 160 },
      keepNext: true,
      children: inline(h[2], { size: lvl === 1 ? 32 : lvl === 2 ? 28 : 26, bold: true }),
    }));
    i++; continue;
  }

  // table
  if (line.trim().startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++; }
    if (rows.length >= 2) {
      children.push(buildTable(rows));
      children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: '', size: 12 })] }));
    }
    continue;
  }

  // blockquote (may span lines)
  if (line.trim().startsWith('>')) {
    const buf = [];
    while (i < lines.length && lines[i].trim().startsWith('>')) {
      buf.push(lines[i].trim().replace(/^>\s?/, '')); i++;
    }
    children.push(new Paragraph({
      spacing: sp({ before: 120, after: 180, line: 320 }),
      indent: { left: 360, right: 240 },
      alignment: AlignmentType.JUSTIFIED,
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: '4F8EF7', space: 8 } },
      shading: { type: ShadingType.CLEAR, fill: 'F4F7FC', color: 'auto' },
      children: inline(buf.join(' ')),
    }));
    continue;
  }

  // bullet list item
  const b = line.match(/^\s*[-*]\s+(.*)$/);
  if (b) {
    let text = b[1];
    // continuation lines
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*([-*]|\d+\.)\s/.test(lines[i + 1]) &&
           !lines[i + 1].trim().startsWith('|') && !lines[i + 1].trim().startsWith('#') &&
           !lines[i + 1].trim().startsWith('>') && !/^---+$/.test(lines[i + 1].trim())) {
      i++; text += ' ' + lines[i].trim();
    }
    children.push(new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      spacing: sp({ after: 90, line: 320 }),
      alignment: AlignmentType.JUSTIFIED,
      children: inline(text),
    }));
    i++; continue;
  }

  // numbered item -> keep literal number, hanging indent (so reference numbers never drift)
  const o = line.match(/^\s*(\d+)\.\s+(.*)$/);
  if (o) {
    let text = o[2];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*([-*]|\d+\.)\s/.test(lines[i + 1]) &&
           !lines[i + 1].trim().startsWith('|') && !lines[i + 1].trim().startsWith('#') &&
           !lines[i + 1].trim().startsWith('>') && !/^---+$/.test(lines[i + 1].trim())) {
      i++; text += ' ' + lines[i].trim();
    }
    children.push(new Paragraph({
      spacing: sp({ after: 120, line: 320 }),
      indent: { left: 600, hanging: 600 },
      alignment: AlignmentType.JUSTIFIED,
      children: [
        new TextRun({ text: o[1] + '.', font: FONT, size: SIZE }),
        new TextRun({ text: '\t', font: FONT, size: SIZE }),
        ...inline(text),
      ],
    }));
    i++; continue;
  }

  // paragraph (join wrapped lines)
  let text = line.trim();
  while (i + 1 < lines.length && lines[i + 1].trim() &&
         !/^(#{1,4})\s/.test(lines[i + 1].trim()) &&
         !lines[i + 1].trim().startsWith('|') &&
         !lines[i + 1].trim().startsWith('>') &&
         !/^\s*([-*]|\d+\.)\s/.test(lines[i + 1]) &&
         !/^---+$/.test(lines[i + 1].trim())) {
    i++; text += ' ' + lines[i].trim();
  }
  // Centre the two title lines / italic standalone note
  const isEnd = /^\*End of document\.\*$/.test(text);
  children.push(bodyPara(text, isEnd ? { alignment: AlignmentType.CENTER } : {}));
  i++;
}

const doc = new Document({
  creator: 'PhD Synopsis',
  title: 'Review of Literature — Display Polarity and Text Colour',
  description: 'Literature review prepared for PhD synopsis presentation',
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 520, hanging: 260 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: sp({ line: 340 }) } },
      heading1: { run: { font: FONT, size: 32, bold: true, color: '1A1A2E' }, paragraph: { spacing: { before: 320, after: 160 } } },
      heading2: { run: { font: FONT, size: 28, bold: true, color: '1A1A2E' }, paragraph: { spacing: { before: 300, after: 150 } } },
      heading3: { run: { font: FONT, size: 26, bold: true, color: '243B53' }, paragraph: { spacing: { before: 260, after: 130 } } },
      heading4: { run: { font: FONT, size: 24, bold: true, italics: true, color: '243B53' }, paragraph: { spacing: { before: 220, after: 110 } } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: 16838 }, // A4
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} (${(buf.length / 1024).toFixed(0)} KB, ${children.length} block elements)`);
});
