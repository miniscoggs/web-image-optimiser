import { resolveSettings } from "../pipeline/resolveSettings.js";
import type { PipelineOptions } from "../pipeline/types.js";
import ApiError from "./ApiError.js";

/**
 * Checks a request's options as a run would, filling in the defaults and trimming the rights
 * fields.
 *
 * @param options - The options.
 * @throws {@link ApiError} 400 when one isn't valid, such as an empty rights field, or `stripAll`
 * with rights fields.
 */
function resolveOptions(options: PipelineOptions) {
  try {
    return resolveSettings(options);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ApiError(400, `The request isn't valid: ${error.message}`);
    }
    throw error;
  }
}

export default resolveOptions;
