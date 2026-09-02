import { describe, expect, it } from "vitest";
import { rect, size } from "@/core/geometry.js";
import { parseObjectFit, renderedContentRect } from "@/core/object-fit.js";

const box = size(400, 200);
const natural = size(100, 100);

describe("parseObjectFit", () => {
  it("reads a valid value", () => {
    expect(parseObjectFit("contain")).toBe("contain");
    expect(parseObjectFit(" cover ")).toBe("cover");
  });

  it("falls back to the CSS default", () => {
    expect(parseObjectFit("nonsense")).toBe("fill");
    expect(parseObjectFit(null)).toBe("fill");
    expect(parseObjectFit(undefined)).toBe("fill");
  });
});

describe("renderedContentRect", () => {
  it("fills the whole box by default", () => {
    expect(renderedContentRect(box, natural, "fill")).toEqual(rect(0, 0, 400, 200));
  });

  it("centres a contained image and leaves the letterbox out", () => {
    expect(renderedContentRect(box, natural, "contain")).toEqual(rect(100, 0, 200, 200));
  });

  it("lets a covering image pass the box, and the overlay clips it", () => {
    expect(renderedContentRect(box, natural, "cover")).toEqual(rect(0, -100, 400, 400));
  });

  it("centres the native size for the value none", () => {
    expect(renderedContentRect(box, natural, "none")).toEqual(rect(150, 50, 100, 100));
  });

  it("never enlarges for the value scale-down", () => {
    expect(renderedContentRect(box, natural, "scale-down")).toEqual(rect(150, 50, 100, 100));
  });

  it("contains a large image for the value scale-down", () => {
    expect(renderedContentRect(box, size(1000, 1000), "scale-down")).toEqual(
      rect(100, 0, 200, 200),
    );
  });

  it("returns the whole box for an unknown natural size", () => {
    expect(renderedContentRect(box, null, "contain")).toEqual(rect(0, 0, 400, 200));
  });

  it("returns the whole box for an element without a size", () => {
    expect(renderedContentRect(size(0, 0), natural, "contain")).toEqual(rect(0, 0, 0, 0));
  });
});
