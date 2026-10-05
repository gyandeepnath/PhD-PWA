import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The same image gives the same landmarks through both trackers (round 75).
 *
 * tests/landmarkTopology.test.ts proves the two packages NUMBER the 478 points the same way; this
 * proves they PUT them in the same place. The image is MediaPipe's own test portrait, with MediaPipe's
 * expected landmarks for it, fetched by the TEST RUNNER from MediaPipe's public test-asset bucket and
 * checked against a pinned SHA-256. It is not committed (a photograph of a person) and the app never
 * fetches it: the page receives it as a data URL. Offline, the test is skipped and says why.
 *
 * Both trackers are the app's own adapters (src/tracking/trackers.ts), run in this browser; the legacy
 * one runs first, which also exercises the shared-global fix in createTasks (see clearForeignEmscriptenModule).
 */
const ASSETS = 'https://storage.googleapis.com/mediapipe-assets';
const PORTRAIT_SHA256 = 'a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e';
// Beside the build's model cache; test-results/ is emptied at the start of every run.
const CACHE = resolve(process.cwd(), 'node_modules', '.cache', 'visulab', 'test-assets');

async function asset(name: string): Promise<Buffer | null> {
  const p = resolve(CACHE, name);
  if (existsSync(p)) return readFileSync(p);
  try {
    const r = await fetch(`${ASSETS}/${name}`);
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(p, b);
    return b;
  } catch {
    return null;
  }
}

test('legacy FaceMesh and Face Landmarker put the landmarks in the same place', async ({ page }) => {
  test.setTimeout(180_000);
  const jpg = await asset('portrait.jpg');
  const expectedTxt = await asset('portrait_expected_face_landmarks.pbtxt');
  test.skip(!jpg || !expectedTxt, 'MediaPipe test assets are not reachable from this machine');
  expect(createHash('sha256').update(jpg!).digest('hex')).toBe(PORTRAIT_SHA256);
  const expected = [...expectedTxt!.toString().matchAll(/x: ([-\d.e]+)\s+y: ([-\d.e]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(expected.length).toBe(478);

  await page.goto('/?e2e=1');
  const out = await page.evaluate(async (dataUrl) => {
    const { createTracker } = await import('/src/tracking/trackers.ts');
    const { faceEar } = await import('/src/tracking/blink.ts');
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const res: Record<string, { lm: number[][]; ear: number }> = {};
    for (const backend of ['legacy', 'tasks-cpu'] as const) {
      const t = await createTracker(backend);
      const lm = await t.detect(img);
      t.close();
      if (!lm) throw new Error(`${backend} found no face`);
      res[backend] = { lm: lm.map((p) => [p.x, p.y]), ear: faceEar(lm, img.naturalWidth / img.naturalHeight) };
    }
    return { res, w: img.naturalWidth, h: img.naturalHeight };
  }, `data:image/jpeg;base64,${jpg!.toString('base64')}`);

  const { res, w, h } = out;
  const px = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h);
  const median = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const faceWidthPx = (Math.max(...expected.map((p) => p[0])) - Math.min(...expected.map((p) => p[0]))) * w;

  expect(res.legacy.lm.length).toBe(478);
  expect(res['tasks-cpu'].lm.length).toBe(478);
  const between = median(res.legacy.lm.map((p, i) => px(p, res['tasks-cpu'].lm[i])));
  const tasksVsExpected = median(res['tasks-cpu'].lm.map((p, i) => px(p, expected[i])));
  const legacyVsExpected = median(res.legacy.lm.map((p, i) => px(p, expected[i])));
  const earGap = Math.abs(res.legacy.ear - res['tasks-cpu'].ear) / res['tasks-cpu'].ear;
  console.log(JSON.stringify({ faceWidthPx: Math.round(faceWidthPx), medianPxBetween: between.toFixed(2), tasksVsExpected: tasksVsExpected.toFixed(2),
    legacyVsExpected: legacyVsExpected.toFixed(2), earLegacy: res.legacy.ear.toFixed(4), earTasks: res['tasks-cpu'].ear.toFixed(4), earGap: earGap.toFixed(3) }));
  // Same place: the median point within 2% of the face's width between the two trackers and against
  // MediaPipe's own expected landmarks. NOT the same instrument: the eye-aspect ratio may differ by a
  // few per cent, which is why the tracker is recorded per condition and frozen for the study.
  expect(between).toBeLessThan(0.02 * faceWidthPx);
  expect(tasksVsExpected).toBeLessThan(0.02 * faceWidthPx);
  expect(legacyVsExpected).toBeLessThan(0.02 * faceWidthPx);
  expect(earGap).toBeLessThan(0.15);
});
