/**
 * Compares a git tag with the version of the package.
 *
 * A release carries a version number in three places: the tag, `package.json`,
 * and the manifest that the build writes. A mismatch would publish a package
 * that reports another version than its own release, so the workflow stops here.
 *
 * The script also reports whether the tag marks a pre-release, because a tag such
 * as `v0.2.0-beta.1` must not become the latest release.
 *
 * Usage: node scripts/check-version.mjs v0.1.0
 */

import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A tag of a release. The suffix after the hyphen marks a pre-release. */
const TAG_PATTERN = /^v(\d+\.\d+\.\d+)(-[0-9A-Za-z.-]+)?$/;

const fail = (message) => {
  console.error(`check-version: ${message}`);
  process.exit(1);
};

const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));

const readManifestVersion = async () => {
  try {
    return (await readJson("dist/manifest.json")).version;
  } catch {
    // The build has not run yet. `package.json` alone then decides.
    return null;
  }
};

const main = async () => {
  const ref = process.argv[2];
  if (ref === undefined || ref === "") fail("the tag is missing from the command line");

  const match = TAG_PATTERN.exec(ref);
  if (match === null) {
    fail(`the reference "${ref}" is not a version tag. A release needs a tag such as v0.1.0`);
  }

  const [, tagVersion, suffix] = match;
  const packageVersion = (await readJson("package.json")).version;
  if (tagVersion !== packageVersion) {
    fail(`the tag says ${tagVersion} and package.json says ${packageVersion}`);
  }

  const manifestVersion = await readManifestVersion();
  if (manifestVersion !== null && manifestVersion !== packageVersion) {
    fail(`the tag says ${tagVersion} and dist/manifest.json says ${manifestVersion}`);
  }

  const prerelease = suffix !== undefined;
  console.log(`check-version: ${ref} matches version ${packageVersion}`);
  if (prerelease) console.log("check-version: the suffix marks a pre-release");

  const output = process.env["GITHUB_OUTPUT"];
  if (output !== undefined) {
    await appendFile(output, `version=${packageVersion}\nprerelease=${prerelease}\n`);
  }
};

await main();
