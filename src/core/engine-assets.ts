/**
 * The choice of the WebAssembly core.
 *
 * The package holds the LSTM cores only. The legacy Tesseract engine needs
 * different training data, and the extension never uses it.
 *
 * Chrome 116 is the minimum version of the manifest, and SIMD arrived in
 * Chrome 91. So the SIMD core always applies, and the relaxed SIMD core applies
 * on Chrome 114 and later. Both cases stay explicit, because a null result gives
 * the user a clear message instead of a load failure inside the worker.
 */

export interface WasmFeatures {
  readonly simd: boolean;
  readonly relaxedSimd: boolean;
}

export const CORE_FILES = {
  relaxedSimd: "tesseract-core-relaxedsimd-lstm.js",
  simd: "tesseract-core-simd-lstm.js",
} as const;

export type CoreFile = (typeof CORE_FILES)[keyof typeof CORE_FILES];

/** Returns the core file to import, or null when the browser is too old. */
export const pickCoreFile = (features: WasmFeatures): CoreFile | null => {
  if (features.relaxedSimd) return CORE_FILES.relaxedSimd;
  if (features.simd) return CORE_FILES.simd;
  return null;
};

/** Directory of the vendored engine inside the package. */
export const ENGINE_DIR = "vendor/tesseract";

/** Directory of the bundled training data inside the package. */
export const TESSDATA_DIR = "vendor/tessdata";

/** Host of the training data of every language that the package does not hold. */
export const REMOTE_TESSDATA = "https://tessdata.projectnaptha.com/4.0.0_fast";

export const WORKER_FILE = "worker.min.js";
