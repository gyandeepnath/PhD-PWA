import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// Build-time provenance: stamp the git hash so every export can be traced to a build.
let gitHash = 'unknown';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout (e.g. CI tarball) — leave as 'unknown' */
}

export default defineConfig({
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
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
      includeAssets: ['mediapipe/**/*'],
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm,tflite,binarypb,data}'],
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
