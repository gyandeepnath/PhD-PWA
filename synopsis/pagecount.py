"""
Accurate page-count estimator for the AdtU synopsis DOCX layout.

LibreOffice cannot render in this container, so page count is computed by
re-implementing Word's line-breaking with real font metrics.  Liberation Serif
is metric-compatible with Times New Roman, so string widths are exact.

Geometry (must match build_synopsis.cjs):
  A4 11906 x 16838 twips; margins L1701 R1134 T1440 B1440
  content width  = 9071 twips = 453.55 pt
  content height = 13958 twips = 697.90 pt
  TNR 12 pt single line height = 1.150 em = 13.80 pt; line=360 -> 1.5x = 20.70 pt

Pagination model: paragraphs break line-by-line with widow/orphan control
(>= 2 lines each side, Word's default); tables break row-by-row; headings are
keepNext so they migrate with the first line of the block that follows.
"""
import re, sys, json
from PIL import ImageFont

FONTS = {
    (False, False): "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    (True,  False): "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    (False, True):  "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
    (True,  True):  "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf",
}
PX = 400
_cache = {}
def _f(bold, ital):
    k = (bold, ital)
    if k not in _cache:
        _cache[k] = ImageFont.truetype(FONTS[k], PX)
    return _cache[k]

def wpt(text, size_pt, bold=False, ital=False):
    return _f(bold, ital).getlength(text) / PX * size_pt if text else 0.0

PAGE_W, PAGE_H = 11906, 16838
M_L, M_R, M_T, M_B = 1701, 1134, 1440, 1440
CONTENT_W_TW = PAGE_W - M_L - M_R
CONTENT_W_PT = CONTENT_W_TW / 20.0
CONTENT_H_PT = (PAGE_H - M_T - M_B) / 20.0
LH_EM = 1.150

def line_h(size_pt, line_tw):
    return (line_tw / 240.0) * LH_EM * size_pt

TOKEN = re.compile(r'(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)')
LINKRE = re.compile(r'\[([^\]]+)\]\((https?://[^)\s]+)\)')

def runs_of(text, size, bold=False, ital=False):
    text = LINKRE.sub(r'\1', text)
    out, last = [], 0
    for m in TOKEN.finditer(text):
        if m.start() > last:
            out.append((text[last:m.start()], size, bold, ital))
        tok = m.group(1)
        if tok.startswith('**'):
            out.append((tok[2:-2], size, True, ital))
        elif tok.startswith('`'):
            out.append((tok[1:-1], size, bold, ital))
        else:
            out.append((tok[1:-1], size, bold, True))
        last = m.end()
    if last < len(text):
        out.append((text[last:], size, bold, ital))
    return out

