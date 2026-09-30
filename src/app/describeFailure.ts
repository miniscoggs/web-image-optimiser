import { OptimiserError } from "../schema/index.js";
import ApiError from "./ApiError.js";
import type { AppApiError } from "./api.js";

/**
 * Describes a failure as the API's error body, with its status: an {@link ApiError}'s own,
 * 422 with the code for an {@link OptimiserError}, and 500 for anything else.
 *
 * @param error - What was thrown.
 */
function describeFailure(error: unknown): {
  status: number;
  body: AppApiError;
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        ...(error.code === undefined ? {} : { code: error.code }),
      },
    };
  }
  if (error instanceof OptimiserError) {
    return { status: 422, body: { error: error.message, code: error.code } };
  }

  const message = error instanceof Error ? error.message : String(error);

  return { status: 500, body: { error: message } };
}

export default describeFailure;
