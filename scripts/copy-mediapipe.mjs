/**
 * Vendor the MediaPipe FaceMesh runtime assets into public/mediapipe/ so they are served locally
 * and precached by the service worker (true offline). The npm package ships these; we copy rather
 * than commit them (they are ~16 MB of binaries). Run automatically before dev/build.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'face_mesh');
const dest = join(root, 'public', 'mediapipe');

/*
 * A missing runtime is a BUILD FAILURE, not a warning.
 *
 * This exited 0 with a one-line warning saying "tracking will degrade". It does not degrade: the
 * primary outcome of the whole study is the incomplete-blink ratio, derived from this runtime, so a
 * bundle without it has no primary outcome at all. public/mediapipe/ is gitignored, so every build
 * depends entirely on this step; a partial `npm ci` would have produced a tablet build that
 * installs, goes offline, and cannot construct the tracker — with the warning buried in several
 * hundred lines of build output and CI green, because nothing downstream asserts the assets exist.
 *
 * The escape hatch is explicit rather than silent, for the rare case of working on UI alone.
 */
if (!existsSync(src)) {
  if (process.env.ALLOW_MISSING_MEDIAPIPE === '1') {
    console.warn('[copy-mediapipe] @mediapipe/face_mesh is missing and ALLOW_MISSING_MEDIAPIPE=1 is set.');
    console.warn('[copy-mediapipe] THIS BUILD CANNOT TRACK. Do not use it to collect data.');
    process.exit(0);
  }
  console.error('[copy-mediapipe] @mediapipe/face_mesh is not installed.');
  console.error('[copy-mediapipe] The primary outcome is derived from this runtime, so a build');
  console.error('[copy-mediapipe] without it cannot collect data. Run `npm ci`.');
  console.error('[copy-mediapipe] To build the UI anyway, set ALLOW_MISSING_MEDIAPIPE=1.');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
let n = 0;
for (const file of readdirSync(src)) {
  // Copy the runtime assets FaceMesh fetches via locateFile (skip docs/types/package metadata).
  if (/\.(wasm|data|binarypb|js)$/.test(file) && file !== 'package.json') {
    copyFileSync(join(src, file), join(dest, file));
    n++;
  }
}
/*
 * Assert what the runtime actually fetches, rather than reporting how many files happened to match
 * an extension. If an upstream release renames an asset, the copy loop above still reports a
 * plausible count and the missing file is discovered by a tablet.
 *
 * face_mesh_solution_simd_wasm_bin.data is legitimately zero bytes upstream (Emscripten emits an
 * empty side-data file when the assets are packed elsewhere), so presence is required and size is
 * not.
 */
const REQUIRED = [
  ['face_mesh.js', 1024],
  ['face_mesh.binarypb', 1],
  ['face_mesh_solution_packed_assets.data', 1024 * 1024],
  ['face_mesh_solution_packed_assets_loader.js', 1024],
];
const WASM_VARIANTS = ['face_mesh_solution_simd_wasm_bin', 'face_mesh_solution_wasm_bin'];

const problems = [];
for (const [file, minBytes] of REQUIRED) {
  const p = join(dest, file);
  if (!existsSync(p)) problems.push(`missing: ${file}`);
  else if (statSync(p).size < minBytes) problems.push(`too small: ${file} (${statSync(p).size} bytes)`);
}
const usable = WASM_VARIANTS.filter((v) => {
  const wasm = join(dest, `${v}.wasm`);
  const js = join(dest, `${v}.js`);
  return existsSync(wasm) && statSync(wasm).size > 1024 * 1024 && existsSync(js);
});
if (!usable.length) problems.push(`no usable wasm variant among ${WASM_VARIANTS.join(', ')}`);

if (problems.length) {
  console.error('[copy-mediapipe] the vendored runtime is incomplete:');
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error('[copy-mediapipe] @mediapipe/face_mesh may have changed its asset names.');
  process.exit(1);
}

console.log(`[copy-mediapipe] vendored ${n} files into public/mediapipe/ (${usable.length} wasm variant(s))`);
