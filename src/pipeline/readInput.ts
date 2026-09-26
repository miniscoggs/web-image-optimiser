import { readFile, stat } from "node:fs/promises";
import { OptimiserError } from "../schema/index.js";
import type { InputFile } from "./destination.js";

/**
 * Reads an input file and its identity on disk.
 *
 * @param filePath - The input path.
 * @throws {@link OptimiserError} `E_READ` when it can't be read.
 */
async function readInput(filePath: string): Promise<InputFile> {
  try {
    const [bytes, stats] = await Promise.all([
      readFile(filePath),
      stat(filePath, { bigint: true }),
    ]);

    return { path: filePath, bytes, stats };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new OptimiserError(
      "E_READ",
      `The file could not be read: ${detail}`,
      { cause: error }
    );
  }
}

export default readInput;
