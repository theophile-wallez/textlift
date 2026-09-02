import { describe, expect, it } from "vitest";
import {
  type AppError,
  CaptureError,
  debugMessage,
  describeUnknown,
  EngineError,
  EngineTimeoutError,
  ImageFetchError,
  isRetryable,
  PageError,
  ScanFailure,
  toErrorPayload,
  userMessage,
} from "@/core/errors.js";

const every: AppError[] = [
  new ImageFetchError({ url: "https://a.test/x.png", reason: "HTTP 403" }),
  new EngineError({ phase: "recognize", reason: "out of memory" }),
  new EngineTimeoutError({ timeoutMs: 120_000 }),
  new CaptureError({ reason: "the tab is not active" }),
  new PageError({ reason: "no content script" }),
];

describe("userMessage", () => {
  it("gives one sentence for every error", () => {
    for (const error of every) {
      const message = userMessage(error);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain(error._tag);
    }
  });

  it("passes the message of a remote failure through", () => {
    const failure = new ScanFailure({
      payload: { tag: "ImageDecodeError", message: "not an image", retryable: false },
    });
    expect(userMessage(failure)).toBe("not an image");
  });
});

describe("isRetryable", () => {
  it("marks a failed read of the image, because a screenshot can still work", () => {
    expect(isRetryable(new ImageFetchError({ url: "x", reason: "y" }))).toBe(true);
  });

  it("marks no failure of the engine itself", () => {
    expect(isRetryable(new EngineError({ phase: "load", reason: "y" }))).toBe(false);
  });

  it("reads the flag of a remote failure", () => {
    const payload = { tag: "ImageFetchError", message: "no", retryable: true };
    expect(isRetryable(new ScanFailure({ payload }))).toBe(true);
    expect(isRetryable(new ScanFailure({ payload: { ...payload, retryable: false } }))).toBe(false);
  });
});

describe("toErrorPayload", () => {
  it("keeps the payload of a remote failure unchanged", () => {
    const payload = { tag: "CaptureError", message: "no", retryable: false };
    expect(toErrorPayload(new ScanFailure({ payload }))).toEqual(payload);
  });

  it("carries the tag, the sentence, and the flag", () => {
    const payload = toErrorPayload(new ImageFetchError({ url: "u", reason: "r" }));
    expect(payload).toEqual({
      tag: "ImageFetchError",
      message: userMessage(new ImageFetchError({ url: "u", reason: "r" })),
      retryable: true,
    });
  });
});

describe("debugMessage", () => {
  it("holds the cause, which the user never reads", () => {
    expect(debugMessage(new ImageFetchError({ url: "https://a.test", reason: "HTTP 403" }))).toBe(
      "ImageFetchError: HTTP 403 (https://a.test)",
    );
    expect(debugMessage(new EngineError({ phase: "load", reason: "bad core" }))).toBe(
      "EngineError[load]: bad core",
    );
  });
});

describe("describeUnknown", () => {
  it("reads the message of an error", () => {
    expect(describeUnknown(new Error("boom"))).toBe("boom");
  });

  it("accepts a string and any other value", () => {
    expect(describeUnknown("boom")).toBe("boom");
    expect(describeUnknown(42)).toBe("42");
  });
});
