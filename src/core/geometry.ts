/**
 * Rectangle and size arithmetic. Every function here is pure, so the unit tests
 * cover the whole module without a browser.
 *
 * Two coordinate spaces exist in this extension:
 *  - image space: pixels of the source image, origin at the top left corner.
 *  - CSS space:   pixels of the rendered element, origin at the top left corner.
 * A function that crosses the two spaces takes both sizes as an argument.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A Tesseract box. The engine reports two corners, not an origin and a size. */
export interface Bbox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const size = (width: number, height: number): Size => ({ width, height });

export const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

export const rectFromBbox = (box: Bbox): Rect =>
  rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);

export const rectRight = (r: Rect): number => r.x + r.width;

export const rectBottom = (r: Rect): number => r.y + r.height;

export const rectArea = (r: Rect): number => Math.max(0, r.width) * Math.max(0, r.height);

export const sizeArea = (s: Size): number => Math.max(0, s.width) * Math.max(0, s.height);

export const isEmptySize = (s: Size): boolean => sizeArea(s) <= 0;

export const scaleSize = (s: Size, factor: number): Size =>
  size(s.width * factor, s.height * factor);

/** Rounds a size to whole pixels. A canvas of zero pixels throws, so the floor is 1. */
export const roundSize = (s: Size): Size =>
  size(Math.max(1, Math.round(s.width)), Math.max(1, Math.round(s.height)));

export const scaleRect = (r: Rect, factor: number): Rect =>
  rect(r.x * factor, r.y * factor, r.width * factor, r.height * factor);

export const roundRect = (r: Rect): Rect => {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return rect(x, y, Math.ceil(r.x + r.width) - x, Math.ceil(r.y + r.height) - y);
};

export const translateRect = (r: Rect, dx: number, dy: number): Rect =>
  rect(r.x + dx, r.y + dy, r.width, r.height);

/**
 * Maps a rectangle from one space to another. The two spaces can have a
 * different aspect ratio, because the page can stretch an image with CSS.
 */
export const projectRect = (r: Rect, from: Size, to: Size): Rect => {
  if (isEmptySize(from)) return rect(0, 0, 0, 0);
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return rect(r.x * sx, r.y * sy, r.width * sx, r.height * sy);
};

export const intersectRect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(rectRight(a), rectRight(b));
  const bottom = Math.min(rectBottom(a), rectBottom(b));
  if (right <= x || bottom <= y) return null;
  return rect(x, y, right - x, bottom - y);
};

/** Clips a rectangle to the bounds of an image. Returns null when nothing is left. */
export const clipRectToSize = (r: Rect, bounds: Size): Rect | null =>
  intersectRect(r, rect(0, 0, bounds.width, bounds.height));

/** Builds the rectangle that two drag points define, in any drag direction. */
export const rectFromPoints = (
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): Rect => rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const unionRect = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, rectRight(r));
    bottom = Math.max(bottom, rectBottom(r));
  }
  return rect(left, top, right - left, bottom - top);
};
