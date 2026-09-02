import { describe, expect, it } from "vitest";
import {
  clipRectToSize,
  intersectRect,
  projectRect,
  rect,
  rectFromBbox,
  rectFromPoints,
  roundRect,
  scaleRect,
  size,
  unionRect,
} from "@/core/geometry.js";

describe("rectFromBbox", () => {
  it("turns two corners into an origin and a size", () => {
    expect(rectFromBbox({ x0: 10, y0: 20, x1: 40, y1: 26 })).toEqual(rect(10, 20, 30, 6));
  });
});

describe("scaleRect", () => {
  it("scales the origin and the size together", () => {
    expect(scaleRect(rect(4, 8, 20, 10), 0.5)).toEqual(rect(2, 4, 10, 5));
  });

  it("returns the source for a factor of one", () => {
    const source = rect(3, 7, 11, 13);
    expect(scaleRect(source, 1)).toEqual(source);
  });
});

describe("projectRect", () => {
  it("maps a box of the image onto the rendered element", () => {
    const box = rect(100, 50, 200, 20);
    const projected = projectRect(box, size(1000, 500), size(500, 250));
    expect(projected).toEqual(rect(50, 25, 100, 10));
  });

  it("follows a change of the aspect ratio", () => {
    const projected = projectRect(rect(0, 0, 100, 100), size(100, 100), size(300, 50));
    expect(projected).toEqual(rect(0, 0, 300, 50));
  });

  it("returns an empty box for an empty source", () => {
    expect(projectRect(rect(1, 2, 3, 4), size(0, 0), size(10, 10))).toEqual(rect(0, 0, 0, 0));
  });
});

describe("intersectRect", () => {
  it("returns the common part", () => {
    expect(intersectRect(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toEqual(rect(5, 5, 5, 5));
  });

  it("returns null for two boxes that only touch", () => {
    expect(intersectRect(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBeNull();
  });

  it("returns null for two boxes apart", () => {
    expect(intersectRect(rect(0, 0, 4, 4), rect(20, 20, 4, 4))).toBeNull();
  });
});

describe("clipRectToSize", () => {
  it("cuts the part outside the image", () => {
    expect(clipRectToSize(rect(-10, -10, 40, 40), size(20, 20))).toEqual(rect(0, 0, 20, 20));
  });

  it("returns null when the whole box sits outside", () => {
    expect(clipRectToSize(rect(30, 30, 10, 10), size(20, 20))).toBeNull();
  });
});

describe("roundRect", () => {
  it("grows the box to whole pixels", () => {
    expect(roundRect(rect(10.4, 20.8, 5.3, 4.1))).toEqual(rect(10, 20, 6, 5));
  });
});

describe("rectFromPoints", () => {
  it("accepts a drag in any direction", () => {
    const down = rectFromPoints({ x: 10, y: 10 }, { x: 40, y: 30 });
    const up = rectFromPoints({ x: 40, y: 30 }, { x: 10, y: 10 });
    expect(down).toEqual(rect(10, 10, 30, 20));
    expect(up).toEqual(down);
  });
});

describe("unionRect", () => {
  it("covers every box", () => {
    const union = unionRect([rect(10, 10, 10, 5), rect(30, 12, 20, 6)]);
    expect(union).toEqual(rect(10, 10, 40, 8));
  });

  it("returns null for an empty list", () => {
    expect(unionRect([])).toBeNull();
  });
});
