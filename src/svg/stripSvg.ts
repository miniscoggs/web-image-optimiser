import inspectSvg from "../inspect/inspectSvg.js";
import type { StripRemovedKind, StripResult } from "../strip/index.js";

const METADATA_PLUGINS = [
  "removeComments",
  "removeMetadata",
  "removeEditorsNSData",
] as const;

/**
 * Removes an SVG's comments, `<metadata>` and editor namespaces with SVGO, which changes nothing
 * that renders. This is SVG's lossless strip.
 *
 * Comments written as `<!--! ... -->`, the convention for licence notices, are kept.
 *
 * @param source - The SVG's bytes, in UTF-8.
 * @returns The stripped SVG and what was removed, or the input itself with nothing removed.
 * @throws When the SVG isn't well-formed XML.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { stripSvg } from "web-image-optimiser";
 *
 * const { bytes, removed } = await stripSvg(await readFile("drawing.svg")); // ["comment", "editor"]
 * ```
 */
async function stripSvg(source: Buffer): Promise<StripResult> {
  const scan = await inspectSvg(source);
  const removed: StripRemovedKind[] = (["comment", "editor"] as const).filter(
    (kind) => scan[kind]
  );

  if (removed.length === 0) {
    return { bytes: source, removed: [] };
  }

  const { optimize } = await import("svgo"); // takes about 250 ms, so only svg inputs pay for it
  const { data } = optimize(new TextDecoder().decode(source), {
    plugins: [...METADATA_PLUGINS],
  });

  return { bytes: Buffer.from(data), removed };
}

export default stripSvg;
