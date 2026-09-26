import type { MetricsImage } from "../metrics/index.js";
import assertFitsFormat from "./assertFitsFormat.js";
import createPipeline from "./createPipeline.js";
import type { EncodeResult } from "./types.js";

/**
 * Encodes decoded pixels as JPEG with mozjpeg's defaults: progressive, trellis-quantised and
 * with optimised Huffman coding. JPEG has no transparency, so use it only for opaque images.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 * @param quality - The quality, 1 to 100.
 * @throws `OptimiserError` `E_TOO_LARGE_FOR_FORMAT` when a side is over 65500 pixels.
 */
async function jpegMozjpeg(
  source: MetricsImage,
  quality: number
): Promise<EncodeResult> {
  assertFitsFormat(source, "jpeg");

  const bytes = await createPipeline(source)
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  return { bytes, format: "jpeg", method: "lossy", quality };
}

export default jpegMozjpeg;
