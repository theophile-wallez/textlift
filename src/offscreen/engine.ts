/**
 * The Tesseract engine service.
 *
 * The service owns one worker and keeps it between two scans, because the load
 * of the WebAssembly core and of the training data costs more than the
 * recognition itself. A semaphore serializes the jobs, so one worker is enough.
 *
 * A language change reuses the same worker when the training data comes from the
 * same location. A location change needs a new worker, because Tesseract fixes
 * `langPath` when it creates the worker.
 */

import { Context, Effect, Layer, Ref } from "effect";
import { createWorker, OEM, type Page, type Worker, type WorkerParams } from "tesseract.js";
import { relaxedSimd, simd } from "wasm-feature-detect";
import {
  ENGINE_DIR,
  pickCoreFile,
  REMOTE_TESSDATA,
  TESSDATA_DIR,
  WORKER_FILE,
} from "../core/engine-assets.js";
import { describeUnknown, EngineError, EngineTimeoutError } from "../core/errors.js";
import { rectFromBbox, scaleRect, type Size } from "../core/geometry.js";
import { resolveDataLocation, toEngineLanguages } from "../core/languages.js";
import { buildLine, buildResult, type OcrLine, type OcrResult } from "../core/ocr.js";
import { inverseScale, type ScalePlan } from "../core/preprocess.js";
import type { OcrRequest, Progress } from "../core/protocol.js";
import { engineParameters } from "../core/settings.js";

export interface RecognizeInput {
  readonly canvas: OffscreenCanvas;
  /** Size of the region before the resize. Every box maps back to it. */
  readonly sourceSize: Size;
  readonly plan: ScalePlan;
  readonly request: OcrRequest;
  readonly onProgress: (progress: Progress) => void;
}

export interface OcrEngineApi {
  readonly recognize: (
    input: RecognizeInput,
  ) => Effect.Effect<OcrResult, EngineError | EngineTimeoutError>;
}

export class OcrEngine extends Context.Tag("textlift/OcrEngine")<OcrEngine, OcrEngineApi>() {}

/** A scan of a large screenshot on a slow machine stays under this budget. */
const JOB_TIMEOUT = "120 seconds";

interface WorkerState {
  readonly worker: Worker;
  readonly langPath: string;
  readonly languages: string;
}

const url = (path: string): string => chrome.runtime.getURL(path);

const detectCoreFile = Effect.tryPromise({
  try: async () => {
    const features = { simd: await simd(), relaxedSimd: await relaxedSimd() };
    return pickCoreFile(features);
  },
  catch: (cause) => new EngineError({ phase: "load", reason: describeUnknown(cause) }),
}).pipe(
  Effect.flatMap((file) =>
    file === null
      ? Effect.fail(
          new EngineError({
            phase: "load",
            reason: "the browser supports no WebAssembly SIMD",
          }),
        )
      : Effect.succeed(file),
  ),
);

/**
 * The lines of one page, in the coordinates of the source image.
 *
 * Tesseract reports the boxes in the coordinates of the resized image, so every
 * box goes through the inverse of the resize plan.
 */
const toLines = (page: Page, plan: ScalePlan, minConfidence: number): readonly OcrLine[] => {
  const inverse = inverseScale(plan);
  const rawLines = (page.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines);

  return rawLines.flatMap((line) => {
    const words = line.words.map((word) => ({
      text: word.text,
      confidence: word.confidence,
      bbox: scaleRect(rectFromBbox(word.bbox), inverse),
    }));
    const built = buildLine(words, minConfidence);
    return built === null ? [] : [built];
  });
};

