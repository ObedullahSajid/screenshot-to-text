/**
 * Generates the extension icons (PNG) without any image dependencies.
 *
 * Design: a rounded square with an indigo -> cyan gradient and three white
 * "text line" bars. Rendered with 4x supersampling for clean edges.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icon');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Signed-distance style coverage for a rounded rectangle in [0,1] space. */
function roundedRectCoverage(x, y, cx, cy, hw, hh, r) {
  const dx = Math.max(Math.abs(x - cx) - (hw - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (hh - r), 0);
  if (dx * dx + dy * dy <= r * r) return 1;
  return 0;
}

function render(size) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  const pad = 0.04; // transparent margin around the tile
  const half = 0.5 - pad;
  const radius = 0.22;

  // Bars: [top, width] in normalized tile space.
  const bars = [
    [0.285, 0.62],
    [0.465, 0.44],
    [0.645, 0.54],
  ];
  const barH = 0.085;
  const barLeft = 0.22;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;

          const tile = roundedRectCoverage(x, y, 0.5, 0.5, half, half, radius);
          if (tile === 0) continue;

          // Gradient from indigo (top-left) to cyan (bottom-right).
          const t = clamp01((x + y) / 2);
          let cr = lerp(0.33, 0.04, t) * 255;
          let cg = lerp(0.29, 0.68, t) * 255;
          let cb = lerp(0.86, 0.82, t) * 255;

          for (const [top, width] of bars) {
            const cov = roundedRectCoverage(
              x,
              y,
              barLeft + width / 2,
              top + barH / 2,
              width / 2,
              barH / 2,
              barH / 2,
            );
            if (cov) {
              cr = lerp(cr, 255, 0.94);
              cg = lerp(cg, 255, 0.94);
              cb = lerp(cb, 255, 0.94);
            }
          }

          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }

      const samples = SS * SS;
      const idx = (py * size + px) * 4;
      buf[idx] = Math.round(r / samples);
      buf[idx + 1] = Math.round(g / samples);
      buf[idx + 2] = Math.round(b / samples);
      buf[idx + 3] = Math.round(a / samples);
    }
  }

  return encodePng(size, size, buf);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = render(size);
  writeFileSync(join(outDir, `${size}.png`), png);
  console.log(`icon/${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
}
