/**
 * The offscreen document.
 *
 * The service worker stops after 30 seconds without an event, and one scan takes
 * longer than that. So the engine lives in this document instead: an extension
 * page with a DOM, a worker, and no lifetime limit.
 *
 * It answers one message, `ocr:run`, and it reports the progress of the engine to
 * the service worker on the way.
 */

import { Effect, Layer, ManagedRuntime } from "effect";
import { type AppError, debugMessage, toErrorPayload } from "../core/errors.js";
import { DEFAULT_SCALE_LIMITS, type ScaleLimits } from "../core/preprocess.js";
import {
  decodeMessage,
  type OcrReply,
  type OcrRequest,
  type Progress,
  type ToOffscreen,
  ToOffscreenSchema,
} from "../core/protocol.js";
import { hasTarget, notify } from "../shared/messaging.js";
import { OcrEngine, OcrEngineLive } from "./engine.js";
import { ImageLoader, ImageLoaderLive } from "./image-loader.js";

const runtime = ManagedRuntime.make(Layer.mergeAll(ImageLoaderLive, OcrEngineLive));

const scaleLimits = (request: OcrRequest): ScaleLimits => ({
  ...DEFAULT_SCALE_LIMITS,
  minShortSide: request.upscale ? DEFAULT_SCALE_LIMITS.minShortSide : 0,
  maxScale: request.maxScale,
});

/**
 * Forwards the progress of the engine, at most once for every 2 percent. The
 * engine reports many times per second, and every report crosses a message port.
 */
const makeProgressSink = (jobId: string): ((progress: Progress) => void) => {
  let lastStatus = "";
  let lastProgress = -1;

  return (progress) => {
    const changed = progress.status !== lastStatus || progress.progress - lastProgress >= 0.02;
    if (!changed) return;
    lastStatus = progress.status;
    lastProgress = progress.progress;
    void notify({ target: "background", kind: "ocr:progress", jobId, progress });
  };
};

const scan = (message: ToOffscreen) =>
  Effect.gen(function* () {
    const loader = yield* ImageLoader;
    const engine = yield* OcrEngine;

    const image = yield* loader.load(message.image, scaleLimits(message.request));
    const result = yield* engine.recognize({
      canvas: image.canvas,
      sourceSize: image.sourceSize,
      plan: image.plan,
      request: message.request,
      onProgress: makeProgressSink(message.jobId),
    });

    yield* Effect.logInfo(
      `job ${message.jobId}: ${result.meta.wordCount} words in ${Math.round(result.meta.durationMs)} ms`,
    );
    return result;
  });

const toReply = (message: ToOffscreen): Effect.Effect<OcrReply, never, ImageLoader | OcrEngine> =>
  scan(message).pipe(
    Effect.map((result): OcrReply => ({ ok: true, result })),
    Effect.catchAll((error: AppError) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(`job ${message.jobId} failed: ${debugMessage(error)}`);
        const reply: OcrReply = { ok: false, error: toErrorPayload(error) };
        return reply;
      }),
    ),
  );

const protocolReply = (reason: string): OcrReply => ({
  ok: false,
  error: { tag: "ProtocolError", message: reason, retryable: false },
});

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  if (!hasTarget(raw, "offscreen")) return false;

  const decoded = decodeMessage(ToOffscreenSchema, raw);
  if (!decoded.ok) {
    sendResponse(protocolReply(decoded.reason));
    return false;
  }

  runtime
    .runPromise(toReply(decoded.value))
    .then(sendResponse)
    .catch((cause: unknown) => sendResponse(protocolReply(String(cause))));

  // The answer arrives later, so the port must stay open.
  return true;
});
