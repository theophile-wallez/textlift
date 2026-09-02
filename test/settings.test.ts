import { describe, expect, it } from "vitest";
import { coerceSettings, defaultSettings, toPageSegMode } from "@/core/settings.js";

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

describe("toPageSegMode", () => {
  it("maps every layout to a Tesseract mode", () => {
    expect(toPageSegMode("auto")).toBe("3");
    expect(toPageSegMode("block")).toBe("6");
    expect(toPageSegMode("line")).toBe("7");
    expect(toPageSegMode("sparse")).toBe("11");
  });
});
