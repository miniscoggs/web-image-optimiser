import sharp from "sharp";
import type { PluginConfig } from "svgo";
import { decodeForScoring, score } from "../metrics/index.js";
import type { MetricsImage } from "../metrics/index.js";
import { MAX_SCORED_PIXELS } from "../metrics/score.js";
import gzipSize from "./gzipSize.js";
import stripSvg from "./stripSvg.js";
import type { SvgOptimiseResult } from "./types.js";

const SVG_TARGET = 90; // fixed, whatever the raster target: svg is expected to look identical
const FLOAT_PRECISIONS = [2, 3, 4, 5];
const BASE_DENSITY = 72; // one pixel per svg unit
const MIN_RENDER_SIZE = 64;
const SAFE_PRESET: PluginConfig = {
  name: "preset-default",
  params: {
    overrides: {
      cleanupIds: false, // ids may be used by page css, scripts or <use> in other files
      inlineStyles: false, // it deletes the ids and classes whose rules it inlines
      removeDesc: false,
      removeUnknownsAndDefaults: { keepRoleAttr: true }, // role="img" gives an icon its accessible name
    },
  },
};

/**
 * Returns the densities to render an SVG at: 1x and 2x, raised so the short side is at least
 * 64 pixels, and capped at the largest image the scorer holds.
 *
 * @param width - The SVG's width at 72 dots per inch.
 * @param height - Its height at 72 dots per inch.
 */
function renderDensities(width: number, height: number) {
  const base = Math.max(1, MIN_RENDER_SIZE / Math.min(width, height));
  const cap = Math.sqrt(MAX_SCORED_PIXELS / (width * height));
  const densities = [base, base * 2].map(
    (scale) => BASE_DENSITY * Math.min(scale, cap)
  );

  return [...new Set(densities)];
}

/**
 * Renders a candidate at each density and scores it against the original's renders, stopping at
 * the first scale that falls below the target.
 *
 * @param candidate - The optimised SVG.
 * @param originals - The original's renders, one per density.
 * @param densities - The densities they were rendered at.
 * @param signal - Aborts before each render.
 * @returns The lowest score, or `-Infinity` when the candidate can't be rendered or renders at
 * a different size.
 */
async function scoreRenders(
  candidate: Buffer,
  originals: MetricsImage[],
  densities: number[],
  signal: AbortSignal | undefined
) {
  let lowest = 100;

  for (const [index, density] of densities.entries()) {
    const original = originals[index];

    signal?.throwIfAborted();
    const render = await decodeForScoring(candidate, { density }).catch(
      () => undefined // eg rounding collapsed the viewBox
    );

    if (
      render === undefined ||
      original === undefined ||
      render.width !== original.width ||
      render.height !== original.height
    ) {
      return -Infinity;
    }
    lowest = Math.min(lowest, await score(original, render));
    if (lowest < SVG_TARGET) {
      break;
    }
  }
  return lowest;
}

/**
 * Optimises an SVG with SVGO, keeping the lowest float precision that still renders like the
 * original.
 *
 * SVGO runs with its default preset, but keeps IDs, `<desc>` and `role` attributes; `viewBox`
 * and `<title>` are always kept. Precisions 2 to 5 are tried in turn. Each result is rendered
 * with the original at 1x and 2x (at least 64 pixels on the short side) and must score at least
 * 90 at both. When none does, the metadata-only pass from {@link stripSvg} is returned instead.
 * The render check can't see scripts, animation or anything only a browser does.
 *
 * @param source - The SVG's bytes, in UTF-8.
 * @param options - `signal` aborts between renders, rejecting with the signal's reason.
 * @returns The optimised SVG, how it was made, its score and its gzipped size.
 * @throws When the SVG isn't well-formed XML or can't be rendered.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { optimiseSvg } from "web-image-optimiser";
 *
 * const result = await optimiseSvg(await readFile("logo.svg"));
 * console.log(result.method, result.bytes.length, result.gzipBytes);
 * ```
 */
async function optimiseSvg(
  source: Buffer,
  options: { signal?: AbortSignal } = {}
): Promise<SvgOptimiseResult> {
  const { signal } = options;

  const { optimize } = await import("svgo"); // takes about 250 ms, so only svg inputs pay for it
  const text = new TextDecoder().decode(source);
  const { width, height } = await sharp(source).metadata();
  const densities = renderDensities(width, height);
  const originals = await Promise.all(
    densities.map((density) => decodeForScoring(source, { density }))
  );

  for (const floatPrecision of FLOAT_PRECISIONS) {
    signal?.throwIfAborted();

    const { data } = optimize(text, {
      multipass: true,
      floatPrecision,
      plugins: [SAFE_PRESET],
    });
    const bytes = Buffer.from(data);
    const lowest = await scoreRenders(bytes, originals, densities, signal);

    if (lowest >= SVG_TARGET) {
      return {
        bytes,
        gzipBytes: gzipSize(bytes),
        score: lowest,
        method: "svgo",
        floatPrecision,
      };
    }
  }

  const { bytes } = await stripSvg(source);

  return { bytes, gzipBytes: gzipSize(bytes), score: 100, method: "strip" };
}

export default optimiseSvg;
