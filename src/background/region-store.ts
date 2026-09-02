/**
 * The pending region selections.
 *
 * A region selection takes seconds, and Chrome stops the service worker after 30
 * seconds without an event. So the worker does not wait for the answer: it stores
 * the context of the request, and the message of the content script wakes it up
 * again later.
 *
 * `chrome.storage.session` holds the context. It lives in memory and it survives
 * a restart of the service worker.
 */

import { Effect } from "effect";
import * as z from "zod";
import type { TabTarget } from "../shared/messaging.js";

const KEY = "pendingRegions";

/** A request older than this never completes, because the user moved on. */
const MAX_AGE_MS = 5 * 60 * 1000;

const PendingRegionSchema = z.object({
  tabId: z.number().int(),
  frameId: z.number().int(),
  windowId: z.number().int(),
  createdAt: z.number(),
});

const PendingMapSchema = z.record(z.string(), PendingRegionSchema);

export type PendingRegion = z.infer<typeof PendingRegionSchema>;

const readMap = Effect.promise(async () => {
  try {
    const bag = await chrome.storage.session.get(KEY);
    const parsed = PendingMapSchema.safeParse(bag[KEY]);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
});

const writeMap = (map: Record<string, PendingRegion>) =>
  Effect.promise(() => chrome.storage.session.set({ [KEY]: map })).pipe(Effect.ignore);

const dropExpired = (
  map: Record<string, PendingRegion>,
  now: number,
): Record<string, PendingRegion> =>
  Object.fromEntries(Object.entries(map).filter(([, entry]) => now - entry.createdAt < MAX_AGE_MS));

export const putRegionRequest = (
  requestId: string,
  target: TabTarget & { readonly windowId: number },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Effect.sync(() => Date.now());
    const map = dropExpired(yield* readMap, now);
    map[requestId] = {
      tabId: target.tabId,
      frameId: target.frameId,
      windowId: target.windowId,
      createdAt: now,
    };
    yield* writeMap(map);
  });

/** Reads one request and removes it, so a repeated answer runs one scan only. */
export const takeRegionRequest = (requestId: string): Effect.Effect<PendingRegion | null> =>
  Effect.gen(function* () {
    const now = yield* Effect.sync(() => Date.now());
    const map = dropExpired(yield* readMap, now);
    const entry = map[requestId];
    if (entry === undefined) {
      yield* writeMap(map);
      return null;
    }
    delete map[requestId];
    yield* writeMap(map);
    return entry;
  });
