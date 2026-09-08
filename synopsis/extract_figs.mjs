/**
 * Pull the synopsis figures out of GUIDE.html.
 *
 * The figures are authored ONCE, inside the guide, and the synopsis embeds rasterised copies. That
 * only stays honest if the copies are regenerated rather than hand-maintained: the guide has already
 * been edited twice since the illumination change, and a figure that silently kept an old caption
 * would put a false statement into the submitted document.
 *
 * Each figure is located by a distinctive fragment of its own `aria-label`, so a figure can be moved
 * around the guide freely; only rewording its aria-label breaks the link, and that fails loudly here
 * rather than quietly shipping a stale PNG.
 *
 * Run this, then `node svg2png.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIGURES = [
  ['fig_pathways',       'Two causal routes from display settings'],
  ['fig_pupil',          'The pupil-mediated explanation of the positive polarity advantage'],
  ['fig_design',         'Within-subjects design: one participant attends a single sitting'],
  ['fig_contrast_curve', 'Contrast ratio plotted against text relative luminance'],
  ['fig_blink_trace',    'An eye-aspect-ratio trace over time showing three blinks'],
];

const guide = readFileSync('GUIDE.html', 'utf8');

for (const [name, needle] of FIGURES) {
  const at = guide.indexOf(needle);
  if (at < 0) throw new Error(`${name}: no <svg> in GUIDE.html carries the aria-label fragment "${needle}"`);
  if (guide.indexOf(needle, at + 1) >= 0) throw new Error(`${name}: the fragment "${needle}" matches more than one figure`);
  const start = guide.lastIndexOf('<svg', at);
  const end = guide.indexOf('</svg>', at) + '</svg>'.length;
  const svg = guide.slice(start, end);
  if (!/^<svg viewBox="0 0 [\d.]+ [\d.]+"/.test(svg)) throw new Error(`${name}: extracted block has no viewBox`);
  writeFileSync(join('figures', `${name}.svg`), `${svg}\n`);
  const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  console.log(`${name}.svg  ${w}x${h}`);
}
