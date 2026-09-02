/**
 * Writes the picture of the README.
 *
 * The script drives the real extension in a real browser: it paints a note,
 * scans it, selects one line with the mouse, and clips the screenshot to the
 * note and its toolbar. So the picture always shows what the code does today.
 *
 * Run `npm run build`, then `xvfb-run -a npm run demo` on a machine without a
 * display, because Chrome loads an unpacked extension in a headed browser only.
 */

import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const target = join(root, "docs/demo.png");

/** The note that the demo reads. A handwritten font keeps it honest: it is an image. */
const NOTE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; }
  #note {
    width: 760px;
    padding: 34px 40px 38px;
    background: linear-gradient(#fffdf6, #fdf8ea);
    color: #232019;
    font: 400 25px/1.62 "DejaVu Serif", Georgia, serif;
  }
  h1 { margin: 0 0 14px; font-size: 29px; letter-spacing: 0.01em; }
  p { margin: 0 0 6px; }
  .dim { color: #6b6152; font-size: 21px; }
</style></head>
<body><div id="note">
  <h1>Weekly notes — 12 March</h1>
  <p>Ship the export pipeline before Friday.</p>
  <p>Rewrite the cache key, and include the locale.</p>
  <p>Ask Marie about the billing migration.</p>
  <p class="dim">Invoice 2024-118 stays open: 1 340,50 EUR</p>
</div></body></html>`;

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>textlift</title>
<style>
  body { margin: 0; padding: 40px; background: #eceef1; font-family: system-ui, sans-serif; }
  img { display: block; width: 760px; border-radius: 4px; box-shadow: 0 2px 4px rgb(20 22 28 / 10%), 0 14px 34px rgb(20 22 28 / 14%); }
</style></head>
<body><img id="target" src="/note.png" alt=""></body></html>`;

const startServer = (png) =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      const png_ = request.url === "/note.png";
      response.writeHead(200, { "content-type": png_ ? "image/png" : "text/html; charset=utf-8" });
      response.end(png_ ? png : PAGE);
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
    );
  });

const main = async () => {
  await mkdir(dirname(target), { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), "textlift-demo-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 860, height: 560 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });

  let server;
  try {
    const painter = await context.newPage();
    await painter.setContent(NOTE);
    const png = await painter.locator("#note").screenshot();
    await painter.close();

    server = await startServer(png);
    const page = await context.newPage();
    await page.goto(server.origin, { waitUntil: "load" });

    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const reply = await worker.evaluate(async (url) => {
      await chrome.offscreen
        .createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "demo" })
        .catch(() => {});
      return chrome.runtime.sendMessage({
        target: "offscreen",
        kind: "ocr:run",
        jobId: "demo",
        image: { kind: "url", url },
        request: {
          languages: ["eng"],
          layout: "auto",
          minConfidence: 30,
          upscale: true,
          maxScale: 3,
        },
      });
    }, `${server.origin}/note.png`);

    if (reply?.ok !== true) throw new Error(`the scan failed: ${JSON.stringify(reply?.error)}`);

    const tabId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      return tab.id;
    });

    await worker.evaluate(
      async ([id, scan]) => {
        await chrome.tabs.sendMessage(id, {
          target: "content",
          kind: "scan:begin",
          jobId: "demo",
          anchor: { kind: "image", srcUrl: scan.url },
        });
        await chrome.tabs.sendMessage(id, {
          target: "content",
          kind: "scan:result",
          jobId: "demo",
          result: scan.result,
          view: { showBoxes: false, autoCopy: false },
        });
      },
      [tabId, { url: `${server.origin}/note.png`, result: reply.result }],
    );

    // Select the third line, so the picture shows the selection over the pixels.
    const line = await page.evaluate(async () => {
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const lines = document
        .getElementById("textlift-overlay")
        .shadowRoot.querySelectorAll(".line");
      const box = lines[2].getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });

    await page.mouse.move(line.x + 1, line.y + line.height / 2);
    await page.mouse.down();
    await page.mouse.move(line.x + line.width - 1, line.y + line.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const clip = await page.evaluate(() => {
      const image = document.getElementById("target").getBoundingClientRect();
      const bar = document
        .getElementById("textlift-overlay")
        .shadowRoot.querySelector(".bar")
        .getBoundingClientRect();
      const pad = 22;
      const bottom = Math.max(image.bottom, bar.bottom);
      return {
        x: image.x - pad,
        y: image.y - pad,
        width: image.width + pad * 2,
        height: bottom - image.y + pad * 2,
      };
    });

    await page.screenshot({ path: target, clip });
    console.log(`demo: docs/demo.png ${Math.round(clip.width)}x${Math.round(clip.height)} CSS px`);
    console.log(
      `demo: read "${reply.result.text.split("\n")[0]}" and ${reply.result.meta.wordCount} words`,
    );
  } finally {
    server?.close();
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
};

await main();
