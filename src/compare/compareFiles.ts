import path from "node:path";
import { inspect } from "../inspect/index.js";
import readOrFail from "../inspect/readOrFail.js";
import {
  createDiffMap,
  decodeForScoring,
  isDownscaledForScoring,
  isScorable,
  score,
  verdictFor,
} from "../metrics/index.js";
import { planWrites } from "../pipeline/destination.js";
import type { InputFile } from "../pipeline/destination.js";
import type { PipelineWarning } from "../pipeline/index.js";
import readInput from "../pipeline/readInput.js";
import runTool from "../pipeline/runTool.js";
import writeOutputs from "../pipeline/writeOutputs.js";
import { OptimiserError, SCHEMA_VERSION } from "../schema/index.js";
import type { CompareImage, CompareOptions, CompareResult } from "./types.js";

/**
 * Runs work on one of the images, naming the file in any error's message, since there are two.
 *
 * @param filePath - The image's path.
 * @param work - The work.
 */
async function aboutFile<Result>(
  filePath: string,
  work: () => Promise<Result>
) {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof OptimiserError)) {
      throw error;
    }
    throw new OptimiserError(error.code, `${filePath}: ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Reads one of the images, recording its size, format and dimensions on `image` as each
 * becomes known, so a failed comparison still reports them.
 *
 * @param image - The image, with its path.
 * @throws {@link OptimiserError} when it can't be read or isn't a raster image.
 */
async function readImage(image: CompareImage) {
  return aboutFile(image.path, async () => {
    const file = await readInput(image.path);

    image.bytes = file.bytes.length;

    const info = await inspect(file.bytes);

    image.format = info.format;
    if (info.format === "svg") {
      throw new OptimiserError(
        "E_UNSUPPORTED_FORMAT",
        "SVGs can't be compared; compare takes PNG, JPEG, WebP or AVIF images"
      );
    }
    image.width = info.width;
    image.height = info.height;
    return file;
  });
}

/**
 * Checks whether the diff map may be written: never over either image, and over another file
 * only with `overwrite`.
 *
 * @param diff - The diff map's path.
 * @param files - Both images.
 * @param overwrite - Whether an existing file may be replaced.
 * @returns A warning when the file exists and may not be replaced.
 * @throws {@link OptimiserError} `E_OUTPUT_IS_INPUT` when it would replace an image.
 */
async function checkDiffPath(
  diff: string,
  files: InputFile[],
  overwrite: boolean
): Promise<PipelineWarning | undefined> {
  const reasons = [];

  for (const file of files) {
    const plan = await planWrites([{ path: diff }], file, {
      inPlace: false,
      overwrite,
    });

    reasons.push("blocked" in plan ? plan.blocked.reason : undefined);
  }
  if (reasons.includes("input")) {
    throw new OptimiserError(
      "E_OUTPUT_IS_INPUT",
      `Writing the diff map to ${diff} would replace one of the images`
    );
  }
  return reasons.includes("exists")
    ? {
        code: "W_OUTPUT_EXISTS",
        message: `${diff} already exists, so the diff map wasn't written; allow overwriting to replace it`,
      }
    : undefined;
}

/**
 * Compares the images in a result, recording what it learns about each on the result.
 *
 * @param result - The result, with both paths.
 * @param options - The diff map's path, and whether it may replace a file.
 * @param signal - Aborts the work.
 * @returns The score, verdict, saving, diff map path and warnings.
 */
