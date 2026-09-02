/**
 * Writes the icons of the extension.
 *
 * The script draws them and encodes the PNG with `node:zlib`, so the repository
 * holds no binary file and the project needs no image dependency.
 *
 * The mark shows a scan frame around three lines of text.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "icons");
const docsDir = join(root, "docs");

const SIZES = [16, 32, 48, 128];

/** The README displays the mark at 96 CSS pixels, so it needs twice that. */
const README_SIZE = 192;

const BACKGROUND = [47, 109, 246, 255];
const INK = [255, 255, 255, 255];

/* ------------------------------------------------------------------ *
 * A very small raster surface
 * ------------------------------------------------------------------ */

const createSurface = (size) => ({
  size,
  pixels: new Uint8Array(size * size * 4),
});

const setPixel = (surface, x, y, colour) => {
  if (x < 0 || y < 0 || x >= surface.size || y >= surface.size) return;
  const offset = (y * surface.size + x) * 4;
  surface.pixels[offset] = colour[0];
  surface.pixels[offset + 1] = colour[1];
  surface.pixels[offset + 2] = colour[2];
  surface.pixels[offset + 3] = colour[3];
};

const fillRect = (surface, x, y, width, height, colour) => {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      setPixel(surface, Math.round(x + column), Math.round(y + row), colour);
    }
  }
};

/** A rounded square. The corner test keeps the shape smooth at every size. */
const fillRoundedSquare = (surface, radius, colour) => {
  const size = surface.size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0);
      const dy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) setPixel(surface, x, y, colour);
    }
  }
};

/* ------------------------------------------------------------------ *
 * The mark
 * ------------------------------------------------------------------ */

const drawMark = (size) => {
  const surface = createSurface(size);
  const unit = size / 16;
  const stroke = Math.max(1, Math.round(unit * 1.1));

  fillRoundedSquare(surface, Math.round(size * 0.22), BACKGROUND);

  // The four corner brackets of a scan frame.
  const inset = Math.round(unit * 2.6);
  const arm = Math.max(2, Math.round(unit * 3.2));
  const far = size - inset - stroke;

  fillRect(surface, inset, inset, arm, stroke, INK);
  fillRect(surface, inset, inset, stroke, arm, INK);
  fillRect(surface, size - inset - arm, inset, arm, stroke, INK);
  fillRect(surface, far, inset, stroke, arm, INK);
  fillRect(surface, inset, far, arm, stroke, INK);
  fillRect(surface, inset, size - inset - arm, stroke, arm, INK);
  fillRect(surface, size - inset - arm, far, arm, stroke, INK);
  fillRect(surface, far, size - inset - arm, stroke, arm, INK);

  // Three lines of text inside the frame.
  const left = Math.round(unit * 5);
  const right = size - left;
  const width = right - left;
  const gap = Math.max(stroke + 1, Math.round(unit * 2.1));
  const middle = Math.round(size / 2);
  const widths = [width, Math.round(width * 0.78), Math.round(width * 0.55)];

  widths.forEach((lineWidth, index) => {
    const y = middle + (index - 1) * gap - Math.round(stroke / 2);
    fillRect(surface, left, y, lineWidth, stroke, INK);
  });

  return surface;
};

/* ------------------------------------------------------------------ *
 * The PNG encoder
 * ------------------------------------------------------------------ */

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

const crc32 = (bytes) => {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};

const encodePng = (surface) => {
  const { size, pixels } = surface;
  const stride = size * 4;

  // One filter byte per row. Filter 0 keeps the row as it is.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const main = async () => {
  await mkdir(outDir, { recursive: true });
  for (const size of SIZES) {
    const png = encodePng(drawMark(size));
    await writeFile(join(outDir, `icon-${size}.png`), png);
    console.log(`icons: icon-${size}.png ${png.length} bytes`);
  }

  // The README shows the mark, so one copy stays in git. `icons/` does not: the
  // build regenerates it, and the package carries it.
  await mkdir(docsDir, { recursive: true });
  const large = encodePng(drawMark(README_SIZE));
  await writeFile(join(docsDir, "icon.png"), large);
  console.log(`icons: docs/icon.png ${large.length} bytes`);
};

await main();
