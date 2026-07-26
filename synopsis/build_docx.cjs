/**
 * Build a formatted .docx (PhD synopsis style) from LITERATURE_REVIEW.md
 * Usage: node build_docx.cjs <input.md> <output.docx>
 */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  ExternalHyperlink, LevelFormat, convertInchesToTwip,
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
  let widths = lens.map((l) => Math.max(700, Math.round((l / total) * CONTENT_W)));
  // normalise to exactly CONTENT_W
  const diff = CONTENT_W - widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] += diff;

  const cell = (txt, isHeader, i) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: 'E8EEF7', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      spacing: { before: 20, after: 20, line: 240 },
      children: inline(txt, { size: SIZE_SMALL, bold: isHeader }),
    })],
  });

  return new Table({
    columnWidths: widths,
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

function bodyPara(text, extra = {}) {
  return new Paragraph({
    spacing: { after: 140, line: 340 }, // ~1.4 line spacing
    alignment: AlignmentType.JUSTIFIED,
    children: inline(text),
    ...extra,
  });
}

while (i < lines.length) {
  const raw = lines[i];
  const line = raw.trimEnd();

  // blank
  if (!line.trim()) { i++; continue; }

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
      spacing: { before: 120, after: 180, line: 320 },
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
      spacing: { after: 90, line: 320 },
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
      spacing: { after: 120, line: 320 },
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
      document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: { line: 340 } } },
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
