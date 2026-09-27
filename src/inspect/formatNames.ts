import type { InspectFormat } from "./types.js";

/**
 * Each format's name, as people write it.
 */
const FORMAT_NAMES = {
  avif: "AVIF",
  jpeg: "JPEG",
  png: "PNG",
  svg: "SVG",
  webp: "WebP",
} as const satisfies Record<InspectFormat, string>;

export default FORMAT_NAMES;
