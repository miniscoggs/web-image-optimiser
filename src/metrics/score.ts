import sharp from "sharp";
import assertComparable from "./assertComparable.js";
import { BLACK, WHITE, flatten, isOpaque } from "./composite.js";
import type { ScorePair } from "./scorePool.js";
import scoreSsimulacra2 from "./ssimulacra2.js";
import type { MetricsImage, MetricsScoreOptions } from "./types.js";

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
 * Scores a pair with the WASM scorer, on a thread of the pool when there is one, or else on
 * the calling thread.
 *
 * @param pair - The pair.
 * @param transfer - Memory of the pair's that the pool's thread may take.
 * @param options - The pool, the signal that drops a pair still waiting for it, and whether
 * the pair is scored ahead of need.
 */
function scorePair(
  pair: ScorePair,
  transfer: ArrayBuffer[],
  options: MetricsScoreOptions
) {
  const { pool, signal, speculative } = options;

  return pool === undefined
    ? scoreSsimulacra2(pair.reference, pair.distorted, pair.width, pair.height)
    : pool.score(pair, { signal, transfer, speculative });
}

/**
 * Scores two flattened RGB images with SSIMULACRA 2, resizing them first when they're too
 * large for the WASM scorer.
 *
 * @param reference - The original's RGB pixels, which a pool's thread may take.
 * @param distorted - The distorted image's RGB pixels, which a pool's thread may take.
 * @param size - The dimensions both images share.
 * @param options - Where to score.
 */
async function scoreRgb(
  reference: Buffer<ArrayBuffer>,
  distorted: Buffer<ArrayBuffer>,
  size: ImageSize,
  options: MetricsScoreOptions
) {
  if (reference.equals(distorted)) {
    return 100; // also lets tiny lossless candidates score
  }
  if (!isScorable(size)) {
    throw new RangeError(
      `Images smaller than ${MIN_SCORABLE_SIZE}x${MIN_SCORABLE_SIZE} can only be scored when identical; got ${size.width}x${size.height}`
    );
  }

  const { width, height } = size;

  if (!isDownscaledForScoring(size)) {
    const transfer = [reference.buffer, distorted.buffer]; // flatten gives each its own memory

    return scorePair(
      { reference, distorted, width, height },
      transfer,
      options
    );
  }

  const [fittedReference, fittedDistorted] = await Promise.all([
    fitForScoring(reference, size),
    fitForScoring(distorted, size),
  ]);
  const fitted = {
    reference: fittedReference.data,
    distorted: fittedDistorted.data,
    width: fittedReference.width,
    height: fittedReference.height,
  };

  return scorePair(fitted, [], options); // sharp's memory can't be transferred, so it's copied
}

/**
 * Scores how closely `distorted` matches `reference` with SSIMULACRA 2, from 100 (identical)
 * downwards. {@link verdictFor} turns the score into a plain-language verdict.
 *
 * Images with transparency are composited onto black and onto white and scored twice, and the
 * lower score wins, so a difference that shows on either background counts. Identical pixels
 * score 100 straight away. Pairs over 26 megapixels are resized to fit the scorer first (see
 * {@link isDownscaledForScoring}). Scoring takes about a second per megapixel. Without a pool,
 * the WASM step blocks the calling thread while it runs; with one, each background's pair is
 * scored on the pool's threads, with the same result.
 *
 * @param reference - The original image, from {@link decodeForScoring}.
 * @param distorted - The image to compare against it, with the same dimensions.
 * @param options - The pool to score on, if any, the signal that drops pairs still waiting
 * for it, and whether they are scored ahead of need, so they wait behind needed ones.
 * @returns The SSIMULACRA 2 score: 100 for identical pixels, and lower for more visible
 * distortion. Heavily distorted images can score below 0.
 * @throws RangeError when a buffer's length doesn't match its dimensions, when the dimensions
 * differ, or when differing images are smaller than 8x8 (see {@link isScorable}).
 */
async function score(
  reference: MetricsImage,
  distorted: MetricsImage,
  options: MetricsScoreOptions = {}
) {
  assertComparable(reference, distorted);
  if (reference.data.equals(distorted.data)) {
    return 100;
  }

  const backgrounds =
    isOpaque(reference) && isOpaque(distorted) ? [BLACK] : [BLACK, WHITE]; // opaque pairs look the same on any background
  const scoreOn = (background: number) =>
    scoreRgb(
      flatten(reference, background),
      flatten(distorted, background),
      reference,
      options
    );

  if (options.pool !== undefined) {
    const scores = await Promise.all(backgrounds.map(scoreOn));

    return Math.min(100, ...scores);
  }

  let lowest = 100;

  for (const background of backgrounds) {
    lowest = Math.min(lowest, await scoreOn(background)); // one pair's pixels at a time, as this thread scores one at a time
  }
  return lowest;
}

export { MAX_SCORED_PIXELS, isDownscaledForScoring, isScorable, score };
