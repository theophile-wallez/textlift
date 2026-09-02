import { describe, expect, it } from "vitest";
import { rect, size } from "@/core/geometry.js";
import {
  buildLine,
  buildResult,
  countWords,
  keepWord,
  lineText,
  meanConfidence,
  type OcrLine,
  type OcrWord,
  resultText,
} from "@/core/ocr.js";

const word = (text: string, confidence: number, x: number, width: number): OcrWord => ({
  text,
  confidence,
  bbox: rect(x, 100, width, 18),
});

const line = (text: string, y: number, height = 18): OcrLine => ({
  text,
  bbox: rect(0, y, 200, height),
  words: [{ text, confidence: 90, bbox: rect(0, y, 200, height) }],
});

describe("keepWord", () => {
  it("drops a word under the confidence floor", () => {
    expect(keepWord(word("noise", 12, 0, 20), 30)).toBe(false);
  });

  it("drops a word of whitespace only", () => {
    expect(keepWord(word("   ", 99, 0, 20), 30)).toBe(false);
  });

  it("keeps a confident word", () => {
    expect(keepWord(word("hello", 88, 0, 40), 30)).toBe(true);
  });
});

describe("lineText", () => {
  it("joins the words with one space", () => {
    expect(lineText([word("the", 90, 0, 20), word(" text ", 90, 30, 30)])).toBe("the text");
  });
});

describe("buildLine", () => {
  it("covers every word that stays", () => {
    const built = buildLine([word("left", 90, 10, 30), word("right", 90, 60, 40)], 30);
    expect(built?.text).toBe("left right");
    expect(built?.bbox).toEqual(rect(10, 100, 90, 18));
  });

  it("returns null when every word fails the filter", () => {
    expect(buildLine([word("x", 5, 0, 5)], 30)).toBeNull();
  });

  it("returns null for a line without a word", () => {
    expect(buildLine([], 30)).toBeNull();
  });
});

describe("resultText", () => {
  it("joins two near lines with one newline", () => {
    expect(resultText([line("first", 0), line("second", 20)])).toBe("first\nsecond");
  });

  it("separates two paragraphs with an empty line", () => {
    expect(resultText([line("first", 0), line("second", 60)])).toBe("first\n\nsecond");
  });

  it("returns an empty string for no line", () => {
    expect(resultText([])).toBe("");
  });
});

describe("buildResult", () => {
  const lines = [line("alpha", 0), line("beta", 20)];
  const result = buildResult(size(400, 300), lines, {
    languages: ["eng"],
    scale: 2,
    durationMs: 1200,
  });

  it("counts the words and the mean confidence", () => {
    expect(result.meta.wordCount).toBe(countWords(lines));
    expect(result.meta.meanConfidence).toBe(meanConfidence(lines));
  });

  it("holds the assembled text", () => {
    expect(result.text).toBe("alpha\nbeta");
  });

  it("keeps the size of the source image", () => {
    expect(result.imageSize).toEqual(size(400, 300));
  });
});
