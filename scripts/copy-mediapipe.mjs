/**
 * Vendor the MediaPipe FaceMesh runtime assets into public/mediapipe/ so they are served locally
 * and precached by the service worker (true offline). The npm package ships these; we copy rather
 * than commit them (they are ~16 MB of binaries). Run automatically before dev/build.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'face_mesh');
const dest = join(root, 'public', 'mediapipe');

if (!existsSync(src)) {
  console.warn('[copy-mediapipe] @mediapipe/face_mesh not installed — skipping (tracking will degrade).');
  process.exit(0);
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
console.log(`[copy-mediapipe] vendored ${n} files into public/mediapipe/`);
