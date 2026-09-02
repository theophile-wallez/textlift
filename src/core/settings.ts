/**
 * The user settings, their schema, and a tolerant reader.
 *
 * A stored object can hold a value of an old version of the extension. The
 * reader validates every key on its own, so one stale key falls back to its
 * default and the other keys survive.
 */

import * as z from "zod";
import { DEFAULT_LANGUAGE, LanguageCodeSchema } from "./languages.js";

/** The page layout hint of the engine. The label maps to a Tesseract mode number. */
export const LayoutModeSchema = z.enum(["auto", "block", "line", "sparse"]);

export type LayoutMode = z.infer<typeof LayoutModeSchema>;

/** Tesseract page segmentation mode numbers, as the engine parameter wants them. */
const PAGE_SEG_MODE: Record<LayoutMode, string> = {
  auto: "3",
  block: "6",
  line: "7",
  sparse: "11",
};

export const toPageSegMode = (mode: LayoutMode): string => PAGE_SEG_MODE[mode];

/**
 * The resolution that the engine assumes.
 *
 * Tesseract estimates the resolution of an image, and the enlargement of the
 * pipeline misleads that estimate: a 3x enlargement of a screen capture reports
 * about 700 dpi. The layout analysis then reads an underlined line as a rule of a
 * table and drops the whole block, so a link under a message disappears while
 * every other line arrives.
 *
 * An explicit value stops the estimate. 300 dpi is the resolution that Tesseract
 * is tuned for, and a measurement over one capture at 1x, 2x and 3x keeps the
 * underlined line at every step with this value.
 */
export const ENGINE_DPI = "300";

/**
 * Every parameter of one recognition.
 *
 * The engine keeps a parameter that a later call does not repeat, and the worker
 * lives between two scans, so this object always carries the whole set.
 */
export const engineParameters = (layout: LayoutMode): Record<string, string> => ({
  tessedit_pageseg_mode: toPageSegMode(layout),
  // A space between two words of one line survives, which keeps a column apart.
  preserve_interword_spaces: "1",
  user_defined_dpi: ENGINE_DPI,
});

export const SettingsSchema = z.object({
  /** Recognition languages, in order of priority. */
  languages: z.array(LanguageCodeSchema).min(1).default([DEFAULT_LANGUAGE]),
  layout: LayoutModeSchema.default("auto"),
  /** Words below this confidence never reach the overlay. Tesseract reports 0 to 100. */
  minConfidence: z.number().min(0).max(100).default(30),
  /** Upscale of a small image. It costs time and it increases the accuracy. */
  upscale: z.boolean().default(true),
  maxScale: z.number().min(1).max(6).default(3),
  /** Copy the whole text as soon as the scan ends. */
  autoCopy: z.boolean().default(false),
  /** Paint the word boxes. It shows what the engine found and where. */
  showBoxes: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (): Settings => SettingsSchema.parse({});

type SettingsShape = typeof SettingsSchema.shape;

/**
 * Reads a settings object of unknown shape. Every key falls back on its own, so
 * one invalid key costs one default value and not the whole object.
 */
export const coerceSettings = (raw: unknown): Settings => {
  const defaults = defaultSettings();
  if (raw === null || typeof raw !== "object") return defaults;

  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(SettingsSchema.shape) as (keyof SettingsShape)[]) {
    if (!(key in source)) continue;
    const parsed = SettingsSchema.shape[key].safeParse(source[key]);
    if (parsed.success) out[key] = parsed.data;
  }

  return out as Settings;
};
