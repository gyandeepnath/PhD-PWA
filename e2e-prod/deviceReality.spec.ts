import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil } from '../e2e/helpers';

/**
 * The two faults a real tablet found, checked against the SHIPPED bundle.
 *
 * Both had passed the whole verification gate. One made every ocular measurement impossible, the
 * other made a questionnaire unsubmittable. They survived because the tests ran the dev server, at
 * viewports no shorter than an iPad, with MediaPipe deliberately avoided — three reasonable choices
 * whose intersection was the blind spot.
 *
 * The FaceMesh fault in particular CANNOT be caught by the dev-server suite, at any viewport, with
 * any assertion: `@mediapipe/face_mesh` ends with `var wa = this || self` and assigns its
 * constructor onto that. Under esbuild's CommonJS interop — the dev server — it lands on the module
 * exports. Under Rollup — every build that ships — `this` is undefined at ESM top level, so it
 * lands on the global and the module namespace is empty. The dev server is therefore green by
 * construction. This file exists so something exercises the artefact that actually reaches a
 * tablet.
 */
test.describe('the shipped bundle', () => {
  test('a FaceMesh constructor is reachable from the shipped chunk', async ({ page }) => {
    await page.goto('/');

    /*
     * Measure where the constructor actually is in the bundle that ships.
     *
     * On the build this was written against, importing the Rollup chunk yields a namespace whose
     * only export is a mangled internal — `Object.keys(m)` is `["f"]` — with `m.FaceMesh` and
     * `m.default` both undefined, while `globalThis.FaceMesh` is a function. That is the whole bug:
     * the app read `mod.FaceMesh`, got undefined, and called `new undefined(...)`.
     *
     * The assertion is the invariant the loader depends on, not the exact shape, because the shape
     * is the bundler's business and may change. If a future toolchain populates the namespace
     * instead, this still passes and the loader still works — it checks the namespace first.
     */
    const shape = await page.evaluate(async () => {
      const chunk = [...document.querySelectorAll('link[rel=modulepreload], script[type=module]')]
        .map((e) => (e as HTMLAnchorElement).href || (e as HTMLScriptElement).src)
        .find((u) => /face_mesh-[^/]*\.js$/.test(u ?? ''))
        ?? new URL('assets/', document.baseURI).toString();

      const out: Record<string, unknown> = { chunk };
      try {
        // Fall back to the static copy if the hashed chunk is not preloaded on this page.
        const url = /face_mesh-/.test(chunk)
          ? chunk
          : new URL('mediapipe/face_mesh.js', document.baseURI).toString();
        const m = await import(/* @vite-ignore */ url) as Record<string, unknown>;
        out.keys = Object.keys(m);
        out.onModule = typeof m.FaceMesh;
        out.onDefault = typeof (m.default as Record<string, unknown> | undefined)?.FaceMesh;
      } catch (e) {
        out.importError = String(e);
      }
      out.onGlobal = typeof (globalThis as Record<string, unknown>).FaceMesh;
      return out;
    });

    const reachable = [shape.onModule, shape.onDefault, shape.onGlobal].includes('function');
    expect(
      reachable,
      `no FaceMesh constructor in any slot the loader checks: ${JSON.stringify(shape)}`,
    ).toBe(true);

    // Guard the case that actually shipped, so a regression is named rather than merely red:
    // the namespace being empty is FINE, and reading it directly is what was not.
    if (shape.onModule !== 'function' && shape.onDefault !== 'function') {
      expect(
        shape.onGlobal,
        'the constructor is only on the global — a loader reading the module namespace would break',
      ).toBe('function');
    }
  });

  test('serves every model asset the tracker fetches, base-relative', async ({ page }) => {
    // A 404 here is the other way to lose the primary outcome, and it looks identical to the
    // operator: getUserMedia still succeeds, the preview still shows a face, and the checklist box
    // gets ticked. Base-relative resolution is what makes these work from a GitHub Pages
    // subdirectory rather than only from a domain root.
    await page.goto('/');
    const results = await page.evaluate(async () => {
      const files = [
        'face_mesh.js',
        'face_mesh.binarypb',
        'face_mesh_solution_packed_assets.data',
        'face_mesh_solution_packed_assets_loader.js',
        'face_mesh_solution_simd_wasm_bin.js',
        'face_mesh_solution_simd_wasm_bin.wasm',
      ];
      const base = new URL('./', document.baseURI);
      return Promise.all(files.map(async (f) => {
        const url = new URL(`mediapipe/${f}`, base).toString();
        try {
          const r = await fetch(url);
          return { f, status: r.status, bytes: (await r.arrayBuffer()).byteLength };
        } catch (e) {
          return { f, status: -1, bytes: 0, error: String(e) };
        }
      }));
    });
    for (const r of results) {
      expect(r.status, `${r.f} returned ${r.status}`).toBe(200);
      expect(r.bytes, `${r.f} served zero bytes`).toBeGreaterThan(0);
    }
  });

  test('the questionnaire fits and can be submitted on the shortest device', async ({ page }) => {
    // 1152x650 is a Xiaomi Pad 6 in Chrome with the address bar showing — the device that failed,
    // and about 180 px shorter than the design canvas the layouts were authored against.
    await page.setViewportSize({ width: 1152, height: 650 });
    await startNewExperiment(page);
    await driveUntil(page, 'CVSQ_BASELINE');

    const root = await page.evaluate(() => {
      const el = document.getElementById('root')!;
      return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    expect(root.scrollH - root.clientH, 'overflows the clipped root vertically').toBeLessThanOrEqual(1);
    expect(root.scrollW - root.clientW, 'overflows the clipped root horizontally').toBeLessThanOrEqual(1);

    const btn = page.getByRole('button', { name: /Continue/ });
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toBeInViewport();
  });

  test('a scale is actually computed, rather than left at its declared default', async ({ page }) => {
    // theme.css declares `--vl-scale: 1` and describes a scaling strategy around it. Nothing ever
    // set it, so every device rendered at the design size. A viewport well under the canvas must
    // therefore produce a value strictly below 1 — that is the whole difference between the broken
    // build and this one.
    await page.setViewportSize({ width: 1152, height: 650 });
    await page.goto('/');
    const scale = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')));
    expect(scale).toBeGreaterThan(0);
    expect(scale, 'the root scaler never ran: --vl-scale is still its declared default').toBeLessThan(1);
  });
});
