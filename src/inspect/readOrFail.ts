import { OptimiserError } from "../schema/index.js";

/**
 * Runs a read of an image, turning any failure into an `E_DECODE` error.
 *
 * @param read - The read to run.
 * @param signal - When it has aborted, the read's rejection passes through unchanged.
 * @throws {@link OptimiserError} `E_DECODE` with the first line of the underlying message.
 */
async function readOrFail<Result>(
  read: () => Result | Promise<Result>,
  signal?: AbortSignal
) {
  try {
    return await read();
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);
    const [summary = detail] = detail.split("\n"); // libvips repeats decoder warnings on later lines

    throw new OptimiserError(
      "E_DECODE",
      `The image could not be decoded: ${summary}`,
      { cause: error }
    );
  }
}

export default readOrFail;
