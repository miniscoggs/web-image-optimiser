import type { WebpOptions } from "sharp";
import type { MetricsImage } from "../metrics/index.js";
import assertFitsFormat from "./assertFitsFormat.js";
import createPipeline from "./createPipeline.js";
import type { EncodeMethod, EncodeResult } from "./types.js";

const WEBP_SMART_DEBLOCK = true; // from the encoder benchmark in docs/encoding.md

/**
 * Encodes decoded pixels as WebP at the slowest, smallest effort.
 *
 * @param source - The decoded image.
 * @param options - The sharp WebP options for this method.
 * @param method - How it compresses.
 * @param quality - The quality, for the methods that take one.
 * @throws `OptimiserError` `E_TOO_LARGE_FOR_FORMAT` when a side is over 16383 pixels.
 */
async function encodeWebp(
  source: MetricsImage,
  options: WebpOptions,
  method: EncodeMethod,
  quality?: number
): Promise<EncodeResult> {
  assertFitsFormat(source, "webp");

  const bytes = await createPipeline(source)
    .webp({ effort: 6, ...options })
    .toBuffer();

  return {
    bytes,
    format: "webp",
    method,
    ...(quality === undefined ? {} : { quality }),
  };
}

/**
 * Encodes decoded pixels as lossy WebP, with smart chroma subsampling and full-quality alpha.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 * @param quality - The quality, 0 to 100.
 */
function webpLossy(source: MetricsImage, quality: number) {
  const options = {
    quality,
    alphaQuality: 100,
    smartSubsample: true,
    smartDeblock: WEBP_SMART_DEBLOCK,
  };

  return encodeWebp(source, options, "lossy", quality);
}

/**
 * Encodes decoded pixels as lossless WebP.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 */
function webpLossless(source: MetricsImage) {
  return encodeWebp(source, { lossless: true }, "lossless");
}

/**
 * Encodes decoded pixels as near-lossless WebP, which adjusts pixel values slightly before
 * compressing them losslessly.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 * @param quality - The near-lossless level: 100 is lossless, lower values adjust more.
 */
function webpNearLossless(source: MetricsImage, quality: number) {
  return encodeWebp(
    source,
    { nearLossless: true, quality },
    "near-lossless",
    quality
  );
}

export { webpLossless, webpLossy, webpNearLossless };
