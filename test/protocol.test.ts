import { describe, expect, it } from "vitest";
import { rect, size } from "@/core/geometry.js";
import { buildResult } from "@/core/ocr.js";
import {
  AnchorReplySchema,
  decodeMessage,
  ImageRefSchema,
  OcrReplySchema,
  ToBackgroundSchema,
  ToContentSchema,
  ToOffscreenSchema,
} from "@/core/protocol.js";

const result = buildResult(
  size(100, 50),
  [{ text: "hello", bbox: rect(0, 0, 40, 10), words: [] }],
  { languages: ["eng"], scale: 1, durationMs: 10 },
);

describe("ImageRefSchema", () => {
  it("accepts a URL reference", () => {
    expect(ImageRefSchema.safeParse({ kind: "url", url: "https://a.test/x.png" }).success).toBe(
      true,
    );
  });

  it("accepts a data URL with a crop", () => {
    const parsed = ImageRefSchema.safeParse({
      kind: "dataUrl",
      dataUrl: "data:image/png;base64,AAA",
      crop: rect(1, 2, 3, 4),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a data URL that is not one", () => {
    expect(ImageRefSchema.safeParse({ kind: "dataUrl", dataUrl: "https://a.test" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown kind", () => {
    expect(ImageRefSchema.safeParse({ kind: "clipboard" }).success).toBe(false);
  });
});

describe("ToOffscreenSchema", () => {
  const message = {
    target: "offscreen",
    kind: "ocr:run",
    jobId: "job-1",
    image: { kind: "url", url: "https://a.test/x.png" },
    request: {
      languages: ["eng"],
      layout: "auto",
      minConfidence: 30,
      upscale: true,
      maxScale: 3,
    },
  };

  it("accepts a complete job", () => {
    expect(decodeMessage(ToOffscreenSchema, message).ok).toBe(true);
  });

  it("rejects an unknown language", () => {
    const broken = { ...message, request: { ...message.request, languages: ["elvish"] } };
    expect(decodeMessage(ToOffscreenSchema, broken).ok).toBe(false);
  });

  it("rejects an enlargement factor out of range", () => {
    const broken = { ...message, request: { ...message.request, maxScale: 99 } };
    expect(decodeMessage(ToOffscreenSchema, broken).ok).toBe(false);
  });

  it("names the invalid field in the reason", () => {
    const outcome = decodeMessage(ToOffscreenSchema, { ...message, jobId: "" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("jobId");
  });
});

describe("OcrReplySchema", () => {
  it("accepts a result", () => {
    expect(OcrReplySchema.safeParse({ ok: true, result }).success).toBe(true);
  });

  it("accepts a failure payload", () => {
    const reply = { ok: false, error: { tag: "ImageFetchError", message: "no", retryable: true } };
    expect(OcrReplySchema.safeParse(reply).success).toBe(true);
  });

  it("rejects a reply without an outcome", () => {
    expect(OcrReplySchema.safeParse({ result }).success).toBe(false);
  });
});

describe("ToContentSchema", () => {
  it("accepts every message kind of the overlay", () => {
    const messages = [
      { target: "content", kind: "ping" },
      { target: "content", kind: "anchor:measure", srcUrl: "https://a.test/x.png" },
      {
        target: "content",
        kind: "scan:begin",
        jobId: "j",
        anchor: { kind: "image", srcUrl: "https://a.test/x.png" },
      },
      {
        target: "content",
        kind: "scan:anchor",
        jobId: "j",
        anchor: { kind: "viewport", rect: rect(0, 0, 10, 10) },
      },
      {
        target: "content",
        kind: "scan:progress",
        jobId: "j",
        progress: { status: "recognizing text", progress: 0.5 },
      },
      {
        target: "content",
        kind: "scan:result",
        jobId: "j",
        result,
        view: { showBoxes: false, autoCopy: true },
      },
      { target: "content", kind: "scan:error", jobId: "j", message: "failed" },
      { target: "content", kind: "region:request", requestId: "r" },
    ];

    for (const message of messages) {
      expect(decodeMessage(ToContentSchema, message), JSON.stringify(message)).toMatchObject({
        ok: true,
      });
    }
  });

  it("rejects a progress value over one", () => {
    const broken = {
      target: "content",
      kind: "scan:progress",
      jobId: "j",
      progress: { status: "x", progress: 4 },
    };
    expect(decodeMessage(ToContentSchema, broken).ok).toBe(false);
  });
});

describe("ToBackgroundSchema", () => {
  it("accepts a region answer", () => {
    const message = {
      target: "background",
      kind: "region:selected",
      requestId: "r",
      rect: rect(10, 10, 100, 40),
      devicePixelRatio: 2,
    };
    expect(decodeMessage(ToBackgroundSchema, message).ok).toBe(true);
  });

  it("rejects a pixel ratio of zero", () => {
    const message = {
      target: "background",
      kind: "region:selected",
      requestId: "r",
      rect: rect(0, 0, 1, 1),
      devicePixelRatio: 0,
    };
    expect(decodeMessage(ToBackgroundSchema, message).ok).toBe(false);
  });
});

describe("AnchorReplySchema", () => {
  it("accepts a measurement", () => {
    const reply = {
      found: true,
      info: {
        rect: rect(0, 0, 100, 50),
        devicePixelRatio: 1,
        naturalSize: size(200, 100),
        viewport: size(1280, 720),
      },
    };
    expect(AnchorReplySchema.safeParse(reply).success).toBe(true);
  });

  it("accepts an element that the frame does not hold", () => {
    expect(AnchorReplySchema.safeParse({ found: false }).success).toBe(true);
  });

  it("accepts an element without a natural size", () => {
    const reply = {
      found: true,
      info: {
        rect: rect(0, 0, 10, 10),
        devicePixelRatio: 1,
        naturalSize: null,
        viewport: size(800, 600),
      },
    };
    expect(AnchorReplySchema.safeParse(reply).success).toBe(true);
  });
});
