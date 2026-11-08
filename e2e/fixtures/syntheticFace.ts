import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/*
 * A DRAWN face for Chromium's fake camera (--use-file-for-fake-video-capture), written as a y4m file.
 *
 * Chromium's own fake camera shows no face, so every camera spec ran calibration without an open-eye
 * baseline. That was the only way they reached the camera check: "Continue without blink measures"
 * led into it. A check that counts blinks cannot run without a baseline (audit 86 CAM-2), so that path
 * no longer leads there, and the specs that test the check itself need a face the tracker finds. This
 * is a cartoon — ellipses and lines, no person's picture — that the face trackers find in headless
 * Chromium (checked with each of the three backends). Its eyes are open in every frame: it gives the
 * calibration a baseline and never blinks, so the camera check runs and does not pass.
 *
 * Generated, not committed: a raw y4m frame is 115 kB, and the drawing below is the whole source.
 */

const W = 320;
const H = 240;
type RGB = [number, number, number];

/** One frame of the face, in RGB, drawn with 3x3 supersampling so its edges are not jagged. */
function drawFace(): Uint8ClampedArray {
  const S = 3;
  const rgb = new Uint8ClampedArray(W * H * 3);
  const shapes: Array<{ inside: (x: number, y: number) => boolean; c: RGB }> = [];
  const ellipse = (cx: number, cy: number, rx: number, ry: number, c: RGB) =>
    shapes.push({ inside: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c });
  const rect = (x0: number, y0: number, x1: number, y1: number, c: RGB) =>
    shapes.push({ inside: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1, c });
  const line = (x0: number, y0: number, x1: number, y1: number, w: number, c: RGB) =>
    shapes.push({
      inside: (x, y) => {
        const dx = x1 - x0, dy = y1 - y0;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= w / 2;
      },
      c,
    });
  const triangle = (a: [number, number], b: [number, number], d: [number, number], c: RGB) =>
    shapes.push({
      inside: (x, y) => {
        const s = (p: [number, number], q: [number, number]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
        const s1 = s(a, b), s2 = s(b, d), s3 = s(d, a);
        return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
      },
      c,
    });
  // Half the size of the 640x480 drawing it was first tried at; painted back to front.
  const k = 0.5;
  const skin: RGB = [224, 172, 140];
  ellipse(320 * k, 170 * k, 120 * k, 130 * k, [50, 35, 25]); // hair
  ellipse(320 * k, 225 * k, 105 * k, 155 * k, skin); // face
  rect(285 * k, 360 * k, 355 * k, 480 * k, [214, 162, 130]); // neck
  ellipse(216 * k, 225 * k, 16 * k, 35 * k, [214, 160, 128]); // ears
  ellipse(424 * k, 225 * k, 16 * k, 35 * k, [214, 160, 128]);
  line(255 * k, 170 * k, 305 * k, 162 * k, 7 * k, [60, 40, 30]); // brows
  line(335 * k, 162 * k, 385 * k, 170 * k, 7 * k, [60, 40, 30]);
  for (const cx of [282 * k, 358 * k]) {
    const cy = 205 * k;
    ellipse(cx, cy, 30 * k, 16 * k, [80, 50, 40]); // lid line
    ellipse(cx, cy, 28 * k, 14 * k, [250, 250, 250]); // white of the eye
    ellipse(cx, cy, 11 * k, 11 * k, [70, 45, 30]); // iris
    ellipse(cx, cy, 5 * k, 5 * k, [10, 10, 10]); // pupil
    rect(cx - 30 * k, cy - 30 * k, cx + 30 * k, cy - 14 * k, skin); // the iris kept inside the lids
    rect(cx - 30 * k, cy + 14 * k, cx + 30 * k, cy + 30 * k, skin);
  }
  triangle([320 * k, 215 * k], [305 * k, 285 * k], [335 * k, 285 * k], [205, 150, 120]); // nose
  ellipse(309 * k, 285 * k, 9 * k, 7 * k, [150, 100, 80]);
  ellipse(331 * k, 285 * k, 9 * k, 7 * k, [150, 100, 80]);
  shapes.push({ inside: (x, y) => y >= 327 * k && ((x - 320 * k) / (35 * k)) ** 2 + ((y - 327 * k) / (17 * k)) ** 2 <= 1, c: [170, 70, 70] }); // mouth
  const bg: RGB = [150, 150, 150];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
          let c = bg;
          for (const sh of shapes) if (sh.inside(px, py)) c = sh.c;
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      const i = (y * W + x) * 3;
      rgb[i] = acc[0] / (S * S); rgb[i + 1] = acc[1] / (S * S); rgb[i + 2] = acc[2] / (S * S);
    }
  }
  return rgb;
}

/** RGB to one I420 frame (BT.601, studio range), chroma averaged over each 2x2 block. */
function toI420(rgb: Uint8ClampedArray): Buffer {
  const out = Buffer.alloc(W * H * 1.5);
  const at = (x: number, y: number) => (y * W + x) * 3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      out[y * W + x] = Math.round(0.257 * rgb[i] + 0.504 * rgb[i + 1] + 0.098 * rgb[i + 2] + 16);
    }
  }
  const u0 = W * H, v0 = u0 + (W / 2) * (H / 2);
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W / 2; x++) {
      let r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = at(2 * x + dx, 2 * y + dy);
        r += rgb[i] / 4; g += rgb[i + 1] / 4; b += rgb[i + 2] / 4;
      }
      out[u0 + y * (W / 2) + x] = Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128);
      out[v0 + y * (W / 2) + x] = Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128);
    }
  }
  return out;
}

/**
 * Chromium's launch options with the drawn face as its fake camera: `test.use({ launchOptions:
 * faceCameraLaunchOptions() })` in a spec that needs the tracker to find a face. The same flags and the
 * same pre-installed Chromium as playwright.config.ts, with the face file added.
 */
export function faceCameraLaunchOptions(): { args: string[]; executablePath?: string } {
  const chrome = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROME_PATH ?? ''].find((p) => p && existsSync(p));
  return {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${syntheticFaceY4m()}`],
    ...(chrome ? { executablePath: chrome } : {}),
  };
}

/**
 * The face's y4m path, written on first use. In the system's temporary folder, not test-results/,
 * which Playwright empties at the start of a run; the name carries a version, so a changed drawing
 * is written afresh.
 */
export function syntheticFaceY4m(): string {
  const file = join(tmpdir(), 'visulab-e2e', 'synthetic-face-v1.y4m');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const frame = toI420(drawFace());
    const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`, 'ascii');
    const parts: Buffer[] = [header];
    // A second of identical frames: Chromium loops the file, and a one-frame file is read as a still.
    for (let f = 0; f < 30; f++) parts.push(Buffer.from('FRAME\n', 'ascii'), frame);
    writeFileSync(file, Buffer.concat(parts));
  }
  return file;
}
