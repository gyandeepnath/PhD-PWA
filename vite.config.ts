import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/*
 * Build-time provenance: the version, the commit and the build time, stamped into every export and
 * shown on screen (lib/env.ts buildIdentity). None of it needs git HISTORY, which the CI checkout does
 * not have: `rev-parse` of the one checked-out commit works in a shallow clone, and the workflow
 * exports that commit as GITHUB_SHA besides.
 */
let gitHash = 'unknown';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Not a git checkout (a source tarball). In GitHub Actions the commit is still known.
  if (process.env.GITHUB_SHA) gitHash = process.env.GITHUB_SHA.slice(0, 7);
}
/*
 * Read from package.json itself. It used to be process.env.npm_package_version, which npm sets only
 * when the build runs through an npm script — `npx vite build` stamped 0.0.0.
 */
const appVersion: string = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version ?? '0.0.0';

export default defineConfig({
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_HASH__: JSON.stringify(gitHash),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      /**
       * 'prompt', not 'autoUpdate'.
       *
       * autoUpdate installs a new service worker and has it take control of the open page as soon
       * as a deployment is noticed. In an ordinary web app that is a refresh. Here it happens in
       * the middle of a 90-minute session: the new worker replaces the precache, the previous
       * build's content-hashed chunks stop resolving, and the two things this app loads lazily are
       * the dashboard — which is the only export path — and MediaPipe, which produces the primary
       * outcome. The participant is mid-protocol and cannot be asked to sit it again.
       *
       * With 'prompt' plus skipWaiting/clientsClaim off, a new build installs quietly and waits.
       * It takes over only once every window of the app has been closed, which on the study tablet
       * means between sessions. Each export stamps app_version and git_hash, so which build
       * produced a session's data is a matter of record rather than of inference.
       */
      registerType: 'prompt',
      includeAssets: ['mediapipe/**/*', 'tasks-vision/**/*'],
      manifest: {
        name: 'VisuLab — Visual Ergonomics Experiment',
        short_name: 'VisuLab',
        description: 'Tablet platform for visual-ergonomics experiments.',
        // theme/background match the live cream UI (the legacy bundle still shipped dark #0a0a12).
        theme_color: '#F8F7F5',
        background_color: '#F8F7F5',
        display: 'fullscreen',
        orientation: 'landscape',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Self-hosted MediaPipe assets must be precached for true offline use, and so must the
        // vendored fonts: the stimulus typeface is an experimental control, and a session run in
        // aeroplane mode with the font uncached renders the reading passage in a fallback face.
        // `task` is the Face Landmarker model bundle (public/tasks-vision/, scripts/copy-mediapipe.mjs).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm,tflite,binarypb,data,task}'],
        // The largest single file is the Face Landmarker SIMD wasm, about 11.8 MB. A file over this
        // limit is silently left out of the precache, so copy-mediapipe.mjs fails the build first.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // Never seize control of a page that is already running a session. Both default to true,
        // which is what made 'autoUpdate' able to swap the precache out from under a live session.
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  build: {
    target: 'es2021',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split heavy vendors into their own chunks so the main bundle isn't a single ~650 kB blob.
        // (MediaPipe is already dynamically imported in useTracking, so it stays out of the entry.)
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
});
