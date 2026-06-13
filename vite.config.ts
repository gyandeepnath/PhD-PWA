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
      registerType: 'autoUpdate',
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Self-hosted MediaPipe assets must be precached for true offline use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,tflite,binarypb,data}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
    }),
  ],
  build: { target: 'es2021', sourcemap: true },
});
