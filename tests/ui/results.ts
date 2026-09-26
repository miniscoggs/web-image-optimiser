import type {
  PipelineFileResult,
  PipelineOutput,
} from "../../src/pipeline/types.js";

// finished files as the ui server streams them, with refs in place of paths

const INPUT_BYTES = 100_000;

/**
 * Returns an output of a file run in the server's temp folder.
 *
 * @param output - The output's role, format, method and size.
 */
function outputOf(
  output: Pick<PipelineOutput, "role" | "format" | "method" | "bytes"> &
    Partial<PipelineOutput>
): PipelineOutput {
  return {
    path: `session/runs/1/0/cat.${output.format}`,
    saving: 1 - output.bytes / INPUT_BYTES,
    score: 100,
    verdict: "visually-lossless",
    strippedMetadata: [],
    ...output,
  };
}

/**
 * Returns a suite run's result for a PNG with alpha: AVIF, WebP and a PNG fallback, in the
 * contract's order.
 */
function suiteResult(): PipelineFileResult {
  return {
    input: "root/photos/cat.png",
    status: "optimised",
    bytes: INPUT_BYTES,
    width: 64,
    height: 48,
    outputs: [
      outputOf({
        role: "avif",
        format: "avif",
        method: "lossy",
        quality: 52,
        bytes: 9_000,
        score: 81.4,
        verdict: "very-high",
      }),
      outputOf({
        role: "webp",
        format: "webp",
        method: "lossy",
        quality: 71,
        bytes: 12_400,
        score: 83.2,
        verdict: "very-high",
      }),
      outputOf({
        role: "fallback",
        format: "png",
        method: "lossless",
        bytes: 61_000,
      }),
    ],
    warnings: [],
  };
}

/**
 * Returns a `same` run's result for a JPEG whose metadata strip won.
 */
function sameResult(): PipelineFileResult {
  return {
    input: "root/photo.jpg",
    status: "optimised",
    bytes: INPUT_BYTES,
    width: 64,
    height: 48,
    outputs: [
      outputOf({
        role: "same",
        format: "jpeg",
        method: "strip",
        bytes: 97_500,
        path: "session/runs/1/0/photo.jpg",
      }),
    ],
    warnings: [],
  };
}

export { sameResult, suiteResult };
