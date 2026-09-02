/**
 * Writes the ZIP file that the Chrome Web Store accepts.
 *
 * The script builds the archive with `node:zlib`, so the project needs no
 * archive dependency. It stores every file of `dist/` with the deflate method.
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

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

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return found.flat().sort();
};

/** The ZIP format wants a forward slash in every entry name. */
const entryName = (path) => relative(dist, path).split(sep).join("/");

const localHeader = (entry) => {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(0, 10); // time
  header.writeUInt16LE(0x21, 12); // date: 1 January 1980
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, Buffer.from(entry.name, "utf8")]);
};

const centralHeader = (entry) => {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(8, 10); // deflate
  header.writeUInt16LE(0, 12); // time
  header.writeUInt16LE(0x21, 14); // date
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, Buffer.from(entry.name, "utf8")]);
};

const endRecord = (count, centralSize, centralOffset) => {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
};

const main = async () => {
  await stat(dist).catch(() => {
    throw new Error("dist/ is missing. Run npm run build first.");
  });

  const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  const target = join(root, `textlift-${manifest.version}.zip`);

  const parts = [];
  const central = [];
  let offset = 0;

  for (const path of await listFiles(dist)) {
    const contents = await readFile(path);
    const entry = {
      name: entryName(path),
      size: contents.length,
      crc: crc32(contents),
      compressed: deflateRawSync(contents, { level: 9 }),
      offset,
    };

    const header = localHeader(entry);
    parts.push(header, entry.compressed);
    offset += header.length + entry.compressed.length;
    central.push(centralHeader(entry));
  }

  const centralBuffer = Buffer.concat(central);
  const archive = Buffer.concat([
    ...parts,
    centralBuffer,
    endRecord(central.length, centralBuffer.length, offset),
  ]);

  await writeFile(target, archive);
  console.log(
    `package: ${relative(root, target)} ${(archive.length / 1e6).toFixed(2)} MB, ${central.length} files`,
  );
};

await main();
