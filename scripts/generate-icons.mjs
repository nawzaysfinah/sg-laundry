/**
 * Generates the PWA icon set with zero dependencies.
 *
 * Writing a PNG by hand is a handful of lines (IHDR + IDAT + IEND, with zlib
 * doing the compression), and it avoids pulling `sharp` or a headless browser
 * into the toolchain just to produce four small images. Re-run with:
 *
 *   npm run icons
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// ---------------------------------------------------------------------------
// Minimal PNG encoder
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());

  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** rgba: Uint8Array of size * size * 4 */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with a filter-type byte (0 = None).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Artwork: a raindrop over a horizon glow, matching the app's palette.
// Everything is drawn with signed-distance functions so it scales cleanly.
// ---------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** Antialiased coverage from a signed distance (negative = inside). */
const coverage = (d, aa) => clamp01(0.5 - d / aa);
/**
 * Polynomial smooth minimum. A plain Math.min union of the bulb and the cone
 * leaves a visible notch where their silhouettes cross; blending over a small
 * radius `k` fuses them into one continuous teardrop.
 */
function smin(a, b, k) {
  if (!Number.isFinite(b)) return a;
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

function drawIcon(size, { maskable = false } = {}) {
  const rgba = new Uint8Array(size * size * 4);
  const aa = size / 128;
  // Maskable icons get cropped to a circle by Android, so shrink the artwork
  // into the guaranteed-safe centre 80%.
  const scale = maskable ? 0.62 : 0.78;
  const cx = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      // --- Background: vertical night-sky gradient with a warm horizon glow.
      let r = lerp(0x14, 0x07, v);
      let g = lerp(0x2c, 0x0d, v);
      let b = lerp(0x52, 0x1a, v);

      const glow = Math.exp(-(((u - 0.5) ** 2) * 6 + ((v - 0.18) ** 2) * 26));
      r = lerp(r, 0x3f, glow * 0.55);
      g = lerp(g, 0x6d, glow * 0.55);
      b = lerp(b, 0xc4, glow * 0.55);

      // --- Raindrop: a circle fused with a cone, the classic teardrop.
      // Work in a normalised space centred on the icon.
      const px = (x + 0.5 - cx) / (size * scale);
      const py = (y + 0.5 - size * 0.54) / (size * scale);

      const bulbR = 0.30;
      const bulbCY = 0.16;
      const dBulb = Math.hypot(px, py - bulbCY) - bulbR;

      // Cone tapering from the bulb up to the tip at py = -0.44.
      const tipY = -0.44;
      const t = clamp01((py - tipY) / (bulbCY - tipY));
      const halfWidth = t * bulbR * 1.02;
      const dCone = py < bulbCY ? Math.abs(px) - halfWidth : Infinity;
      const inCone = py >= tipY && py <= bulbCY ? dCone : Infinity;

      const dDrop = smin(dBulb, inCone, 0.05);
      const a = coverage(dDrop * size * scale, aa * 1.5);

      if (a > 0) {
        // Shade the drop so it reads as glassy rather than flat.
        const shade = clamp01(0.55 + (0.35 - py) * 0.55 - px * 0.25);
        const dropR = lerp(0x7d, 0xdc, shade);
        const dropG = lerp(0xb8, 0xef, shade);
        const dropB = lerp(0xf0, 0xff, shade);
        r = lerp(r, dropR, a);
        g = lerp(g, dropG, a);
        b = lerp(b, dropB, a);
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = 255;
    }
  }

  return encodePng(size, rgba);
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["badge-96.png", 96, { maskable: true }],
  ["apple-touch-icon.png", 180, {}],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT_DIR, name), drawIcon(size, opts));
  console.log(`  ✓ icons/${name}  (${size}×${size})`);
}

console.log(`\nWrote ${targets.length} icons to public/icons/`);
