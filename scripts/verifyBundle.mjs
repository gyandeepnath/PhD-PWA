/**
 * Verify that the built bundle can actually run offline on a study tablet.
 *
 * The app is installed on a tablet, taken into a light-controlled room, and run for a hundred
 * minutes with no network. Everything it will ever need has to be in the service worker's precache
 * before that happens. Nothing checked it: the build succeeded, CI went green, and whether the
 * tablet could see a face was discovered by pointing a tablet at a face.
 *
 * Three properties, each of which has a plausible way of going wrong:
 *
 *   1. EVERY SHIPPED ASSET IS PRECACHED. An asset in dist/ that the manifest omits is fetched from
 *      the network at the moment it is needed, which offline means it is not fetched at all. The
 *      two things this app loads lazily are the dashboard — the only export path — and the
 *      MediaPipe runtime, which produces the primary outcome.
 *
 *   2. NO CONFLICTING PRECACHE ENTRIES. `includeAssets` and `globPatterns` both match the vendored
 *      MediaPipe files, so eleven URLs appear in the manifest twice. Workbox tolerates a duplicate
 *      whose revision matches and throws `add-to-cache-list-conflicting-entries` when it does not —
 *      and a throw at install time means the worker never activates and the app has no offline
 *      support at all, on a device that is about to be taken offline. Today the revisions match.
 *      This is what makes sure they still do.
 *
 *   3. THE TRACKING RUNTIME IS IN THE BUNDLE. public/mediapipe/ is gitignored and produced by
 *      scripts/copy-mediapipe.mjs at prebuild; if that step is skipped the bundle builds cleanly
 *      and cannot construct the tracker. That has happened before in a different form — the
 *      constructor moved from module exports to a global between esbuild and Rollup, so the dev
 *      suite was green while the shipped bundle could not track — which is why there is a separate
 *      production-bundle e2e suite. This check is the cheap half of the same lesson.
 *
 * Runs as `postbuild`, so `npm run build` fails rather than producing a bundle that looks fine.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('[verify-bundle] dist/ does not exist — nothing to verify.');
  process.exit(1);
}

/** Files the service worker itself is made of, plus sourcemaps, which are not precached by design. */
const NOT_PRECACHED = /\.map$|^sw\.js$|^workbox-[^/]+\.js$|^registerSW\.js$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(relative(dist, p).split('\\').join('/'));
  }
  return out;
}

const swPath = join(dist, 'sw.js');
if (!existsSync(swPath)) {
  console.error('[verify-bundle] dist/sw.js is missing — the PWA has no service worker, so it has no offline mode.');
  process.exit(1);
}

const sw = readFileSync(swPath, 'utf8');
const entries = [...sw.matchAll(/\{url:"([^"]+)",revision:("[^"]*"|null)\}/g)]
  .map((m) => ({ url: decodeURIComponent(m[1]), revision: m[2] }));

if (!entries.length) {
  console.error('[verify-bundle] the service worker precaches nothing. Either the manifest shape changed');
  console.error('[verify-bundle] and this check needs updating, or the build is broken — do not ship either.');
  process.exit(1);
}

const problems = [];

/* 1. everything shipped is precached */
const shipped = walk(dist).filter((f) => !NOT_PRECACHED.test(f));
const precached = new Set(entries.map((e) => e.url));
for (const file of shipped) {
  if (!precached.has(file)) problems.push(`shipped but not precached: ${file} (${(statSync(join(dist, file)).size / 1024).toFixed(0)} kB)`);
}
// A URL legitimately appears twice in the manifest (includeAssets and globPatterns both match the
// vendored runtime), so report each missing one once rather than once per entry.
for (const url of new Set(entries.map((e) => e.url))) {
  if (!shipped.includes(url)) problems.push(`precached but absent from dist/: ${url}`);
}

/* 2. no duplicate URL carries two different revisions */
const revisionsByUrl = new Map();
for (const { url, revision } of entries) {
  if (!revisionsByUrl.has(url)) revisionsByUrl.set(url, new Set());
  revisionsByUrl.get(url).add(revision);
}
for (const [url, revs] of revisionsByUrl) {
  if (revs.size > 1) {
    problems.push(`conflicting precache revisions for ${url}: ${[...revs].join(' vs ')} — the service worker will refuse to install`);
  }
}

/* 3. the tracking runtime shipped */
const REQUIRED_TRACKING = [
  ['mediapipe/face_mesh.js', 1024],
  ['mediapipe/face_mesh.binarypb', 1],
  ['mediapipe/face_mesh_solution_packed_assets.data', 1024 * 1024],
  ['mediapipe/face_mesh_solution_packed_assets_loader.js', 1024],
];
for (const [file, minBytes] of REQUIRED_TRACKING) {
  const p = join(dist, file);
  if (!existsSync(p)) problems.push(`the tracking runtime is not in the bundle: ${file}`);
  else if (statSync(p).size < minBytes) problems.push(`tracking asset looks truncated: ${file} (${statSync(p).size} bytes)`);
}
const wasm = shipped.filter((f) => /^mediapipe\/.*\.wasm$/.test(f) && statSync(join(dist, f)).size > 1024 * 1024);
if (!wasm.length) problems.push('no usable MediaPipe wasm binary in the bundle');

if (problems.length) {
  console.error('[verify-bundle] this bundle is not safe to take into the field:');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

const bytes = shipped.reduce((a, f) => a + statSync(join(dist, f)).size, 0);
console.log(`[verify-bundle] ${shipped.length} assets, all precached; ${revisionsByUrl.size} unique precache URLs; `
  + `${wasm.length} wasm variant(s); ${(bytes / 1024 / 1024).toFixed(1)} MB total.`);
