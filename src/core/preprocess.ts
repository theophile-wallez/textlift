/**
 * The resize decision. Tesseract needs a character height of about 30 pixels.
 * An upscale of a small image gives the largest accuracy increase of the whole
 * pipeline, and a downscale of a very large image keeps the run time bounded.
 *
 * The module holds no canvas call, so the unit tests cover the decision alone.
 */

import { isEmptySize, roundSize, scaleSize, type Size, sizeArea } from "./geometry.js";

export interface ScaleLimits {
  /** Target height of the shorter side of the image. Below it, the plan upscales. */
  readonly minShortSide: number;
  /** Pixel budget of the processed image. Above it, the plan downscales. */
  readonly maxPixels: number;
  /** Upper bound of the upscale factor. A large factor costs time and adds no detail. */
  readonly maxScale: number;
}

export type ScaleReason = "native" | "upscaled" | "downscaled";

export interface ScalePlan {
  readonly scale: number;
  readonly target: Size;
  readonly reason: ScaleReason;
}

export const DEFAULT_SCALE_LIMITS: ScaleLimits = {
  minShortSide: 1000,
  maxPixels: 6_000_000,
  maxScale: 3,
};

const identityPlan = (source: Size): ScalePlan => ({
  scale: 1,
  target: roundSize(source),
  reason: "native",
});

/**
 * Chooses the resize factor of one image.
 *
 * The downscale wins over the upscale, because the pixel budget protects the
 * run time. A wide banner keeps its native size: its shorter side is small, but
 * an upscale would break the budget.
 */
export const planScale = (source: Size, limits: ScaleLimits = DEFAULT_SCALE_LIMITS): ScalePlan => {
  if (isEmptySize(source)) return identityPlan(source);

  const pixels = sizeArea(source);
  if (pixels > limits.maxPixels) {
    const scale = Math.sqrt(limits.maxPixels / pixels);
    return { scale, target: roundSize(scaleSize(source, scale)), reason: "downscaled" };
  }

  const shortSide = Math.min(source.width, source.height);
  if (shortSide >= limits.minShortSide) return identityPlan(source);

  const wanted = Math.min(limits.maxScale, limits.minShortSide / shortSide);
  const budget = Math.sqrt(limits.maxPixels / pixels);
  const scale = Math.min(wanted, budget);
  if (scale <= 1) return identityPlan(source);

  return { scale, target: roundSize(scaleSize(source, scale)), reason: "upscaled" };
};

/**
 * Tesseract reports a box in the coordinates of the image that it received.
 * The overlay needs the coordinates of the source image, so every box goes
 * through the inverse of the plan.
 */
export const inverseScale = (plan: ScalePlan): number => (plan.scale === 0 ? 1 : 1 / plan.scale);
