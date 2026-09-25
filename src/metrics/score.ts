import sharp from "sharp";
import assertComparable from "./assertComparable.js";
import { BLACK, WHITE, flatten, isOpaque } from "./composite.js";
import scoreSsimulacra2 from "./ssimulacra2.js";
import type { MetricsImage } from "./types.js";

const MIN_SCORABLE_SIZE = 8; // ssimulacra 2's minimum width and height
const MAX_SCORED_PIXELS = 26_000_000; // the wasm's 4 GiB fits 27 MP, and traps at 28

type ImageSize = Pick<MetricsImage, "width" | "height">;

/**
 * Returns whether an image is large enough for SSIMULACRA 2, which needs at least 8x8 pixels.
 *
 * {@link score} still scores a smaller pair when its pixels are identical, so lossless
 * candidates of tiny images can be scored.
 *
 * @param image - The image, or just its dimensions.
 * @returns `true` when both dimensions are at least 8 pixels.
 *
 * @example
 * ```ts
 * import { isScorable } from "web-image-optimiser";
 *
 * isScorable({ width: 6, height: 6 }); // false
 * ```
 */
function isScorable(image: ImageSize) {
  return image.width >= MIN_SCORABLE_SIZE && image.height >= MIN_SCORABLE_SIZE;
}

/**
 * Returns whether {@link score} resizes an image of this size before scoring it.
 *
 * The WASM scorer's 4 GiB memory holds a pair of up to 26 megapixels. Above that, both images
 * are resized to 26 MP and scored at that size, which slightly overstates quality because the
 * finest detail is lost. Callers should warn that such a score is approximate.
 *
 * @param image - The image, or just its dimensions.
 * @returns `true` when the image has more than 26 million pixels.
 *
 * @example
 * ```ts
 * import { isDownscaledForScoring } from "web-image-optimiser";
 *
 * isDownscaledForScoring({ width: 8192, height: 5464 }); // true (44.8 MP)
 * ```
 */
function isDownscaledForScoring(image: ImageSize) {
  return image.width * image.height > MAX_SCORED_PIXELS;
}

/**
 * Resizes RGB pixels to the largest size the WASM scorer can hold, keeping the aspect ratio.
 *
 * @param rgb - RGB pixels.
 * @param size - Their dimensions.
 */
async function fitForScoring(rgb: Buffer, size: ImageSize) {
  const scale = Math.sqrt(MAX_SCORED_PIXELS / (size.width * size.height));
  const width = Math.max(MIN_SCORABLE_SIZE, Math.floor(size.width * scale));
  const height = Math.max(MIN_SCORABLE_SIZE, Math.floor(size.height * scale));
  const raw = { width: size.width, height: size.height, channels: 3 } as const;
  const data = await sharp(rgb, { raw })
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  return { data, width, height };
}

/**
 * Scores two flattened RGB images with SSIMULACRA 2, resizing them first when they're too
 * large for the WASM scorer.
 *
 * @param reference - The original's RGB pixels.
 * @param distorted - The distorted image's RGB pixels.
 * @param size - The dimensions both images share.
 */
async function scoreRgb(reference: Buffer, distorted: Buffer, size: ImageSize) {
  if (reference.equals(distorted)) {
    return 100; // also lets tiny lossless candidates score
  }
  if (!isScorable(size)) {
    throw new RangeError(
      `Images smaller than ${MIN_SCORABLE_SIZE}x${MIN_SCORABLE_SIZE} can only be scored when identical; got ${size.width}x${size.height}`
    );
  }
  if (!isDownscaledForScoring(size)) {
    return scoreSsimulacra2(reference, distorted, size.width, size.height);
  }

  const [fittedReference, fittedDistorted] = await Promise.all([
    fitForScoring(reference, size),
    fitForScoring(distorted, size),
  ]);

  return scoreSsimulacra2(
    fittedReference.data,
    fittedDistorted.data,
    fittedReference.width,
    fittedReference.height
  );
}

/**
 * Scores how closely `distorted` matches `reference` with SSIMULACRA 2, from 100 (identical)
 * downwards. {@link verdictFor} turns the score into a plain-language verdict.
 *
 * Images with transparency are composited onto black and onto white and scored twice, and the
 * lower score wins, so a difference that shows on either background counts. Identical pixels
 * score 100 straight away. Pairs over 26 megapixels are resized to fit the scorer first (see
 * {@link isDownscaledForScoring}). Scoring takes about a second per megapixel, and the WASM
 * step blocks the calling thread while it runs.
 *
 * @param reference - The original image, from {@link decodeForScoring}.
 * @param distorted - The image to compare against it, with the same dimensions.
 * @returns The SSIMULACRA 2 score: 100 for identical pixels, and lower for more visible
 * distortion. Heavily distorted images can score below 0.
 * @throws RangeError when a buffer's length doesn't match its dimensions, when the dimensions
 * differ, or when differing images are smaller than 8x8 (see {@link isScorable}).
 *
 * @example
 * ```ts
 * import { decodeForScoring, score, verdictFor } from "web-image-optimiser";
 *
 * const original = await decodeForScoring("photo.png");
 * const candidate = await decodeForScoring("photo.webp");
 * const value = await score(original, candidate);
 * console.log(value, verdictFor(value));
 * ```
 */
async function score(reference: MetricsImage, distorted: MetricsImage) {
  assertComparable(reference, distorted);
  if (reference.data.equals(distorted.data)) {
    return 100;
  }

  const backgrounds =
    isOpaque(reference) && isOpaque(distorted) ? [BLACK] : [BLACK, WHITE]; // opaque pairs look the same on any background
  let lowest = 100;

  for (const background of backgrounds) {
    const backgroundScore = await scoreRgb(
      flatten(reference, background),
      flatten(distorted, background),
      reference
    );

    lowest = Math.min(lowest, backgroundScore);
  }
  return lowest;
}

export { isDownscaledForScoring, isScorable, score };
