import { PIPELINE_MODES } from "./types.js";
import type { PipelineOptions, PipelineTargetPreset } from "./types.js";

/**
 * The score each {@link PipelineTargetPreset} stands for, from the SSIMULACRA 2 README's bands.
 *
 * @example
 * ```ts
 * import { PIPELINE_TARGET_PRESETS } from "../pipeline/index.js";
 *
 * PIPELINE_TARGET_PRESETS.excellent; // 85
 * ```
 */
const PIPELINE_TARGET_PRESETS = {
  "visually-lossless": 90,
  excellent: 85,
  high: 80,
  web: 70,
} as const satisfies Record<PipelineTargetPreset, number>;

type PipelineSettings = Required<Omit<PipelineOptions, "outDir" | "target">> &
  Pick<PipelineOptions, "outDir"> & { target: number };

/**
 * Fills in the defaults and turns a target preset into its score.
 *
 * @param options - The caller's options.
 * @throws RangeError when the mode or target isn't valid.
 */
function resolveSettings(options: PipelineOptions): PipelineSettings {
  const { to = "webp", target = "high" } = options;
  const score =
    typeof target === "number" ? target : PIPELINE_TARGET_PRESETS[target];

  if (!PIPELINE_MODES.includes(to)) {
    throw new RangeError(`Unknown mode "${String(to)}"`);
  }
  if (!(score >= 0 && score <= 100)) {
    throw new RangeError(
      `Expected a target preset or a score from 0 to 100, got ${String(target)}`
    );
  }

  return {
    to,
    target: score,
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
    inPlace: options.inPlace ?? false,
    overwrite: options.overwrite ?? false,
    dryRun: options.dryRun ?? false,
  };
}

export { PIPELINE_TARGET_PRESETS, resolveSettings };
export type { PipelineSettings };
