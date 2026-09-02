/**
 * The build.
 *
 * Four bundles leave this script. The service worker and the two extension pages
 * are modules. The content script is a classic script, because Chrome injects a
 * content script that way.
 *
 * The script also writes `dist/manifest.json` from `src/manifest.ts`, so the
 * manifest and the code never drift apart.
 */

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const watch = process.argv.includes("--watch");
const development = watch || process.argv.includes("--dev");

const BUNDLES = [
  { entry: "src/background/index.ts", out: "background.js", format: "esm" },
  { entry: "src/offscreen/index.ts", out: "offscreen.js", format: "esm" },
  { entry: "src/options/index.ts", out: "options.js", format: "esm" },
  // A content script runs as a classic script, so it carries no import.
  { entry: "src/content/index.ts", out: "content.js", format: "iife" },
];

const STATIC_FILES = [
  ["src/offscreen/index.html", "offscreen.html"],
  ["src/options/index.html", "options.html"],
  ["src/options/options.css", "options.css"],
];

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const runScript = (name) => {
  const outcome = spawnSync(process.execPath, [join(root, "scripts", name)], {
    stdio: "inherit",
  });
  if (outcome.status !== 0) throw new Error(`scripts/${name} failed`);
};

/** The vendored engine and the icons are build inputs, so they come first. */
const VENDOR_INPUTS = [
  "public/vendor/tesseract/worker.min.js",
  "public/vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm",
  "public/vendor/tessdata/eng.traineddata.gz",
];

const ensureInputs = async () => {
  const present = await Promise.all(VENDOR_INPUTS.map((path) => exists(join(root, path))));
  if (present.includes(false)) runScript("vendor.mjs");
  if (!(await exists(join(root, "icons/icon-128.png")))) runScript("make-icons.mjs");
};

const readVersion = async () => {
  const raw = await readFile(join(root, "package.json"), "utf8");
  return JSON.parse(raw).version;
};

const writeManifest = async () => {
  // The manifest lives in TypeScript, so esbuild compiles it before the import.
  const bundle = await esbuild.build({
    entryPoints: [join(root, "src/manifest.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });

  const code = bundle.outputFiles[0].text;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const manifest = module.buildManifest({ version: await readVersion() });

  await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

const bundleOptions = (bundle) => ({
  entryPoints: [join(root, bundle.entry)],
  outfile: join(dist, bundle.out),
  bundle: true,
  format: bundle.format,
  platform: "browser",
  target: ["chrome116"],
  minify: !development,
  sourcemap: development ? "inline" : false,
  legalComments: "none",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
  logLevel: "warning",
  metafile: true,
});

const report = async () => {
  const sizes = await Promise.all(
    [...BUNDLES.map((bundle) => bundle.out), "manifest.json"].map(async (name) => {
      const info = await stat(join(dist, name));
      return `${name} ${(info.size / 1024).toFixed(1)} kB`;
    }),
  );
  console.log(`build: ${sizes.join(", ")}`);
};

const main = async () => {
  await ensureInputs();
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  if (watch) {
    const contexts = await Promise.all(
      BUNDLES.map((bundle) => esbuild.context(bundleOptions(bundle))),
    );
    await Promise.all(contexts.map((context) => context.watch()));
  } else {
    await Promise.all(BUNDLES.map((bundle) => esbuild.build(bundleOptions(bundle))));
  }

  for (const [source, target] of STATIC_FILES) {
    await cp(join(root, source), join(dist, target));
  }
  await cp(join(root, "public/vendor"), join(dist, "vendor"), { recursive: true });
  await cp(join(root, "icons"), join(dist, "icons"), { recursive: true });

  await writeManifest();
  await report();

  if (watch) console.log("build: watching. Load dist/ as an unpacked extension.");
};

await main();
