import { INSPECT_METADATA_KINDS } from "../inspect/types.js";

const STRIP_REMOVED_KINDS = [
  ...INSPECT_METADATA_KINDS,
  "icc",
  "other",
] as const;

/**
 * A raster format {@link stripLossless} can strip.
 */
type StripFormat = "jpeg" | "png" | "webp" | "avif";

/**
 * A kind of data {@link stripLossless} removed: a metadata kind from `inspect`, `icc` for an
 * sRGB profile, or `other` for anything else outside the image data, such as a PNG `pHYs`
 * chunk or bytes after the end of the image.
 */
type StripRemovedKind = (typeof STRIP_REMOVED_KINDS)[number];

/**
 * The result of {@link stripLossless}.
 */
type StripResult = {
  /** The stripped file, or the input itself when nothing was removed. */
  bytes: Buffer;
  /** What was removed, sorted. Empty when there was nothing to strip. */
  removed: StripRemovedKind[];
};

export { STRIP_REMOVED_KINDS };
export type { StripFormat, StripRemovedKind, StripResult };
