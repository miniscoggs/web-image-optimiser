import type { CompareResult } from "../compare/index.js";
import type { MetricsVerdict } from "../metrics/index.js";
import { formatBytes, formatPercent, paint, verdictStyle } from "./format.js";

// the ssimulacra 2 readme's description of each band
const VERDICT_MEANINGS = {
  "visually-lossless": "not noticeable even in a flicker test at 1:1",
  excellent: "not noticeable in an in-place comparison",
  "very-high": "not noticeable side by side at 1:1",
  high: "barely noticeable side by side",
  noticeable: "slightly annoying artifacts",
  obvious: "obvious artifacts",
} as const satisfies Record<MetricsVerdict, string>;

/**
 * Renders a successful comparison for people: the score and what it means, the sizes, the
 * diff map's path, and any warnings.
 *
 * @param result - The comparison's result.
 * @param color - Whether to add colour.
 */
function renderCompare(result: CompareResult, color: boolean) {
  const lines = [];
  const { original, candidate, saving } = result;

  if (result.score !== undefined && result.verdict !== undefined) {
    const verdict = paint(result.verdict, verdictStyle(result.verdict), color);

    lines.push(
      `Score  ${result.score.toFixed(1)}, ${verdict}: ${VERDICT_MEANINGS[result.verdict]}`
    );
  }
  if (
    original.bytes !== undefined &&
    candidate.bytes !== undefined &&
    saving !== undefined
  ) {
    const change =
      saving < 0
        ? `${formatPercent(-saving)} larger`
        : `${formatPercent(saving)} smaller`;

    lines.push(
      `Size   ${formatBytes(original.bytes)} -> ${formatBytes(candidate.bytes)}, ${change}`
    );
  }
  if (result.diff !== undefined) {
    lines.push(`Diff   ${result.diff}`);
  }
  for (const warning of result.warnings) {
    lines.push(`${paint(warning.code, "yellow", color)} ${warning.message}`);
  }
  return lines.map((line) => `${line}\n`).join("");
}

export default renderCompare;