async function compareImages(
  result: CompareResult,
  options: CompareOptions,
  signal: AbortSignal | undefined
): Promise<Partial<CompareResult>> {
  const { original, candidate } = result;
  const originalFile = await readImage(original);
  const candidateFile = await readImage(candidate);

  if (
    original.width !== candidate.width ||
    original.height !== candidate.height
  ) {
    throw new OptimiserError(
      "E_DIMENSIONS_MISMATCH",
      `The images are different sizes: ${original.width}x${original.height} and ${candidate.width}x${candidate.height}`
    );
  }

  const warnings: PipelineWarning[] = [];
  const blocked =
    options.diff === undefined
      ? undefined
      : await checkDiffPath(
          options.diff,
          [originalFile, candidateFile],
          options.overwrite ?? false
        );
  const reference = await aboutFile(original.path, () =>
    readOrFail(() => decodeForScoring(originalFile.bytes), signal)
  );
  const distorted = await aboutFile(candidate.path, () =>
    readOrFail(() => decodeForScoring(candidateFile.bytes), signal)
  );

  if (!isScorable(reference) && !reference.data.equals(distorted.data)) {
    throw new OptimiserError(
      "E_TOO_SMALL_TO_SCORE",
      "The images differ, and images under 8x8 pixels can't be scored"
    );
  }
  signal?.throwIfAborted();

  const value = await score(reference, distorted);

  if (isDownscaledForScoring(reference)) {
    warnings.push({
      code: "W_SCORED_DOWNSCALED",
      message:
        "The images are over 26 megapixels, so they were scored at 26 MP and the score is approximate",
    });
  }
  if (blocked !== undefined) {
    warnings.push(blocked);
  } else if (options.diff !== undefined) {
    const map = await createDiffMap(reference, distorted);

    await writeOutputs([{ path: options.diff, bytes: map }], signal);
  }

  return {
    score: value,
    verdict: verdictFor(value),
    saving: 1 - candidateFile.bytes.length / originalFile.bytes.length,
    ...(options.diff === undefined || blocked !== undefined
      ? {}
      : { diff: options.diff }),
    warnings,
  };
}

/**
 * Compares a candidate image with its original: its SSIMULACRA 2 score and verdict, and how
 * much smaller it is, with an optional heat map of where they differ.
 *
 * Both images must be PNG, JPEG, WebP or AVIF, the same size once EXIF orientation is applied,
 * and at least 8x8 unless identical. Images with transparency are scored on black and on white,
 * and the lower score wins; a pair over 26 megapixels is scored at 26 MP, with the warning
 * `W_SCORED_DOWNSCALED`. The diff map never replaces either image, and replaces another file
 * only with `overwrite`; otherwise it isn't written, with the warning `W_OUTPUT_EXISTS`.
 *
 * Problems with the files come back as an `error` with a code, never as a rejection.
 *
 * @param original - The original image's path.
 * @param candidate - The path of the image to score against it.
 * @param options - Where to write the diff map, and whether it may replace a file.
 * @param context - `signal` aborts the comparison.
 * @returns Both images, the score, verdict and saving, and any warnings or error.
 * @throws RangeError when the diff map's path doesn't end in `.png`.
 *
 * @example
 * ```ts
 * import { compareFiles } from "web-image-optimiser";
 *
 * const result = await compareFiles("photo.png", "photo.webp", { diff: "diff.png" });
 * console.log(result.score, result.verdict, result.saving);
 * ```
 */
async function compareFiles(
  original: string,
  candidate: string,
  options: CompareOptions = {},
  context: { signal?: AbortSignal } = {}
): Promise<CompareResult> {
  if (
    options.diff !== undefined &&
    path.extname(options.diff).toLowerCase() !== ".png"
  ) {
    throw new RangeError(
      `The diff map is a PNG, so its path must end in .png, got ${options.diff}`
    );
  }
  context.signal?.throwIfAborted();

  const result: CompareResult = {
    schemaVersion: SCHEMA_VERSION,
    tool: runTool(),
    original: { path: original },
    candidate: { path: candidate },
    warnings: [],
  };

  try {
    return {
      ...result,
      ...(await compareImages(result, options, context.signal)),
    };
  } catch (error) {
    if (!(error instanceof OptimiserError)) {
      throw error;
    }
    return { ...result, error: { code: error.code, message: error.message } };
  }
}

export default compareFiles;
