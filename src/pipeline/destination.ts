import type { BigIntStats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { InspectFormat } from "../inspect/index.js";
import type { PipelineSettings } from "./resolveSettings.js";
import type { PipelineMode } from "./types.js";

// the first is used when the input's own extension doesn't fit
const EXTENSIONS = {
  avif: [".avif"],
  jpeg: [".jpg", ".jpeg"],
  png: [".png"],
  svg: [".svg"],
  webp: [".webp"],
} as const satisfies Record<InspectFormat, readonly [string, ...string[]]>;

const IGNORES_CASE =
  process.platform === "win32" || process.platform === "darwin"; // their file systems usually do

/**
 * An input file, read, with its identity on disk.
 */
type InputFile = {
  path: string;
  bytes: Buffer;
  stats: BigIntStats;
};

/**
 * An output that can't be written: it is the input, or it exists and may not be replaced.
 */
type BlockedOutput = {
  reason: "input" | "exists";
  path: string;
};

/**
 * Returns where an output goes: the output folder, or the input's, with the input's name and
 * an extension for the format. The input's own extension is kept when it fits, eg `.jpeg`.
 *
 * @param input - The input path.
 * @param format - The output format.
 * @param outDir - The output folder, if any.
 */
function outputPath(
  input: string,
  format: InspectFormat,
  outDir: string | undefined
) {
  const { dir, name, ext } = path.parse(input);
  const extensions: readonly string[] = EXTENSIONS[format];
  const extension = extensions.includes(ext.toLowerCase())
    ? ext
    : EXTENSIONS[format][0];

  return path.join(outDir ?? dir, name + extension);
}

/**
 * Returns the format a path's extension names, whatever its case, or `undefined` for any other
 * extension.
 *
 * @param filePath - The path.
 */
function formatOfExtension(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const formats = Object.keys(EXTENSIONS) as InspectFormat[];

  return formats.find((format) =>
    (EXTENSIONS[format] as readonly string[]).includes(extension)
  );
}

/**
 * Returns a path in the form used to compare it: absolute, and lowercased where the file
 * system usually ignores case.
 *
 * @param filePath - The path.
 */
function comparablePath(filePath: string) {
  const resolved = path.resolve(filePath).normalize("NFC");

  return IGNORES_CASE ? resolved.toLowerCase() : resolved;
}

/**
 * Returns the formats whose outputs a mode always aims for, which are checked before any work
 * is done. The strip fallback and a suite's fallback are only checked once chosen.
 *
 * @param format - The input's format.
 * @param mode - The mode.
 */
function primaryFormats(
  format: InspectFormat,
  mode: PipelineMode
): InspectFormat[] {
  if (format === "svg" || mode === "same") {
    return [format];
  }
  return mode === "suite" ? ["avif", "webp"] : [mode];
}

/**
 * Returns every path an input's outputs could be written to in a mode, in the form
 * {@link comparablePath} gives: the requested formats, a suite's JPEG or PNG fallback, and the
 * strip fallback in the input's own format, each named as {@link outputPath} names it.
 *
 * @param input - The input path.
 * @param format - Its format, from its bytes.
 * @param outDir - The output folder, if any.
 * @param mode - The mode.
 */
function outputClaims(
  input: string,
  format: InspectFormat,
  outDir: string | undefined,
  mode: PipelineMode
) {
  const paths = claimedFormats(format, mode).map((each) =>
    comparablePath(outputPath(input, each, outDir))
  );

  return [...new Set(paths)];
}

/**
 * Returns every format an input's outputs could be written in: the requested ones, a suite's
 * fallbacks, and the input's own for the strip fallback. SVG always stays SVG.
 *
 * @param format - The input's format.
 * @param mode - The mode.
 */
function claimedFormats(
  format: InspectFormat,
  mode: PipelineMode
): InspectFormat[] {
  if (format === "svg" || mode === "same") {
    return [format];
  }
  return mode === "suite"
    ? ["avif", "webp", "jpeg", "png", format]
    : [mode, format];
}

/**
 * Returns whether an existing path is the input file, by its file ID, which sees through case,
 * links and `..`, or by its path where the file system reports no IDs.
 *
 * @param outputPath - The output path.
 * @param stats - The output path's stats.
 * @param input - The input.
 */
function isInput(outputPath: string, stats: BigIntStats, input: InputFile) {
  if (stats.ino !== 0n && input.stats.ino !== 0n) {
    return stats.dev === input.stats.dev && stats.ino === input.stats.ino;
  }
  return comparablePath(outputPath) === comparablePath(input.path);
}

/**
 * Checks where outputs go. An output may replace the input only with `inPlace`, and another
 * existing file only with `overwrite`, and the first that can't is returned. Otherwise every
 * output is returned for writing, except one that is the input, unchanged, at its own path.
 *
 * @param outputs - The outputs' paths, with their bytes once known.
 * @param input - The input.
 * @param settings - Whether the input, and other existing files, may be replaced.
 */
async function planWrites<Output extends { path: string; bytes?: Buffer }>(
  outputs: Output[],
  input: InputFile,
  settings: Pick<PipelineSettings, "inPlace" | "overwrite">
): Promise<{ blocked: BlockedOutput } | { writes: Output[] }> {
  const writes: Output[] = [];
  let existing: string | undefined;

  for (const output of outputs) {
    const stats = await stat(output.path, { bigint: true }).catch(
      () => undefined // missing, or unreadable, which the write then reports
    );

    if (stats !== undefined && isInput(output.path, stats, input)) {
      if (output.bytes?.equals(input.bytes)) {
        continue; // eg a suite's fallback that is the input as it was
      }
      if (!settings.inPlace) {
        return { blocked: { reason: "input", path: output.path } };
      }
    } else if (stats !== undefined && !settings.overwrite) {
      existing ??= output.path;
    }
    writes.push(output);
  }
  return existing === undefined
    ? { writes }
    : { blocked: { reason: "exists", path: existing } };
}

export {
  EXTENSIONS,
  IGNORES_CASE,
  comparablePath,
  formatOfExtension,
  outputClaims,
  outputPath,
  planWrites,
  primaryFormats,
};
export type { BlockedOutput, InputFile };
