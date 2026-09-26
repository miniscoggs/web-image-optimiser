import type { OptimiserErrorCode } from "./codes.js";

/**
 * An error about one input file, carrying a stable code from {@link OptimiserErrorCode}.
 *
 * The message is for people and may change between releases; branch on `code` instead.
 *
 * @example
 * ```ts
 * import { inspect, OptimiserError } from "web-image-optimiser";
 *
 * try {
 *   await inspect("notes.txt");
 * } catch (error) {
 *   if (error instanceof OptimiserError && error.code === "E_UNSUPPORTED_FORMAT") {
 *     console.log("Skipping a file that isn't an image");
 *   }
 * }
 * ```
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
