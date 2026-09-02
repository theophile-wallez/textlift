/**
 * The message protocol of the three extension contexts.
 *
 * `chrome.runtime.sendMessage` broadcasts to every extension page, so every
 * message carries a `target` field. Each context validates the message that it
 * receives, because a stale page of a previous extension version can still send
 * an old shape after a reload.
 */

import * as z from "zod";
import { LanguageCodeSchema } from "./languages.js";
import { OcrResultSchema, RectSchema, SizeSchema } from "./ocr.js";
import { LayoutModeSchema } from "./settings.js";

/* ------------------------------------------------------------------ *
 * Shared payloads
 * ------------------------------------------------------------------ */

/** Where the pixels come from. The offscreen document resolves both kinds. */
export const ImageRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string().min(1) }),
  z.object({
    kind: z.literal("dataUrl"),
    dataUrl: z.string().startsWith("data:"),
    /** Region of the screenshot to keep, in device pixels. */
    crop: RectSchema.optional(),
  }),
]);

export const OcrRequestSchema = z.object({
  languages: z.array(LanguageCodeSchema).min(1),
  layout: LayoutModeSchema,
  minConfidence: z.number().min(0).max(100),
  upscale: z.boolean(),
  maxScale: z.number().min(1).max(6),
});

export const ProgressSchema = z.object({
  status: z.string(),
  progress: z.number().min(0).max(1),
});

export const ErrorPayloadSchema = z.object({
  tag: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

/** What the overlay does with the result. */
export const ViewOptionsSchema = z.object({
  showBoxes: z.boolean(),
  autoCopy: z.boolean(),
});

/** What the overlay attaches itself to. */
export const AnchorSchema = z.discriminatedUnion("kind", [
  /** An element of the page. The overlay follows it on a scroll and on a resize. */
  z.object({ kind: z.literal("image"), srcUrl: z.string().min(1) }),
  /** A fixed region of the viewport, used by the region scan. */
  z.object({ kind: z.literal("viewport"), rect: RectSchema }),
]);

/* ------------------------------------------------------------------ *
 * Service worker -> offscreen document
 * ------------------------------------------------------------------ */

export const ToOffscreenSchema = z.object({
  target: z.literal("offscreen"),
  kind: z.literal("ocr:run"),
  jobId: z.string().min(1),
  image: ImageRefSchema,
  request: OcrRequestSchema,
});

export const OcrReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: OcrResultSchema }),
  z.object({ ok: z.literal(false), error: ErrorPayloadSchema }),
]);

/* ------------------------------------------------------------------ *
 * Offscreen document and content script -> service worker
 * ------------------------------------------------------------------ */

export const ToBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({
    target: z.literal("background"),
    kind: z.literal("ocr:progress"),
    jobId: z.string().min(1),
    progress: ProgressSchema,
  }),
  z.object({
    target: z.literal("background"),
    kind: z.literal("region:selected"),
    requestId: z.string().min(1),
    rect: RectSchema,
    devicePixelRatio: z.number().positive(),
  }),
  z.object({
    target: z.literal("background"),
    kind: z.literal("region:cancelled"),
    requestId: z.string().min(1),
  }),
]);

/* ------------------------------------------------------------------ *
 * Service worker -> content script
 * ------------------------------------------------------------------ */

export const ToContentSchema = z.discriminatedUnion("kind", [
  z.object({
    target: z.literal("content"),
    kind: z.literal("scan:begin"),
    jobId: z.string().min(1),
    anchor: AnchorSchema,
  }),
  /**
   * Moves a running scan to another anchor. The screenshot fallback uses it,
   * because it reads the visible part of the element and not the element itself.
   */
  z.object({
    target: z.literal("content"),
    kind: z.literal("scan:anchor"),
    jobId: z.string().min(1),
    anchor: AnchorSchema,
  }),
  z.object({
    target: z.literal("content"),
    kind: z.literal("scan:progress"),
    jobId: z.string().min(1),
    progress: ProgressSchema,
  }),
  z.object({
    target: z.literal("content"),
    kind: z.literal("scan:result"),
    jobId: z.string().min(1),
    result: OcrResultSchema,
    view: ViewOptionsSchema,
  }),
  z.object({
    target: z.literal("content"),
    kind: z.literal("scan:error"),
    jobId: z.string().min(1),
    message: z.string(),
  }),
  z.object({
    target: z.literal("content"),
    kind: z.literal("region:request"),
    requestId: z.string().min(1),
  }),
  /** Asks the frame where the image sits, and whether it sits there at all. */
  z.object({
    target: z.literal("content"),
    kind: z.literal("anchor:measure"),
    srcUrl: z.string().min(1),
  }),
  /** Asks whether a content script runs in the frame. */
  z.object({
    target: z.literal("content"),
    kind: z.literal("ping"),
  }),
]);

/** The place of the anchor element inside the viewport, at the time of the read. */
export const AnchorInfoSchema = z.object({
  /** Position in CSS pixels, relative to the viewport of the frame. */
  rect: RectSchema,
  devicePixelRatio: z.number().positive(),
  /** Pixel size of the source image, absent for an element without one. */
  naturalSize: SizeSchema.nullable(),
  /** Size of the viewport of the frame, used to clip a screenshot region. */
  viewport: SizeSchema,
});

export const AnchorReplySchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(true), info: AnchorInfoSchema }),
  z.object({ found: z.literal(false) }),
]);

export const PongSchema = z.object({ pong: z.literal(true) });

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type ImageRef = z.infer<typeof ImageRefSchema>;
export type OcrRequest = z.infer<typeof OcrRequestSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
export type ViewOptions = z.infer<typeof ViewOptionsSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type ToOffscreen = z.infer<typeof ToOffscreenSchema>;
export type OcrReply = z.infer<typeof OcrReplySchema>;
export type ToBackground = z.infer<typeof ToBackgroundSchema>;
export type ToContent = z.infer<typeof ToContentSchema>;
export type AnchorInfo = z.infer<typeof AnchorInfoSchema>;
export type AnchorReply = z.infer<typeof AnchorReplySchema>;

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

export type DecodeOutcome<A> =
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string };

/**
 * Validates one incoming message. The caller ignores a message that fails,
 * because another part of the extension owns it.
 */
export const decodeMessage = <S extends z.ZodType>(
  schema: S,
  value: unknown,
): DecodeOutcome<z.infer<S>> => {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: z.prettifyError(parsed.error) };
};
