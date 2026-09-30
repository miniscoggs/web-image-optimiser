import { readFile } from "node:fs/promises";
import { SNIFF_BYTES, detectFormat } from "../inspect/detectFormat.js";
import ApiError from "./ApiError.js";

/**
 * Reads an image and its format, from its bytes.
 *
 * @param filePath - The image, a path a ref resolved to.
 * @param ref - Its ref, for the error.
 * @throws {@link ApiError} 404 when it isn't an image.
 */
async function readImage(filePath: string, ref: string) {
  const bytes = await readFile(filePath);
  const format = detectFormat(bytes.subarray(0, SNIFF_BYTES));

  if (format === undefined) {
    throw new ApiError(404, `Not an image: ${ref}`);
  }
  return { bytes, format };
}

export default readImage;
