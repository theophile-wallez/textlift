/**
 * The client of the content script.
 *
 * A tab that Chrome loaded before the install of the extension holds no content
 * script. So every call starts with a ping, and an injection follows when the
 * ping finds nobody.
 */

import { Context, Effect, Layer } from "effect";
import { describeUnknown, PageError } from "../core/errors.js";
import {
  type AnchorInfo,
  AnchorReplySchema,
  decodeMessage,
  PongSchema,
  type ToContent,
} from "../core/protocol.js";
import { notifyFrame, sendToFrame, type TabTarget } from "../shared/messaging.js";

const CONTENT_SCRIPT = "content.js";

export interface PageApi {
  /** Makes sure that a content script answers in the frame. */
  readonly ensureScript: (target: TabTarget) => Effect.Effect<void, PageError>;
  /** Reads where an image sits. Returns null when the frame holds no such image. */
  readonly measureAnchor: (
    target: TabTarget,
    srcUrl: string,
  ) => Effect.Effect<AnchorInfo | null, PageError>;
  /** Sends a message and ignores an absent receiver. */
  readonly tell: (target: TabTarget, message: ToContent) => Effect.Effect<void>;
}

export class Page extends Context.Tag("textlift/Page")<Page, PageApi>() {}

/**
 * Asks the frame for an answer. The answer must match `PongSchema`, because
 * another extension or another version of this one can also hold a listener.
 */
const ping = (target: TabTarget) =>
  Effect.tryPromise({
    try: () => sendToFrame(target, { target: "content", kind: "ping" }),
    catch: (cause) => new PageError({ reason: describeUnknown(cause) }),
  }).pipe(
    Effect.flatMap((raw) => {
      const decoded = decodeMessage(PongSchema, raw);
      return decoded.ok
        ? Effect.void
        : Effect.fail(new PageError({ reason: `unexpected answer: ${decoded.reason}` }));
    }),
  );

const inject = (target: TabTarget) =>
  Effect.tryPromise({
    try: () =>
      chrome.scripting.executeScript({
        target: { tabId: target.tabId, frameIds: [target.frameId] },
        files: [CONTENT_SCRIPT],
      }),
    catch: (cause) => new PageError({ reason: describeUnknown(cause) }),
  });

const makePage = Effect.sync(() => {
  const ensureScript: PageApi["ensureScript"] = (target) =>
    ping(target).pipe(
      Effect.catchTag("PageError", () =>
        Effect.logInfo(`content script injection into tab ${target.tabId}`).pipe(
          Effect.zipRight(inject(target)),
          Effect.asVoid,
        ),
      ),
    );

  const measureAnchor: PageApi["measureAnchor"] = (target, srcUrl) =>
    Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () => sendToFrame(target, { target: "content", kind: "anchor:measure", srcUrl }),
        catch: (cause) => new PageError({ reason: describeUnknown(cause) }),
      });

      const decoded = decodeMessage(AnchorReplySchema, raw);
      if (!decoded.ok) return yield* Effect.fail(new PageError({ reason: decoded.reason }));
      return decoded.value.found ? decoded.value.info : null;
    });

  const tell: PageApi["tell"] = (target, message) =>
    Effect.promise(() => notifyFrame(target, message)).pipe(Effect.ignore);

  return { ensureScript, measureAnchor, tell } satisfies PageApi;
});

export const PageLive = Layer.effect(Page, makePage);
