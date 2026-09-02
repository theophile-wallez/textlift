/**
 * The persistence of the settings.
 *
 * `chrome.storage.sync` follows the Chrome profile, so the settings arrive on
 * every machine of the user. A read failure returns the defaults, because a scan
 * with the default language beats no scan at all.
 */

import { coerceSettings, defaultSettings, type Settings } from "../core/settings.js";

const KEY = "settings";

export const readSettings = async (): Promise<Settings> => {
  try {
    const bag = await chrome.storage.sync.get(KEY);
    return coerceSettings(bag[KEY]);
  } catch {
    return defaultSettings();
  }
};

export const writeSettings = async (settings: Settings): Promise<void> => {
  await chrome.storage.sync.set({ [KEY]: settings });
};

/** Calls back on every change of the settings, from any page of the extension. */
export const onSettingsChanged = (listener: (settings: Settings) => void): void => {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const change = changes[KEY];
    if (change === undefined) return;
    listener(coerceSettings(change.newValue));
  });
};
