import sharp from "sharp";
import { isOpaque } from "../metrics/composite.js";
import type { MetricsImage } from "../metrics/index.js";

/**
 * Creates a sharp pipeline from decoded pixels, dropping the alpha channel when every pixel is
 * opaque so encoders don't store one.
 *
 * @param source - The decoded image, from `decodeForScoring`.
 */
function createPipeline(source: MetricsImage) {
  const raw = {
    width: source.width,
    height: source.height,
    channels: 4,
  } as const;
  const pipeline = sharp(source.data, { raw });

  return isOpaque(source) ? pipeline.removeAlpha() : pipeline;
}

export default createPipeline;
