/**
 * The scan pipeline.
 *
 * Two entry points end here: the scan of one image and the scan of a screen
 * region. Both produce the same result and the same overlay.
 *
 * The image path reads the bytes of the image directly, because that keeps the
 * full resolution of the source. An image host that refuses the read sends the
 * path to the screenshot fallback, which reads the pixels of the screen instead.
 */

import { Effect } from "effect";
import {
  type AppError,
  debugMessage,
  EmptyRegionError,
  isRetryable,
  PageError,
  userMessage,
} from "../core/errors.js";
import { intersectRect, rect, type Rect, scaleRect } from "../core/geometry.js";
import type { OcrResult } from "../core/ocr.js";
import type { Anchor, ImageRef, OcrRequest, ViewOptions } from "../core/protocol.js";
import type { Settings } from "../core/settings.js";
import type { TabTarget } from "../shared/messaging.js";
import { Capture } from "./capture.js";
import { forgetJob, registerJob } from "./job-registry.js";
import { Offscreen } from "./offscreen-client.js";
import { Page } from "./page-client.js";

export interface ScanContext {
  readonly tab: TabTarget;
  readonly windowId: number;
  readonly settings: Settings;
}

export interface ImageScan extends ScanContext {
  readonly kind: "image";
  readonly srcUrl: string;
}

export interface RegionScan extends ScanContext {
  readonly kind: "region";
  /** The region that the user drew, in CSS pixels of the viewport. */
  readonly rect: Rect;
  readonly devicePixelRatio: number;
}

export type ScanCommand = ImageScan | RegionScan;

export const toOcrRequest = (settings: Settings): OcrRequest => ({
  languages: settings.languages,
  layout: settings.layout,
  minConfidence: settings.minConfidence,
  upscale: settings.upscale,
  maxScale: settings.maxScale,
});

export const toViewOptions = (settings: Settings): ViewOptions => ({
  showBoxes: settings.showBoxes,
  autoCopy: settings.autoCopy,
});

/** The top frame owns the screenshot, because a screenshot covers the whole tab. */
const isTopFrame = (target: TabTarget): boolean => target.frameId === 0;

const newJobId = Effect.sync(() => crypto.randomUUID());

/**
 * Reads the visible part of an element and turns it into a screenshot region.
 *
 * The overlay then anchors itself to that visible part. A clipped region with an
 * element anchor would stretch the text across the whole element.
 */
const screenshotOfElement = (command: ImageScan, viewportRect: Rect, dpr: number) =>
  Effect.gen(function* () {
    const capture = yield* Capture;

    if (!isTopFrame(command.tab)) {
      return yield* Effect.fail(
        new PageError({ reason: "the screenshot fallback covers the top frame only" }),
      );
    }

    const dataUrl = yield* capture.visibleTab(command.windowId);
    const image: ImageRef = {
      kind: "dataUrl",
      dataUrl,
      crop: scaleRect(viewportRect, dpr),
    };
    return image;
  });

interface Attempt {
  readonly result: OcrResult;
  /** The anchor that produced the result. It can differ from the first anchor. */
  readonly anchor: Anchor;
}

const runImageScan = (command: ImageScan, jobId: string) =>
  Effect.gen(function* () {
    const page = yield* Page;
    const offscreen = yield* Offscreen;
    const request = toOcrRequest(command.settings);

    const info = yield* page.measureAnchor(command.tab, command.srcUrl);
    if (info === null) {
      return yield* Effect.fail(
        new PageError({ reason: "the frame holds no element with this source" }),
      );
    }

    const elementAnchor: Anchor = { kind: "image", srcUrl: command.srcUrl };
    yield* page.tell(command.tab, {
      target: "content",
      kind: "scan:begin",
      jobId,
      anchor: elementAnchor,
    });

    const direct = offscreen
      .run({ jobId, image: { kind: "url", url: command.srcUrl }, request })
      .pipe(Effect.map((result): Attempt => ({ result, anchor: elementAnchor })));

    const fallback = Effect.gen(function* () {
      const visible = intersectRect(
        info.rect,
        rect(0, 0, info.viewport.width, info.viewport.height),
      );
      if (visible === null) {
        return yield* Effect.fail(
          new EmptyRegionError({ reason: "the image sits outside the viewport" }),
        );
      }

      const image = yield* screenshotOfElement(command, visible, info.devicePixelRatio);
      const anchor: Anchor = { kind: "viewport", rect: visible };
      yield* page.tell(command.tab, { target: "content", kind: "scan:anchor", jobId, anchor });

      const result = yield* offscreen.run({ jobId, image, request });
      return { result, anchor } satisfies Attempt;
    });

    return yield* direct.pipe(
      Effect.catchIf(isRetryable, (error) =>
        Effect.logInfo(`direct read failed, screenshot fallback: ${debugMessage(error)}`).pipe(
          Effect.zipRight(fallback),
        ),
      ),
    );
  });

const runRegionScan = (command: RegionScan, jobId: string) =>
  Effect.gen(function* () {
    const page = yield* Page;
    const offscreen = yield* Offscreen;
    const capture = yield* Capture;

    const anchor: Anchor = { kind: "viewport", rect: command.rect };
    yield* page.tell(command.tab, { target: "content", kind: "scan:begin", jobId, anchor });

    const dataUrl = yield* capture.visibleTab(command.windowId);
    const result = yield* offscreen.run({
      jobId,
      image: {
        kind: "dataUrl",
        dataUrl,
        crop: scaleRect(command.rect, command.devicePixelRatio),
      },
      request: toOcrRequest(command.settings),
    });

    return { result, anchor } satisfies Attempt;
  });

/**
 * Runs one scan and reports the outcome to the page. It never fails: the user
 * reads the failure in the overlay, and the log holds the cause.
 */
export const runScan = (
  command: ScanCommand,
): Effect.Effect<void, never, Page | Offscreen | Capture> =>
  Effect.gen(function* () {
    const page = yield* Page;
    const jobId = yield* newJobId;

    const pipeline = Effect.gen(function* () {
      yield* Effect.sync(() => registerJob(jobId, command.tab));
      yield* page.ensureScript(command.tab);
      const attempt =
        command.kind === "image"
          ? yield* runImageScan(command, jobId)
          : yield* runRegionScan(command, jobId);

      yield* page.tell(command.tab, {
        target: "content",
        kind: "scan:result",
        jobId,
        result: attempt.result,
        view: toViewOptions(command.settings),
      });

      yield* Effect.logInfo(
        `job ${jobId}: ${attempt.result.meta.wordCount} words, mean confidence ${Math.round(attempt.result.meta.meanConfidence)}`,
      );
    });

    yield* pipeline.pipe(
      Effect.ensuring(Effect.sync(() => forgetJob(jobId))),
      Effect.catchAll((error: AppError) =>
        Effect.logWarning(`job ${jobId} failed: ${debugMessage(error)}`).pipe(
          Effect.zipRight(
            page.tell(command.tab, {
              target: "content",
              kind: "scan:error",
              jobId,
              message: userMessage(error),
            }),
          ),
        ),
      ),
    );
  });
