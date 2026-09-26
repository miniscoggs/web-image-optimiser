import type { MetricsImage } from "../metrics/index.js";
import createPipeline from "./createPipeline.js";
import type { EncodeResult } from "./types.js";

/**
 * Encodes decoded pixels as PNG at maximum zlib compression with adaptive filtering.
 *
 * It is lossless for the 8-bit sRGB pixels it receives. A 16-bit source was already reduced to
 * 8 bits by `decodeForScoring`, which the score confirms is invisible.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 */
async function pngLossless(source: MetricsImage): Promise<EncodeResult> {
  const bytes = await createPipeline(source)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return { bytes, format: "png", method: "lossless" };
}

export default pngLossless;
