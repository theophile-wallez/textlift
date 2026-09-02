/**
 * The image loader of the offscreen document.
 *
 * It reads the bytes, decodes them, cuts the requested region, and resizes the
 * result to the size that the engine wants. It returns a canvas, because
 * Tesseract accepts an `OffscreenCanvas` and converts it to PNG bytes itself.
 */

import { Context, Effect, Layer, Schedule } from "effect";
import {
  describeUnknown,
  EmptyRegionError,
  ImageDecodeError,
  ImageFetchError,
} from "../core/errors.js";
import { clipRectToSize, rect, type Rect, roundRect, size, type Size } from "../core/geometry.js";
import type { ImageRef } from "../core/protocol.js";
import { planScale, type ScaleLimits, type ScalePlan } from "../core/preprocess.js";

export interface LoadedImage {
  /** The pixels that the engine reads. Its size is `plan.target`. */
  readonly canvas: OffscreenCanvas;
  /** The size of the region before the resize. Every reported box maps to it. */
  readonly sourceSize: Size;
  readonly plan: ScalePlan;
}

export interface ImageLoaderApi {
  readonly load: (
    ref: ImageRef,
    limits: ScaleLimits,
  ) => Effect.Effect<LoadedImage, ImageFetchError | ImageDecodeError | EmptyRegionError>;
}

export class ImageLoader extends Context.Tag("textlift/ImageLoader")<
  ImageLoader,
  ImageLoaderApi
>() {}

/** Two extra attempts absorb a slow image host and a transient network failure. */
const fetchRetry = Schedule.recurs(2).pipe(Schedule.addDelay(() => "200 millis"));

const refUrl = (ref: ImageRef): string => (ref.kind === "url" ? ref.url : ref.dataUrl);

const fetchBytes = (ref: ImageRef): Effect.Effect<Blob, ImageFetchError> => {
  const url = refUrl(ref);
  const attempt = Effect.tryPromise({
    try: async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("empty body");
      return blob;
    },
    catch: (cause) =>
      new ImageFetchError({
        url: url.slice(0, 200),
        reason: describeUnknown(cause),
      }),
  });

  // A data URL never benefits from a retry, because it holds the bytes already.
  return ref.kind === "dataUrl" ? attempt : Effect.retry(attempt, fetchRetry);
};

const decode = (blob: Blob): Effect.Effect<ImageBitmap, ImageDecodeError> =>
  Effect.tryPromise({
    try: () => createImageBitmap(blob),
    catch: (cause) => new ImageDecodeError({ reason: describeUnknown(cause) }),
  });

/** Closes the bitmap on every exit path, because it holds decoded pixels. */
const scopedBitmap = (blob: Blob) =>
  Effect.acquireRelease(decode(blob), (bitmap) => Effect.sync(() => bitmap.close()));

const draw = (
  bitmap: ImageBitmap,
  source: Rect,
  plan: ScalePlan,
): Effect.Effect<OffscreenCanvas, ImageDecodeError> =>
  Effect.try({
    try: () => {
      const canvas = new OffscreenCanvas(plan.target.width, plan.target.height);
      const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
      if (context === null) throw new Error("no 2d context");

      // A transparent PNG carries dark text most of the time. A white
      // background keeps that text readable after the alpha channel goes away.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        bitmap,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      return canvas;
    },
    catch: (cause) => new ImageDecodeError({ reason: describeUnknown(cause) }),
  });

/** The part of the decoded image to read. A missing crop means the whole image. */
const cropRegion = (ref: ImageRef, bitmapSize: Size): Effect.Effect<Rect, EmptyRegionError> => {
  const requested = ref.kind === "dataUrl" ? ref.crop : undefined;
  if (requested === undefined)
    return Effect.succeed(rect(0, 0, bitmapSize.width, bitmapSize.height));

  const clipped = clipRectToSize(requested, bitmapSize);
  if (clipped === null) {
    return Effect.fail(
      new EmptyRegionError({
        reason: `region outside the ${bitmapSize.width}x${bitmapSize.height} image`,
      }),
    );
  }
  return Effect.succeed(roundRect(clipped));
};

const load: ImageLoaderApi["load"] = (ref, limits) =>
  Effect.scoped(
    Effect.gen(function* () {
      const blob = yield* fetchBytes(ref);
      const bitmap = yield* scopedBitmap(blob);
      const bitmapSize = size(bitmap.width, bitmap.height);

      const region = yield* cropRegion(ref, bitmapSize);
      const sourceSize = size(region.width, region.height);
      const plan = planScale(sourceSize, limits);
      const canvas = yield* draw(bitmap, region, plan);

      yield* Effect.logDebug(
        `image ${bitmapSize.width}x${bitmapSize.height} -> ${plan.target.width}x${plan.target.height} (${plan.reason})`,
      );

      return { canvas, sourceSize, plan };
    }),
  );

export const ImageLoaderLive = Layer.succeed(ImageLoader, { load });
