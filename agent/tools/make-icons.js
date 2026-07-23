"use strict";

/**
 * Generates the agent's tray icons — real .ico and .png files on disk.
 *
 * Run:  node tools/make-icons.js
 *
 * WHY THIS EXISTS
 * The first version of the agent built its tray icon from an inline SVG data
 * URL. Electron's nativeImage decodes PNG and JPEG only — NOT SVG — so it
 * returned an empty image, and the hard-coded PNG fallback was itself a
 * corrupt/truncated base64 string. `new Tray(emptyImage)` produces exactly the
 * reported symptom: a tray entry that exists, has a working tooltip and menu,
 * but shows nothing.
 *
 * So icons are now generated as genuine files, committed to the repo, and
 * loaded from disk. This script is the source of truth for them; re-run it to
 * change the design.
 *
 * No image libraries — pure Node. PNG via zlib, ICO via the classic
 * BITMAPINFOHEADER/DIB layout that every Windows version accepts (rather than
 * PNG-in-ICO, which only Vista+ handles).
 *
 * THE MARK: a gauge, echoing components/brand/logo.tsx — coloured ring, dark
 * dial face, coloured needle. Green while tracking, amber while paused, so the
 * tray itself tells the employee which state the agent is in.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "assets");

/** Supersampling factor — drawn at N× then box-filtered down for smooth edges. */
const SS = 4;

const COLOURS = {
  // Matches the web app's palette exactly.
  active: { r: 0x2b, g: 0xb6, b: 0x73 }, // #2BB673 good
  paused: { r: 0xf5, g: 0xa6, b: 0x23 }, // #F5A623 warn
};
const DIAL = { r: 0x17, g: 0x1d, b: 0x21 }; // #171D21 surface

/**
 * Rasterise the mark at `size` px into an RGBA buffer.
 *
 * Drawn with plain maths at SS× resolution, then averaged down — that gives
 * anti-aliased edges without pulling in a canvas dependency.
 */
function drawMark(size, colour) {
  const S = size * SS;
  const big = new Uint8ClampedArray(S * S * 4);

  const cx = S / 2;
  const cy = S / 2;
  const rOuter = S * 0.47; // outer disc
  const rInner = S * 0.29; // dark dial face
  const needleLen = S * 0.34;
  const needleHalf = S * 0.055; // half-thickness

  // Needle points up-right (−45°), into the "good" zone of the dial.
  const ang = -Math.PI / 4;
  const nx = Math.cos(ang);
  const ny = Math.sin(ang);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);

      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;

      if (dist <= rOuter) {
        // Outer ring in the status colour.
        R = colour.r;
        G = colour.g;
        B = colour.b;
        A = 255;

        if (dist <= rInner) {
          // Dark dial face.
          R = DIAL.r;
          G = DIAL.g;
          B = DIAL.b;
        }
      }

      // Needle: distance from the centre→direction segment.
      const proj = dx * nx + dy * ny;
      if (proj >= 0 && proj <= needleLen) {
        const perp = Math.abs(dx * -ny + dy * nx);
        // Taper toward the tip so it reads as a pointer, not a bar.
        const halfHere = needleHalf * (1 - 0.45 * (proj / needleLen));
        if (perp <= halfHere && dist <= rOuter) {
          R = colour.r;
          G = colour.g;
          B = colour.b;
          A = 255;
        }
      }

      const o = (y * S + x) * 4;
      big[o] = R;
      big[o + 1] = G;
      big[o + 2] = B;
      big[o + 3] = A;
    }
  }

  // Box-filter down by SS.
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          const al = big[o + 3];
          // Premultiply so transparent pixels don't darken the edges.
          r += big[o] * al;
          g += big[o + 1] * al;
          b += big[o + 2] * al;
          a += al;
        }
      }
      const n = SS * SS;
      const o2 = (y * size + x) * 4;
      if (a === 0) {
        out[o2] = out[o2 + 1] = out[o2 + 2] = out[o2 + 3] = 0;
      } else {
        out[o2] = Math.round(r / a);
        out[o2 + 1] = Math.round(g / a);
        out[o2 + 2] = Math.round(b / a);
        out[o2 + 3] = Math.round(a / n);
      }
    }
  }
  return out;
}

// ── PNG encoding ───────────────────────────────────────────────────

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
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
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgba, size) {
  // Filter byte 0 (None) per scanline.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size * 4; x++) raw[p++] = rgba[y * size * 4 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)), // the chunk the old broken icon was missing
  ]);
}

// ── ICO encoding (DIB entries — universally supported) ─────────────

function dibEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight = XOR + AND masks
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // BI_RGB

  // BGRA, bottom-up.
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  // AND mask: 1bpp, rows padded to 4 bytes. Zeroed — the alpha channel does
  // the real work on 32-bit icons, but the mask must still be present.
  const rowBytes = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(rowBytes * size);

  return Buffer.concat([header, xor, and]);
}

function encodeIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type 1 = icon
  dir.writeUInt16LE(images.length, 4);

  const entries = [];
  const blobs = [];
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // palette count
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit count
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(data);
    offset += data.length;
  }

  return Buffer.concat([dir, ...entries, ...blobs]);
}

// ── Build ──────────────────────────────────────────────────────────

// 16 and 32 are what Windows actually asks for in the tray (at 100% and
// 150–200% DPI); 48 and 64 cover the app/window icon and higher scaling.
const SIZES = [16, 32, 48, 64];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [state, colour] of Object.entries(COLOURS)) {
  const images = SIZES.map((size) => ({ size, data: dibEntry(drawMark(size, colour), size) }));
  const ico = encodeIco(images);
  const icoPath = path.join(OUT_DIR, `tray-${state}.ico`);
  fs.writeFileSync(icoPath, ico);

  // PNGs too: macOS and Linux trays want PNG, not ICO.
  for (const size of [16, 32]) {
    const png = encodePng(drawMark(size, colour), size);
    fs.writeFileSync(path.join(OUT_DIR, `tray-${state}-${size}.png`), png);
  }

  console.log(
    `  tray-${state}.ico  ${ico.length} bytes  (${SIZES.join("/")} px)  + ${[16, 32].map((s) => `tray-${state}-${s}.png`).join(", ")}`,
  );
}

console.log(`\nWrote icons to ${OUT_DIR}`);
