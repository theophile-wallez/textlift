/**
 * The failure model.
 *
 * Every step of the pipeline fails with a tagged error, so the service worker
 * chooses the recovery from the tag and not from a string. `retryable` marks the
 * errors that a second source of pixels can solve: the screenshot fallback.
 *
 * The content script never imports this module, because it must not carry the
 * Effect runtime. It receives an `ErrorPayload` instead.
 */

import { Data } from "effect";
import type { ErrorPayload } from "./protocol.js";

/** The extension cannot read the bytes of the image from its URL. */
export class ImageFetchError extends Data.TaggedError("ImageFetchError")<{
  readonly url: string;
  readonly reason: string;
}> {}

/** The bytes arrived, but the browser refused to decode them as an image. */
export class ImageDecodeError extends Data.TaggedError("ImageDecodeError")<{
  readonly reason: string;
}> {}

/** The requested region falls outside the image. */
export class EmptyRegionError extends Data.TaggedError("EmptyRegionError")<{
  readonly reason: string;
}> {}

/** The engine failed to load its core, its training data, or to recognize. */
export class EngineError extends Data.TaggedError("EngineError")<{
  readonly phase: "load" | "initialize" | "recognize";
  readonly reason: string;
}> {}

/** The engine took longer than the budget of one job. */
export class EngineTimeoutError extends Data.TaggedError("EngineTimeoutError")<{
  readonly timeoutMs: number;
}> {}

/** The offscreen document did not start, or it stopped answering. */
export class OffscreenError extends Data.TaggedError("OffscreenError")<{
  readonly reason: string;
}> {}

/** The screenshot of the visible tab failed. */
export class CaptureError extends Data.TaggedError("CaptureError")<{
  readonly reason: string;
}> {}

/** The content script is absent, or the page refuses an injection. */
export class PageError extends Data.TaggedError("PageError")<{
  readonly reason: string;
}> {}

/** An incoming message does not match its schema. */
export class ProtocolError extends Data.TaggedError("ProtocolError")<{
  readonly reason: string;
}> {}

/**
 * A failure that another context reported. The service worker receives the
 * payload of the offscreen document, not its error object, so this class carries
 * the payload across the boundary without a second translation table.
 */
export class ScanFailure extends Data.TaggedError("ScanFailure")<{
  readonly payload: ErrorPayload;
}> {}

export type AppError =
  | ImageFetchError
  | ImageDecodeError
  | EmptyRegionError
  | EngineError
  | EngineTimeoutError
  | OffscreenError
  | CaptureError
  | PageError
  | ProtocolError
  | ScanFailure;

const RETRYABLE_TAGS = new Set<AppError["_tag"]>([
  "ImageFetchError",
  "ImageDecodeError",
  "EngineTimeoutError",
]);

/**
 * True when a second source of pixels can still succeed. The service worker
 * takes a screenshot of the tab when it reads this flag.
 */
export const isRetryable = (error: AppError): boolean =>
  error._tag === "ScanFailure" ? error.payload.retryable : RETRYABLE_TAGS.has(error._tag);

/** Sentences for the overlay. The user reads them, so they carry no tag name. */
export const userMessage = (error: AppError): string => {
  switch (error._tag) {
    case "ScanFailure":
      return error.payload.message;
    case "ImageFetchError":
      return "The extension cannot read this image. Use the region scan instead.";
    case "ImageDecodeError":
      return "This file is not an image that Chrome can decode.";
    case "EmptyRegionError":
      return "The selected region is empty. Select a larger region.";
    case "EngineError":
      return error.phase === "recognize"
        ? "The engine failed to read this image."
        : "The engine failed to start. Check the network for the language data.";
    case "EngineTimeoutError":
      return "The scan took too long and stopped. Try a smaller region.";
    case "OffscreenError":
      return "The scan engine did not start. Reload the extension.";
    case "CaptureError":
      return "Chrome refused a screenshot of this tab.";
    case "PageError":
      return "This page blocks the overlay. Reload the page and try again.";
    case "ProtocolError":
      return "The extension received an unexpected message. Reload the page.";
  }
};

/** Detail for the log. It holds the cause, so it never reaches the user. */
export const debugMessage = (error: AppError): string => {
  switch (error._tag) {
    case "ImageFetchError":
      return `${error._tag}: ${error.reason} (${error.url})`;
    case "EngineError":
      return `${error._tag}[${error.phase}]: ${error.reason}`;
    case "EngineTimeoutError":
      return `${error._tag}: ${error.timeoutMs} ms`;
    case "ScanFailure":
      return `${error._tag}[${error.payload.tag}]: ${error.payload.message}`;
    default:
      return `${error._tag}: ${error.reason}`;
  }
};

export const toErrorPayload = (error: AppError): ErrorPayload =>
  error._tag === "ScanFailure"
    ? error.payload
    : { tag: error._tag, message: userMessage(error), retryable: isRetryable(error) };

/** Turns an unknown thrown value into a short sentence. */
export const describeUnknown = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
};
