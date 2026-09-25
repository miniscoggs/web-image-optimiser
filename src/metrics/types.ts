/**
 * A decoded image ready for scoring: 8-bit sRGB pixels in RGBA order, orientation applied.
 *
 * @example
 * ```ts
 * import { decodeForScoring, type MetricsImage } from "web-image-optimiser";
 *
 * const image: MetricsImage = await decodeForScoring("photo.jpg");
 * ```
 */
type MetricsImage = {
  /** RGBA bytes, `width * height * 4` long, not premultiplied. */
  data: Buffer;
  width: number;
  height: number;
};

/**
 * A plain-language verdict for an SSIMULACRA 2 score, from the SSIMULACRA 2 README's bands:
 * `visually-lossless` (90 and above), `excellent` (85), `very-high` (80), `high` (70),
 * `noticeable` (50) and `obvious` (below 50).
 *
 * @example
 * ```ts
 * import { verdictFor, type MetricsVerdict } from "web-image-optimiser";
 *
 * const verdict: MetricsVerdict = verdictFor(82.4); // "very-high"
 * ```
 */
type MetricsVerdict =
  | "visually-lossless"
  | "excellent"
  | "very-high"
  | "high"
  | "noticeable"
  | "obvious";

export type { MetricsImage, MetricsVerdict };
