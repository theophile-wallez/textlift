/**
 * The content script.
 *
 * It holds three jobs: it remembers the element of the last right click, it shows
 * the overlay, and it runs the region selector. It never touches the engine.
 *
 * Chrome can inject this file a second time when the service worker finds no
 * answer to its ping, so a flag on the window stops a double install.
 */

import { decodeMessage, type ToContent, ToContentSchema } from "../core/protocol.js";
import { hasTarget, notify } from "../shared/messaging.js";
import {
  anchorViewOf,
  findAnchorElement,
  naturalSizeOf,
  pixelRectOf,
  viewportSize,
} from "./anchor.js";
import { Overlay } from "./overlay.js";
import { pickRegion, type RegionPicker } from "./region-picker.js";

const INSTALL_FLAG = "__textliftInstalled";

type Flagged = typeof globalThis & { [INSTALL_FLAG]?: true };

const install = (): void => {
  /** The element under the last right click. The menu click follows it. */
  let contextTarget: Element | null = null;
  let overlay: Overlay | null = null;
  let activeJob: string | null = null;
  let picker: RegionPicker | null = null;

  document.addEventListener(
    "contextmenu",
    (event) => {
      contextTarget = event.target instanceof Element ? event.target : null;
    },
    true,
  );

  const closeOverlay = (): void => {
    overlay?.destroy();
    overlay = null;
    activeJob = null;
  };

  const beginScan = (message: Extract<ToContent, { kind: "scan:begin" }>): void => {
    closeOverlay();
    const view = anchorViewOf(message.anchor, contextTarget);
    if (view === null) return;

    activeJob = message.jobId;
    overlay = Overlay.open(view);
  };

  /** Ignores a message of a scan that another scan already replaced. */
  const forJob = (jobId: string): Overlay | null =>
    overlay !== null && activeJob === jobId && !overlay.isDisposed ? overlay : null;

  const startRegion = (requestId: string): void => {
    picker?.cancel();
    closeOverlay();

    const session = pickRegion();
    picker = session.picker;

    void session.done.then((area) => {
      picker = null;
      if (area === null) {
        void notify({ target: "background", kind: "region:cancelled", requestId });
        return;
      }
      void notify({
        target: "background",
        kind: "region:selected",
        requestId,
        rect: area,
        devicePixelRatio: window.devicePixelRatio,
      });
    });
  };

  const measure = (srcUrl: string): unknown => {
    const element = findAnchorElement(srcUrl, contextTarget);
    if (element === null) return { found: false };

    return {
      found: true,
      info: {
        rect: pixelRectOf(element),
        devicePixelRatio: window.devicePixelRatio,
        naturalSize: naturalSizeOf(element),
        viewport: viewportSize(),
      },
    };
  };

  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    if (!hasTarget(raw, "content")) return false;

    const decoded = decodeMessage(ToContentSchema, raw);
    if (!decoded.ok) {
      sendResponse({ ok: false });
      return false;
    }

    const message = decoded.value;

    switch (message.kind) {
      case "ping":
        sendResponse({ pong: true });
        return false;
      case "anchor:measure":
        sendResponse(measure(message.srcUrl));
        return false;
      case "scan:begin":
        beginScan(message);
        break;
      case "scan:anchor": {
        const view = anchorViewOf(message.anchor, contextTarget);
        if (view !== null) forJob(message.jobId)?.setAnchor(view);
        break;
      }
      case "scan:progress":
        forJob(message.jobId)?.setProgress(message.progress);
        break;
      case "scan:result":
        forJob(message.jobId)?.setResult(message.result, message.view);
        break;
      case "scan:error": {
        const owner = forJob(message.jobId);
        // A scan can fail before its overlay exists, and the user still reads why.
        if (owner === null) overlay = Overlay.openToast(message.message);
        else owner.setError(message.message);
        break;
      }
      case "region:request":
        startRegion(message.requestId);
        break;
    }

    sendResponse({ ok: true });
    return false;
  });
};

const flagged = globalThis as Flagged;
if (flagged[INSTALL_FLAG] !== true) {
  flagged[INSTALL_FLAG] = true;
  install();
}
