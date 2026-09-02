/**
 * Collects the engine files that the package ships.
 *
 * Manifest V3 forbids remote code, so the WebAssembly core and the worker script
 * live inside the package. Training data is data and not code, so the package
 * holds English only and the engine downloads the other languages on demand.
 *
 * Run `npm run vendor` once after an install, and again after an update of
 * `tesseract.js`. The build runs it as well when the directory is empty.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(root, "public/vendor/tesseract");
const dataDir = join(root, "public/vendor/tessdata");

/**
 * The engine files.
 *
 * Only the LSTM cores, because the legacy Tesseract engine needs other training
 * data. Only the two SIMD variants, because Chrome 116 is the minimum version of
 * the manifest and SIMD arrived in Chrome 91.
 */
const ENGINE_FILES = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js/dist/worker.min.js.LICENSE.txt", "worker.min.js.LICENSE.txt"],
  ["tesseract.js/LICENSE.md", "LICENSE.tesseract.js.txt"],
  ["tesseract.js-core/LICENSE", "LICENSE.tesseract.js-core.txt"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.js", "tesseract-core-relaxedsimd-lstm.js"],
  [
    "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm",
    "tesseract-core-relaxedsimd-lstm.wasm",
  ],
  ["tesseract.js-core/tesseract-core-simd-lstm.js", "tesseract-core-simd-lstm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm"],
];

/** The default data host of tesseract.js. It serves the `fast` set of Tesseract 4. */
const TESSDATA_BASE = "https://tessdata.projectnaptha.com/4.0.0_fast";

const BUNDLED_LANGUAGES = ["eng"];

/** A shorter file means a failed download or an HTML error page. */
const MIN_TRAINEDDATA_BYTES = 500_000;

const sizeOf = async (path) => {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
};

const copyEngine = async () => {
  await mkdir(engineDir, { recursive: true });
  let copied = 0;

  for (const [source, target] of ENGINE_FILES) {
    const from = join(root, "node_modules", source);
    if ((await sizeOf(from)) === 0) {
      throw new Error(`${source} is missing. Run npm install first.`);
    }
    await copyFile(from, join(engineDir, target));
    copied += 1;
  }

  console.log(`vendor: ${copied} engine files -> public/vendor/tesseract`);
};

const downloadLanguage = async (code) => {
  const name = `${code}.traineddata.gz`;
  const target = join(dataDir, name);

  if ((await sizeOf(target)) >= MIN_TRAINEDDATA_BYTES) {
    console.log(`vendor: ${name} is present`);
    return;
  }

  const url = `${TESSDATA_BASE}/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < MIN_TRAINEDDATA_BYTES) {
    throw new Error(`${url} returned ${bytes.byteLength} bytes, which is too short`);
  }

  await writeFile(target, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  console.log(`vendor: ${name} ${(bytes.byteLength / 1e6).toFixed(2)} MB sha256:${digest}`);
};

const main = async () => {
  await copyEngine();
  await mkdir(dataDir, { recursive: true });
  for (const code of BUNDLED_LANGUAGES) await downloadLanguage(code);
};

await main();
