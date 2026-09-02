/**
 * Thin wrappers over the Chrome messaging API.
 *
 * Every context imports this module, the content script included, so it holds
 * no Effect code. A send to an absent receiver rejects, and the caller of a
 * broadcast does not care, so `postMessage` swallows that one failure.
 */

import type { ToBackground, ToContent, ToOffscreen } from "../core/protocol.js";

const NO_RECEIVER = "Receiving end does not exist";

const isNoReceiver = (cause: unknown): boolean =>
  cause instanceof Error && cause.message.includes(NO_RECEIVER);

/** Sends a message and waits for the answer of the receiver. */
export const request = async (message: ToOffscreen | ToBackground): Promise<unknown> =>
  chrome.runtime.sendMessage(message);

/**
 * Sends a message and ignores the answer. A progress notice reaches a service
 * worker that can already be asleep, and that loss changes nothing.
 */
export const notify = async (message: ToBackground): Promise<void> => {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (cause) {
    if (!isNoReceiver(cause)) throw cause;
  }
};

export interface TabTarget {
  readonly tabId: number;
  readonly frameId: number;
}

/** Sends a message to one frame of one tab. Rejects when no content script runs. */
export const sendToFrame = async (target: TabTarget, message: ToContent): Promise<unknown> =>
  chrome.tabs.sendMessage(target.tabId, message, { frameId: target.frameId });

/** Sends a message to one frame and ignores an absent content script. */
export const notifyFrame = async (target: TabTarget, message: ToContent): Promise<void> => {
  try {
    await sendToFrame(target, message);
  } catch (cause) {
    if (!isNoReceiver(cause)) throw cause;
  }
};

/**
 * True when the message carries the given target field. It filters the broadcast
 * before the schema runs, because every context sees every runtime message.
 */
export const hasTarget = (raw: unknown, target: string): boolean =>
  typeof raw === "object" &&
  raw !== null &&
  (raw as { readonly target?: unknown }).target === target;
