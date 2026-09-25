import type { MetricsVerdict } from "./types.js";

// lowest score per verdict, highest first, from the ssimulacra 2 readme
const VERDICT_BANDS: readonly (readonly [number, MetricsVerdict])[] = [
  [90, "visually-lossless"],
  [85, "excellent"],
  [80, "very-high"],
  [70, "high"],
  [50, "noticeable"],
];

/**
 * Returns the plain-language verdict for an SSIMULACRA 2 score.
 *
 * Each band includes its lower edge, so 90 is `visually-lossless` and 89.99 is `excellent`.
 * Scores below 50 are `obvious`.
 *
 * @param score - An SSIMULACRA 2 score, 100 or lower.
 * @returns The verdict for the band the score falls in.
 *
 * @example
 * ```ts
 * import { verdictFor } from "web-image-optimiser";
 *
 * verdictFor(90); // "visually-lossless"
 * verdictFor(72.5); // "high"
 * ```
 */
function verdictFor(score: number): MetricsVerdict {
  const band = VERDICT_BANDS.find(([lowest]) => score >= lowest);

  return band?.[1] ?? "obvious";
}

export default verdictFor;
