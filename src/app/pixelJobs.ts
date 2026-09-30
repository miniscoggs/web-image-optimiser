import sharp from "sharp";
import { inspect } from "../inspect/index.js";
import readOrFail from "../inspect/readOrFail.js";
import { createDiffMap, decodeForScoring } from "../metrics/index.js";
import type {
  PipelineOutputMethod,
  PipelineWarning,
} from "../pipeline/index.js";
import {
  createRasterSource,
  fitToWidth,
} from "../pipeline/rasterCandidates.js";
import readInput from "../pipeline/readInput.js";
import type { PipelineSettings } from "../pipeline/resolveSettings.js";
import { selectFormat } from "../pipeline/selectRaster.js";
import writeOutputs from "../pipeline/writeOutputs.js";
import { OptimiserError } from "../schema/index.js";
import type { OptimiserErrorCode } from "../schema/index.js";
import type { PixelFormat } from "./api.js";
import fileVersion from "./fileVersion.js";

/**
 * The settings a search takes, as a run's.
 */
type PixelSearchSettings = Pick<
  PipelineSettings,
  "target" | "maxWidth" | "stripAll" | "rights"
>;

/**
 * Work on pixels, which blocks its thread while it scores: searching a format for a source's
 * smallest output that reaches a target, or drawing a diff map. Each writes its file to
 * `output`.
 */
type PixelJob =
  | {
      type: "search";
      source: string;
      format: PixelFormat;
      settings: PixelSearchSettings;
      output: string;
    }
  | {
      type: "diff";
      original: string;
      candidate: string;
      maxWidth: number | undefined;
      output: string;
    };

/**
 * How a {@link PixelJob} went. A failure has the optimiser's code when the image was the
 * problem.
 */
type PixelReply =
  | {
      type: "searched";
      method: PipelineOutputMethod;
      quality: number | undefined;
      bytes: number;
      inputBytes: number;
      score: number;
      warnings: PipelineWarning[];
    }
  | { type: "diffed" }
  | { type: "failed"; code?: OptimiserErrorCode; message: string };

/**
 * A decoded raster image.
 */
type DecodedFile = {
  path: string;
  image: Awaited<ReturnType<typeof decodeForScoring>>;
};

/**
 * The original decoded last, and the version of its file.
 */
type DecodedOriginal = DecodedFile & { version: string };

let lastOriginal: DecodedOriginal | undefined; // an overlay diffs the same original again and again

/**
 * Reads and decodes a raster image for scoring.
 *
 * @param filePath - The image.
 * @throws {@link OptimiserError} when it can't be read or decoded, or is an SVG.
 */
async function decodeFile(filePath: string): Promise<DecodedFile> {
  const file = await readInput(filePath);
  const info = await inspect(file.bytes);

  if (info.format === "svg") {
    throw new OptimiserError(
      "E_UNSUPPORTED_FORMAT",
      "SVGs are only ever optimised as SVG, so they have no pixels to compare"
    );
  }
  return {
    path: filePath,
    image: await readOrFail(() => decodeForScoring(file.bytes)),
  };
}

/**
 * Decodes the original of a job, reusing the last one decoded.
 *
 * @param filePath - The original.
 */
async function decodeOriginal(filePath: string) {
  const version = await fileVersion(filePath); // a save can replace the file

  if (lastOriginal?.path !== filePath || lastOriginal.version !== version) {
    lastOriginal = undefined; // frees the old pixels first, which can be hundreds of MB
    lastOriginal = { ...(await decodeFile(filePath)), version };
  }
  return lastOriginal;
}

/**
 * Searches a format for the output a suite would choose, apart from the chain rule, carrying
 * the rights a run's would, and writes it.
 *
 * @param job - The job.
 */
async function searchJob(
  job: Extract<PixelJob, { type: "search" }>
): Promise<PixelReply> {
  sharp.concurrency(1); // as in optimiseFile, so a search finds what a run would
  const file = await readInput(job.source);
  const info = await inspect(file.bytes);

  if (info.format === "svg") {
    throw new OptimiserError(
      "E_UNSUPPORTED_FORMAT",
      "SVGs are only ever optimised as SVG, so they have no target to search for"
    );
  }

  const source = await createRasterSource(
    file.bytes,
    { ...info, format: info.format },
    job.settings,
    undefined
  );
  const { chosen, warnings } = await selectFormat(
    source,
    job.format,
    file.bytes.length
  );

  await writeOutputs([{ path: job.output, bytes: chosen.bytes }], undefined);
  return {
    type: "searched",
    method: chosen.method,
    quality: chosen.quality,
    bytes: chosen.bytes.length,
    inputBytes: file.bytes.length,
    score: chosen.score,
    warnings,
  };
}

/**
 * Draws a diff map of a candidate against its original, shrunk as a run shrinks it to the
 * maximum width, and writes it.
 *
 * @param job - The job.
 */
async function diffJob(
  job: Extract<PixelJob, { type: "diff" }>
): Promise<PixelReply> {
  const original = await decodeOriginal(job.original);
  const reference = await fitToWidth(original.image, job.maxWidth);
  const candidate = await decodeFile(job.candidate);
  const { width, height } = reference;

  if (width !== candidate.image.width || height !== candidate.image.height) {
    throw new OptimiserError(
      "E_DIMENSIONS_MISMATCH",
      `The images are different sizes: ${width}x${height} and ${candidate.image.width}x${candidate.image.height}`
    );
  }

  const map = await createDiffMap(reference, candidate.image);

  await writeOutputs([{ path: job.output, bytes: map }], undefined);
  return { type: "diffed" };
}

/**
 * Runs a {@link PixelJob}, in the app API's pixel process or, from the TypeScript sources, on
 * the calling thread.
 *
 * @param job - The job.
 * @returns How it went; it never rejects, so a reply can always reach the API.
 */
async function runPixelJob(job: PixelJob): Promise<PixelReply> {
  try {
    return job.type === "search" ? await searchJob(job) : await diffJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return error instanceof OptimiserError
      ? { type: "failed", code: error.code, message }
      : { type: "failed", message };
  }
}

export { runPixelJob };
export type { PixelJob, PixelReply };
