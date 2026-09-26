import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { OptimiserError } from "../schema/index.js";

/**
 * Writes files safely: each goes to a temp file in its destination folder, and only once every
 * one is written are they renamed into place. Temp files are removed whatever happens.
 *
 * @param files - The paths and bytes to write.
 * @param signal - Aborts the writes, before any rename.
 * @throws {@link OptimiserError} `E_WRITE` when a file can't be written; an abort rethrows the
 * signal's reason.
 */
async function writeOutputs(
  files: { path: string; bytes: Buffer }[],
  signal: AbortSignal | undefined
) {
  const staged: { temp: string; target: string }[] = [];

  try {
    for (const file of files) {
      const directory = path.dirname(file.path);
      const suffix = randomBytes(4).toString("hex");
      const temp = path.join(
        directory,
        `.${path.basename(file.path)}.wio-${suffix}.tmp`
      );

      await mkdir(directory, { recursive: true });
      staged.push({ temp, target: file.path });
      await writeFile(temp, file.bytes, { flag: "wx", signal });
    }
    signal?.throwIfAborted();
    for (const { temp, target } of staged) {
      await rename(temp, target);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);

    throw new OptimiserError(
      "E_WRITE",
      `An output could not be written: ${detail}`,
      { cause: error }
    );
  } finally {
    await Promise.all(staged.map(({ temp }) => rm(temp, { force: true })));
  }
}

export default writeOutputs;
