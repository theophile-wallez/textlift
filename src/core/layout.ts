/**
 * The projection of the recognition result onto the rendered element.
 *
 * The overlay places one transparent line of text over every line that the
 * engine found. A PDF viewer uses the same method: the reader sees the pixels of
 * the image and selects the text of the layer above it.
 *
 * One box per line, not one box per word. A line keeps the copy correct, because
 * the browser inserts one newline between two absolute boxes and one space
 * between two words of the same box.
 */

import { projectRect, type Rect, type Size } from "./geometry.js";
import type { OcrLine, OcrWord } from "./ocr.js";

export interface LineBox {
  readonly text: string;
  readonly rect: Rect;
  /** Font size in CSS pixels. The DOM corrects the width with a horizontal scale. */
  readonly fontSize: number;
}

export interface WordBox {
  readonly text: string;
  readonly confidence: number;
  readonly rect: Rect;
}

/** Below this height a line carries no readable text, and the browser clamps the font. */
const MIN_FONT_SIZE = 4;

export const projectLines = (
  lines: readonly OcrLine[],
  imageSize: Size,
  target: Size,
): readonly LineBox[] =>
  lines.map((line) => {
    const rect = projectRect(line.bbox, imageSize, target);
    return {
      text: line.text,
      rect,
      fontSize: Math.max(MIN_FONT_SIZE, rect.height),
    };
  });

export const projectWords = (
  lines: readonly OcrLine[],
  imageSize: Size,
  target: Size,
): readonly WordBox[] =>
  lines.flatMap((line) =>
    line.words.map((word: OcrWord) => ({
      text: word.text,
      confidence: word.confidence,
      rect: projectRect(word.bbox, imageSize, target),
    })),
  );

/**
 * The horizontal correction of one line. The overlay sets the font size from the
 * box height, then measures the real width of the text and squeezes it into the
 * box. A factor outside the bounds means a wrong measurement, so it stays at 1.
 */
export const horizontalScale = (measuredWidth: number, targetWidth: number): number => {
  if (measuredWidth <= 0 || targetWidth <= 0) return 1;
  const factor = targetWidth / measuredWidth;
  if (!Number.isFinite(factor)) return 1;
  return Math.min(8, Math.max(0.125, factor));
};
