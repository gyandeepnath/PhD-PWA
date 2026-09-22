/**
 * Render one administration of the colour-vision screen to a standalone HTML page, three ways:
 * as the participant sees it, as a protanope sees it, and as a deuteranope sees it.
 *
 *   npx tsx scripts/platePreview.ts [seed] > plates.html
 *
 * WHY THIS EXISTS. The plates' central property — that each confusion plate is invisible to the
 * observer it targets — is asserted by `tests/screening.test.ts` as numbers. Numbers are the right
 * thing to gate a build on and the wrong thing to hand an investigator who has to decide whether
 * the stimulus is acceptable. This renders the same claim as something you can look at: on the
 * protan row, the three protan plates are blank discs by construction. What must still read on
 * every row is the GREYSCALE CONTROL, and that contrast — control returned, colour plates not — is
 * what separates a colour-vision deficiency from a participant who was not attending.
 *
 * It uses the TABLET'S OWN dot generator and plate builder, imported, not re-implemented. A preview
 * drawn by a second implementation would prove something about the preview.
 *
 * The simulated columns are the Viénot, Brettel & Mollon (1999) transform from `dichromat.ts`;
 * read that file's header for what the simulation does and does not license. In short: where a
 * plate is a metamer pair for the simulated observer, "the digit disappears" is exact. The
 * simulated colours are an sRGB rendering meant for a trichromat to look at, not a claim about what
 * a dichromat's experience is like.
 */
import { buildScreeningPlates, type Plate } from '../src/screening/ishihara';
import { generateDots, dotSeed, PLATE_DIAMETER as D } from '../src/screening/IshiharaTest';
import { hexToLinearRgb, simulateDichromat, type DichromatKind } from '../src/screening/dichromat';

const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

const through = (hex: string, kind: DichromatKind | null): string => {
  const lin = hexToLinearRgb(hex);
  const out = kind ? simulateDichromat(lin, kind) : lin;
  const byte = (x: number) => Math.round(Math.max(0, Math.min(1, linearToSrgb(x))) * 255);
  return `#${out.map((x) => byte(x).toString(16).padStart(2, '0')).join('')}`;
};

const svg = (plate: Plate, kind: DichromatKind | null) => {
  const dots = generateDots(plate, dotSeed(plate));
  const body = dots
    .map((d) => `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.r.toFixed(1)}" fill="${through(d.color, kind)}"/>`)
    .join('');
  return `<svg width="${D}" height="${D}" viewBox="0 0 ${D} ${D}" style="border-radius:50%;background:${through('#efece6', kind)}">${body}</svg>`;
};

const seed = Number(process.argv[2] ?? 701);
const plates = buildScreeningPlates(seed);

const label = (p: Plate) =>
  p.axis === 'control' ? 'control (greyscale)' : `${p.axis} confusion axis`;

const row = (kind: DichromatKind | null, title: string, blurb: string) => `
  <section>
    <h2>${title}</h2>
    <p class="blurb">${blurb}</p>
    <div class="row">
      ${plates.map((p) => `
        <figure>
          ${svg(p, kind)}
          <figcaption><b>plate ${p.id}</b> · ${label(p)}<br><span class="ans">answer: ${p.digit}</span></figcaption>
        </figure>`).join('')}
    </div>
  </section>`;

process.stdout.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>VisuLab colour-vision plates — seed ${seed}</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 32px 24px 64px;
         background: #faf8f4; color: #1a1a2e; }
  h1 { font-weight: 300; font-size: 30px; margin: 0 0 4px; }
  .sub { color: #5a5a7a; margin: 0 0 28px; max-width: 70ch; }
  h2 { font-size: 18px; font-weight: 600; margin: 34px 0 2px; }
  .blurb { color: #5a5a7a; margin: 0 0 14px; max-width: 80ch; }
  .row { display: flex; flex-wrap: wrap; gap: 18px; }
  figure { margin: 0; text-align: center; }
  figcaption { font-size: 12px; color: #5a5a7a; margin-top: 6px; }
  .ans { font-variant-numeric: tabular-nums; }
  section { border-top: 1px solid #e4e0d8; padding-top: 6px; }
  code { background: #eeeae2; padding: 1px 5px; border-radius: 4px; }
</style></head><body>
<h1>Colour-vision screen — one administration</h1>
<p class="sub">Seed <code>${seed}</code>. Rendered with the tablet's own plate builder and dot
generator, not a re-implementation. The two simulated rows use the Viénot, Brettel &amp; Mollon
(1999) transform; see <code>src/screening/dichromat.ts</code> for exactly what that does and does not
establish.</p>
${row(null, 'As the participant sees it — normal trichromat', 'All seven digits should be legible. The digit is carried by hue: figure and background dots are drawn from the same lightness spread, so there is no lightness boundary to read instead.')}
${row('protan', 'As a protanope sees it', 'The three <b>protan</b> plates are blank by construction — figure and background are the same colour to this observer, exactly, so there is nothing there. The three <b>deutan</b> plates keep a residual luminance difference of about 20%, which is <i>not</i> enough to carry a digit through a noisy dot field: in practice they read as uniform too. What must still read is the <b>greyscale control</b>, and it does. That contrast is the point: a colour-deficient participant returns the control and almost nothing else, which is a different pattern from someone who is not attending and misses the control as well.')}
${row('deutan', 'As a deuteranope sees it', 'The mirror image, and the same outcome: the three <b>deutan</b> plates are blank by construction, the protan ones read as uniform in practice, and the greyscale control still reads.')}
</body></html>
`);