def nlines(text, size_pt, width_pt, indent_l=0, indent_r=0, first_indent=0):
    avail = max(20.0, width_pt - (indent_l + indent_r) / 20.0)
    words = []
    for seg, s, b, it in runs_of(text, size_pt):
        for p in seg.split(' '):
            if p:
                words.append((p, s, b, it))
    n, cur = 1, first_indent / 20.0
    space = wpt(' ', size_pt)
    started = cur > 0
    for w, s, b, it in words:
        ww = wpt(w, s, b, it)
        add = ww if not started else space + ww
        if cur + add <= avail:
            cur += add; started = True
        else:
            if ww > avail:
                n += int(ww // avail); cur = ww % avail
            else:
                n += 1; cur = ww
            started = True
    return n

def sp(before, after):
    return (before + after) / 20.0

def split_row(l):
    s = l.strip()
    if s.startswith('|'): s = s[1:]
    if s.endswith('|'):   s = s[:-1]
    return [c.strip() for c in s.split('|')]

def table_rows_h(rows, cfg):
    header = split_row(rows[0])
    body = [split_row(r) for r in rows[2:]]
    n = len(header)
    lens = [0] * n
    for r in [header] + body:
        for i, c in enumerate(r):
            if i < n:
                lens[i] = max(lens[i], min(len(re.sub(r'\*\*|\[|\]\([^)]*\)', '', c)), 80))
    tot = sum(lens) or n
    w = [max(650, round(l / tot * CONTENT_W_TW)) for l in lens]
    w[n - 1] += CONTENT_W_TW - sum(w)
    cm_l, cm_r = cfg['cell_margin']
    pad = sp(*cfg['cell_sp']) + sum(cfg['cell_margin_v']) / 20.0
    out = []
    for r in [header] + body:
        rowmax = 0.0
        for i in range(n):
            inner = (w[i] - cm_l - cm_r) / 20.0
            ln = nlines(r[i] if i < len(r) else '', cfg['tbl_pt'], inner)
            rowmax = max(rowmax, ln * line_h(cfg['tbl_pt'], cfg['cell_line']) + pad)
        out.append(rowmax)
    return out


def build_blocks(md_path, cfg):
    """Each block: dict(kind, sect, hard, atoms=[pt...], extra=pt, keepnext=bool)."""
    lines = open(md_path, encoding='utf-8').read().split('\n')
    B, sect = [], 'FRONT MATTER'
    def add(kind, atoms, extra, hard=False, keepnext=False):
        B.append(dict(kind=kind, sect=sect, hard=hard, atoms=atoms,
                      extra=extra, keepnext=keepnext))
    i, page_idx = 0, 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1; continue
        s = line.strip()

        if s == '<!--PAGEBREAK-->':
            add('pagebreak', [], 0.0, hard=True); page_idx += 1; i += 1; continue
        if re.fullmatch(r'-{3,}', s):
            add('rule', [line_h(12, 240)], sp(*cfg['rule_sp'])); i += 1; continue

        if page_idx == 0:
            first = not B
            size = 14 if first else 12
            add('front', [line_h(size, cfg['line'])] * nlines(s, size, CONTENT_W_PT),
                sp(1200 if first else 200, 200)); i += 1; continue
        if page_idx == 1:
            add('front', [line_h(12, cfg['line'])] * nlines(s, 12, CONTENT_W_PT),
                sp(160, 160)); i += 1; continue

        m = re.match(r'^(#{1,4})\s+(.*)$', s)
        if m:
            lvl = len(m.group(1)); txt = m.group(2)
            size = {1: 15, 2: 13.5, 3: 12.5, 4: 12}[lvl]
            if lvl <= 2:
                sect = re.sub(r'\*\*', '', txt)[:46]
            before = cfg['h1_before'] if lvl == 1 else cfg['hn_before']
            hard = bool(lvl == 1 and re.match(r'^REFERENCES', txt, re.I) and cfg['ref_pagebreak'])
            add('h%d' % lvl, [line_h(size, cfg['line'])] * nlines(txt, size, CONTENT_W_PT),
                sp(before, cfg['h_after']), hard=hard, keepnext=True)
            i += 1; continue

        if s == '<!--FLOW-->':
            i += 1; items = []
            while i < len(lines) and lines[i].strip() != '<!--/FLOW-->':
                if lines[i].strip(): items.append(lines[i].strip())
                i += 1
            i += 1
            atoms = []
            for idx, it in enumerate(items):
                ln = nlines(it, cfg['flow_pt'], CONTENT_W_PT, cfg['flow_indent'], cfg['flow_indent'])
                atoms.append(ln * line_h(cfg['flow_pt'], cfg['flow_line'])
                             + sp(*cfg['flow_sp']) + 0.4)
                if idx < len(items) - 1:
                    atoms.append(line_h(cfg['arrow_pt'], cfg['arrow_line']))
            add('flow', atoms, cfg['spacer']); continue

        if s.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append(lines[i]); i += 1
            if len(rows) >= 2:
                add('table', table_rows_h(rows, cfg), cfg['spacer'])
            continue

        if s.startswith('>'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                buf.append(re.sub(r'^>\s?', '', lines[i].strip())); i += 1
            ln = nlines(' '.join(buf), 12, CONTENT_W_PT, 360, 240)
            add('quote', [line_h(12, cfg['line'])] * ln, sp(80, 100)); continue

        def cont(k):
            if k >= len(lines) or not lines[k].strip(): return False
            t = lines[k].strip()
            return not (re.match(r'^#{1,4}\s', t) or t.startswith('|') or t.startswith('>')
                        or re.match(r'^\s*([-*]|\d+\.)\s', lines[k]) or re.fullmatch(r'-{3,}', t)
                        or t == '<!--PAGEBREAK-->' or t.startswith('<!--'))

        b = re.match(r'^\s*[-*]\s+(.*)$', line)
        if b:
            t = b.group(1)
            while cont(i + 1): i += 1; t += ' ' + lines[i].strip()
            ln = nlines(t, 12, CONTENT_W_PT, 560, 0)
            add('bullet', [line_h(12, cfg['line'])] * ln, sp(0, cfg['bullet_after']))
            i += 1; continue
        o = re.match(r'^\s*(\d+)\.\s+(.*)$', line)
        if o:
            t = o.group(2)
            while cont(i + 1): i += 1; t += ' ' + lines[i].strip()
            ln = nlines(o.group(1) + '.  ' + t, 12, CONTENT_W_PT, 640, 0)
            add('num', [line_h(12, cfg['line'])] * ln, sp(0, cfg['num_after']))
            i += 1; continue

        t = s
        while cont(i + 1): i += 1; t += ' ' + lines[i].strip()
        sig = bool(re.match(r'^(Date:|Signature of|Seal)', t))
        is_ref = sect.upper().startswith('REFERENCES')
        lt = cfg['ref_line'] if is_ref else cfg['line']
        ln = nlines(t, 12, CONTENT_W_PT, cfg['ref_indent'] if is_ref else 0, 0,
                    first_indent=(-cfg['ref_indent'] if is_ref else cfg['body_first']))
        add('ref' if is_ref else 'body', [line_h(12, lt)] * ln,
            sp(0, 240 if sig else (cfg['ref_after'] if is_ref else cfg['body_after'])))
        i += 1
    return B


def paginate(B):
    pages, used, carry = 1, 0.0, 0.0     # carry = pending keepNext height
    for bi, blk in enumerate(B):
        if blk['hard']:
            if used > 0: pages += 1
            used, carry = 0.0, 0.0
            if blk['kind'] == 'pagebreak': continue
        atoms, extra = blk['atoms'], blk['extra']
        if not atoms:
            used += extra; continue
        # keepNext heading: needs its own height + the first atom of the next block
        need = carry + sum(atoms) if blk['keepnext'] else 0.0
        if blk['keepnext']:
            nxt = B[bi + 1]['atoms'][0] if bi + 1 < len(B) and B[bi + 1]['atoms'] else 0.0
            if used + need + extra + nxt > CONTENT_H_PT and used > 0:
                pages += 1; used = 0.0
            used += sum(atoms) + extra
            continue
        # widow/orphan: keep >=2 lines together at a break
        k = 0
        n = len(atoms)
        while k < n:
            rem = CONTENT_H_PT - used
            fit = 0; acc = 0.0
            while k + fit < n and acc + atoms[k + fit] <= rem:
                acc += atoms[k + fit]; fit += 1
            if n > 2 and 0 < fit < 2:  fit = 0            # orphan
            if n > 2 and 0 < n - (k + fit) < 2: fit = max(0, fit - 1)  # widow
            if fit == 0:
                if used == 0.0:                            # atom taller than a page
                    pages += 1; k += 1; used = 0.0; continue
                pages += 1; used = 0.0; continue
            used += acc; k += fit
            if k < n:
                pages += 1; used = 0.0
        used += extra
        if used > CONTENT_H_PT:
            pages += 1; used = 0.0
    return pages


BASE = dict(          # mirrors build_synopsis.cjs as shipped
    line=360, h1_before=140, hn_before=100, h_after=40,
    body_after=0, body_first=360, bullet_after=0, num_after=0, rule_sp=(0, 40),
    tbl_pt=8, cell_line=240, cell_sp=(0, 0), cell_margin=(60, 60), cell_margin_v=(20, 20),
    flow_pt=9, flow_line=240, flow_sp=(10, 10), flow_indent=340,
    arrow_pt=9, arrow_line=160, ref_pagebreak=False,
    ref_line=240, ref_indent=720, ref_after=60,
    spacer=sp(0, 40) + line_h(4, 120),
)

def report(md, cfg, verbose=True):
    B = build_blocks(md, cfg)
    pages = paginate(B)
    ink = sum(sum(b['atoms']) + b['extra'] for b in B)
    if verbose:
        print(f"content box {CONTENT_W_PT:.1f} x {CONTENT_H_PT:.1f} pt | "
              f"{line_h(12, cfg['line']):.2f} pt/line -> {CONTENT_H_PT/line_h(12,cfg['line']):.1f} lines/page")
        print(f"blocks {len(B):4d} | ink {ink:.0f} pt = {ink/CONTENT_H_PT:.2f} pages | PAGES {pages}\n")
        by = {}
        for b in B:
            by[b['kind']] = by.get(b['kind'], 0.0) + sum(b['atoms']) + b['extra']
        for k, v in sorted(by.items(), key=lambda x: -x[1]):
            print(f"   {k:10s} {v:8.0f} pt  {v/ink*100:5.1f}%  {v/CONTENT_H_PT:5.2f} pg")
        print()
        bs = {}
        order = []
        for b in B:
            if b['sect'] not in bs: bs[b['sect']] = 0.0; order.append(b['sect'])
            bs[b['sect']] += sum(b['atoms']) + b['extra']
        for k in order:
            print(f"   {bs[k]/CONTENT_H_PT:5.2f} pg  {k}")
    return pages, ink, B


if __name__ == '__main__':
    md = sys.argv[1] if len(sys.argv) > 1 else 'SYNOPSIS_AdtU.md'
    cfg = dict(BASE)
    if len(sys.argv) > 2:
        cfg.update(json.loads(sys.argv[2]))
    report(md, cfg)
