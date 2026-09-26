import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import { inspect } from "../inspect/index.js";
import type { InspectFormat, InspectResult } from "../inspect/index.js";
import { verdictFor } from "../metrics/index.js";
import { OptimiserError } from "../schema/index.js";
import type { ChosenCandidate } from "./candidate.js";
import { outputPath, planWrites } from "./destination.js";
import type { BlockedOutput, InputFile } from "./destination.js";
import failedResult from "./failedResult.js";
import { createRasterSource } from "./rasterCandidates.js";
import { resolveSettings } from "./resolveSettings.js";
import type { PipelineSettings } from "./resolveSettings.js";
import selectRaster from "./selectRaster.js";
import selectSvg from "./selectSvg.js";
import type {
  PipelineFileResult,
  PipelineOptions,
  PipelineOutput,
  PipelineWarning,
} from "./types.js";
import writeOutputs from "./writeOutputs.js";

const NOTICEABLE_BELOW = 80; // under "very-high", the loss may show side by side

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

/**
 * Returns the formats whose outputs a mode always aims for, which are checked before any work
 * is done. The strip fallback and a suite's fallback are only checked once chosen.
 *
 * @param format - The input's format.
 * @param mode - The mode.
 */
function primaryFormats(
  format: InspectFormat,
  mode: PipelineSettings["to"]
): InspectFormat[] {
  if (format === "svg" || mode === "same") {
    return [format];
  }
  return mode === "suite" ? ["avif", "webp"] : [mode];
}

/**
 * Turns a blocked output into the file's result: a failure when it is the input, or a skip
 * when it already exists.
 *
 * @param blocked - The blocked output.
 * @param base - The result's input fields.
 * @throws {@link OptimiserError} `E_OUTPUT_IS_INPUT` when the output is the input.
 */
function blockedResult(
  blocked: BlockedOutput,
  base: Pick<PipelineFileResult, "input" | "bytes">
): PipelineFileResult {
  if (blocked.reason === "input") {
    throw new OptimiserError(
      "E_OUTPUT_IS_INPUT",
      `Writing ${blocked.path} would replace the input; allow in-place writes, or write to another folder`
    );
  }
  return {
    ...base,
    status: "skipped",
    outputs: [],
    warnings: [
      {
        code: "W_OUTPUT_EXISTS",
        message: `${blocked.path} already exists; allow overwriting to replace it`,
      },
    ],
  };
}

/**
 * Chooses an input's outputs for the mode.
 *
 * @param file - The input.
 * @param info - What `inspect` reported about it.
 * @param settings - The run's settings.
 * @param signal - Aborts the work.
 */
async function selectOutputs(
  file: InputFile,
  info: InspectResult,
  settings: PipelineSettings,
  signal: AbortSignal | undefined
): Promise<{ chosen: ChosenCandidate[]; warnings: PipelineWarning[] }> {
  if (info.format === "svg") {
    const candidate = await selectSvg(file.bytes, info.metadata, signal);
    const warnings: PipelineWarning[] =
      settings.to === "same"
        ? []
        : [
            {
              code: "W_SVG_SAME_ONLY",
              message: "SVGs are always optimised as SVG",
            },
          ];

    return {
      chosen: candidate === undefined ? [] : [{ ...candidate, role: "same" }],
      warnings,
    };
  }

  const rasterInfo = { ...info, format: info.format };
  const source = await createRasterSource(
    file.bytes,
    rasterInfo,
    settings.target,
    signal
  );

  return selectRaster(source, settings.to, file.bytes.length);
}

/**
 * Describes a chosen candidate as an output.
 *
 * @param candidate - The candidate.
 * @param path - Where it goes.
 * @param inputBytes - The input's size.
 */
function toOutput(
  candidate: ChosenCandidate,
  path: string,
  inputBytes: number
): PipelineOutput {
  return {
    role: candidate.role,
    path,
    format: candidate.format,
    method: candidate.method,
    ...(candidate.quality === undefined ? {} : { quality: candidate.quality }),
    bytes: candidate.bytes.length,
    ...(candidate.gzipBytes === undefined
      ? {}
      : { gzipBytes: candidate.gzipBytes }),
    saving: 1 - candidate.bytes.length / inputBytes,
    score: candidate.score,
    verdict: verdictFor(candidate.score),
    strippedMetadata: candidate.strippedMetadata,
  };
}

/**
 * Optimises a read input: checks where its outputs go, chooses them, and writes them.
 *
 * @param file - The input.
 * @param settings - The run's settings.
 * @param signal - Aborts the work.
 */
