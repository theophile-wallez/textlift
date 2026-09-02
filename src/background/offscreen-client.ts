/**
 * The client of the offscreen document.
 *
 * Chrome allows one offscreen document per extension, so the client checks for
 * it before every job and creates it once. A semaphore serializes the creation,
 * because two menu clicks in the same second would race.
 */

import { Context, Effect, Layer } from "effect";
import { describeUnknown, OffscreenError, ProtocolError, ScanFailure } from "../core/errors.js";
import type { OcrResult } from "../core/ocr.js";
import { decodeMessage, type ImageRef, type OcrRequest, OcrReplySchema } from "../core/protocol.js";
import { request } from "../shared/messaging.js";

const DOCUMENT_PATH = "offscreen.html";

/** Chrome answers with this message when the document already exists. */
const ALREADY_EXISTS = "Only a single offscreen document may be created";

export interface ScanJob {
  readonly jobId: string;
  readonly image: ImageRef;
  readonly request: OcrRequest;
}

export interface OffscreenApi {
  readonly run: (
    job: ScanJob,
  ) => Effect.Effect<OcrResult, OffscreenError | ProtocolError | ScanFailure>;
  readonly release: Effect.Effect<void>;
}

export class Offscreen extends Context.Tag("textlift/Offscreen")<Offscreen, OffscreenApi>() {}

const hasDocument = Effect.tryPromise({
  try: () =>
    chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    }),
  catch: (cause) => new OffscreenError({ reason: describeUnknown(cause) }),
}).pipe(Effect.map((contexts) => contexts.length > 0));

const createDocument = Effect.tryPromise({
  try: () =>
    chrome.offscreen.createDocument({
      url: DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs the Tesseract WebAssembly worker, which outlives a service worker.",
    }),
  catch: (cause) => new OffscreenError({ reason: describeUnknown(cause) }),
}).pipe(
  // A parallel creation is not a failure: the document that the other call made
  // serves this job as well.
  Effect.catchTag("OffscreenError", (error) =>
    error.reason.includes(ALREADY_EXISTS) ? Effect.void : Effect.fail(error),
  ),
);

const makeOffscreen = Effect.gen(function* () {
  const lock = yield* Effect.makeSemaphore(1);

  const ensureDocument = lock.withPermits(1)(
    Effect.gen(function* () {
      if (yield* hasDocument) return;
      yield* Effect.logInfo("offscreen document start");
      yield* createDocument;
    }),
  );

  const run: OffscreenApi["run"] = (job) =>
    Effect.gen(function* () {
      yield* ensureDocument;

      const raw = yield* Effect.tryPromise({
        try: () =>
          request({
            target: "offscreen",
            kind: "ocr:run",
            jobId: job.jobId,
            image: job.image,
            request: job.request,
          }),
        catch: (cause) => new OffscreenError({ reason: describeUnknown(cause) }),
      });

      const decoded = decodeMessage(OcrReplySchema, raw);
      if (!decoded.ok) return yield* Effect.fail(new ProtocolError({ reason: decoded.reason }));
      if (!decoded.value.ok) {
        return yield* Effect.fail(new ScanFailure({ payload: decoded.value.error }));
      }
      return decoded.value.result;
    });

  const release = Effect.gen(function* () {
    if (!(yield* hasDocument)) return;
    yield* Effect.promise(() => chrome.offscreen.closeDocument());
  }).pipe(Effect.ignore);

  return { run, release } satisfies OffscreenApi;
});

export const OffscreenLive = Layer.effect(Offscreen, makeOffscreen);
