import { styleText } from "node:util";
import type { MetricsVerdict } from "../metrics/index.js";
import { verdictRating } from "./format.js";

/**
 * A colour or modifier for {@link paint}.
 */
type TextStyle = Parameters<typeof styleText>[0];

const RATING_STYLES = {
  good: "green",
  fair: "yellow",
  bad: "red",
} as const satisfies Record<ReturnType<typeof verdictRating>, TextStyle>;

/**
 * Returns the style for a verdict: green where the loss isn't noticeable side by side, yellow
 * where it barely is, and red below.
 *
 * @param verdict - The verdict.
 */
function verdictStyle(verdict: MetricsVerdict): TextStyle {
  return RATING_STYLES[verdictRating(verdict)];
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

export { paint, verdictStyle };
export type { TextStyle };
