/**
 * Generate the PWA icons (public/icon-192.png, icon-512.png) — a simple "iris" mark on the cream
 * theme background, centred within the maskable safe zone. Pure Node (zlib + a tiny PNG encoder),
 * so it needs no native image dependency. Run via `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function makePng(size) {
  const [bgR, bgG, bgB] = hexRgb('#F8F7F5');
  const navy = hexRgb('#1a1a2e');
  const blue = hexRgb('#4f8ef7');
  const white = [255, 255, 255];
  const cx = size / 2;
  const cy = size / 2;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy) / size; // 0..~0.7
      let rgb;
      if (d < 0.07) rgb = navy;        // pupil
      else if (d < 0.085) rgb = white; // catchlight ring
      else if (d < 0.20) rgb = blue;   // iris
      else if (d < 0.235) rgb = navy;  // limbal ring
      else if (d < 0.30) rgb = white;  // sclera
      else rgb = [bgR, bgG, bgB];      // cream background
      raw[p++] = rgb[0];
      raw[p++] = rgb[1];
      raw[p++] = rgb[2];
      raw[p++] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // ihdr[10..12] = 0 (compression/filter/interlace)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  const png = makePng(size);
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`[make-icons] wrote public/icon-${size}.png (${png.length} bytes)`);
}
