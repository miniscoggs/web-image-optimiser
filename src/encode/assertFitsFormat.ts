import type { MetricsImage } from "../metrics/index.js";
import { OptimiserError } from "../schema/index.js";
import type { EncodeFormat } from "./types.js";

// the longest side each encoder writes: libwebp's 14-bit size fields, sharp's heif check and
// libjpeg's JPEG_MAX_DIMENSION; png's limit is far beyond anything sharp decodes
const MAX_DIMENSIONS = {
  webp: { name: "WebP", max: 16383 },
  avif: { name: "AVIF", max: 16384 },
  jpeg: { name: "JPEG", max: 65500 },
} as const satisfies Partial<
  Record<EncodeFormat, { name: string; max: number }>
>;

/**
 * Checks that an image fits a format's largest dimensions, so a pipeline can drop that format
 * and keep the others rather than failing on the encoder's own error.
 *
 * @param source - The decoded image.
 * @param format - The format it is about to be encoded as.
 * @throws {@link OptimiserError} `E_TOO_LARGE_FOR_FORMAT` when a side is too long.
 */
function assertFitsFormat(
  source: MetricsImage,
  format: keyof typeof MAX_DIMENSIONS
) {
  const { name, max } = MAX_DIMENSIONS[format];

  if (source.width > max || source.height > max) {
    throw new OptimiserError(
      "E_TOO_LARGE_FOR_FORMAT",
      `${name} images can be at most ${max} pixels on each side; this one is ${source.width}x${source.height}`
    );
  }
}

export default assertFitsFormat;
