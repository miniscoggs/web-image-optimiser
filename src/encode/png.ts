import type { MetricsImage } from "../metrics/index.js";
import createPipeline from "./createPipeline.js";
import type { EncodeResult } from "./types.js";

const PALETTE_EFFORT = 7; // from the encoder benchmark in docs/encoding.md
const PALETTE_DITHER = 1;

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

/**
 * Encodes decoded pixels as a palette PNG: libimagequant reduces them to as few colours as the
 * quality allows, at most 256, and zlib compresses them at its maximum level.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 * @param quality - The quality, 1 to 100.
 */
async function pngPalette(
  source: MetricsImage,
  quality: number
): Promise<EncodeResult> {
  const bytes = await createPipeline(source)
    .png({
      palette: true,
      quality,
      effort: PALETTE_EFFORT,
      dither: PALETTE_DITHER,
      compressionLevel: 9,
    })
    .toBuffer();

  return { bytes, format: "png", method: "lossy", quality };
}

export { pngLossless, pngPalette };
