/**
 * The overlay.
 *
 * It draws one transparent line of text over every line that the engine found, so
 * the user selects the text with the mouse and copies it with the keyboard. A PDF
 * viewer works the same way.
 *
 * The overlay owns a shadow root. The page cannot style it, and it cannot style
 * the page.
 */

import { rect, rectBottom, type Rect, size, type Size } from "../core/geometry.js";
import { horizontalScale, projectLines, projectWords } from "../core/layout.js";
import type { OcrResult } from "../core/ocr.js";
import type { Progress, ViewOptions } from "../core/protocol.js";
import { type AnchorView, viewportAnchor } from "./anchor.js";
import { copyText } from "./clipboard.js";
import styles from "./overlay.css";

const HOST_ID = "textlift-overlay";

/** Distance between the anchor and the toolbar, in CSS pixels. */
const BAR_GAP = 8;

type Phase = "scanning" | "ready" | "failed";

export class Overlay {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly frame: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private readonly boxes: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly status: HTMLSpanElement;
  private readonly spinner: HTMLDivElement;
  private readonly copyButton: HTMLButtonElement;

  private anchor: AnchorView;
  private result: OcrResult | null = null;
  private view: ViewOptions = { showBoxes: false, autoCopy: false };
  private phase: Phase = "scanning";
  private frameHandle = 0;
  private observer: ResizeObserver | null = null;
  private disposed = false;
  /** A toast carries a message only, so it draws no frame around an element. */
  private showFrame = true;
  /** The anchor size of the last text layer. A scroll alone does not change it. */
  private paintedSize: Size | null = null;
  private needsPaint = false;

  private constructor(anchor: AnchorView) {
    this.anchor = anchor;

    this.host = document.createElement("div");
    this.host.id = HOST_ID;
    this.host.style.setProperty("all", "initial");
    this.root = this.host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = styles;

    this.frame = element("div", "frame");
    this.layer = element("div", "layer");
    this.boxes = element("div", "boxes boxes--hidden");
    this.frame.append(this.layer, this.boxes);

    this.spinner = element("div", "spinner");
    this.status = element("span", "status");
    this.copyButton = button("Copy", { primary: true });
    const closeButton = button("✕", { icon: true, label: "Close the overlay" });

    this.bar = element("div", "bar");
    this.bar.setAttribute("role", "status");
    this.bar.setAttribute("aria-live", "polite");
    this.bar.append(this.spinner, this.status, this.copyButton, closeButton);

    this.root.append(style, this.frame, this.bar);

    this.copyButton.addEventListener("click", () => void this.copyAll());
    closeButton.addEventListener("click", () => this.destroy());

    this.setPhase("scanning");
    this.setStatus("Scanning…");
  }

  static open(anchor: AnchorView): Overlay {
    const overlay = new Overlay(anchor);
    (document.body ?? document.documentElement).append(overlay.host);
    overlay.attachListeners();
    overlay.reposition();
    requestAnimationFrame(() => overlay.show());
    return overlay;
  }

  /**
   * Opens a message near the top of the viewport, with no frame.
   *
   * A scan can fail before the overlay exists, for example when the extension
   * cannot find the image in the page. The user needs the reason anyway.
   */
  static openToast(message: string): Overlay {
    const width = 320;
    const anchor = viewportAnchor(rect(Math.max(8, (window.innerWidth - width) / 2), 14, width, 0));
    const overlay = Overlay.open(anchor);
    overlay.showFrame = false;
    overlay.setError(message);
    return overlay;
  }

  /** Moves the overlay to another anchor, for example the screenshot fallback. */
  setAnchor(anchor: AnchorView): void {
    this.observer?.disconnect();
    this.observer = null;
    this.anchor = anchor;
    this.observeAnchor();
    this.render();
  }

  setProgress(progress: Progress): void {
    if (this.phase !== "scanning") return;
    const percent = Math.round(progress.progress * 100);
    this.setStatus(`${describeStatus(progress.status)} ${percent}%`);
  }

  setResult(result: OcrResult, view: ViewOptions): void {
    this.result = result;
    this.view = view;
    this.setPhase("ready");

    if (result.lines.length === 0) {
      this.setStatus("No text found");
      this.copyButton.hidden = true;
      this.render();
      return;
    }

    this.copyButton.hidden = false;
    this.setStatus(summary(result));
    this.render();
    if (view.autoCopy) void this.copyAll();
  }

