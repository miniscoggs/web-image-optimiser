import type { OptimiserErrorCode } from "../schema/index.js";
import type { PipelineFileResult } from "./types.js";

/**
 * Builds the result of a file that failed.
 *
 * @param input - The input path, as given.
 * @param code - The error code.
 * @param message - A plain-language description.
 * @param bytes - The input's size, when it was read.
 */
function failedResult(
  input: string,
  code: OptimiserErrorCode,
  message: string,
  bytes?: number
): PipelineFileResult {
  return {
    input,
    status: "failed",
    ...(bytes === undefined ? {} : { bytes }),
    outputs: [],
    warnings: [],
    error: { code, message },
  };
}

export default failedResult;
