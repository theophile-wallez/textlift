/**
 * The recognition result, its schema, and the text assembly.
 *
 * The result crosses two message boundaries, so it holds plain data only. Every
 * box uses the coordinates of the source image, never the coordinates of the
 * resized image that the engine received.
 */

import * as z from "zod";
import { rectBottom, type Size, unionRect } from "./geometry.js";

export const SizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const OcrWordSchema = z.object({
  text: z.string(),
  confidence: z.number(),
  bbox: RectSchema,
});

export const OcrLineSchema = z.object({
  text: z.string(),
  bbox: RectSchema,
  words: z.array(OcrWordSchema),
});

export const OcrMetaSchema = z.object({
  languages: z.array(z.string()),
  /** Resize factor that the engine received. The boxes are already inverted. */
  scale: z.number().positive(),
  durationMs: z.number().nonnegative(),
  meanConfidence: z.number(),
  wordCount: z.number().int().nonnegative(),
});

export const OcrResultSchema = z.object({
  imageSize: SizeSchema,
  lines: z.array(OcrLineSchema),
  text: z.string(),
  meta: OcrMetaSchema,
});

export type OcrWord = z.infer<typeof OcrWordSchema>;
export type OcrLine = z.infer<typeof OcrLineSchema>;
export type OcrMeta = z.infer<typeof OcrMetaSchema>;
export type OcrResult = z.infer<typeof OcrResultSchema>;

const isPrintable = (text: string): boolean => text.trim().length > 0;

/** Drops an empty word and a word that the engine is not sure about. */
export const keepWord = (word: OcrWord, minConfidence: number): boolean =>
  isPrintable(word.text) && word.confidence >= minConfidence;

/** Joins the words of one line. Tesseract reports the words in reading order. */
export const lineText = (words: readonly OcrWord[]): string =>
  words
    .map((word) => word.text.trim())
    .filter(isPrintable)
    .join(" ");

/**
 * Builds a line from its words. Returns null when no word survives the
 * confidence filter, because an empty line adds an empty row to the overlay.
 */
export const buildLine = (words: readonly OcrWord[], minConfidence: number): OcrLine | null => {
  const kept = words.filter((word) => keepWord(word, minConfidence));
  if (kept.length === 0) return null;

  const bbox = unionRect(kept.map((word) => word.bbox));
  if (bbox === null) return null;

  return { text: lineText(kept), bbox, words: kept };
};

const meanLineHeight = (lines: readonly OcrLine[]): number => {
  if (lines.length === 0) return 0;
  const total = lines.reduce((sum, line) => sum + line.bbox.height, 0);
  return total / lines.length;
};

/**
 * Assembles the full text. A large vertical gap between two lines becomes an
 * empty line, because that gap separates two paragraphs in the source image.
 */
export const resultText = (lines: readonly OcrLine[]): string => {
  if (lines.length === 0) return "";

  const gapThreshold = meanLineHeight(lines) * 0.6;
  const parts: string[] = [];

  lines.forEach((line, index) => {
    const previous = index > 0 ? lines[index - 1] : undefined;
    if (previous !== undefined) {
      const gap = line.bbox.y - rectBottom(previous.bbox);
      parts.push(gap > gapThreshold ? "\n\n" : "\n");
    }
    parts.push(line.text);
  });

  return parts.join("");
};

export const countWords = (lines: readonly OcrLine[]): number =>
  lines.reduce((sum, line) => sum + line.words.length, 0);

export const meanConfidence = (lines: readonly OcrLine[]): number => {
  const words = lines.flatMap((line) => line.words);
  if (words.length === 0) return 0;
  const total = words.reduce((sum, word) => sum + word.confidence, 0);
  return total / words.length;
};

/** Builds the result object from the lines that the engine adapter produced. */
export const buildResult = (
  imageSize: Size,
  lines: readonly OcrLine[],
  meta: Omit<OcrMeta, "meanConfidence" | "wordCount">,
): OcrResult => ({
  imageSize,
  lines: [...lines],
  text: resultText(lines),
  meta: {
    ...meta,
    meanConfidence: meanConfidence(lines),
    wordCount: countWords(lines),
  },
});

export const isEmptyResult = (result: OcrResult): boolean => result.lines.length === 0;
