import sharp from "sharp";
import assertComparable from "./assertComparable.js";
import { BLACK, WHITE, flatten, isOpaque } from "./composite.js";
import type { MetricsImage } from "./types.js";

const AMPLIFICATION = 8; // a luma difference of ~32 levels shows at full heat
const BACKGROUND_DIM = 0.5; // brightness of the greyscale reference, 0-1

/**
 * Returns the Rec. 709 luma of the RGB pixel at an offset.
 *
 * @param rgb - RGB pixels.
 * @param offset - Byte offset of the pixel's red channel.
 */
function luma(rgb: Buffer, offset: number) {
  const red = rgb[offset] ?? 0;
  const green = rgb[offset + 1] ?? 0;
  const blue = rgb[offset + 2] ?? 0;

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Draws where two images differ, as a PNG heat map over a dimmed greyscale copy of the
 * reference.
 *
 * Each pixel's luma difference is amplified 8 times and blended over the greyscale copy, from
 * faint red for small differences to solid yellow for large ones. Unchanged pixels stay grey.
 * Images with transparency are compared on black and on white, and the larger difference is
 * drawn.
 *
 * @param reference - The original image, from {@link decodeForScoring}.
 * @param distorted - The image to compare against it, with the same dimensions.
 * @returns PNG bytes with the same dimensions as the images.
 * @throws RangeError when a buffer's length doesn't match its dimensions, or the dimensions
 * differ.
 *
 * @example
 * ```ts
 * import { writeFile } from "node:fs/promises";
 * import { createDiffMap, decodeForScoring } from "web-image-optimiser";
 *
 * const original = await decodeForScoring("photo.png");
 * const candidate = await decodeForScoring("photo.webp");
 * await writeFile("diff.png", await createDiffMap(original, candidate));
 * ```
 */
async function createDiffMap(reference: MetricsImage, distorted: MetricsImage) {
  assertComparable(reference, distorted);

  const opaque = isOpaque(reference) && isOpaque(distorted);
  const onWhite = {
    reference: flatten(reference, WHITE),
    distorted: flatten(distorted, WHITE),
  };
  const onBlack = opaque
    ? onWhite
    : {
        reference: flatten(reference, BLACK),
        distorted: flatten(distorted, BLACK),
      };
  const map = Buffer.allocUnsafe(onWhite.reference.length);

  for (let offset = 0; offset < map.length; offset += 3) {
    const referenceLuma = luma(onWhite.reference, offset);
    let difference = Math.abs(referenceLuma - luma(onWhite.distorted, offset));

    if (!opaque) {
      const differenceOnBlack =
        luma(onBlack.reference, offset) - luma(onBlack.distorted, offset);
      difference = Math.max(difference, Math.abs(differenceOnBlack));
    }

    const heat = Math.min(1, (difference * AMPLIFICATION) / 255);
    const grey = referenceLuma * BACKGROUND_DIM * (1 - heat);

    map[offset] = Math.round(grey + 255 * heat); // heat runs red to yellow
    map[offset + 1] = Math.round(grey + 255 * heat * heat);
    map[offset + 2] = Math.round(grey);
  }

  const raw = {
    width: reference.width,
    height: reference.height,
    channels: 3,
  } as const;

  return sharp(map, { raw }).png().toBuffer();
}

export default createDiffMap;
