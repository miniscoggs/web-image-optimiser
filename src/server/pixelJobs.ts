import sharp from "sharp";
import { avifLossy, jpegMozjpeg, webpLossy } from "../encode/index.js";
import { inspect } from "../inspect/index.js";
import readOrFail from "../inspect/readOrFail.js";
import {
  createDiffMap,
  decodeForScoring,
  isDownscaledForScoring,
  isScorable,
  score,
} from "../metrics/index.js";
import readInput from "../pipeline/readInput.js";
import writeOutputs from "../pipeline/writeOutputs.js";
import { OptimiserError } from "../schema/index.js";
import type { OptimiserErrorCode } from "../schema/index.js";
import type { PixelFormat } from "./api.js";
import fileVersion from "./fileVersion.js";

const ENCODERS = {
  webp: webpLossy,
  avif: avifLossy,
  jpeg: jpegMozjpeg,
} satisfies Record<PixelFormat, unknown>;

/**
 * Work on pixels, which blocks its thread while it scores: re-encoding a source at a quality
 * and scoring it, or drawing a diff map. Each writes its file to `output`.
 */
type PixelJob =
  | {
      type: "encode";
      source: string;
      format: PixelFormat;
      quality: number;
      output: string;
    }
  | { type: "diff"; original: string; candidate: string; output: string };

/**
 * How a {@link PixelJob} went. A failure has the optimiser's code when the image was the
 * problem.
 */
type PixelReply =
  | {
      type: "encoded";
      bytes: number;
      inputBytes: number;
      score: number;
      downscaled: boolean;
    }
  | { type: "diffed" }
  | { type: "failed"; code?: OptimiserErrorCode; message: string };

/**
 * A decoded raster image, with its file's size.
 */
type DecodedFile = {
  path: string;
  image: Awaited<ReturnType<typeof decodeForScoring>>;
  bytes: number;
};

/**
 * The original decoded last, and the version of its file.
 */
type DecodedOriginal = DecodedFile & { version: string };

let lastOriginal: DecodedOriginal | undefined; // a slider re-encodes the same source again and again

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
      "SVGs are only ever optimised as SVG, so they have no quality to choose or pixels to compare"
    );
  }

  const image = await readOrFail(() => decodeForScoring(file.bytes));

  return { path: filePath, image, bytes: file.bytes.length };
}

/**
 * Decodes the original of a job, reusing the last one decoded.
 *
 * @param filePath - The original.
 */
async function decodeOriginal(filePath: string) {
  const version = await fileVersion(filePath); // a write can replace the file

  if (lastOriginal?.path !== filePath || lastOriginal.version !== version) {
    lastOriginal = undefined; // frees the old pixels first, which can be hundreds of MB
    lastOriginal = { ...(await decodeFile(filePath)), version };
  }
  return lastOriginal;
}

/**
 * Re-encodes a source at a quality, scores it against the source, and writes it.
 *
 * @param job - The job.
 */
async function encodeJob(
  job: Extract<PixelJob, { type: "encode" }>
): Promise<PixelReply> {
  sharp.concurrency(1); // as in optimiseFile, so a quality gives the bytes a run would
  const source = await decodeOriginal(job.source);
  const encoded = await ENCODERS[job.format](source.image, job.quality);
  const decoded = await decodeForScoring(encoded.bytes);

  if (!isScorable(source.image) && !source.image.data.equals(decoded.data)) {
    throw new OptimiserError(
      "E_TOO_SMALL_TO_SCORE",
      "Images under 8x8 pixels can't be scored"
    );
  }

  const value = await score(source.image, decoded);

  await writeOutputs([{ path: job.output, bytes: encoded.bytes }], undefined);
  return {
    type: "encoded",
    bytes: encoded.bytes.length,
    inputBytes: source.bytes,
    score: value,
    downscaled: isDownscaledForScoring(source.image),
  };
}

/**
 * Draws a diff map of a candidate against its original, and writes it.
 *
 * @param job - The job.
 */
async function diffJob(
  job: Extract<PixelJob, { type: "diff" }>
): Promise<PixelReply> {
  const original = await decodeOriginal(job.original);
  const candidate = await decodeFile(job.candidate);
  const { width, height } = original.image;

  if (width !== candidate.image.width || height !== candidate.image.height) {
    throw new OptimiserError(
      "E_DIMENSIONS_MISMATCH",
      `The images are different sizes: ${width}x${height} and ${candidate.image.width}x${candidate.image.height}`
    );
  }

  const map = await createDiffMap(original.image, candidate.image);

  await writeOutputs([{ path: job.output, bytes: map }], undefined);
  return { type: "diffed" };
}

/**
 * Runs a {@link PixelJob}, on the UI server's worker thread or, from the TypeScript sources, on
 * the calling one.
 *
 * @param job - The job.
 * @returns How it went; it never rejects, so a reply can always cross a thread.
 */
async function runPixelJob(job: PixelJob): Promise<PixelReply> {
  try {
    return job.type === "encode" ? await encodeJob(job) : await diffJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return error instanceof OptimiserError
      ? { type: "failed", code: error.code, message }
      : { type: "failed", message };
  }
}

export { runPixelJob };
export type { PixelJob, PixelReply };
