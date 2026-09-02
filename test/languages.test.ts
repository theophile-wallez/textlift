import { describe, expect, it } from "vitest";
import { CORE_FILES, pickCoreFile } from "@/core/engine-assets.js";
import { isBundled, LANGUAGES, resolveDataLocation, toEngineLanguages } from "@/core/languages.js";

const sources = { bundled: "chrome-extension://x/vendor/tessdata", remote: "https://example.test" };

describe("LANGUAGES", () => {
  it("holds a unique code for every entry", () => {
    const codes = LANGUAGES.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("bundles English only", () => {
    expect(LANGUAGES.filter((entry) => entry.bundled).map((e) => e.code)).toEqual(["eng"]);
  });
});

describe("toEngineLanguages", () => {
  it("keeps the order of the user, because the first language weighs most", () => {
    expect(toEngineLanguages(["fra", "eng"])).toBe("fra+eng");
  });

  it("removes a duplicate", () => {
    expect(toEngineLanguages(["eng", "eng", "deu"])).toBe("eng+deu");
  });

  it("falls back to English for an empty list", () => {
    expect(toEngineLanguages([])).toBe("eng");
  });
});

describe("resolveDataLocation", () => {
  it("reads a bundled language from the package and caches nothing", () => {
    expect(resolveDataLocation(["eng"], sources)).toEqual({
      langPath: sources.bundled,
      cacheMethod: "none",
    });
  });

  it("moves the whole set to the host when one language is remote", () => {
    expect(resolveDataLocation(["eng", "jpn"], sources)).toEqual({
      langPath: sources.remote,
      cacheMethod: "write",
    });
  });

  it("uses the host for an empty list, because no bundled file applies", () => {
    expect(resolveDataLocation([], sources).langPath).toBe(sources.remote);
  });
});

describe("isBundled", () => {
  it("knows the bundled languages", () => {
    expect(isBundled("eng")).toBe(true);
    expect(isBundled("jpn")).toBe(false);
    expect(isBundled("klingon")).toBe(false);
  });
});

describe("pickCoreFile", () => {
  it("prefers the relaxed SIMD core", () => {
    expect(pickCoreFile({ simd: true, relaxedSimd: true })).toBe(CORE_FILES.relaxedSimd);
  });

  it("falls back to the SIMD core", () => {
    expect(pickCoreFile({ simd: true, relaxedSimd: false })).toBe(CORE_FILES.simd);
  });

  it("returns null for a browser without SIMD", () => {
    expect(pickCoreFile({ simd: false, relaxedSimd: false })).toBeNull();
  });
});
