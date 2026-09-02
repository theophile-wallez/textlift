/**
 * The anchor of the overlay.
 *
 * An element anchor follows its element: the overlay reads the rectangle again on
 * every scroll and on every resize. A viewport anchor holds a fixed rectangle,
 * which the region scan and the screenshot fallback both need.
 *
 * Every rectangle uses CSS pixels of the viewport of this frame, because the
 * overlay positions itself with `position: fixed`.
 */

import { rect, type Rect, size, type Size, translateRect } from "../core/geometry.js";
import { parseObjectFit, renderedContentRect } from "../core/object-fit.js";
import type { Anchor as AnchorRef } from "../core/protocol.js";

export interface AnchorView {
  /** The rectangle of the pixels, or null when the anchor left the page. */
  readonly rectNow: () => Rect | null;
  /** The element to observe for a size change, absent for a viewport anchor. */
  readonly element: Element | null;
}

const numberOf = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The natural pixel size of the source, or null when the element has none. */
export const naturalSizeOf = (element: Element): Size | null => {
  if (element instanceof HTMLImageElement && element.naturalWidth > 0) {
    return size(element.naturalWidth, element.naturalHeight);
  }
  if (element instanceof HTMLVideoElement && element.videoWidth > 0) {
    return size(element.videoWidth, element.videoHeight);
  }
  if (element instanceof HTMLCanvasElement && element.width > 0) {
    return size(element.width, element.height);
  }
  if (element instanceof SVGImageElement) {
    const box = element.getBBox();
    if (box.width > 0) return size(box.width, box.height);
  }
  return null;
};

/**
 * The rectangle of the drawn pixels of one element, inside the viewport.
 *
 * The border and the padding of the element do not hold pixels of the image, so
 * they leave the rectangle first. `object-fit` then removes the letterbox.
 */
export const pixelRectOf = (element: Element): Rect => {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);

  const left = numberOf(style.borderLeftWidth) + numberOf(style.paddingLeft);
  const top = numberOf(style.borderTopWidth) + numberOf(style.paddingTop);
  const right = numberOf(style.borderRightWidth) + numberOf(style.paddingRight);
  const bottom = numberOf(style.borderBottomWidth) + numberOf(style.paddingBottom);

  const content = size(
    Math.max(0, box.width - left - right),
    Math.max(0, box.height - top - bottom),
  );

  const drawn = renderedContentRect(
    content,
    naturalSizeOf(element),
    parseObjectFit(style.objectFit),
  );

  return translateRect(drawn, box.left + left, box.top + top);
};

const isAttached = (element: Element): boolean => element.isConnected;

export const elementAnchor = (element: Element): AnchorView => ({
  element,
  rectNow: () => (isAttached(element) ? pixelRectOf(element) : null),
});

export const viewportAnchor = (fixed: Rect): AnchorView => ({
  element: null,
  rectNow: () => fixed,
});

/* ------------------------------------------------------------------ *
 * The search for the element that the user right-clicked
 * ------------------------------------------------------------------ */

const absolute = (url: string): string => {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
};

const backgroundUrls = (element: Element): readonly string[] => {
  const value = getComputedStyle(element).backgroundImage;
  if (value === "none" || value === "") return [];
  return [...value.matchAll(/url\((['"]?)(.*?)\1\)/g)].flatMap((match) =>
    match[2] === undefined ? [] : [absolute(match[2])],
  );
};

/** Every URL that can make one element the source of a context menu click. */
export const sourcesOf = (element: Element): readonly string[] => {
  const found: string[] = [];

  if (element instanceof HTMLImageElement) {
    if (element.currentSrc !== "") found.push(absolute(element.currentSrc));
    if (element.src !== "") found.push(absolute(element.src));
  }
  if (element instanceof HTMLVideoElement) {
    if (element.poster !== "") found.push(absolute(element.poster));
    if (element.currentSrc !== "") found.push(absolute(element.currentSrc));
  }
  if (element instanceof HTMLInputElement && element.type === "image" && element.src !== "") {
    found.push(absolute(element.src));
  }
  if (element instanceof SVGImageElement) {
    const href = element.href.baseVal;
    if (href !== "") found.push(absolute(href));
  }
  found.push(...backgroundUrls(element));

  return found;
};

const area = (element: Element): number => {
  const box = element.getBoundingClientRect();
  return box.width * box.height;
};

const MEDIA_SELECTOR = 'img, video, canvas, input[type="image"], image';

/**
 * Finds the element that a source URL belongs to.
 *
 * The element of the last right click wins, because it is the element that the
 * user pointed at. A search of the frame follows, and the largest match wins:
 * a page often holds the same picture as a thumbnail and as a full image.
 */
export const findAnchorElement = (srcUrl: string, hint: Element | null): Element | null => {
  const wanted = absolute(srcUrl);

  if (hint !== null && isAttached(hint) && sourcesOf(hint).includes(wanted)) return hint;

  const matches = [...document.querySelectorAll(MEDIA_SELECTOR)].filter((element) =>
    sourcesOf(element).includes(wanted),
  );
  if (matches.length > 0) {
    return matches.reduce((best, element) => (area(element) > area(best) ? element : best));
  }

  // A CSS background image reports a URL that no media element holds. The hint
  // is then the only link between the click and the page.
  if (hint !== null && isAttached(hint) && area(hint) > 0) return hint;

  return null;
};

export const viewportSize = (): Size => size(window.innerWidth, window.innerHeight);

export const anchorViewOf = (ref: AnchorRef, hint: Element | null): AnchorView | null => {
  if (ref.kind === "viewport") {
    return viewportAnchor(rect(ref.rect.x, ref.rect.y, ref.rect.width, ref.rect.height));
  }
  const element = findAnchorElement(ref.srcUrl, hint);
  return element === null ? null : elementAnchor(element);
};
