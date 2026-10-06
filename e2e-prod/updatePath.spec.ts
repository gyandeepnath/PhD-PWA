import { test, expect } from '@playwright/test';

/**
 * The tablet must be able to tell which build it is running, and must have a way to move to a new one.
 *
 * A deployed fix and a stale cache are indistinguishable from the device. That is not hypothetical:
 * a face-tracker fix was deployed, verified live, and the tablet went on reporting the identical
 * error from its cached build — which looked exactly like a fix that had not worked, and cost a
 * round trip of screenshots to tell apart.
 *
 * The cause was that `registerType: 'prompt'` is a contract with two sides and only one was
 * written. The worker installed and waited; nothing in the app ever offered to activate it. Closing
 * tabs did not help and neither did removing the home-screen shortcut, because the worker belongs
 * to the origin rather than to the shortcut.
 */
test.describe('update path', () => {
  test('the running build is visible on the landing screen', async ({ page }) => {
    await page.goto('/');
    // A version and a short git hash. Without this, "did the fix reach the tablet?" can only be
    // answered by re-running the thing that was broken.
    // Since Round 74 the line reads "VisuLab 2.3.1 · built <date time> UTC · <hash>": the build time
    // changes on every deployment even when the version does not, which "v2.1.0 · hash" never showed.
    const stamp = page.getByTestId('build-stamp');
    await expect(stamp, 'no build stamp on the landing screen').toHaveCount(1);
    await expect(stamp).toHaveText(/VisuLab \d+\.\d+\.\d+ · built .+ · [0-9a-f]{7,}/);
  });

  test('the app registers a service worker at all', async ({ page }) => {
    await page.goto('/');
    // Registration is what makes an update even possible to notice. It is also what makes the app
    // work in aeroplane mode, which the protocol requires.
    // Registration is asynchronous and races page load, so wait for it rather than sampling once.
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) return 'registered';
        await new Promise((r) => setTimeout(r, 250));
      }
      return 'none';
    });
    expect(registered, 'no service worker registration — the app cannot update or run offline')
      .toBe('registered');
  });

  test('the update banner stays out of a running session', async ({ page }) => {
    // Applying an update reloads the page. Offering that during a sitting is how a 90-minute
    // session gets lost, which is why skipWaiting is off in the first place.
    await page.goto('/?e2e=1');
    const banner = page.getByRole('status').filter({ hasText: /newer version/i });
    // Not shown when nothing is waiting, on any screen.
    await expect(banner).toHaveCount(0);
  });
});
