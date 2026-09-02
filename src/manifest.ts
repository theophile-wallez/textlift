/**
 * The manifest.
 *
 * `scripts/build.mjs` writes `dist/manifest.json` from this file, and a test
 * compares the two. So the manifest never drifts from the code, and the version
 * comes from `package.json` only.
 */

export interface ManifestInput {
  readonly version: string;
}

export const buildManifest = ({ version }: ManifestInput): chrome.runtime.ManifestV3 => ({
  manifest_version: 3,
  name: "textlift",
  version,
  description:
    "Right-click an image and read its text. The recognition runs on your machine, offline.",
  // `chrome.runtime.getContexts` and `chrome.offscreen` need Chrome 116, and
  // that version supports the relaxed SIMD core of the engine.
  minimum_chrome_version: "116",

  permissions: [
    "contextMenus",
    // The engine runs in an offscreen document, because a service worker stops.
    "offscreen",
    "storage",
    // Injects the content script into a tab that Chrome loaded before the install.
    "scripting",
    // Closes the idle engine, which holds about 100 MB.
    "alarms",
  ],
  // The extension reads the bytes of an image of any host, and it takes a
  // screenshot of the visible tab.
  host_permissions: ["<all_urls>"],

  background: {
    service_worker: "background.js",
    type: "module",
  },

  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      run_at: "document_idle",
      all_frames: true,
    },
  ],

  action: {
    default_title: "Scan the text of a screen region",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
    },
  },

  options_ui: {
    page: "options.html",
    open_in_tab: true,
  },

  commands: {
    "scan-region": {
      suggested_key: { default: "Alt+Shift+S" },
      description: "Scan the text of a screen region",
    },
  },

  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },

  // `wasm-unsafe-eval` allows the compilation of the engine. It allows no
  // JavaScript evaluation.
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
});
