import type { MetricsImage } from "./types.js";

const BLACK = 0;
const WHITE = 255;

const opaqueByPixels = new WeakMap<Buffer, boolean>(); // decoded pixels are never changed, and each encode and score asks again

/**
 * Returns whether every pixel of an image is fully opaque.
 *
 * @param image - The image to check.
 */
function isOpaque(image: MetricsImage) {
  const { data } = image;
  let opaque = opaqueByPixels.get(data);

  if (opaque === undefined) {
    opaque = true;
    for (let alpha = 3; alpha < data.length && opaque; alpha += 4) {
      opaque = data[alpha] === 255;
    }
    opaqueByPixels.set(data, opaque);
  }
  return opaque;
}

/**
 * Composites RGBA pixels onto a solid grey level and returns the RGB result, blending the
 * sRGB-encoded values as browsers do.
 *
 * @param image - The image to composite.
 * @param background - The background grey level, {@link BLACK} to {@link WHITE}.
 */
function flatten(image: MetricsImage, background: number) {
  const { data } = image;
  const rgb = Buffer.allocUnsafe((data.length / 4) * 3);

  for (let source = 0, target = 0; source < data.length; source += 4) {
    const alpha = data[source + 3] ?? 0;
    const behind = background * (255 - alpha);

    for (let channel = 0; channel < 3; channel++, target++) {
      const value = data[source + channel] ?? 0;
      rgb[target] = Math.round((value * alpha + behind) / 255);
    }
  }
  return rgb;
}

export { BLACK, WHITE, flatten, isOpaque };
