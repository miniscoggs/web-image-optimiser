// public api: once released, a code is never renamed, removed or reused
const ERROR_CODES = [
  "E_ANIMATED",
  "E_DECODE",
  "E_INTERNAL",
  "E_OUTPUT_CONFLICT",
  "E_OUTPUT_IS_INPUT",
  "E_READ",
  "E_TOO_LARGE_FOR_FORMAT",
  "E_UNSUPPORTED_FORMAT",
  "E_WRITE",
] as const;
const WARNING_CODES = [
  "W_ICC_KEPT",
  "W_NOTICEABLE",
  "W_NOT_CONVERTED",
  "W_OUTPUT_EXISTS",
  "W_SCORED_DOWNSCALED",
  "W_SVG_SAME_ONLY",
  "W_TARGET_NOT_REACHED",
  "W_TOO_SMALL_TO_SCORE",
] as const;

/**
 * The code of an {@link OptimiserError}, stable across releases so callers can branch on it:
 *
 * - `E_ANIMATED`: the image is animated (an animated WebP, APNG or AVIF sequence).
 * - `E_DECODE`: the file has a supported format's signature but can't be read.
 * - `E_INTERNAL`: an unexpected error, which is a bug. The message has the details.
 * - `E_OUTPUT_CONFLICT`: in a batch, one of the file's outputs could land on another input,
 *   or on an earlier input's outputs, such as `photo.png` and `photo.jpg` both writing
 *   `photo.webp`.
 * - `E_OUTPUT_IS_INPUT`: an output would replace its own input, which needs `inPlace`.
 * - `E_READ`: the input file can't be read, for example because it doesn't exist.
 * - `E_TOO_LARGE_FOR_FORMAT`: the image is too large for an output format, such as WebP's
 *   16383-pixel limit or AVIF's 16384. Other formats can still be tried.
 * - `E_UNSUPPORTED_FORMAT`: the file isn't a PNG, JPEG, WebP, AVIF or SVG.
 * - `E_WRITE`: an output can't be written, for example because the folder is read-only.
 *
 * @example
 * ```ts
 * import { inspect, OptimiserError, type OptimiserErrorCode } from "web-image-optimiser";
 *
 * let code: OptimiserErrorCode | undefined;
 * try {
 *   await inspect("animation.webp");
 * } catch (error) {
 *   if (error instanceof OptimiserError) code = error.code; // "E_ANIMATED"
 * }
 * ```
 */
type OptimiserErrorCode = (typeof ERROR_CODES)[number];

/**
 * The code of a warning on a file's result, stable across releases so callers can branch on it:
 *
 * - `W_ICC_KEPT`: the file keeps a colour profile that isn't sRGB, because dropping it would
 *   shift its colours.
 * - `W_NOTICEABLE`: an output scores below 80, so the loss may be noticeable side by side.
 * - `W_NOT_CONVERTED`: no output in the requested format was smaller than the input, so the
 *   file was stripped in its own format, or kept.
 * - `W_OUTPUT_EXISTS`: an output already exists, so the file was skipped. Pass `overwrite` to
 *   replace it.
 * - `W_SCORED_DOWNSCALED`: the image is over 26 megapixels, so it was scored at 26 MP and its
 *   scores are approximate.
 * - `W_SVG_SAME_ONLY`: SVGs are always optimised as SVG, whatever format was asked for.
 * - `W_TARGET_NOT_REACHED`: no output in the requested format reached the quality target, so
 *   the highest-scoring one smaller than the input was written.
 * - `W_TOO_SMALL_TO_SCORE`: the image is under 8x8 pixels, too small to score, so only
 *   lossless outputs were tried.
 *
 * @example
 * ```ts
 * import { optimiseFile, type OptimiserWarningCode } from "web-image-optimiser";
 *
 * const result = await optimiseFile("photo.jpg", { to: "webp", outDir: "web" });
 * const codes: OptimiserWarningCode[] = result.warnings.map((warning) => warning.code);
 * ```
 */
type OptimiserWarningCode = (typeof WARNING_CODES)[number];

export { ERROR_CODES, WARNING_CODES };
export type { OptimiserErrorCode, OptimiserWarningCode };
