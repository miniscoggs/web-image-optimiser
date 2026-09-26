import type { InspectMetadataKind } from "../inspect/index.js";
import readOrFail from "../inspect/readOrFail.js";
import gzipSize from "../svg/gzipSize.js";
import { optimiseSvg, stripSvg } from "../svg/index.js";
import type { Candidate } from "./candidate.js";

/**
 * Chooses an SVG's output: SVGO's result when it's smaller than the input, otherwise the
 * metadata-only strip when that is.
 *
 * @param bytes - The SVG.
 * @param metadata - The metadata `inspect` found, all of which either output removes.
 * @param signal - Aborts the render checks.
 * @returns The output, or `undefined` to keep the input.
 * @throws {@link OptimiserError} `E_DECODE` when the SVG can't be optimised or rendered.
 */
async function selectSvg(
  bytes: Buffer,
  metadata: InspectMetadataKind[],
  signal: AbortSignal | undefined
): Promise<Candidate | undefined> {
  const optimised = await readOrFail(
    () => optimiseSvg(bytes, { signal }),
    signal
  );

  if (optimised.bytes.length < bytes.length) {
    return {
      format: "svg",
      method: optimised.method,
      bytes: optimised.bytes,
      score: optimised.score,
      gzipBytes: optimised.gzipBytes,
      strippedMetadata: metadata,
    };
  }
  if (optimised.method === "strip") {
    return undefined; // already the strip
  }

  const stripped = await stripSvg(bytes);

  return stripped.bytes.length < bytes.length
    ? {
        format: "svg",
        method: "strip",
        bytes: stripped.bytes,
        score: 100,
        gzipBytes: gzipSize(stripped.bytes),
        strippedMetadata: metadata,
      }
    : undefined;
}

export default selectSvg;
