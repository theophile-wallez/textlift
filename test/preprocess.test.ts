import { describe, expect, it } from "vitest";
import { size } from "@/core/geometry.js";
import { DEFAULT_SCALE_LIMITS, inverseScale, planScale } from "@/core/preprocess.js";

const limits = DEFAULT_SCALE_LIMITS;

describe("planScale", () => {
  it("keeps a large enough image at its native size", () => {
    const plan = planScale(size(1600, 1200), limits);
    expect(plan.reason).toBe("native");
    expect(plan.scale).toBe(1);
    expect(plan.target).toEqual(size(1600, 1200));
  });

  it("enlarges a small image up to the target short side", () => {
    const plan = planScale(size(500, 250), limits);
    expect(plan.reason).toBe("upscaled");
    expect(plan.scale).toBeCloseTo(3, 5);
    expect(plan.target).toEqual(size(1500, 750));
  });

  it("never enlarges beyond the largest factor", () => {
    const plan = planScale(size(40, 20), { ...limits, maxScale: 2 });
    expect(plan.scale).toBe(2);
    expect(plan.target).toEqual(size(80, 40));
  });

  it("reduces an image over the pixel budget", () => {
    const plan = planScale(size(8000, 6000), limits);
    expect(plan.reason).toBe("downscaled");
    expect(plan.scale).toBeLessThan(1);
    const pixels = plan.target.width * plan.target.height;
    expect(pixels).toBeLessThanOrEqual(limits.maxPixels * 1.001);
  });

  it("keeps a wide banner native, because an enlargement breaks the budget", () => {
    const plan = planScale(size(20000, 60), { ...limits, maxPixels: 1_200_000 });
    expect(plan.reason).toBe("native");
  });

  it("never returns a target under one pixel", () => {
    const plan = planScale(size(1, 1), limits);
    expect(plan.target.width).toBeGreaterThanOrEqual(1);
    expect(plan.target.height).toBeGreaterThanOrEqual(1);
  });

  it("keeps an empty size unchanged", () => {
    const plan = planScale(size(0, 0), limits);
    expect(plan.reason).toBe("native");
    expect(plan.scale).toBe(1);
  });

  it("makes no change when the enlargement is off", () => {
    const plan = planScale(size(300, 200), { ...limits, minShortSide: 0 });
    expect(plan.reason).toBe("native");
  });
});

describe("inverseScale", () => {
  it("undoes the plan", () => {
    const plan = planScale(size(500, 250), limits);
    expect(plan.scale * inverseScale(plan)).toBeCloseTo(1, 10);
  });
});
