import type { MetricsImage } from "./types.js";

/**
 * Throws a `RangeError` unless both images hold `width * height` RGBA pixels and share their
 * dimensions.
 *
 * @param reference - The original image.
 * @param distorted - The image compared against it.
 */
function assertComparable(reference: MetricsImage, distorted: MetricsImage) {
  for (const image of [reference, distorted]) {
    const expected = image.width * image.height * 4;

    if (image.data.length !== expected) {
      throw new RangeError(
        `Expected ${image.width}x${image.height} RGBA pixels (${expected} bytes), got ${image.data.length} bytes`
      );
    }
  }
  if (
    reference.width !== distorted.width ||
    reference.height !== distorted.height
  ) {
    throw new RangeError(
      `Images must be the same size: the reference is ${reference.width}x${reference.height} and the distorted image is ${distorted.width}x${distorted.height}`
    );
  }
}

export default assertComparable;
