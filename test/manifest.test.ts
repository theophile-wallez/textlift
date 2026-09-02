import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MENU_ITEMS } from "@/background/menus.js";
import { buildManifest } from "@/manifest.js";

const manifest = buildManifest({ version: "1.2.3" });
const distManifest = fileURLToPath(new URL("../dist/manifest.json", import.meta.url));

describe("buildManifest", () => {
  it("declares manifest version 3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("takes the version of the package", () => {
    expect(manifest.version).toBe("1.2.3");
  });

  it("holds every permission that the pipeline uses", () => {
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["contextMenus", "offscreen", "storage", "scripting", "alarms"]),
    );
  });

  it("allows the WebAssembly engine and no JavaScript evaluation", () => {
    const policy = manifest.content_security_policy?.extension_pages ?? "";
    expect(policy).toContain("wasm-unsafe-eval");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("script-src 'self'");
  });

  it("runs the service worker as a module", () => {
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
  });

  it("injects the content script into every frame", () => {
    const script = manifest.content_scripts?.[0];
    expect(script?.js).toEqual(["content.js"]);
    expect(script?.all_frames).toBe(true);
  });

  it("needs a Chrome version that holds the offscreen API", () => {
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
  });

  it("binds a keyboard command to the region scan", () => {
    expect(manifest.commands?.["scan-region"]).toBeDefined();
  });
});

describe("MENU_ITEMS", () => {
  it("holds one item, so the context menu carries no submenu", () => {
    expect(MENU_ITEMS).toHaveLength(1);
  });

  it("shows that item on an image only", () => {
    expect(MENU_ITEMS[0]?.contexts).toEqual(["image"]);
  });

  it("nests no item under another one", () => {
    for (const item of MENU_ITEMS) expect(item.parentId).toBeUndefined();
  });

  it("names the item after the action that it starts", () => {
    expect(MENU_ITEMS[0]?.title).toBe("Scan the text of this image");
  });
});

describe("dist/manifest.json", () => {
  it("matches the definition after a build", async () => {
    let written: string;
    try {
      written = await readFile(distManifest, "utf8");
    } catch {
      // No build in this tree. `npm run check` builds after the tests.
      return;
    }

    const parsed = JSON.parse(written);
    expect(parsed).toEqual(buildManifest({ version: parsed.version }));
  });
});
