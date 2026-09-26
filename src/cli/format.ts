import { styleText } from "node:util";
import type { MetricsVerdict } from "../metrics/index.js";

/**
 * A colour or modifier for {@link paint}.
 */
type TextStyle = Parameters<typeof styleText>[0];

const UNITS = ["kB", "MB", "GB"];

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
 * Returns the style for a verdict: green where the loss isn't noticeable side by side, yellow
 * where it barely is, and red below.
 *
 * @param verdict - The verdict.
 */
function verdictStyle(verdict: MetricsVerdict): TextStyle {
  if (verdict === "high") {
    return "yellow";
  }
  return verdict === "noticeable" || verdict === "obvious" ? "red" : "green";
}

/**
 * Styles text for a terminal, or returns it as it is when colour is off.
 *
 * @param text - The text.
 * @param style - The style.
 * @param color - Whether to add colour.
 */
function paint(text: string, style: TextStyle, color: boolean) {
  return color ? styleText(style, text, { validateStream: false }) : text;
}

export { formatBytes, formatPercent, paint, verdictStyle };
export type { TextStyle };
