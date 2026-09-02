/**
 * The language catalogue and the resolution of the training data location.
 *
 * The extension bundles English, because that covers most pages and it keeps
 * the first scan offline. Every other language arrives from the Tesseract data
 * host on the first use, and the engine caches it in IndexedDB after that.
 */

import * as z from "zod";

export interface LanguageEntry {
  readonly code: string;
  /** English name of the language, used by the options page. */
  readonly label: string;
  /** True when the package holds the training data of this language. */
  readonly bundled: boolean;
}

export const LANGUAGES: readonly LanguageEntry[] = [
  { code: "eng", label: "English", bundled: true },
  { code: "ara", label: "Arabic", bundled: false },
  { code: "ces", label: "Czech", bundled: false },
  { code: "chi_sim", label: "Chinese (simplified)", bundled: false },
  { code: "chi_tra", label: "Chinese (traditional)", bundled: false },
  { code: "dan", label: "Danish", bundled: false },
  { code: "deu", label: "German", bundled: false },
  { code: "ell", label: "Greek", bundled: false },
  { code: "fin", label: "Finnish", bundled: false },
  { code: "fra", label: "French", bundled: false },
  { code: "heb", label: "Hebrew", bundled: false },
  { code: "hin", label: "Hindi", bundled: false },
  { code: "hun", label: "Hungarian", bundled: false },
  { code: "ita", label: "Italian", bundled: false },
  { code: "jpn", label: "Japanese", bundled: false },
  { code: "kor", label: "Korean", bundled: false },
  { code: "nld", label: "Dutch", bundled: false },
  { code: "nor", label: "Norwegian", bundled: false },
  { code: "pol", label: "Polish", bundled: false },
  { code: "por", label: "Portuguese", bundled: false },
  { code: "ron", label: "Romanian", bundled: false },
  { code: "rus", label: "Russian", bundled: false },
  { code: "spa", label: "Spanish", bundled: false },
  { code: "swe", label: "Swedish", bundled: false },
  { code: "tha", label: "Thai", bundled: false },
  { code: "tur", label: "Turkish", bundled: false },
  { code: "ukr", label: "Ukrainian", bundled: false },
  { code: "vie", label: "Vietnamese", bundled: false },
] as const;

const LANGUAGE_CODES = LANGUAGES.map((entry) => entry.code) as [string, ...string[]];

export const LanguageCodeSchema = z.enum(LANGUAGE_CODES);

export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

export const DEFAULT_LANGUAGE = "eng";

const BUNDLED_CODES = new Set(LANGUAGES.filter((entry) => entry.bundled).map((e) => e.code));

export const isBundled = (code: string): boolean => BUNDLED_CODES.has(code);

/**
 * Builds the language argument of the engine. The order stays, because
 * Tesseract gives the first language the largest weight. A duplicate goes away,
 * because a repeated code loads the same data twice.
 */
export const toEngineLanguages = (codes: readonly string[]): string => {
  const unique = [...new Set(codes)];
  return unique.length === 0 ? DEFAULT_LANGUAGE : unique.join("+");
};

export interface DataSources {
  /** Directory inside the package that holds the bundled training data. */
  readonly bundled: string;
  /** Base URL of the remote training data host. */
  readonly remote: string;
}

export type CacheMethod = "write" | "readOnly" | "refresh" | "none";

export interface DataLocation {
  readonly langPath: string;
  readonly cacheMethod: CacheMethod;
}

/**
 * The engine accepts one directory for the whole language set. So the local
 * directory serves a set of bundled languages only, and one remote language
 * moves the whole set to the remote host.
 *
 * The cache follows the same rule: a local file needs no IndexedDB copy.
 */
export const resolveDataLocation = (
  codes: readonly string[],
  sources: DataSources,
): DataLocation => {
  const allBundled = codes.length > 0 && codes.every(isBundled);
  return allBundled
    ? { langPath: sources.bundled, cacheMethod: "none" }
    : { langPath: sources.remote, cacheMethod: "write" };
};
