/**
 * Build the AdtU-formatted PhD synopsis .docx from SYNOPSIS_AdtU.md
 *
 * AdtU Annexure AdtU/PhD/A(i) page specification:
 *   Left margin 3.0 cm | Right margin 2.0 cm | Top 2.54 cm | Bottom 2.54 cm
 *   Times New Roman, line spacing 1.5, printed single side.
 *
 * Usage: node build_synopsis.cjs <input.md> <output.docx>
 */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  ExternalHyperlink, LevelFormat,
} = require('docx');

const IN = process.argv[2], OUT = process.argv[3];
const md = fs.readFileSync(IN, 'utf8');

const FONT = 'Times New Roman';
const SIZE = 24;          // 12 pt
const SIZE_TBL = 20;      // 10 pt inside tables
const LINE = 360;         // 1.5 line spacing (240 = single)
const CM = 567;           // twips per cm
const PAGE_W = 11906, PAGE_H = 16838;               // A4
const M_LEFT = Math.round(3.0 * CM);                // 1701
const M_RIGHT = Math.round(2.0 * CM);               // 1134
const M_TOP = 1440, M_BOTTOM = 1440;                // 2.54 cm
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;        // 9071

/* ---------- inline formatting ---------- */
function inline(text, o = {}) {
  const size = o.size || SIZE, bB = !!o.bold, bI = !!o.italics;
  const runs = [];
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, m;
  const plain = (s) => { if (s) runs.push(...emph(s, size, bB, bI)); };
  while ((m = linkRe.exec(text)) !== null) {
    plain(text.slice(last, m.index));
    runs.push(new ExternalHyperlink({
      link: m[2],
      children: [new TextRun({ text: m[1], font: FONT, size, color: '1155CC', underline: {}, bold: bB, italics: bI })],
    }));
    last = linkRe.lastIndex;
  }
  plain(text.slice(last));
  return runs.length ? runs : [new TextRun({ text: '', font: FONT, size })];
}
function emph(s, size, bB, bI) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  const plain = (t) => { if (t) out.push(new TextRun({ text: t, font: FONT, size, bold: bB, italics: bI })); };
  while ((m = re.exec(s)) !== null) {
    plain(s.slice(last, m.index));
    const tok = m[1];
    if (tok.startsWith('**')) out.push(new TextRun({ text: tok.slice(2, -2), font: FONT, size, bold: true, italics: bI }));
    else if (tok.startsWith('`')) out.push(new TextRun({ text: tok.slice(1, -1), font: FONT, size, bold: bB, italics: bI }));
    else out.push(new TextRun({ text: tok.slice(1, -1), font: FONT, size, italics: true, bold: bB }));
    last = re.lastIndex;
  }
  plain(s.slice(last));
  return out;
}

/* ---------- tables ---------- */
const splitRow = (l) => {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
};
function buildTable(rows) {
  const header = splitRow(rows[0]);
  const body = rows.slice(2).map(splitRow);
  const n = header.length;
  const lens = new Array(n).fill(0);
  [header, ...body].forEach((r) => r.forEach((c, i) => {
    if (i < n) lens[i] = Math.max(lens[i], Math.min(c.replace(/\*\*|\[|\]\([^)]*\)/g, '').length, 80));
  }));
  const tot = lens.reduce((a, b) => a + b, 0) || n;
  const w = lens.map((l) => Math.max(650, Math.round((l / tot) * CONTENT_W)));
  w[n - 1] += CONTENT_W - w.reduce((a, b) => a + b, 0);
  const cell = (t, hdr, i) => new TableCell({
    width: { size: w[i], type: WidthType.DXA },
    shading: hdr ? { type: ShadingType.CLEAR, fill: 'E8EEF7', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { before: 20, after: 20, line: 240 }, children: inline(t, { size: SIZE_TBL, bold: hdr }) })],
  });
  return new Table({
    columnWidths: w,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '7A8896' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '7A8896' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '7A8896' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '7A8896' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'B4BCC4' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'B4BCC4' },
    },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((c, i) => cell(c, true, i)) }),
      ...body.map((r) => new TableRow({ children: Array.from({ length: n }, (_, i) => cell(r[i] ?? '', false, i)) })),
    ],
  });
}

/* ---------- parse ---------- */
const lines = md.split('\n');
const children = [];
let i = 0, pageIdx = 0;   // 0 = title page, 1 = details page, 2+ = body
const HL = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };

