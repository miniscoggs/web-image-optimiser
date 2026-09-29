/**
 * The result of {@link optimiseSvg}: SVGO's output at the lowest float precision that still
 * renders like the original (`svgo`), or, when none does, the metadata-only pass (`strip`).
 */
type SvgOptimiseResult = {
  /** The optimised SVG. */
  bytes: Buffer;
  /** Its size once gzipped at the highest compression level, as a server would serve it. */
  gzipBytes: number;
  /** The lowest SSIMULACRA 2 score across the render scales; 100 for `strip`. */
  score: number;
} & (
  | {
      method: "svgo";
      /** The number of decimal places SVGO kept. */
      floatPrecision: number;
    }
  | { method: "strip" }
);

export type { SvgOptimiseResult };
