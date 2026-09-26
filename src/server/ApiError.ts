import type { OptimiserErrorCode } from "../schema/index.js";

/**
 * An API request that fails with an HTTP status, which the app sends as `{ error, code }`.
 */
class ApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 415 | 422 | 500;
  readonly code: OptimiserErrorCode | undefined;

  /**
   * Creates the error.
   *
   * @param status - The HTTP status.
   * @param message - What went wrong, for people.
   * @param code - The optimiser's error code, when the image was the problem.
   */
  constructor(
    status: ApiError["status"],
    message: string,
    code?: OptimiserErrorCode
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export default ApiError;
