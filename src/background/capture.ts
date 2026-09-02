/**
 * The screenshot of the visible tab.
 *
 * Two paths need it. The region scan reads a rectangle that the user draws, and
 * the image scan falls back to it when the image host refuses a direct read.
 *
 * Chrome limits the call rate, so a rejected call waits and tries again.
 */

import { Context, Effect, Layer, Schedule } from "effect";
import { CaptureError, describeUnknown } from "../core/errors.js";

export interface CaptureApi {
  /** Returns a PNG data URL of the visible part of the window. */
  readonly visibleTab: (windowId: number) => Effect.Effect<string, CaptureError>;
}

export class Capture extends Context.Tag("textlift/Capture")<Capture, CaptureApi>() {}

/** The quota of `captureVisibleTab` resets inside one second. */
const rateLimitRetry = Schedule.recurs(2).pipe(Schedule.addDelay(() => "500 millis"));

/**
 * True for the quota failure only. A refusal of the tab itself never changes, so
 * a retry of it would only delay the message to the user.
 */
const isQuotaFailure = (error: CaptureError): boolean =>
  error.reason.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND");

const makeCapture = Effect.sync(() => {
  const visibleTab: CaptureApi["visibleTab"] = (windowId) =>
    Effect.retry(
      Effect.tryPromise({
        try: () => chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
        catch: (cause) => new CaptureError({ reason: describeUnknown(cause) }),
      }),
      { schedule: rateLimitRetry, while: isQuotaFailure },
    );

  return { visibleTab } satisfies CaptureApi;
});

export const CaptureLive = Layer.effect(Capture, makeCapture);
