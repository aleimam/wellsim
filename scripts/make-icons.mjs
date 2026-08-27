// Generates the WellSim PWA icons as PNGs with zero dependencies (raw PNG
// chunks + zlib). Motif: the nodal plot — declining IPR, rising VLP, white
// operating point — on the app's navy.
// Run: node scripts/make-icons.mjs   (writes into src/ui/)
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/ui');

const NAVY = [0x16, 0x32, 0x4f];
const GREEN = [0x4c, 0xbf, 0x7b];
const BLUE = [0x7f, 0xb3, 0xe0];
const WHITE = [0xff, 0xff, 0xff];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// curves in unit coords (y down); crossing found numerically
const iprY = (t) => 0.26 + 0.52 * t * t;            // declines in pressure
const vlpY = (t) => 0.78 - 0.48 * t + 0.14 * t * t; // rises in pressure
let tX = 0.5;
for (let i = 0; i < 60; i++) {
  const f = (t) => iprY(t) - vlpY(t);
  tX -= f(tX) / ((f(tX + 1e-4) - f(tX - 1e-4)) / 2e-4);
}
const X0 = 0.14, X1 = 0.86;
const cross = { x: X0 + tX * (X1 - X0), y: iprY(tX) };

const smooth = (edge, w, d) => Math.max(0, Math.min(1, (edge - d) / w));

function draw(size, { fullBleed = false, scale = 1 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size;
  const r = fullBleed ? 0 : s * 0.18;
  const px = 1 / s;
  const cx = 0.5, cy = 0.5;
  const m = (v) => cx + (v - cx) * scale; // shrink motif toward center (maskable safe zone)
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s, v = (y + 0.5) / s;
      // rounded-rect coverage
      let bgA = 1;
      if (!fullBleed) {
        const qx = Math.max(Math.abs(u - 0.5) - (0.5 - r / s), 0);
        const qy = Math.max(Math.abs(v - 0.5) - (0.5 - r / s), 0);
        const d = Math.hypot(qx, qy) - r / s;
        bgA = smooth(0, 1.5 * px, d);
      }
      let [cr, cg, cb] = NAVY, ca = bgA;
      if (bgA > 0) {
        // motif in (possibly shrunken) coords
        const uu = cx + (u - cx) / scale, vv = cy + (v - cy) / scale;
        if (uu >= X0 - 0.02 && uu <= X1 + 0.02) {
          const t = Math.max(0, Math.min(1, (uu - X0) / (X1 - X0)));
          const th = 0.045;
          const dI = Math.abs(vv - iprY(t)), dV = Math.abs(vv - vlpY(t));
          const inRange = uu >= X0 && uu <= X1;
          const aI = inRange ? smooth(th / 2, 1.5 * px / scale, dI) : 0;
          const aV = inRange ? smooth(th / 2, 1.5 * px / scale, dV) : 0;
          if (aV > 0) { [cr, cg, cb] = BLUE.map((c2, i) => Math.round(NAVY[i] + (c2 - NAVY[i]) * aV)); }
          if (aI > 0) { [cr, cg, cb] = [cr, cg, cb].map((c2, i) => Math.round(c2 + (GREEN[i] - c2) * aI)); }
        }
        // operating point: navy ring + white dot
        const dC = Math.hypot(uu - cross.x, vv - cross.y);
        const ring = smooth(0.095, 1.5 * px / scale, dC);
        if (ring > 0) { [cr, cg, cb] = [cr, cg, cb].map((c2, i) => Math.round(c2 + (NAVY[i] - c2) * ring)); }
        const dot = smooth(0.062, 1.5 * px / scale, dC);
        if (dot > 0) { [cr, cg, cb] = [cr, cg, cb].map((c2, i) => Math.round(c2 + (WHITE[i] - c2) * dot)); }
      }
      const o = (y * s + x) * 4;
      buf[o] = cr; buf[o + 1] = cg; buf[o + 2] = cb; buf[o + 3] = Math.round(255 * ca);
    }
  }
  return encodePng(s, buf);
}

writeFileSync(path.join(UI, 'icon-192.png'), draw(192));
writeFileSync(path.join(UI, 'icon-512.png'), draw(512));
writeFileSync(path.join(UI, 'icon-maskable-512.png'), draw(512, { fullBleed: true, scale: 0.78 }));
writeFileSync(path.join(UI, 'apple-touch-icon.png'), draw(180, { fullBleed: true, scale: 0.92 }));
console.log('icons written to src/ui/: icon-192, icon-512, icon-maskable-512, apple-touch-icon');