async function optimiseInput(
  file: InputFile,
  settings: PipelineSettings,
  signal: AbortSignal | undefined
): Promise<PipelineFileResult> {
  const info = await inspect(file.bytes);
  const base = { input: file.path, bytes: file.bytes.length };
  const pathFor = (format: InspectFormat) =>
    outputPath(file.path, format, settings.outDir);
  const primaryOutputs = primaryFormats(info.format, settings.to).map(
    (format) => ({ path: pathFor(format) })
  );
  const early = await planWrites(primaryOutputs, file, settings);

  if ("blocked" in early) {
    return blockedResult(early.blocked, base);
  }

  const { chosen, warnings } = await selectOutputs(
    file,
    info,
    settings,
    signal
  );
  const unchanged = chosen.every((candidate) =>
    candidate.bytes.equals(file.bytes)
  );
  const outputs = chosen.map((candidate) =>
    toOutput(candidate, pathFor(candidate.format), file.bytes.length)
  );

  for (const output of outputs.filter(
    (output) => output.score < NOTICEABLE_BELOW
  )) {
    warnings.push({
      code: "W_NOTICEABLE",
      message: `${output.path} scores ${output.score.toFixed(1)}, so the loss may be noticeable side by side`,
    });
  }
  if (
    info.icc === "non-srgb" &&
    (outputs.length === 0 ||
      outputs.some((output) => output.method === "strip"))
  ) {
    warnings.push({
      code: "W_ICC_KEPT",
      message:
        "The colour profile isn't sRGB, so it was kept: removing it would shift the colours",
    });
  }
  if (unchanged) {
    return { ...base, status: "kept-original", outputs: [], warnings };
  }

  const files = chosen.map((candidate) => ({
    path: pathFor(candidate.format),
    bytes: candidate.bytes,
  }));
  const planned = await planWrites(files, file, settings);

  if ("blocked" in planned) {
    return blockedResult(planned.blocked, base);
  }
  if (!settings.dryRun) {
    await writeOutputs(planned.writes, signal);
  }
  return { ...base, status: "optimised", outputs, warnings };
}

/**
 * Optimises one image file: strips its metadata and writes the smallest output that stays
 * above the quality target, in the format the mode asks for.
 *
 * The input's format comes from its bytes. Every candidate is scored with SSIMULACRA 2 against
 * the decoded input, and no output is ever larger than the input: when nothing in the requested
 * format is smaller, the input's metadata is stripped losslessly in its own format instead, and
 * only when there is nothing to strip is the input kept as it is. An output that would replace
 * the input needs `inPlace`, and one that would replace another existing file needs
 * `overwrite`. Every write goes to a temp file that is then renamed into place.
 *
 * Problems with the file itself come back as a `failed` result with an error code, never as a
 * rejection. Scoring takes about a second per megapixel per candidate, and a quality search
 * tries about eight.
 *
 * It sets sharp's thread count for the whole process to 1 (`sharp.concurrency(1)`). With more
 * threads, libaom splits an AVIF into tiles, which makes it larger at the same quality and
 * makes its bytes depend on the machine's CPU count. {@link optimiseBatch} runs files in
 * parallel on worker threads instead.
 *
 * @param input - The image file's path.
 * @param options - What to write, and where.
 * @param context - `signal` aborts the work, rejecting with the signal's reason and leaving no
 * temp files.
 * @returns What was written, or would be in a dry run, with any warnings.
 * @throws RangeError when an option is invalid.
 *
 * @example
 * ```ts
 * import { optimiseFile } from "web-image-optimiser";
 *
 * const result = await optimiseFile("photo.jpg", { to: "suite", outDir: "web" });
 * for (const output of result.outputs) {
 *   console.log(output.path, output.bytes, output.score, output.verdict);
 * }
 * ```
 */
async function optimiseFile(
  input: string,
  options: PipelineOptions = {},
  context: { signal?: AbortSignal } = {}
): Promise<PipelineFileResult> {
  const settings = resolveSettings(options);
  let file: InputFile | undefined;

  context.signal?.throwIfAborted();
  sharp.concurrency(1); // libaom tiles avifs across threads: up to 35% larger, and machine-dependent
  try {
    file = await readInput(input);
    return await optimiseInput(file, settings, context.signal);
  } catch (error) {
    if (!(error instanceof OptimiserError)) {
      throw error;
    }
    return failedResult(input, error.code, error.message, file?.bytes.length);
  }
}

export default optimiseFile;
