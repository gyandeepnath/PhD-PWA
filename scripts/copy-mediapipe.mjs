/**
 * Vendor the face-tracking runtimes into public/ so they are served locally and precached by the
 * service worker (true offline). Run automatically before dev/build.
 *
 *   public/mediapipe/     — the legacy @mediapipe/face_mesh solution (~16 MB), copied from npm.
 *   public/tasks-vision/  — the @mediapipe/tasks-vision wasm (copied from npm) and the Face Landmarker
 *                           model, which npm does not ship: it is DOWNLOADED HERE, AT BUILD TIME ONLY,
 *                           from a versioned URL and checked against a pinned SHA-256 (see below).
 *
 * Both directories are gitignored and rebuilt by this step; we copy rather than commit ~40 MB of
 * binaries. The app itself never fetches anything from Google at run time: every asset is
 * same-origin, and index.html's Content-Security-Policy refuses any other connection.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

/*
 * ---- Face Landmarker (@mediapipe/tasks-vision) ----
 *
 * The wasm comes from the npm package, pinned exactly in package.json. Only the two variants
 * FilesetResolver.forVisionTasks() can select are copied: SIMD (vision_wasm_internal) and no-SIMD
 * (vision_wasm_nosimd_internal). The "module" variant is for useModule=true, which this app does not
 * use. Each .wasm is under the service worker's 12 MB per-file precache limit (vite.config.ts); the
 * check below fails the build if an upgrade ever pushes one over, because a file the worker will not
 * precache is a file the tablet does not have offline.
 */
const tvSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const tvDest = join(root, 'public', 'tasks-vision');
const PRECACHE_LIMIT = 12 * 1024 * 1024;
if (!existsSync(tvSrc)) {
  if (process.env.ALLOW_MISSING_MEDIAPIPE === '1') {
    console.warn('[copy-mediapipe] @mediapipe/tasks-vision is missing; only the legacy tracker can run.');
    process.exit(0);
  }
  console.error('[copy-mediapipe] @mediapipe/tasks-vision is not installed. Run `npm ci`.');
  process.exit(1);
}
mkdirSync(tvDest, { recursive: true });
const TV_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
for (const f of TV_FILES) {
  const from = join(tvSrc, f);
  if (!existsSync(from)) { console.error(`[copy-mediapipe] tasks-vision is missing ${f}`); process.exit(1); }
  if (statSync(from).size > PRECACHE_LIMIT) {
    console.error(`[copy-mediapipe] ${f} is ${statSync(from).size} bytes, over the ${PRECACHE_LIMIT}-byte precache limit.`);
    console.error('[copy-mediapipe] The service worker would skip it and the tablet would not have it offline.');
    process.exit(1);
  }
  copyFileSync(from, join(tvDest, f));
}

/*
 * The model. Version 1 of the float16 Face Landmarker bundle, by its VERSIONED path (".../float16/1/"),
 * not ".../latest/": a model that changed under the study between two builds would change the
 * instrument without anyone deciding it. The SHA-256 below was computed from the downloaded file in
 * round 75; a mismatch fails the build rather than shipping a different model. It is fetched once
 * and cached in node_modules/.cache, so dev servers and rebuilds work offline after the first time.
 *
 * Its contents (read from the file, round 75): face_detector.tflite (input 128x128),
 * face_landmarks_detector.tflite (input 256x256, 478 landmarks x 3), face_blendshapes.tflite (unused
 * here) and the face-geometry metadata.
 */
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const cacheDir = join(root, 'node_modules', '.cache', 'visulab');
const cached = join(cacheDir, 'face_landmarker.task');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let model = existsSync(cached) ? readFileSync(cached) : null;
if (model && sha256(model) !== MODEL_SHA256) model = null;
if (!model) {
  if (process.env.ALLOW_MISSING_MEDIAPIPE === '1' && process.env.VISULAB_OFFLINE === '1') {
    console.warn('[copy-mediapipe] no cached Face Landmarker model and VISULAB_OFFLINE=1: Face Landmarker cannot run in this build.');
    process.exit(0);
  }
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    model = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(`[copy-mediapipe] could not download the Face Landmarker model from ${MODEL_URL}: ${err.message}`);
    console.error('[copy-mediapipe] It is fetched at build time only. Check the network, or place the file at');
    console.error(`[copy-mediapipe] ${cached} (SHA-256 ${MODEL_SHA256}).`);
    process.exit(1);
  }
  const got = sha256(model);
  if (got !== MODEL_SHA256) {
    console.error(`[copy-mediapipe] the downloaded model's SHA-256 is ${got}, not the pinned ${MODEL_SHA256}.`);
    console.error('[copy-mediapipe] The file at the versioned URL has changed. Do not ship it unexamined.');
    process.exit(1);
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, model);
}
if (model.length > PRECACHE_LIMIT) { console.error('[copy-mediapipe] the model is over the precache limit.'); process.exit(1); }
writeFileSync(join(tvDest, 'face_landmarker.task'), model);
console.log(`[copy-mediapipe] vendored ${TV_FILES.length} tasks-vision files and face_landmarker.task (sha256 ${MODEL_SHA256.slice(0, 12)}…) into public/tasks-vision/`);
