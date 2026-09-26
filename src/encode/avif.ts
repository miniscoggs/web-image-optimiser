import type { MetricsImage } from "../metrics/index.js";
import assertFitsFormat from "./assertFitsFormat.js";
import createPipeline from "./createPipeline.js";
import type { EncodeResult } from "./types.js";

// from the encoder benchmark in docs/encoding.md
const AVIF_EFFORT = 6;
const AVIF_TUNE = "iq";

/**
 * Encodes decoded pixels as lossy AVIF.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 * @param quality - The quality, 0 to 100.
 * @throws `OptimiserError` `E_TOO_LARGE_FOR_FORMAT` when a side is over 16384 pixels.
 */
async function avifLossy(
  source: MetricsImage,
  quality: number
): Promise<EncodeResult> {
  assertFitsFormat(source, "avif");

  const bytes = await createPipeline(source)
    .avif({ quality, effort: AVIF_EFFORT, tune: AVIF_TUNE })
    .toBuffer();

  return { bytes, format: "avif", method: "lossy", quality };
}

export default avifLossy;
