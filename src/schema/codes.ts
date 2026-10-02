// public api: once released, a code is never renamed, removed or reused
const ERROR_CODES = [
  "E_ANIMATED",
  "E_DECODE",
  "E_DIMENSIONS_MISMATCH",
  "E_INTERNAL",
  "E_OUTPUT_CONFLICT",
  "E_OUTPUT_IS_INPUT",
  "E_READ",
  "E_TOO_LARGE_FOR_FORMAT",
  "E_TOO_SMALL_TO_SCORE",
  "E_UNSUPPORTED_FORMAT",
  "E_WRITE",
] as const;
const USAGE_ERROR_CODES = ["E_NO_INPUTS"] as const; // the cli prints these with exit code 2
const WARNING_CODES = [
  "W_ICC_KEPT",
  "W_NOTICEABLE",
  "W_NOT_CONVERTED",
  "W_NOT_RESIZED",
  "W_NO_RIGHTS",
  "W_OUTPUT_EXISTS",
  "W_RIGHTS_NOT_ADDED",
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
 * - `E_DIMENSIONS_MISMATCH`: `compareFiles` only: the two images aren't the same size, so they
 *   can't be compared.
 * - `E_INTERNAL`: an unexpected error, which is a bug. The message has the details.
 * - `E_OUTPUT_CONFLICT`: in a batch, one of the file's outputs could land on another input,
 *   or on an earlier input's outputs, such as `photo.png` and `photo.jpg` both writing
 *   `photo.webp`.
 * - `E_OUTPUT_IS_INPUT`: an output would replace its own input, which needs `inPlace`.
 * - `E_READ`: the input file can't be read, for example because it doesn't exist.
 * - `E_TOO_LARGE_FOR_FORMAT`: the image is too large for an output format, such as WebP's
 *   16383-pixel limit or AVIF's 16384. Other formats can still be tried.
 * - `E_TOO_SMALL_TO_SCORE`: `compareFiles` and the app's target searches only: the images
 *   differ, or the format is lossy, but the image is under 8x8 pixels, too small to score.
 * - `E_UNSUPPORTED_FORMAT`: the file isn't a PNG, JPEG, WebP, AVIF or SVG, or `compareFiles`
 *   was given an SVG.
 * - `E_WRITE`: an output can't be written, for example because the folder is read-only.
 */
type OptimiserErrorCode = (typeof ERROR_CODES)[number];

/**
 * The code of a warning on a file's result, stable across releases so callers can branch on it:
 *
 * - `W_ICC_KEPT`: the file keeps a colour profile that isn't sRGB, because dropping it would
 *   shift its colours.
 * - `W_NOTICEABLE`: an output scores below 70, in the "noticeable" band, so the loss is likely to
 *   show.
 * - `W_NOT_CONVERTED`: no output in the requested format was smaller than the input, so the
 *   file was stripped in its own format (re-encoded in it, when resized to `maxWidth`), or kept.
 * - `W_NOT_RESIZED`: the image is wider than `maxWidth`, but nothing at that width was smaller
 *   than the input and reached the target, so the file was kept as it is.
 * - `W_NO_RIGHTS`: the outputs, or the kept original, carry none of the Creator, Credit Line,
 *   Copyright Notice, Web Statement of Rights and Licensor URL fields. Not given with `stripAll`,
 *   or for SVG.
 * - `W_OUTPUT_EXISTS`: an output already exists, so the file was skipped. Pass `overwrite` to
 *   replace it.
 * - `W_RIGHTS_NOT_ADDED`: an output lacks rights fields, added or the file's own, that would
 *   have left nothing smaller than the input, or the file was kept without fields it was given.
 * - `W_SCORED_DOWNSCALED`: the image is over 26 megapixels, so it was scored at 26 MP and its
 *   scores are approximate.
 * - `W_SVG_SAME_ONLY`: SVGs are always optimised as SVG, whatever format was asked for.
 * - `W_TARGET_NOT_REACHED`: no output in the requested format reached the quality target, so
 *   the highest-scoring one smaller than the input was written.
 * - `W_TOO_SMALL_TO_SCORE`: the image is under 8x8 pixels, too small to score, so only
 *   lossless outputs were tried.
 */
type OptimiserWarningCode = (typeof WARNING_CODES)[number];

export { ERROR_CODES, USAGE_ERROR_CODES, WARNING_CODES };
export type { OptimiserErrorCode, OptimiserWarningCode };
