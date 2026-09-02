/**
 * The service worker.
 *
 * It owns the menus, the keyboard command, and the routing of every message. It
 * runs no recognition: the offscreen document does that, because Chrome stops a
 * service worker after 30 seconds of inactivity.
 *
 * Every listener registers at the top level, because Chrome dispatches an event
 * to a worker that it just started, and a listener inside a promise arrives late.
 */

import { Effect, Layer, ManagedRuntime } from "effect";
import { rect } from "../core/geometry.js";
import { decodeMessage, ToBackgroundSchema } from "../core/protocol.js";
import { hasTarget, type TabTarget } from "../shared/messaging.js";
import { readSettings } from "../shared/settings-store.js";
import { Capture, CaptureLive } from "./capture.js";
import { findJobTarget } from "./job-registry.js";
import { MENU_ITEMS, MenuId } from "./menus.js";
import { Offscreen, OffscreenLive } from "./offscreen-client.js";
import { Page, PageLive } from "./page-client.js";
import { putRegionRequest, takeRegionRequest } from "./region-store.js";
import { runScan } from "./scan.js";

/** The engine holds about 100 MB, so an idle document closes after this delay. */
const IDLE_RELEASE_MINUTES = 5;
const RELEASE_ALARM = "textlift:release-engine";

const layer = Layer.mergeAll(OffscreenLive, PageLive, CaptureLive);
const runtime = ManagedRuntime.make(layer);

type AppEffect<A> = Effect.Effect<A, never, Offscreen | Page | Capture>;

const run = (effect: AppEffect<void>): void => {
  void runtime.runPromise(effect).catch((cause: unknown) => {
    console.error("[textlift] unhandled failure", cause);
  });
};

const scheduleRelease = Effect.promise(async () => {
  await chrome.alarms.create(RELEASE_ALARM, { delayInMinutes: IDLE_RELEASE_MINUTES });
}).pipe(Effect.ignore);

/* ------------------------------------------------------------------ *
 * Menus
 * ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const item of MENU_ITEMS) chrome.contextMenus.create(item);
  });
});

/* ------------------------------------------------------------------ *
 * Scan entry points
 * ------------------------------------------------------------------ */

const scanImage = (target: TabTarget, windowId: number, srcUrl: string): AppEffect<void> =>
  Effect.gen(function* () {
    const settings = yield* Effect.promise(readSettings);
    yield* runScan({ kind: "image", tab: target, windowId, settings, srcUrl });
    yield* scheduleRelease;
  });

/**
 * Starts a region selection. The service worker does not wait for the drag: it
 * stores the context and returns, and the answer of the page wakes it up again.
 */
const requestRegion = (target: TabTarget, windowId: number): AppEffect<void> =>
  Effect.gen(function* () {
    const page = yield* Page;
    const requestId = yield* Effect.sync(() => crypto.randomUUID());
    yield* putRegionRequest(requestId, { ...target, windowId });
    yield* page.ensureScript(target).pipe(Effect.ignore);
    yield* page.tell(target, { target: "content", kind: "region:request", requestId });
  });

const scanRegion = (
  requestId: string,
  region: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  devicePixelRatio: number,
): AppEffect<void> =>
  Effect.gen(function* () {
    const pending = yield* takeRegionRequest(requestId);
    if (pending === null) {
      yield* Effect.logWarning(`unknown region request ${requestId}`);
      return;
    }

    const settings = yield* Effect.promise(readSettings);
    yield* runScan({
      kind: "region",
      tab: { tabId: pending.tabId, frameId: pending.frameId },
      windowId: pending.windowId,
      settings,
      rect: rect(region.x, region.y, region.width, region.height),
      devicePixelRatio,
    });
    yield* scheduleRelease;
  });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  const target: TabTarget = { tabId: tab.id, frameId: info.frameId ?? 0 };
  const windowId = tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

  if (info.menuItemId !== MenuId.ScanImage || info.srcUrl === undefined) return;
  run(scanImage(target, windowId, info.srcUrl));
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  run(requestRegion({ tabId: tab.id, frameId: 0 }, tab.windowId));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "scan-region" || tab?.id === undefined) return;
  run(requestRegion({ tabId: tab.id, frameId: 0 }, tab.windowId));
});

/* ------------------------------------------------------------------ *
 * Message routing
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  if (!hasTarget(raw, "background")) return false;

  const decoded = decodeMessage(ToBackgroundSchema, raw);
  if (!decoded.ok) {
    console.warn("[textlift] rejected message:", decoded.reason);
    sendResponse({ ok: false });
    return false;
  }

  const message = decoded.value;
  sendResponse({ ok: true });

  switch (message.kind) {
    case "ocr:progress": {
      const target = findJobTarget(message.jobId);
      if (target === undefined) return false;
      run(
        Effect.flatMap(Page, (page) =>
          page.tell(target, {
            target: "content",
            kind: "scan:progress",
            jobId: message.jobId,
            progress: message.progress,
          }),
        ),
      );
      return false;
    }
    case "region:selected":
      run(scanRegion(message.requestId, message.rect, message.devicePixelRatio));
      return false;
    case "region:cancelled":
      run(Effect.asVoid(takeRegionRequest(message.requestId)));
      return false;
  }
});

/* ------------------------------------------------------------------ *
 * Idle cleanup
 * ------------------------------------------------------------------ */

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RELEASE_ALARM) return;
  run(
    Effect.flatMap(Offscreen, (offscreen) =>
      Effect.logInfo("engine release after idle").pipe(Effect.zipRight(offscreen.release)),
    ),
  );
});
