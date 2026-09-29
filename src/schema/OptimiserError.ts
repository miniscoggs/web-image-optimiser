import type { OptimiserErrorCode } from "./codes.js";

/**
 * An error about one input file, carrying a stable code from {@link OptimiserErrorCode}.
 *
 * The message is for people and may change between releases; branch on `code` instead.
 */
class OptimiserError extends Error {
  override name = "OptimiserError";
  readonly code: OptimiserErrorCode;

  /**
   * Creates an error with a stable code.
   *
   * @param code - The machine-readable code.
   * @param message - A plain-language description.
   * @param options - Standard error options, such as the underlying `cause`.
   */
  constructor(
    code: OptimiserErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.code = code;
  }
}

export default OptimiserError;