const makeEngine = Effect.gen(function* () {
  const state = yield* Ref.make<WorkerState | null>(null);
  const lock = yield* Effect.makeSemaphore(1);

  // The worker reports its progress through a callback that it receives at
  // creation. The semaphore keeps one job at a time, so one slot is enough.
  let progressSink: (progress: Progress) => void = () => {};

  const terminate = (worker: Worker): Effect.Effect<void> =>
    Effect.promise(() => worker.terminate()).pipe(Effect.ignore);

  const dropWorker = Effect.gen(function* () {
    const current = yield* Ref.getAndSet(state, null);
    if (current !== null) yield* terminate(current.worker);
  });

  const spawn = (languages: string, langPath: string, cacheMethod: string) =>
    Effect.gen(function* () {
      const coreFile = yield* detectCoreFile;
      yield* Effect.logInfo(`engine start: ${languages} from ${langPath}`);

      const worker = yield* Effect.tryPromise({
        try: () =>
          createWorker(languages, OEM.LSTM_ONLY, {
            workerPath: url(`${ENGINE_DIR}/${WORKER_FILE}`),
            corePath: url(`${ENGINE_DIR}/${coreFile}`),
            langPath,
            cacheMethod,
            // A blob URL worker breaks the content security policy of an
            // extension page, so the worker loads from the package instead.
            workerBlobURL: false,
            logger: (message) =>
              progressSink({
                status: message.status,
                progress: Math.min(1, Math.max(0, message.progress)),
              }),
          }),
        catch: (cause) => new EngineError({ phase: "initialize", reason: describeUnknown(cause) }),
      });

      const next: WorkerState = { worker, langPath, languages };
      yield* Ref.set(state, next);
      return next;
    });

  const reinitialize = (current: WorkerState, languages: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`engine language change: ${current.languages} -> ${languages}`);
      yield* Effect.tryPromise({
        try: () => current.worker.reinitialize(languages, OEM.LSTM_ONLY),
        catch: (cause) => new EngineError({ phase: "initialize", reason: describeUnknown(cause) }),
      });
      const next: WorkerState = { ...current, languages };
      yield* Ref.set(state, next);
      return next;
    });

  const acquire = (request: OcrRequest) =>
    Effect.gen(function* () {
      const languages = toEngineLanguages(request.languages);
      const location = resolveDataLocation(request.languages, {
        bundled: url(TESSDATA_DIR),
        remote: REMOTE_TESSDATA,
      });

      const current = yield* Ref.get(state);
      if (current === null) return yield* spawn(languages, location.langPath, location.cacheMethod);
      if (current.languages === languages && current.langPath === location.langPath) return current;
      if (current.langPath === location.langPath) return yield* reinitialize(current, languages);

      yield* dropWorker;
      return yield* spawn(languages, location.langPath, location.cacheMethod);
    });

  const run = (input: RecognizeInput) =>
    Effect.gen(function* () {
      const started = yield* Effect.sync(() => performance.now());
      const active = yield* acquire(input.request);

      yield* Effect.tryPromise({
        try: () =>
          // `engineParameters` returns plain strings, and the types of the engine
          // name the set of the mode numbers `PSM`.
          active.worker.setParameters(
            engineParameters(input.request.layout) as Partial<WorkerParams>,
          ),
        catch: (cause) => new EngineError({ phase: "initialize", reason: describeUnknown(cause) }),
      });

      const page = yield* Effect.tryPromise({
        try: () =>
          active.worker
            .recognize(input.canvas, {}, { blocks: true, text: false })
            .then((outcome) => outcome.data),
        catch: (cause) => new EngineError({ phase: "recognize", reason: describeUnknown(cause) }),
      });

      const lines = toLines(page, input.plan, input.request.minConfidence);
      const durationMs = (yield* Effect.sync(() => performance.now())) - started;

      return buildResult(input.sourceSize, lines, {
        languages: [...input.request.languages],
        scale: input.plan.scale,
        durationMs,
      });
    });

  const recognize: OcrEngineApi["recognize"] = (input) =>
    lock.withPermits(1)(
      Effect.acquireUseRelease(
        Effect.sync(() => {
          progressSink = input.onProgress;
        }),
        () =>
          run(input).pipe(
            Effect.timeoutFail({
              duration: JOB_TIMEOUT,
              onTimeout: () => new EngineTimeoutError({ timeoutMs: 120_000 }),
            }),
            // A job that times out leaves the worker inside a recognition, so
            // the next job needs a new worker.
            Effect.tapError((error) =>
              error._tag === "EngineTimeoutError" ? dropWorker : Effect.void,
            ),
          ),
        () =>
          Effect.sync(() => {
            progressSink = () => {};
          }),
      ),
    );

  yield* Effect.addFinalizer(() => dropWorker);

  return { recognize } satisfies OcrEngineApi;
});

export const OcrEngineLive = Layer.scoped(OcrEngine, makeEngine);
