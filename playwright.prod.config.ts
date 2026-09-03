import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const CANDIDATE_CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.CHROME_PATH ?? '',
].find((p) => p && existsSync(p));

/**
 * End-to-end checks against the PRODUCTION BUILD, served the way the tablet is served.
 *
 * The main e2e suite runs the Vite dev server and deliberately avoids MediaPipe. Both choices are
 * defensible on their own and together they left a hole big enough to lose a study through:
 * `@mediapipe/face_mesh` publishes its constructor onto a global under Rollup and onto the module
 * exports under esbuild, so the dev server resolved it and the shipped bundle did not. Every unit
 * test, every e2e test and the whole verification gate passed green, and the first real device
 * reported "FaceMesh is not a constructor" with no ocular data collectable at all.
 *
 * These specs therefore run against `dist/`, over the same static server the field package uses.
 * A test that never touches the artefact it ships cannot catch a packaging fault.
 */
export default defineConfig({
  testDir: './e2e-prod',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5181',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'production-bundle',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
          ...(CANDIDATE_CHROME ? { executablePath: CANDIDATE_CHROME } : {}),
        },
      },
    },
  ],
  webServer: {
    // The very server shipped in the field package, so a fault in it is caught here too.
    command: 'node field/serve.mjs --port 5181',
    url: 'http://localhost:5181',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
