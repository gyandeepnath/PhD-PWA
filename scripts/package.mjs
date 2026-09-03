/**
 * Assemble a distributable package: the built app, the field server, the documents, checksums and
 * a provenance record.
 *
 * The checksums and the provenance record are the point. A build handed over without them cannot
 * be told apart from a different build later, and "which version produced these timings?" is
 * exactly the question that gets asked six months afterwards.
 *
 *   npm run build && npm run package
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'package-staging', 'visulab-build');
const DIST = path.join(ROOT, 'dist');

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

fs.rmSync(path.join(ROOT, 'package-staging'), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(DIST, path.join(OUT, 'app'), { recursive: true });
for (const f of ['serve.mjs', 'RUN.md', 'TIMING-SHEET.md']) {
  fs.copyFileSync(path.join(ROOT, 'field', f), path.join(OUT, f));
}
fs.mkdirSync(path.join(OUT, 'reference'), { recursive: true });
for (const f of ['TIMING_MODEL.md', 'TIMING_SIMULATION_OUTPUT.txt',
                 'PROTOCOL_FRONTIER_OUTPUT.txt', 'CITATION_VERIFICATION.md']) {
  const src = path.join(ROOT, 'docs', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, 'reference', f));
  else console.warn(`  (skipped missing docs/${f})`);
}

// Checksum every file in app/, sorted, so the manifest is byte-reproducible.
const appDir = path.join(OUT, 'app');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const files = walk(appDir).map((p) => path.relative(appDir, p)).sort();
const sums = files
  .map((rel) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(appDir, rel))).digest('hex')}  ./${rel}`)
  .join('\n') + '\n';
fs.writeFileSync(path.join(appDir, 'SHA256SUMS.txt'), sums);

const dirty = git(['status', '--porcelain']).length > 0;
fs.writeFileSync(path.join(OUT, 'reference', 'BUILD-INFO.txt'), [
  'VisuLab — build provenance',
  '==========================',
  '',
  `Branch      : ${git(['branch', '--show-current'])}`,
  `Commit      : ${git(['rev-parse', 'HEAD'])}`,
  `Commit date : ${git(['log', '-1', '--format=%cI'])}`,
  `Subject     : ${git(['log', '-1', '--format=%s'])}`,
  `Node        : ${process.version}`,
  `Working tree: ${dirty ? 'DIRTY — uncommitted changes present' : 'clean — this build is exactly the committed source'}`,
  '',
  `Files       : ${files.length}`,
  '',
  'Verify every file with:   cd app && sha256sum -c SHA256SUMS.txt',
  '',
].join('\n'));

console.log(`Packaged ${files.length} app files into package-staging/visulab-build`);
console.log(dirty ? 'WARNING: working tree is dirty; the package is not reproducible from the commit.' : '');
console.log('Create the tarball with:  tar -czf visulab-build.tar.gz -C package-staging visulab-build');
