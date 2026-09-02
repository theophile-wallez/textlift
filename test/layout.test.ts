import { describe, expect, it } from "vitest";
import { rect, size } from "@/core/geometry.js";
import { horizontalScale, projectLines, projectWords } from "@/core/layout.js";
import type { OcrLine } from "@/core/ocr.js";

const lines: OcrLine[] = [
  {
    text: "one two",
    bbox: rect(100, 200, 400, 40),
    words: [
      { text: "one", confidence: 95, bbox: rect(100, 200, 150, 40) },
      { text: "two", confidence: 60, bbox: rect(300, 200, 200, 40) },
    ],
  },
];

const imageSize = size(1000, 800);
const rendered = size(500, 400);

describe("projectLines", () => {
  it("halves every box for an element at half the size", () => {
    const [box] = projectLines(lines, imageSize, rendered);
    expect(box?.rect).toEqual(rect(50, 100, 200, 20));
  });

  it("takes the font size from the height of the box", () => {
    const [box] = projectLines(lines, imageSize, rendered);
    expect(box?.fontSize).toBe(20);
  });

  it("never falls under the smallest readable font size", () => {
    const [box] = projectLines(lines, imageSize, size(10, 8));
    expect(box?.fontSize).toBe(4);
  });

  it("carries the text of the line", () => {
    const [box] = projectLines(lines, imageSize, rendered);
    expect(box?.text).toBe("one two");
  });
});

describe("projectWords", () => {
  it("returns one box per word with its confidence", () => {
    const words = projectWords(lines, imageSize, rendered);
    expect(words).toHaveLength(2);
    expect(words[0]?.rect).toEqual(rect(50, 100, 75, 20));
    expect(words[1]?.confidence).toBe(60);
  });
});

describe("horizontalScale", () => {
  it("squeezes text that is too wide", () => {
    expect(horizontalScale(200, 100)).toBe(0.5);
  });

  it("stretches text that is too narrow", () => {
    expect(horizontalScale(50, 100)).toBe(2);
  });

  it("returns one for a measurement of zero", () => {
    expect(horizontalScale(0, 100)).toBe(1);
    expect(horizontalScale(100, 0)).toBe(1);
  });

  it("stays inside its bounds", () => {
    expect(horizontalScale(1, 1000)).toBe(8);
    expect(horizontalScale(1000, 1)).toBe(0.125);
  });
});
