import { readFile } from "node:fs/promises";
import { SNIFF_BYTES, detectFormat } from "../inspect/detectFormat.js";
import {
  outputPath,
  planWrites,
  primaryFormats,
} from "../pipeline/destination.js";
import type { BlockedOutput } from "../pipeline/destination.js";
import type { PipelineFileResult, PipelineMode } from "../pipeline/index.js";
import readInput from "../pipeline/readInput.js";

const UPLOADS = "session/uploads/";
const NOT_REPLACING = { inPlace: false, overwrite: false }; // the command as copied, with neither flag

/**
 * Returns the output folder the page's copied `wio` command gives a file: none, so its outputs
 * go beside it, or the folder served for an upload, which the command names by file name alone,
 * as if it were there.
 *
 * @param ref - The file's ref.
 * @param root - The folder served.
 */
function cliOutDir(ref: string, root: string) {
  return ref.startsWith(UPLOADS) ? root : undefined;
}

/**
 * Replays, for a file a run finished, the checks `optimiseFile` makes where the copied command
 * writes: the mode's primary outputs before any work, which is why a kept-original file in
 * `same` mode is caught, then the outputs chosen, with their bytes.
 *
 * @param file - The file's result, with its real paths.
 * @param ref - The input's ref.
 * @param root - The folder served.
 * @param mode - The run's mode.
 * @returns The first output that would fail or skip the file, or `undefined` when the command
 * would write it as the run did.
 */
async function findCliBlock(
  file: PipelineFileResult,
  ref: string,
  root: string,
  mode: PipelineMode
): Promise<BlockedOutput | undefined> {
  const input = await readInput(file.input);
  const format = detectFormat(input.bytes.subarray(0, SNIFF_BYTES));

  if (format === undefined) {
    return undefined; // it ran, so this is a file replaced since
  }

  const outDir = cliOutDir(ref, root);
  const primary = primaryFormats(format, mode).map((each) => ({
    path: outputPath(input.path, each, outDir),
  }));
  const early = await planWrites(primary, input, NOT_REPLACING);

  if ("blocked" in early) {
    return early.blocked;
  }

  const chosen = await Promise.all(
    file.outputs.map(async (output) => ({
      path: outputPath(input.path, output.format, outDir),
      bytes: await readFile(output.path),
    }))
  );
  const planned = await planWrites(chosen, input, NOT_REPLACING);

  return "blocked" in planned ? planned.blocked : undefined;
}

export { cliOutDir, findCliBlock };
