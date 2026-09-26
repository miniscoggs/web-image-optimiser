const INSPECT_FORMATS = ["png", "jpeg", "webp", "avif", "svg"] as const;
const INSPECT_METADATA_KINDS = [
  "comment",
  "editor",
  "exif",
  "gps",
  "iptc",
  "text",
  "xmp",
] as const;

/**
 * An input format `wio` reads, detected from the file's bytes rather than its extension.
 *
 * @example
 * ```ts
 * import { inspect, type InspectFormat } from "web-image-optimiser";
 *
 * const { format }: { format: InspectFormat } = await inspect("photo.jpg"); // "jpeg"
 * ```
 */
type InspectFormat = (typeof INSPECT_FORMATS)[number];

/**
 * A kind of metadata an image can carry, all of which `wio` strips:
 *
 * - `comment`: JPEG `COM` segments, or SVG comments other than `<!--! -->` licence notices.
 * - `editor`: SVG editor data, such as Inkscape or Illustrator namespaces and `<metadata>`.
 * - `exif`: an EXIF block.
 * - `gps`: GPS location inside the EXIF block.
 * - `iptc`: IPTC captions and credits.
 * - `text`: PNG text chunks (`tEXt`, `zTXt` and `iTXt`).
 * - `xmp`: an XMP packet.
 *
 * @example
 * ```ts
 * import { inspect, type InspectMetadataKind } from "web-image-optimiser";
 *
 * const kinds: InspectMetadataKind[] = (await inspect("photo.jpg")).metadata;
 * ```
 */
type InspectMetadataKind = (typeof INSPECT_METADATA_KINDS)[number];

/**
 * What {@link inspect} reports about an SVG's structure.
 *
 * @example
 * ```ts
 * import { inspect, type InspectSvg } from "web-image-optimiser";
 *
 * const svg: InspectSvg | undefined = (await inspect("logo.svg")).svg;
 * ```
 */
type InspectSvg = {
  /** Whether the root `<svg>` has a `viewBox`, which lets it scale. */
  viewBox: boolean;
  /** Whether the SVG has a `<title>`, its accessible name. */
  title: boolean;
  /**
   * IDs that other parts of the SVG refer to, sorted: through `href`, `url(#id)`,
   * `aria-labelledby`, `aria-describedby` or a CSS `#id` selector.
   */
  referencedIds: string[];
};

/**
 * What {@link inspect} reports about an image.
 *
 * @example
 * ```ts
 * import { inspect, type InspectResult } from "web-image-optimiser";
 *
 * const info: InspectResult = await inspect("photo.jpg");
 * ```
 */
type InspectResult = {
  format: InspectFormat;
  /** The file's size in bytes. */
  bytes: number;
  /** The width as displayed, after EXIF orientation. */
  width: number;
  /** The height as displayed, after EXIF orientation. */
  height: number;
  /** Whether the image has an alpha channel. Always `true` for SVG. */
  hasAlpha: boolean;
  /** Bits per channel once decoded. */
  bitDepth: 8 | 16;
  /** The EXIF orientation, from 1 to 8, or 1 when there is none. */
  orientation: number;
  /** Whether an embedded ICC profile is sRGB, or `null` when there is none. */
  icc: "srgb" | "non-srgb" | null;
  /** The kinds of metadata present, sorted. */
  metadata: InspectMetadataKind[];
  /** SVG structure, present only for SVG. */
  svg?: InspectSvg;
};

export { INSPECT_FORMATS, INSPECT_METADATA_KINDS };
export type { InspectFormat, InspectMetadataKind, InspectResult, InspectSvg };
