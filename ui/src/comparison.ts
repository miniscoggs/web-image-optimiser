import FORMAT_NAMES from "../../src/inspect/formatNames.js";
import type {
  PipelineFileResult,
  PipelineOutput,
} from "../../src/pipeline/types.js";

/**
 * A finished file the viewer can compare: one with outputs, and its size known.
 */
type ComparisonFile = PipelineFileResult & { width: number; height: number };

const ROLE_ORDER: readonly PipelineOutput["role"][] = [
  "same",
  "avif",
  "webp",
  "fallback",
];

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
 * Returns a file's outputs in the order the viewer shows them: AVIF, WebP, then the fallback.
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
 * Returns the width a file's outputs were capped at, when a run made them narrower than the
 * original.
 *
 * @param file - The file.
 */
function cappedWidth(file: ComparisonFile) {
  const narrowest = Math.min(...file.outputs.map((output) => output.width));

  return narrowest < file.width ? narrowest : undefined;
}

export { ROLE_ORDER, canCompare, cappedWidth, comparedOutputs, outputTitle };
export type { ComparisonFile };
