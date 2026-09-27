import type { PipelineWarning } from "./types.js";

/**
 * The warning for an image scored at a smaller size, which slightly overstates its quality.
 */
const DOWNSCALED_WARNING: PipelineWarning = {
  code: "W_SCORED_DOWNSCALED",
  message:
    "The image is over 26 megapixels, so it was scored at 26 MP and its score is approximate",
};

export default DOWNSCALED_WARNING;
