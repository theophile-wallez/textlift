/**
 * Writes the body of a release to the standard output.
 *
 * The body carries the install steps and the fingerprint of the package. GitHub
 * adds the list of the commits under it, so this text holds no changelog.
 *
 * Usage: node scripts/release-notes.mjs textlift-0.1.0.zip > release-notes.md
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const main = async () => {
  const path = process.argv[2];
  if (path === undefined || path === "") {
    console.error("release-notes: the name of the package is missing");
    process.exit(1);
  }

  const bytes = await readFile(path);
  const size = (await stat(path)).size;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const manifest = JSON.parse(await readFile(join(root, "dist/manifest.json"), "utf8"));
  const name = basename(path);

  process.stdout.write(`Reads the text of an image on your machine, and lays a selectable copy of
that text over the picture.

## Install

1. Download \`${name}\` under **Assets**.
2. Unzip it into a directory that stays on your disk.
3. Open \`chrome://extensions\` and turn on **Developer mode**.
4. Choose **Load unpacked** and select that directory.

Chrome ${manifest.minimum_chrome_version} or later. Right-click an image and choose
**Scan the text of this image**, or press \`Alt+Shift+S\` to scan a screen region.

The package holds the recognition engine and English. Every other language
downloads on its first use.

| Package | Size | SHA-256 |
| ------- | ---- | ------- |
| \`${name}\` | ${(size / 1e6).toFixed(2)} MB | \`${digest}\` |

`);
};

await main();
