const METRICS_VERDICTS = [
  "visually-lossless",
  "excellent",
  "very-high",
  "high",
  "noticeable",
  "obvious",
] as const;

/**
 * A decoded image ready for scoring: 8-bit sRGB pixels in RGBA order, orientation applied.
 */
type MetricsImage = {
  /** RGBA bytes, `width * height * 4` long, not premultiplied. */
  data: Buffer;
  width: number;
  height: number;
};

/**
 * Options for {@link decodeForScoring}.
 */
type MetricsDecodeOptions = {
  /** Dots per inch to render an SVG at, where 72 is one pixel per SVG unit. Ignored for raster images. */
  density?: number;
};

/**
 * A plain-language verdict for an SSIMULACRA 2 score, from the SSIMULACRA 2 README's bands:
 * `visually-lossless` (90 and above), `excellent` (85), `very-high` (80), `high` (70),
 * `noticeable` (50) and `obvious` (below 50).
 */
type MetricsVerdict = (typeof METRICS_VERDICTS)[number];

export { METRICS_VERDICTS };
export type { MetricsDecodeOptions, MetricsImage, MetricsVerdict };
