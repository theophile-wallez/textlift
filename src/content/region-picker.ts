/**
 * The region selector.
 *
 * The user drags a rectangle over the page, and the service worker reads that
 * part of a screenshot. This path covers what a direct image read cannot: a CSS
 * background, a canvas, a video frame, and text of the page itself.
 */

import { rect, type Rect, rectFromPoints } from "../core/geometry.js";
import styles from "./region-picker.css";

const HOST_ID = "textlift-region";

/** A drag under this size is a click, and a click cancels the selection. */
const MIN_SIZE = 8;

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface RegionPicker {
  readonly cancel: () => void;
}

/**
 * Opens the selector. The promise resolves with the rectangle in CSS pixels of
 * the viewport, or with null when the user cancels.
 */
export const pickRegion = (): {
  readonly picker: RegionPicker;
  readonly done: Promise<Rect | null>;
} => {
  const host = document.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = styles;

  const sheet = document.createElement("div");
  sheet.className = "sheet";

  const selection = document.createElement("div");
  selection.className = "selection";
  selection.hidden = true;

  const readout = document.createElement("div");
  readout.className = "readout";
  readout.hidden = true;

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Drag over the text. Escape cancels.";

  sheet.append(selection, readout);
  root.append(style, sheet, hint);
  (document.body ?? document.documentElement).append(host);

  let origin: Point | null = null;
  let settled = false;

  let resolve: (value: Rect | null) => void = () => {};
  const done = new Promise<Rect | null>((resolveDone) => {
    resolve = resolveDone;
  });

  const teardown = (value: Rect | null): void => {
    if (settled) return;
    settled = true;
    sheet.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onBlur);
    host.remove();
    resolve(value);
  };

  const paint = (area: Rect): void => {
    selection.hidden = false;
    selection.style.left = `${area.x}px`;
    selection.style.top = `${area.y}px`;
    selection.style.width = `${area.width}px`;
    selection.style.height = `${area.height}px`;

    readout.hidden = false;
    readout.textContent = `${Math.round(area.width)} × ${Math.round(area.height)}`;
    // The label sits under the rectangle, and over it near the bottom edge.
    const below = area.y + area.height + 6;
    const fits = below + 22 < window.innerHeight;
    readout.style.left = `${area.x}px`;
    readout.style.top = `${fits ? below : Math.max(0, area.y - 24)}px`;
  };

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      teardown(null);
      return;
    }
    event.preventDefault();
    origin = { x: event.clientX, y: event.clientY };
    sheet.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (origin === null) return;
    event.preventDefault();
    paint(rectFromPoints(origin, { x: event.clientX, y: event.clientY }));
  }

  function onPointerUp(event: PointerEvent): void {
    if (origin === null) return;
    event.preventDefault();
    const area = rectFromPoints(origin, { x: event.clientX, y: event.clientY });
    origin = null;
    teardown(area.width >= MIN_SIZE && area.height >= MIN_SIZE ? clampToViewport(area) : null);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    teardown(null);
  }

  function onBlur(): void {
    teardown(null);
  }

  sheet.addEventListener("pointerdown", onPointerDown);
  sheet.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onBlur);

  return { picker: { cancel: () => teardown(null) }, done };
};

/** A drag can leave the viewport, and a screenshot holds the viewport only. */
const clampToViewport = (area: Rect): Rect => {
  const left = Math.max(0, area.x);
  const top = Math.max(0, area.y);
  const right = Math.min(window.innerWidth, area.x + area.width);
  const bottom = Math.min(window.innerHeight, area.y + area.height);
  return rect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
};
