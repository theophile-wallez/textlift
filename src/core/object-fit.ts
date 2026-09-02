/**
 * The rendered rectangle of a replaced element.
 *
 * A page can letterbox an image with `object-fit`, so the pixels of the image do
 * not always fill the box of the element. The overlay needs the rectangle of the
 * pixels, because a text layer over the box would sit beside the text.
 *
 * The functions assume the default `object-position: 50% 50%`, which centres the
 * image. A page that moves the position gets a shifted layer.
 */

import { rect, type Rect, type Size } from "./geometry.js";

export type ObjectFit = "fill" | "contain" | "cover" | "none" | "scale-down";

const FIT_VALUES: readonly string[] = ["fill", "contain", "cover", "none", "scale-down"];

/** Reads a computed style value. An unknown value falls back to the CSS default. */
export const parseObjectFit = (value: string | null | undefined): ObjectFit => {
  const trimmed = (value ?? "").trim();
  return FIT_VALUES.includes(trimmed) ? (trimmed as ObjectFit) : "fill";
};

const centred = (box: Size, drawn: Size): Rect =>
  rect((box.width - drawn.width) / 2, (box.height - drawn.height) / 2, drawn.width, drawn.height);

/**
 * Returns the rectangle of the drawn pixels, relative to the content box of the
 * element. A null natural size means an unknown source, and the whole box serves.
 */
export const renderedContentRect = (box: Size, natural: Size | null, fit: ObjectFit): Rect => {
  const full = rect(0, 0, box.width, box.height);
  if (natural === null || natural.width <= 0 || natural.height <= 0) return full;
  if (box.width <= 0 || box.height <= 0) return full;

  const containScale = Math.min(box.width / natural.width, box.height / natural.height);

  switch (fit) {
    case "fill":
      return full;
    case "contain":
      return centred(box, {
        width: natural.width * containScale,
        height: natural.height * containScale,
      });
    case "cover": {
      const scale = Math.max(box.width / natural.width, box.height / natural.height);
      return centred(box, { width: natural.width * scale, height: natural.height * scale });
    }
    case "none":
      return centred(box, natural);
    case "scale-down": {
      const scale = Math.min(1, containScale);
      return centred(box, { width: natural.width * scale, height: natural.height * scale });
    }
  }
};
