import QUALITY_RANGES from "../../src/encode/qualityRanges.js";
import type {
  PipelineFileResult,
  PipelineOutput,
} from "../../src/pipeline/types.js";
import type { ServerEncodeResponse } from "../../src/server/api.js";

/**
 * A finished file the viewer can compare: one with outputs, and its size known.
 */
type ComparisonFile = PipelineFileResult & { width: number; height: number };

const ROLE_ORDER: readonly PipelineOutput["role"][] = [
  "same",
  "webp",
  "avif",
  "fallback",
];

const FORMAT_NAMES = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
  avif: "AVIF",
  svg: "SVG",
} as const satisfies Record<PipelineOutput["format"], string>;

/**
 * Returns whether a file's result can be compared: it has outputs, and its size is known.
 *
 * @param file - The file's result.
 */
function canCompare(file: PipelineFileResult): file is ComparisonFile {
  return (
    file.outputs.length > 0 &&
    file.width !== undefined &&
    file.height !== undefined
  );
}

/**
 * Returns a file's outputs in the order the viewer shows them: WebP, AVIF, then the fallback.
 *
 * @param file - The file.
 */
function comparedOutputs(file: ComparisonFile) {
  return file.outputs.toSorted(
    (first, second) =>
      ROLE_ORDER.indexOf(first.role) - ROLE_ORDER.indexOf(second.role)
  );
}

/**
 * Names an output by its format, and as the fallback when it is one.
 *
 * @param output - The output.
 */
function outputTitle(output: Pick<PipelineOutput, "role" | "format">) {
  const name = FORMAT_NAMES[output.format];

  return output.role === "fallback" ? `${name} fallback` : name;
}

/**
 * Returns what an output pane's quality slider re-encodes in, the qualities it offers, which are
 * those the engine searches, and where it starts: the output's quality when it is lossy, else
 * the top of the range. A lossless format has no slider.
 *
 * @param output - The run's output.
 */
function qualitySliderOf(output: PipelineOutput) {
  const { format } = output;

  if (format === "png" || format === "svg") {
    return undefined;
  }

  const range = QUALITY_RANGES[format];
  const start =
    output.method === "lossy" && output.quality !== undefined
      ? output.quality
      : range[1];

  return { format, range, start };
}

/**
 * Returns what an output pane shows: the run's output, or its latest re-encode at another
 * quality, described as an output.
 *
 * @param output - The run's output.
 * @param encoded - The re-encode, if any.
 */
function currentOutput(
  output: PipelineOutput,
  encoded: ServerEncodeResponse | undefined
): PipelineOutput {
  return encoded === undefined
    ? output
    : {
        ...output,
        path: encoded.ref,
        method: "lossy",
        quality: encoded.quality,
        bytes: encoded.bytes,
        saving: encoded.saving,
        score: encoded.score,
        verdict: encoded.verdict,
      };
}

export {
  canCompare,
  comparedOutputs,
  currentOutput,
  outputTitle,
  qualitySliderOf,
};
export type { ComparisonFile };
