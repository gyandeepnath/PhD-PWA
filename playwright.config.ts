import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Prefer a pre-installed Chromium when the browser download is blocked by the network policy.
const CANDIDATE_CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.CHROME_PATH ?? '',
].find((p) => p && existsSync(p));

/**
 * E2E config. Runs the dev server with the ?e2e=1 fast-timing flag and a landscape tablet viewport.
 * The full experiment is exercised on the no-camera path (deterministic; MediaPipe/wasm in headless
 * is flaky), which still validates the entire stage flow, DB writes and export.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5180',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
          ...(CANDIDATE_CHROME ? { executablePath: CANDIDATE_CHROME } : {}),
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5180',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