  setError(message: string): void {
    this.setPhase("failed");
    this.status.classList.add("status--error");
    this.setStatus(message);
    this.copyButton.hidden = true;
    this.render();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;

    cancelAnimationFrame(this.frameHandle);
    this.observer?.disconnect();
    window.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("resize", this.onViewportChange);
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.host.remove();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private attachListeners(): void {
    window.addEventListener("scroll", this.onViewportChange, { capture: true, passive: true });
    window.addEventListener("resize", this.onViewportChange, { passive: true });
    document.addEventListener("keydown", this.onKeyDown, true);
    this.observeAnchor();
  }

  private observeAnchor(): void {
    const element = this.anchor.element;
    if (element === null) return;

    this.observer = new ResizeObserver(() => this.scheduleReposition());
    this.observer.observe(element);
  }

  private readonly onViewportChange = (): void => {
    this.scheduleReposition();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.destroy();
  };

  private scheduleReposition(): void {
    if (this.disposed) return;
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = requestAnimationFrame(() => this.reposition());
  }

  private show(): void {
    this.bar.dataset["visible"] = "true";
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.spinner.hidden = phase !== "scanning";
    this.copyButton.hidden = phase !== "ready";
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** Places the frame and the toolbar. It reads no text metric, so it is cheap. */
  private reposition(): void {
    if (this.disposed) return;

    const target = this.anchor.rectNow();
    if (target === null) {
      this.destroy();
      return;
    }

    this.frame.hidden = !this.showFrame;
    place(this.frame, target);
    this.placeBar(target);

    // A repaint replaces every span, and that drops the selection of the user.
    // So it happens on a size change and on new data, never on a scroll.
    const current = size(target.width, target.height);
    if (this.needsPaint || !sameSize(this.paintedSize, current)) {
      this.paintText(target);
      this.paintedSize = current;
      this.needsPaint = false;
    }
  }

  /**
   * The toolbar sits under the anchor. It moves over the anchor when the space
   * under it is too small, and it never leaves the viewport on the left.
   */
  private placeBar(target: Rect): void {
    const barSize = this.bar.getBoundingClientRect();
    const under = rectBottom(target) + BAR_GAP;
    const fitsUnder = under + barSize.height <= window.innerHeight;
    const top = fitsUnder ? under : Math.max(BAR_GAP, target.y - barSize.height - BAR_GAP);
    const left = Math.min(
      Math.max(BAR_GAP, target.x),
      Math.max(BAR_GAP, window.innerWidth - barSize.width - BAR_GAP),
    );

    this.bar.style.top = `${Math.round(top)}px`;
    this.bar.style.left = `${Math.round(left)}px`;
  }

  private render(): void {
    this.needsPaint = true;
    this.scheduleReposition();
  }

  /**
   * Builds the text layer.
   *
   * Two passes, because a read after a write forces the browser to lay out the
   * page again. The first pass writes every line, the second pass reads every
   * width, and the third pass writes every horizontal scale.
   */
  private paintText(target: Rect): void {
    const result = this.result;
    this.layer.replaceChildren();
    this.boxes.replaceChildren();

    if (result === null || result.lines.length === 0) return;

    const targetSize = size(target.width, target.height);
    const lines = projectLines(result.lines, result.imageSize, targetSize);

    const spans = lines.map((line) => {
      const span = element("span", "line");
      span.textContent = line.text;
      span.style.left = `${line.rect.x}px`;
      span.style.top = `${line.rect.y}px`;
      span.style.fontSize = `${line.fontSize}px`;
      return span;
    });
    this.layer.append(...spans);

    const widths = spans.map((span) => span.getBoundingClientRect().width);
    spans.forEach((span, index) => {
      const line = lines[index];
      const width = widths[index];
      if (line === undefined || width === undefined) return;
      span.style.transform = `scaleX(${horizontalScale(width, line.rect.width)})`;
    });

    this.paintBoxes(result, targetSize);
  }

  private paintBoxes(result: OcrResult, targetSize: { width: number; height: number }): void {
    this.boxes.classList.toggle("boxes--hidden", !this.view.showBoxes);
    if (!this.view.showBoxes) return;

    const words = projectWords(result.lines, result.imageSize, targetSize);
    this.boxes.append(
      ...words.map((word) => {
        const box = element("div", "box");
        box.style.left = `${word.rect.x}px`;
        box.style.top = `${word.rect.y}px`;
        box.style.width = `${word.rect.width}px`;
        box.style.height = `${word.rect.height}px`;
        box.dataset["weak"] = String(word.confidence < 70);
        box.title = `${word.text} — ${Math.round(word.confidence)}%`;
        return box;
      }),
    );
  }

  private async copyAll(): Promise<void> {
    const result = this.result;
    if (result === null) return;

    const copied = await copyText(result.text);
    this.setStatus(copied ? "Copied to the clipboard" : "The page blocked the copy");
    if (copied) {
      window.setTimeout(() => {
        if (!this.disposed && this.phase === "ready") this.setStatus(summary(result));
      }, 1600);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

const button = (
  label: string,
  options: { primary?: boolean; icon?: boolean; label?: string } = {},
): HTMLButtonElement => {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  if (options.primary === true) node.dataset["primary"] = "true";
  if (options.icon === true) node.dataset["icon"] = "true";
  node.setAttribute("aria-label", options.label ?? label);
  return node;
};

const sameSize = (a: Size | null, b: Size): boolean =>
  a !== null && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

const place = (node: HTMLElement, target: Rect): void => {
  node.style.left = `${target.x}px`;
  node.style.top = `${target.y}px`;
  node.style.width = `${target.width}px`;
  node.style.height = `${target.height}px`;
};

const summary = (result: OcrResult): string => {
  const lines = result.lines.length;
  const words = result.meta.wordCount;
  return `${words} ${words === 1 ? "word" : "words"} · ${lines} ${lines === 1 ? "line" : "lines"} · ${Math.round(result.meta.meanConfidence)}%`;
};

/** Turns an engine status into a sentence for the toolbar. */
const describeStatus = (status: string): string => {
  if (status.includes("loading tesseract core")) return "Loading the engine";
  if (status.includes("loading language traineddata")) return "Loading the language";
  if (status.includes("initializ")) return "Starting the engine";
  if (status.includes("recognizing")) return "Reading the text";
  return "Working";
};