while (i < lines.length) {
  const line = lines[i].trimEnd();
  if (!line.trim()) { i++; continue; }

  if (line.trim() === '<!--PAGEBREAK-->') {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    pageIdx++; i++; continue;
  }
  if (/^---+$/.test(line.trim())) {
    children.push(new Paragraph({
      spacing: { before: 60, after: 90 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } },
      children: [new TextRun({ text: '', font: FONT, size: SIZE })],
    }));
    i++; continue;
  }

  // --- front matter (title page & details page) ---
  if (pageIdx === 0) {
    const isTitle = children.length === 0;
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: isTitle ? 1200 : 200, after: 200, line: LINE },
      children: inline(line.trim(), { size: isTitle ? 28 : SIZE, bold: isTitle || /DOCTOR OF PHILOSOPHY|GYANDEEP NATH|OPTOMETRY/.test(line) }),
    }));
    i++; continue;
  }
  if (pageIdx === 1) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 160, line: LINE },
      children: inline(line.trim()),
    }));
    i++; continue;
  }

  // --- body ---
  const h = line.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    const lvl = h[1].length;
    children.push(new Paragraph({
      heading: HL[lvl],
      alignment: lvl === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: lvl === 1 ? 240 : 180, after: 90, line: LINE },
      keepNext: true,
      pageBreakBefore: lvl === 1 && /^REFERENCES/i.test(h[2]),
      children: inline(h[2], { size: lvl === 1 ? 30 : lvl === 2 ? 27 : 25, bold: true }),
    }));
    i++; continue;
  }
  // --- flow chart: <!--FLOW--> one box per line <!--/FLOW--> ---
  if (line.trim() === '<!--FLOW-->') {
    i++;
    const items = [];
    while (i < lines.length && lines[i].trim() !== '<!--/FLOW-->') {
      if (lines[i].trim()) items.push(lines[i].trim());
      i++;
    }
    i++;
    const edge = { style: BorderStyle.SINGLE, size: 6, color: '5B6B7C', space: 4 };
    items.forEach((it, idx) => {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 30, after: 30, line: 240 },
        indent: { left: 340, right: 340 },
        border: { top: edge, bottom: edge, left: edge, right: edge },
        shading: { type: ShadingType.CLEAR, fill: 'EDF2F9', color: 'auto' },
        keepNext: idx < items.length - 1,
        children: inline(it, { size: 20 }),
      }));
      if (idx < items.length - 1) {
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0, line: 200 },
          keepNext: true,
          children: [new TextRun({ text: '▼', font: FONT, size: 18 })],
        }));
      }
    });
    children.push(new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: '', size: 12 })] }));
    continue;
  }

  if (line.trim().startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++; }
    if (rows.length >= 2) {
      children.push(buildTable(rows));
      children.push(new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: '', size: 12 })] }));
    }
    continue;
  }
  if (line.trim().startsWith('>')) {
    const buf = [];
    while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
    children.push(new Paragraph({
      spacing: { before: 80, after: 100, line: LINE },
      indent: { left: 360, right: 240 },
      alignment: AlignmentType.JUSTIFIED,
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: '4F8EF7', space: 8 } },
      children: inline(buf.join(' ')),
    }));
    continue;
  }
  const cont = (k) => k < lines.length && lines[k].trim() &&
    !/^(#{1,4})\s/.test(lines[k].trim()) && !lines[k].trim().startsWith('|') &&
    !lines[k].trim().startsWith('>') && !/^\s*([-*]|\d+\.)\s/.test(lines[k]) &&
    !/^---+$/.test(lines[k].trim()) && lines[k].trim() !== '<!--PAGEBREAK-->';

  const b = line.match(/^\s*[-*]\s+(.*)$/);
  if (b) {
    let t = b[1];
    while (cont(i + 1)) { i++; t += ' ' + lines[i].trim(); }
    children.push(new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      spacing: { after: 50, line: LINE },
      alignment: AlignmentType.JUSTIFIED,
      children: inline(t),
    }));
    i++; continue;
  }
  const o = line.match(/^\s*(\d+)\.\s+(.*)$/);
  if (o) {
    let t = o[2];
    while (cont(i + 1)) { i++; t += ' ' + lines[i].trim(); }
    children.push(new Paragraph({
      spacing: { after: 60, line: LINE },
      indent: { left: 640, hanging: 640 },
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: o[1] + '.', font: FONT, size: SIZE }), new TextRun({ text: '\t', font: FONT, size: SIZE }), ...inline(t)],
    }));
    i++; continue;
  }
  let t = line.trim();
  while (cont(i + 1)) { i++; t += ' ' + lines[i].trim(); }
  const sig = /^(Date:|Signature of|Seal)/.test(t);
  children.push(new Paragraph({
    spacing: { after: sig ? 240 : 60, line: LINE },
    alignment: sig ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
    children: inline(t),
  }));
  i++;
}

const doc = new Document({
  creator: 'Gyandeep Nath',
  title: 'Ergonomics of Visual Perception — PhD Synopsis',
  description: 'PhD synopsis submitted to Assam down town University',
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 560, hanging: 280 } } } }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: { line: LINE } } },
      heading1: { run: { font: FONT, size: 30, bold: true, color: '000000' }, paragraph: { spacing: { before: 240, after: 120, line: LINE } } },
      heading2: { run: { font: FONT, size: 27, bold: true, color: '000000' }, paragraph: { spacing: { before: 180, after: 90, line: LINE } } },
      heading3: { run: { font: FONT, size: 25, bold: true, color: '000000' }, paragraph: { spacing: { before: 160, after: 80, line: LINE } } },
      heading4: { run: { font: FONT, size: 24, bold: true, italics: true, color: '000000' }, paragraph: { spacing: { before: 220, after: 120, line: LINE } } },
    },
  },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: M_TOP, bottom: M_BOTTOM, left: M_LEFT, right: M_RIGHT } } },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} — ${(buf.length / 1024).toFixed(0)} KB, ${children.length} blocks`);
  console.log(`Margins: L ${M_LEFT} (3.0cm) R ${M_RIGHT} (2.0cm) T/B ${M_TOP} (2.54cm); font ${FONT} 12pt; line ${LINE} (1.5)`);
});
