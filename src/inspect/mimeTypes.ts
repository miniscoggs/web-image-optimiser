import type { InspectFormat } from "./types.js";

/**
 * Each format's MIME type.
 */
const MIME_TYPES = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
} as const satisfies Record<InspectFormat, string>;

export default MIME_TYPES;
