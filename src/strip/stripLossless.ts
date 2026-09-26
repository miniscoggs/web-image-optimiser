import { OptimiserError } from "../schema/index.js";
import stripAvif from "./stripAvif.js";
import stripJpeg from "./stripJpeg.js";
import stripPng from "./stripPng.js";
import stripWebp from "./stripWebp.js";
import type { StripFormat, StripResult } from "./types.js";

const STRIPPERS = {
  avif: stripAvif,
  jpeg: stripJpeg,
  png: stripPng,
  webp: stripWebp,
};

/**
 * Removes an image's metadata without touching its pixel data, by editing the file's segments,
 * chunks or boxes directly.
 *
 * It keeps only the image data, what changes how it displays (such as a non-sRGB ICC profile,
 * JPEG's `APP14` Adobe segment, PNG's `tRNS` chunk or AVIF's `irot` rotation), and, for JPEG,
 * PNG and WebP, an EXIF block holding just the orientation when the orientation isn't 1.
 * Anything after the end of a JPEG, PNG or WebP image is dropped. The result decodes to the same
 * pixels and is never larger than the input.
 *
 * @param bytes - The image's bytes.
 * @param info - Its format and EXIF orientation, from `inspect`.
 * @returns The stripped bytes and what was removed, or the input itself with nothing removed.
 * @throws {@link OptimiserError} `E_DECODE` when the file's structure ends early or a field
 * runs past it.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { inspect, stripLossless } from "web-image-optimiser";
 *
 * const bytes = await readFile("photo.jpg");
 * const info = await inspect(bytes);
 * if (info.format === "jpeg") {
 *   const { removed } = stripLossless(bytes, info); // ["exif", "gps", "xmp"]
 * }
 * ```
 */
function stripLossless(
  bytes: Buffer,
  info: { format: StripFormat; orientation: number }
): StripResult {
  let result: StripResult;

  try {
    result = STRIPPERS[info.format](bytes, info.orientation);
  } catch (error) {
    // a buffer read past the end of a malformed field, in any format
    if (error instanceof RangeError) {
      throw new OptimiserError(
        "E_DECODE",
        "A segment, chunk or box is truncated",
        { cause: error }
      );
    }
    throw error;
  }
  return result.removed.length === 0 ? { bytes, removed: [] } : result;
}

export default stripLossless;
