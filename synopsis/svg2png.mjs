/**
 * Rasterise the synopsis figures so Word can embed them.
 *
 * Word cannot render SVG reliably across versions, and the docx library takes bitmaps. The figures
 * are authored once as SVG (shared with GUIDE.html, so the two can never drift) and converted here
 * at 3x for print. Without this step the synopsis could only carry flow diagrams built from table
 * cells, which cannot express a curve — and two of the three figures below ARE curves.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'figures';
const SCALE = 3;
// The bundled headless-shell build does not match this Playwright version's expected path, so the
// full Chromium already present is named explicitly rather than downloading anything.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ deviceScaleFactor: SCALE });

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.svg'))) {
  const svg = readFileSync(join(DIR, f), 'utf8');
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const w = vb ? Math.ceil(+vb[1]) : 720;
  const h = vb ? Math.ceil(+vb[2]) : 400;
  // currentColor and the --accent variable come from the guide's stylesheet; supply print values.
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:#fff;color:#1a1a2e}
     :root{--accent:#2f5d8a}
     svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
  await page.setViewportSize({ width: w, height: h });
  const png = f.replace(/\.svg$/, '.png');
  await page.locator('svg').screenshot({ path: join(DIR, png), omitBackground: false });
  console.log(`${png}  ${w}x${h} @${SCALE}x`);
}
await browser.close();
