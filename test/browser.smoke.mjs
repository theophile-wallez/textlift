/**
 * The browser smoke test.
 *
 * The unit tests cover the arithmetic, and they cannot cover the parts that only
 * Chrome holds: the content security policy of the manifest, the load of the
 * WebAssembly core inside a worker, the bundled training data, and the overlay.
 *
 * The test drives a real Chromium with the unpacked extension:
 *  1. It renders a sentence with the browser and saves it as a PNG.
 *  2. It serves that PNG over HTTP, because a content script needs a real origin.
 *  3. It asks the offscreen document to read the PNG, and it compares the text.
 *  4. It sends the result to the content script and reads the overlay.
 *  5. It selects the transparent text with the mouse and reads the selection.
 *  6. It runs a region scan, which covers the screenshot and the crop arithmetic.
 *
 * The device pixel ratio of the browser is 2, because a screenshot arrives in
 * device pixels and a wrong ratio would pass at 1.
 *
 * Chrome opens the context menu itself, and no test can click an item of it. So
 * the test drives the two paths behind the menu instead of the menu.
 *
 * Chrome loads an unpacked extension in a headed browser only, so the test needs
 * a display. Use `xvfb-run -a npm run test:browser` on a machine without one.
 *
 * Run `npm run build`, then `npm run test:browser`.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const SENTENCE = "The quick brown fox jumps over the lazy dog";

const PAGE = (imageUrl) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>textlift smoke</title>
<style>body{margin:0;background:#fff}img{display:block;width:900px}</style></head>
<body><img id="target" src="${imageUrl}" alt=""></body></html>`;

const SAMPLE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; background: #fff; }
  #card { width: 900px; padding: 40px; font: 400 38px/1.5 "DejaVu Sans", sans-serif; color: #111; }
</style></head>
<body><div id="card">${SENTENCE}</div></body></html>`;

/** Serves the sample page and the sample image on a loopback port. */
const startServer = async (png) => {
  const server = createServer((request, response) => {
    if (request.url === "/sample.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(png);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE("/sample.png"));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
};

const normalise = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const wordOverlap = (expected, actual) => {
  const wanted = normalise(expected).split(" ");
  const found = new Set(normalise(actual).split(" "));
  const hits = wanted.filter((word) => found.has(word)).length;
  return hits / wanted.length;
};

const main = async () => {
  await readFile(join(dist, "manifest.json")).catch(() => {
    throw new Error("dist/ is missing. Run npm run build first.");
  });

  const profile = await mkdtemp(join(tmpdir(), "textlift-profile-"));
  const context = await chromium.launchPersistentContext(profile, {
    // A headless Chrome loads no unpacked extension, so the browser stays headed.
    headless: false,
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });

  let server;
  try {
    /* 1. Render the sentence and keep the pixels. */
    const painter = await context.newPage();
    await painter.setContent(SAMPLE);
    const png = await painter.locator("#card").screenshot();
    await painter.close();

    /* 2. Serve the image, then open the page that holds it. */
    server = await startServer(png);
    const page = await context.newPage();
    await page.goto(server.origin, { waitUntil: "load" });

    /* 3. Read the image with the offscreen document. */
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

    const reply = await worker.evaluate(async (imageUrl) => {
      await chrome.offscreen
        .createDocument({
          url: "offscreen.html",
          reasons: ["WORKERS"],
          justification: "smoke test",
        })
        .catch(() => {});

      return chrome.runtime.sendMessage({
        target: "offscreen",
        kind: "ocr:run",
        jobId: "smoke-1",
        image: { kind: "url", url: imageUrl },
        request: {
          languages: ["eng"],
          layout: "auto",
          minConfidence: 30,
          upscale: true,
          maxScale: 3,
        },
      });
    }, `${server.origin}/sample.png`);

    assert.ok(reply, "the offscreen document sent no answer");
    assert.equal(reply.ok, true, `the scan failed: ${JSON.stringify(reply.error)}`);

    const { result } = reply;
    const overlap = wordOverlap(SENTENCE, result.text);
    console.log(
      `smoke: read ${result.meta.wordCount} words in ${Math.round(result.meta.durationMs)} ms`,
    );
    console.log(`smoke: text "${result.text.replace(/\n/g, " / ")}"`);
    console.log(`smoke: word overlap ${(overlap * 100).toFixed(0)}%`);

    assert.ok(overlap >= 0.8, `the engine read only ${(overlap * 100).toFixed(0)}% of the words`);
    assert.ok(result.lines.length >= 1, "the engine reported no line");
    assert.ok(result.meta.meanConfidence > 60, "the mean confidence is too low");

    // Every box stays inside the source image.
    for (const line of result.lines) {
      assert.ok(line.bbox.x >= -1 && line.bbox.y >= -1, "a box starts outside the image");
      assert.ok(
        line.bbox.x + line.bbox.width <= result.imageSize.width + 2,
        "a box passes the right edge of the image",
      );
    }

    /* 4. Send the result to the page and read the overlay. */
    const tabId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      return tab?.id ?? null;
    });
    assert.ok(tabId !== null, "the worker found no test tab");

    // The measurement of the anchor. The image path of the service worker starts
    // with it, and the screenshot fallback reads its rectangle.
    const measured = await worker.evaluate(
      ([id, url]) =>
        chrome.tabs.sendMessage(id, { target: "content", kind: "anchor:measure", srcUrl: url }),
      [tabId, `${server.origin}/sample.png`],
    );
    const domRect = await page.evaluate(() => {
      const box = document.getElementById("target").getBoundingClientRect();
      const image = document.getElementById("target");
      return {
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
        natural: { width: image.naturalWidth, height: image.naturalHeight },
        ratio: window.devicePixelRatio,
      };
    });

    assert.equal(measured.found, true, "the content script did not find the image");
    assert.deepEqual(measured.info.naturalSize, domRect.natural, "a wrong natural size");
    assert.equal(measured.info.devicePixelRatio, domRect.ratio, "a wrong pixel ratio");
    assert.ok(
      Math.abs(measured.info.rect.width - domRect.rect.width) < 1 &&
        Math.abs(measured.info.rect.y - domRect.rect.y) < 1,
      `the measured rectangle ${JSON.stringify(measured.info.rect)} misses the element`,
    );
    console.log(`smoke: anchor ${measured.info.rect.width}x${measured.info.rect.height} CSS px`);

    const notFound = await worker.evaluate(
      (id) =>
        chrome.tabs.sendMessage(id, {
          target: "content",
          kind: "anchor:measure",
          srcUrl: "https://absent.test/nothing.png",
        }),
      tabId,
    );
    assert.equal(notFound.found, false, "the content script invented an element");

    await worker.evaluate(
      async ([id, scan]) => {
        await chrome.tabs.sendMessage(id, {
          target: "content",
          kind: "scan:begin",
          jobId: "smoke-1",
          anchor: { kind: "image", srcUrl: scan.url },
        });
        await chrome.tabs.sendMessage(id, {
          target: "content",
          kind: "scan:result",
          jobId: "smoke-1",
          result: scan.result,
          view: { showBoxes: false, autoCopy: false },
        });
      },
      [tabId, { url: `${server.origin}/sample.png`, result }],
    );

    const overlay = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const host = document.getElementById("textlift-overlay");
      if (host?.shadowRoot === null || host?.shadowRoot === undefined) return null;

      const lines = [...host.shadowRoot.querySelectorAll(".line")];
      const image = document.getElementById("target").getBoundingClientRect();
      const frame = host.shadowRoot.querySelector(".frame").getBoundingClientRect();

      return {
        lineCount: lines.length,
        text: lines.map((node) => node.textContent).join("\n"),
        transformed: lines.every((node) => node.style.transform.startsWith("scaleX(")),
        firstLine: lines[0]?.getBoundingClientRect() ?? null,
        font: getComputedStyle(host.shadowRoot.querySelector(".bar")).fontFamily,
        image: { x: image.x, y: image.y, width: image.width, height: image.height },
        frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
        status: host.shadowRoot.querySelector(".status")?.textContent ?? "",
      };
    });

    assert.ok(overlay !== null, "the content script built no overlay");
    assert.ok(overlay.lineCount >= 1, "the overlay holds no line");
    assert.ok(overlay.transformed, "a line carries no horizontal correction");
    assert.ok(
      Math.abs(overlay.frame.width - overlay.image.width) < 2,
      `the frame is ${overlay.frame.width} wide and the image is ${overlay.image.width}`,
    );
    assert.ok(
      overlay.firstLine.y >= overlay.image.y - 2 &&
        overlay.firstLine.y <= overlay.image.y + overlay.image.height,
      "the first line sits outside the image",
    );
    assert.ok(overlay.status.includes("word"), `the toolbar shows "${overlay.status}"`);

    // An inline reset on the host once beat the `:host` rule, and the whole
    // overlay fell back to the serif default of the browser.
    assert.ok(
      overlay.font.startsWith("system-ui"),
      `the toolbar reads its font from "${overlay.font}"`,
    );
    assert.ok(!/times/i.test(overlay.font), `the toolbar names a serif: ${overlay.font}`);
    assert.ok(
      /(^|,\s*)sans-serif\s*$/.test(overlay.font),
      `the last family of the toolbar is not sans-serif: ${overlay.font}`,
    );

    console.log(`smoke: overlay holds ${overlay.lineCount} selectable lines`);
    console.log(`smoke: toolbar reads "${overlay.status}"`);

    const shot = join(tmpdir(), "textlift-smoke.png");
    await page.screenshot({ path: shot });
    await writeFile(join(tmpdir(), "textlift-smoke.txt"), result.text);
    console.log(`smoke: screenshot ${shot}`);

    /* 5. Select the transparent text with the mouse, as the user does. */
    const line = overlay.firstLine;
    await page.mouse.move(line.x + 4, line.y + line.height / 2);
    await page.mouse.down();
    await page.mouse.move(line.x + line.width - 4, line.y + line.height / 2, { steps: 12 });
    await page.mouse.up();

    const selected = await page.evaluate(() => {
      const host = document.getElementById("textlift-overlay");
      const inShadow = host?.shadowRoot?.getSelection?.()?.toString() ?? "";
      return inShadow !== "" ? inShadow : (document.getSelection()?.toString() ?? "");
    });

    console.log(`smoke: mouse selection "${selected}"`);
    assert.ok(
      wordOverlap(SENTENCE, selected) >= 0.6,
      `the mouse selected "${selected}" instead of the text of the image`,
    );

    /* 6. The region scan: a real drag, a real screenshot, a real crop. */
    const requestId = "smoke-region";
    await worker.evaluate(
      async ([id, request]) => {
        const tab = await chrome.tabs.get(id);
        // The service worker stores this entry when the user starts a selection.
        // No test can click the toolbar button that starts it, so the test writes it.
        await chrome.storage.session.set({
          pendingRegions: {
            [request]: { tabId: id, frameId: 0, windowId: tab.windowId, createdAt: Date.now() },
          },
        });
        await chrome.tabs.sendMessage(id, {
          target: "content",
          kind: "region:request",
          requestId: request,
        });
      },
      [tabId, requestId],
    );

    const region = await page.evaluate(() => {
      const box = document.getElementById("target").getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });

    await page.waitForFunction(() => document.getElementById("textlift-region") !== null);
    await page.mouse.move(region.x + 2, region.y + 2);
    await page.mouse.down();
    await page.mouse.move(region.x + region.width - 2, region.y + region.height - 2, { steps: 16 });
    await page.mouse.up();

    const regionText = await page.waitForFunction(
      () => {
        const host = document.getElementById("textlift-overlay");
        const lines = host?.shadowRoot?.querySelectorAll(".line");
        return lines !== undefined && lines.length > 0
          ? [...lines].map((node) => node.textContent).join(" ")
          : false;
      },
      { timeout: 90_000 },
    );

    const fromRegion = await regionText.jsonValue();
    console.log(`smoke: region scan read "${fromRegion}"`);
    assert.ok(
      wordOverlap(SENTENCE, fromRegion) >= 0.8,
      `the region scan read "${fromRegion}" instead of the text of the image`,
    );

    const regionShot = join(tmpdir(), "textlift-smoke-region.png");
    await page.screenshot({ path: regionShot });
    console.log(`smoke: screenshot ${regionShot}`);

    console.log("smoke: every check passed");
  } finally {
    server?.close();
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
};

await main();
