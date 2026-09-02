import { describe, expect, it } from "vitest";
import {
  coerceSettings,
  defaultSettings,
  ENGINE_DPI,
  engineParameters,
  toPageSegMode,
} from "@/core/settings.js";

describe("defaultSettings", () => {
  it("reads English and keeps the enlargement on", () => {
    const settings = defaultSettings();
    expect(settings.languages).toEqual(["eng"]);
    expect(settings.upscale).toBe(true);
    expect(settings.layout).toBe("auto");
  });
});

describe("coerceSettings", () => {
  it("keeps a valid object", () => {
    const stored = { ...defaultSettings(), languages: ["fra", "eng"], minConfidence: 55 };
    expect(coerceSettings(stored)).toEqual(stored);
  });

  it("returns the defaults for a value that is not an object", () => {
    expect(coerceSettings(null)).toEqual(defaultSettings());
    expect(coerceSettings("nonsense")).toEqual(defaultSettings());
    expect(coerceSettings(undefined)).toEqual(defaultSettings());
  });

  it("keeps the valid keys of a partly invalid object", () => {
    const settings = coerceSettings({
      languages: ["deu"],
      minConfidence: 500,
      layout: "unknown",
      autoCopy: true,
    });
    expect(settings.languages).toEqual(["deu"]);
    expect(settings.autoCopy).toBe(true);
    expect(settings.minConfidence).toBe(defaultSettings().minConfidence);
    expect(settings.layout).toBe("auto");
  });

  it("rejects an unknown language code", () => {
    expect(coerceSettings({ languages: ["klingon"] }).languages).toEqual(["eng"]);
  });

  it("rejects an empty language list", () => {
    expect(coerceSettings({ languages: [] }).languages).toEqual(["eng"]);
  });

  it("ignores a key that the schema does not hold", () => {
    const settings = coerceSettings({ removedInVersion2: true });
    expect(settings).toEqual(defaultSettings());
    expect("removedInVersion2" in settings).toBe(false);
  });
});

describe("engineParameters", () => {
  it("pins the resolution, because the estimate of the engine breaks the layout", () => {
    // A 3x enlargement makes the engine estimate about 700 dpi. It then reads an
    // underlined line as a rule of a table and drops that whole block.
    expect(engineParameters("auto").user_defined_dpi).toBe(ENGINE_DPI);
    expect(Number(ENGINE_DPI)).toBeGreaterThanOrEqual(150);
  });

  it("carries the layout of the request", () => {
    expect(engineParameters("sparse").tessedit_pageseg_mode).toBe(toPageSegMode("sparse"));
  });

  it("keeps the space between two words of one line", () => {
    expect(engineParameters("auto").preserve_interword_spaces).toBe("1");
  });

  it("repeats every parameter, because the engine keeps an earlier value", () => {
    // The worker lives between two scans. A parameter that one call drops would
    // survive from the call before it.
    const keys = Object.keys(engineParameters("auto")).sort();
    expect(keys).toEqual([
      "preserve_interword_spaces",
      "tessedit_pageseg_mode",
      "user_defined_dpi",
    ]);
    expect(Object.keys(engineParameters("line")).sort()).toEqual(keys);
  });
});

describe("toPageSegMode", () => {
  it("maps every layout to a Tesseract mode", () => {
    expect(toPageSegMode("auto")).toBe("3");
    expect(toPageSegMode("block")).toBe("6");
    expect(toPageSegMode("line")).toBe("7");
    expect(toPageSegMode("sparse")).toBe("11");
  });
});
