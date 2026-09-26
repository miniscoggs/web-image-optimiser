import { INSPECT_METADATA_KINDS } from "../inspect/types.js";

const STRIP_REMOVED_KINDS = [
  ...INSPECT_METADATA_KINDS,
  "icc",
  "other",
] as const;

/**
 * A raster format {@link stripLossless} can strip.
 *
 * @example
 * ```ts
 * import type { StripFormat } from "web-image-optimiser";
 *
 * const format: StripFormat = "webp";
 * ```
 */
type StripFormat = "jpeg" | "png" | "webp" | "avif";

/**
 * A kind of data {@link stripLossless} removed: a metadata kind from `inspect`, `icc` for an
 * sRGB profile, or `other` for anything else outside the image data, such as a PNG `pHYs`
 * chunk or bytes after the end of the image.
 *
 * @example
 * ```ts
 * import type { StripRemovedKind } from "web-image-optimiser";
 *
 * const removed: StripRemovedKind[] = ["exif", "gps", "icc"];
 * ```
 */
type StripRemovedKind = (typeof STRIP_REMOVED_KINDS)[number];

/**
 * The result of {@link stripLossless}.
 *
 * @example
 * ```ts
 * import { stripLossless, type StripResult } from "web-image-optimiser";
 *
 * const result: StripResult = stripLossless(bytes, { format: "jpeg", orientation: 1 });
 * ```
 */
type StripResult = {
  /** The stripped file, or the input itself when nothing was removed. */
  bytes: Buffer;
  /** What was removed, sorted. Empty when there was nothing to strip. */
  removed: StripRemovedKind[];
};

export { STRIP_REMOVED_KINDS };
export type { StripFormat, StripRemovedKind, StripResult };
