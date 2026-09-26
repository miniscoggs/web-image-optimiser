import type { MetricsVerdict } from "../metrics/types.js";
import type {
  PipelineFileStatus,
  PipelineOutput,
  PipelineRunResult,
} from "../pipeline/types.js";

// shared with the ui's browser bundle, so it imports only types

const UNITS = ["kB", "MB", "GB"];

const STATUS_LABELS = {
  optimised: "optimised",
  "kept-original": "kept original",
  skipped: "skipped",
  failed: "failed",
} as const satisfies Record<PipelineFileStatus, string>;

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
 * Formats a size in bytes with three significant figures, in kB and MB of 1000 as browsers
 * show them.
 *
 * @param bytes - The size.
 */
function formatBytes(bytes: number) {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  let value = bytes / 1000;
  let unit = 0;

  while (value >= 999.5 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toPrecision(3)} ${UNITS[unit]}`;
}

/**
 * Formats a fraction as a percentage with one decimal place.
 *
 * @param fraction - The fraction, eg 0.742.
 */
function formatPercent(fraction: number) {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Describes how an output was made: its quality for a lossy encode, otherwise its method.
 *
 * @param output - The output.
 */
function formatQuality(output: Pick<PipelineOutput, "method" | "quality">) {
  if (output.quality === undefined) {
    return output.method;
  }
  return output.method === "lossy"
    ? `q${output.quality}`
    : `${output.method} ${output.quality}`;
}

/**
 * Rates a verdict: `good` where the loss isn't noticeable side by side, `fair` where it barely
 * is, and `bad` below.
 *
 * @param verdict - The verdict.
 */
function verdictRating(verdict: MetricsVerdict) {
  if (verdict === "high") {
    return "fair";
  }
  return verdict === "noticeable" || verdict === "obvious" ? "bad" : "good";
}

/**
 * Summarises a run's totals: how many files ended each way, and the bytes saved.
 *
 * @param totals - The run's totals.
 */
function formatTotals(totals: PipelineRunResult["totals"]) {
  const counts = [
    [totals.optimised, "optimised"],
    [totals.keptOriginal, "kept original"],
    [totals.skipped, "skipped"],
    [totals.failed, "failed"],
  ] as const;
  const parts = counts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  const files = `${totals.files} ${totals.files === 1 ? "file" : "files"}`;
  const saved =
    totals.inputBytes === 0
      ? ""
      : ` ${formatBytes(totals.inputBytes)} -> ${formatBytes(totals.outputBytes)}, ${formatPercent(totals.saving)} smaller.`;

  return `${files}: ${parts.join(", ")}.${saved}`;
}

export {
  STATUS_LABELS,
  VERDICT_MEANINGS,
  formatBytes,
  formatPercent,
  formatQuality,
  formatTotals,
  verdictRating,
};
