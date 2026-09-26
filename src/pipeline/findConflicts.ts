import { open } from "node:fs/promises";
import { detectFormat } from "../inspect/detectFormat.js";
import { comparablePath, outputClaims } from "./destination.js";
import type { PipelineMode } from "./types.js";

const SNIFF_BYTES = 16 * 1024; // any format's signature, and an svg's prolog up to its root

/**
 * Reads enough of a file to detect its format from its bytes.
 *
 * @param filePath - The file.
 * @returns The format, or `undefined` when it can't be read or isn't supported, which the file
 * reports when its turn comes.
 */
async function sniffFormat(filePath: string) {
  try {
    const handle = await open(filePath);

    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(SNIFF_BYTES),
        0,
        SNIFF_BYTES,
        0
      );

      return detectFormat(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Finds the inputs that can't run without clashing, each mapped to why: an output that could
 * land on another input, or on a path an earlier input's outputs could use. Formats come from
 * the files' bytes, so a misnamed file is caught too.
 *
 * @param inputs - The files, in order, each with the folder its outputs go to, if not its own.
 * @param mode - The mode.
 * @returns Each conflicting input's position, with the reason.
 */
async function findConflicts(
  inputs: { path: string; outDir?: string }[],
  mode: PipelineMode
) {
  const firstPositions = new Map<string, number>();
  const claims = new Map<string, string>();
  const conflicts = new Map<number, string>();

  for (const [index, input] of inputs.entries()) {
    const key = comparablePath(input.path);

    if (!firstPositions.has(key)) {
      firstPositions.set(key, index);
    }
  }
  for (const [index, input] of inputs.entries()) {
    const format = await sniffFormat(input.path); // one at a time, so a huge batch can't run out of file handles
    const paths =
      format === undefined
        ? []
        : outputClaims(input.path, format, input.outDir, mode);
    const ownKey = comparablePath(input.path);
    const firstIndex = firstPositions.get(ownKey) ?? index;
    let reason =
      firstIndex === index
        ? undefined
        : `It is the same file as an earlier input, ${inputs[firstIndex]?.path}`;

    for (const claim of paths) {
      const inputIndex = firstPositions.get(claim);
      const claimant = claims.get(claim);

      if (claimant !== undefined) {
        reason ??= `Its outputs would land on those of ${claimant}`;
      } else if (inputIndex !== undefined && claim !== ownKey) {
        reason ??= `One of its outputs would replace another input, ${inputs[inputIndex]?.path}`;
      }
    }
    if (reason === undefined) {
      for (const claim of paths) {
        claims.set(claim, input.path);
      }
    } else {
      conflicts.set(index, reason);
    }
  }
  return conflicts;
}

export default findConflicts;
