import { describe, expect, it } from "vitest";
import { joinAddressPieces } from "@/core/ocr.js";

const join = (...tokens: string[]): string => joinAddressPieces(tokens).join(" ");

describe("joinAddressPieces", () => {
  describe("the reported failure", () => {
    it("rebuilds an address that the image renders with a spaced hyphen", () => {
      expect(join("https://www.cse", "-siapartners.fr/com/homepage")).toBe(
        "https://www.cse-siapartners.fr/com/homepage",
      );
    });

    it("keeps a mark that the engine read beside the address", () => {
      // A logo before the link becomes a stray character on the same token.
      expect(join("‘https://www.cse", "-siapartners.fr/com/homepage")).toBe(
        "‘https://www.cse-siapartners.fr/com/homepage",
      );
    });

    it("accepts a hyphen that stands on its own", () => {
      expect(join("www.cse", "-", "siapartners.fr/com")).toBe("www.cse-siapartners.fr/com");
    });

    it("joins a path that the engine split", () => {
      expect(join("https://a.test/com", "/homepage")).toBe("https://a.test/com/homepage");
    });

    it("walks a chain of pieces", () => {
      expect(join("https://a.test", "-b.c", "/d_e", "?f=g")).toBe("https://a.test-b.c/d_e?f=g");
    });
  });

  describe("text that must keep its spaces", () => {
    it("leaves a range of numbers alone", () => {
      expect(join("10", "-", "20", "EUR")).toBe("10 - 20 EUR");
    });

    it("leaves a hyphenated name alone", () => {
      expect(join("Jean", "-", "Pierre")).toBe("Jean - Pierre");
    });

    it("leaves a sentence after an address alone", () => {
      expect(join("https://x.test", "-", "it", "is", "down")).toBe("https://x.test - it is down");
    });

    it("leaves a word after a slash alone", () => {
      expect(join("https://a.test/", "then", "we", "wait")).toBe("https://a.test/ then we wait");
    });

    it("opens no address on a word with one dot", () => {
      expect(join("Fin.Merci", "-", "beaucoup")).toBe("Fin.Merci - beaucoup");
    });

    it("opens no address on an abbreviation", () => {
      expect(join("etc.", "-", "voir", "plus")).toBe("etc. - voir plus");
    });

    it("leaves an ordinary sentence untouched", () => {
      expect(join("oublies", "pas", "de", "prendre", "ton", "ticket")).toBe(
        "oublies pas de prendre ton ticket",
      );
    });

    it("leaves an address of one token untouched", () => {
      expect(join("https://a.test/b-c/d")).toBe("https://a.test/b-c/d");
    });

    it("stops at the end of the line instead of joining a trailing separator", () => {
      expect(join("https://a.test", "-")).toBe("https://a.test -");
    });
  });

  describe("shape", () => {
    it("returns an empty list for no token", () => {
      expect(joinAddressPieces([])).toEqual([]);
    });

    it("is stable on its own result", () => {
      const once = joinAddressPieces(["https://www.cse", "-siapartners.fr/com"]);
      expect(joinAddressPieces(once)).toEqual(once);
    });

    it("keeps every character of the input, apart from a joined space", () => {
      const tokens = ["voir", "https://a.test", "-b.c", "puis", "partir"];
      const joined = joinAddressPieces(tokens).join("");
      expect(joined).toBe(tokens.join(""));
    });
  });
});
