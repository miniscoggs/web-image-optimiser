import sharp from "sharp";
import type { MetricsImage } from "./types.js";

/**
 * Decodes an image into the pixels the metrics compare: 8-bit sRGB RGBA with EXIF orientation
 * applied.
 *
 * Embedded colour profiles are converted to sRGB, 16-bit images are reduced to 8 bits, and
 * images without alpha get an opaque alpha channel. Only the first frame of an animation is
 * decoded.
 *
 * @param input - A file path, or the encoded image bytes.
 * @returns The decoded pixels and their dimensions.
 *
 * @example
 * ```ts
 * import { decodeForScoring, score } from "web-image-optimiser";
 *
 * const original = await decodeForScoring("photo.jpg");
 * const candidate = await decodeForScoring("photo.webp");
 * console.log(score(original, candidate));
 * ```
 */
async function decodeForScoring(input: Buffer | string): Promise<MetricsImage> {
  const { data, info } = await sharp(input)
    .autoOrient()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

export default decodeForScoring;
