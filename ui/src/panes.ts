import type { PixelFormat } from "../../src/app/api.js";
import { PIPELINE_TARGET_PRESETS } from "../../src/pipeline/resolveSettings.js";
import keptBySuiteChain from "../../src/pipeline/suiteChain.js";
import type { PipelineOutput } from "../../src/pipeline/types.js";
import { ROLE_ORDER, comparedOutputs, outputTitle } from "./comparison.js";
import type { ComparisonFile } from "./comparison.js";
import type { RunSettings } from "./api.js";
import type { TargetSearch } from "./useTargetSearches.js";

/**
 * One output pane of a comparison: what it shows now, and whether the suite keeps it.
 */
type ViewPane = {
  role: PipelineOutput["role"];
  title: string;
  output?: PipelineOutput; // none for a format the suite left out, until a slider finds one
  format?: PixelFormat; // set when the pane has a target slider
  search?: TargetSearch;
  reached: boolean;
  kept: boolean;
  note?: string; // why the suite leaves it out
};

const CHAIN_ROLES = ["fallback", "webp", "avif"] as const; // the order the chain rule keeps them in

/**
 * Returns a pane's output as its search found it, or the run's output when there is no search.
 *
 * @param file - The file.
 * @param role - The pane's role.
 * @param base - The run's output, when the suite kept one.
 * @param search - The pane's slider.
 */
function currentOutput(
  file: ComparisonFile,
  role: PipelineOutput["role"],
  base: PipelineOutput | undefined,
  search: TargetSearch | undefined
): PipelineOutput | undefined {
  const response = search?.found?.response;

  if (response === undefined) {
    return base;
  }

  return {
    width: file.width,
    height: file.height,
    strippedMetadata: [],
    ...base,
    role,
    path: response.ref,
    format: response.format,
    method: response.method,
    quality: response.quality,
    bytes: response.bytes,
    saving: response.saving,
    score: response.score,
    verdict: response.verdict,
  };
}

/**
 * Returns a file's output panes in the order the viewer shows them. A raster suite always has an
 * AVIF, a WebP and a fallback pane, empty when the suite has none of the format, and each pane
 * says whether the suite keeps what it shows now, which is what Save suite saves. An empty AVIF
 * or WebP pane has a slider to find one; an empty fallback pane has none, since only the run
 * chooses between JPEG and PNG.
 *
 * @param file - The file.
 * @param searchOf - Returns a role's target slider.
 */
function panesOf(
  file: ComparisonFile,
  searchOf: (role: PipelineOutput["role"]) => TargetSearch | undefined
) {
  const runOutputs = comparedOutputs(file);
  const isSuite = !runOutputs.some(({ role }) => role === "same"); // the app runs a raster image as a suite, an svg as itself
  const roles = isSuite
    ? (["avif", "webp", "fallback"] as const)
    : runOutputs.map(({ role }) => role);
  const panes = roles.map((role): ViewPane => {
    const base = runOutputs.find((output) => output.role === role);
    const search = searchOf(role);
    const output = currentOutput(file, role, base, search);
    const format =
      output?.format ?? (role === "avif" || role === "webp" ? role : undefined);
    const searchable =
      role !== "same" && format !== undefined && format !== "svg";

    return {
      role,
      title: format === undefined ? "Fallback" : outputTitle({ role, format }),
      output,
      ...(searchable ? { format } : {}),
      search,
      reached: search?.found?.response.reached ?? true,
      kept: output !== undefined && output.saving >= 0,
    };
  });

  if (!isSuite) {
    return panes;
  }

  const sizes = CHAIN_ROLES.map((role) => {
    const { output } = panes.find((pane) => pane.role === role) ?? {};

    return output !== undefined && output.saving >= 0
      ? output.bytes
      : undefined;
  });
  const keptRoles = keptBySuiteChain(sizes);
  let lastKept: string | undefined;

  for (const [index, role] of CHAIN_ROLES.entries()) {
    const pane = panes.find((candidate) => candidate.role === role);

    if (pane === undefined) {
      continue;
    }
    pane.kept = keptRoles[index] === true;
    if (pane.kept) {
      lastKept = pane.title;
    } else if (pane.output === undefined || pane.output.saving >= 0) {
      pane.note =
        lastKept === undefined
          ? "Not in the suite"
          : `Not in the suite: no smaller than the ${lastKept}`;
    }
  }
  return panes;
}

/**
 * Returns the target a run was made at, which its sliders start at.
 *
 * @param settings - The run's settings.
 */
function runTarget(settings: RunSettings) {
  const { target } = settings;

  return typeof target === "number" ? target : PIPELINE_TARGET_PRESETS[target];
}

/**
 * Returns the refs of the outputs the suite keeps, for Save suite.
 *
 * @param panes - The file's panes.
 */
function keptRefs(panes: ViewPane[]) {
  return panes.flatMap(({ kept, output }) =>
    kept && output !== undefined ? [output.path] : []
  );
}

/**
 * Returns the key of a pane's slider and save state, across every opened image.
 *
 * @param original - The original's ref.
 * @param role - The pane's role.
 */
function paneKey(original: string, role: PipelineOutput["role"]) {
  return `${original} ${role}`;
}

/**
 * Returns the keys of every pane an image can have.
 *
 * @param original - The original's ref.
 */
function paneKeysOf(original: string) {
  return ROLE_ORDER.map((role) => paneKey(original, role));
}

export { keptRefs, paneKey, paneKeysOf, panesOf, runTarget };
export type { ViewPane };
