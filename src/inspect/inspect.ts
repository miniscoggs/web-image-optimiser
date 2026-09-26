import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { OptimiserError } from "../schema/index.js";
import { detectFormat, isAvifSequence } from "./detectFormat.js";
import hasGps from "./hasGps.js";
import inspectSvg from "./inspectSvg.js";
import isSrgbProfile from "./isSrgbProfile.js";
import jpegSegments from "./jpegSegments.js";
import pngChunks from "./pngChunks.js";
import readOrFail from "./readOrFail.js";
import { INSPECT_METADATA_KINDS } from "./types.js";
import type {
  InspectFormat,
  InspectMetadataKind,
  InspectResult,
} from "./types.js";

const JPEG_COM = 0xfe;
const ANIMATED_MESSAGE = "Animated images are not supported";

/**
 * Returns whether a PNG has an `acTL` chunk before its image data, which makes it an APNG.
 *
 * @param png - The PNG's bytes.
 */
function isAnimatedPng(png: Buffer) {
  for (const chunk of pngChunks(png)) {
    if (chunk.type === "acTL") {
      return true;
    }
    if (chunk.type === "IDAT") {
      return false;
    }
  }
  return false;
}

/**
 * Returns whether the file's container marks it as animated in a way sharp's page count misses.
 *
 * @param bytes - The file's bytes.
 * @param format - Its format.
 */
function isAnimatedContainer(bytes: Buffer, format: InspectFormat) {
  if (format === "png") {
    return isAnimatedPng(bytes); // libvips decodes only an apng's default image
  }
  if (format === "avif") {
    return isAvifSequence(bytes); // libheif can reject a sequence outright, so check before decoding
  }
  return false;
}

/**
 * Returns whether a JPEG has a `COM` segment before its image data.
 *
 * @param jpeg - The JPEG's bytes.
 */
function hasJpegComment(jpeg: Buffer) {
  return jpegSegments(jpeg).some((segment) => segment.marker === JPEG_COM);
}

/**
 * Inspects an image: its format (from its bytes, never its extension), displayed size, alpha,
 * bit depth, orientation, colour profile and the metadata it carries.
 *
 * Only the header is read, so a file whose image data is damaged can still pass. SVGs are
 * parsed to report their `viewBox`, `<title>` and internal ID references.
 *
 * @param input - A file path, or the file's bytes.
 * @returns What the image contains.
 * @throws {@link OptimiserError} with `E_UNSUPPORTED_FORMAT` when the file isn't a PNG, JPEG,
 * WebP, AVIF or SVG, `E_ANIMATED` when it's animated, or `E_DECODE` when its header can't be
 * read.
 *
 * @example
 * ```ts
 * import { inspect } from "web-image-optimiser";
 *
 * const info = await inspect("photo.jpg");
 * console.log(info.format, info.width, info.height, info.metadata); // "jpeg" 4000 3000 ["exif", "gps"]
 * ```
 */
async function inspect(input: Buffer | string): Promise<InspectResult> {
  const bytes = typeof input === "string" ? await readFile(input) : input;
  const format = detectFormat(bytes);

  if (format === undefined) {
    throw new OptimiserError(
      "E_UNSUPPORTED_FORMAT",
      "The file is not a PNG, JPEG, WebP, AVIF or SVG image"
    );
  }

  if (isAnimatedContainer(bytes, format)) {
    throw new OptimiserError("E_ANIMATED", ANIMATED_MESSAGE);
  }

  const header = await readOrFail(() => sharp(bytes).metadata());

  if ((header.pages ?? 1) > 1) {
    throw new OptimiserError("E_ANIMATED", ANIMATED_MESSAGE);
  }

  const svg =
    format === "svg" ? await readOrFail(() => inspectSvg(bytes)) : undefined;
  const present: Record<InspectMetadataKind, boolean> = {
    comment: format === "jpeg" ? hasJpegComment(bytes) : svg?.comment === true,
    editor: svg?.editor === true,
    exif: header.exif !== undefined,
    gps: header.exif !== undefined && hasGps(header.exif),
    iptc: header.iptc !== undefined,
    text: header.comments !== undefined,
    xmp: header.xmp !== undefined,
  };
  let icc: InspectResult["icc"] = null;

  if (header.icc !== undefined) {
    icc = isSrgbProfile(header.icc) ? "srgb" : "non-srgb";
  }

  return {
    format,
    bytes: bytes.length,
    width: header.autoOrient.width,
    height: header.autoOrient.height,
    hasAlpha: header.hasAlpha,
    bitDepth: header.depth === "ushort" ? 16 : 8,
    orientation: header.orientation ?? 1,
    icc,
    metadata: INSPECT_METADATA_KINDS.filter((kind) => present[kind]),
    ...(svg && { svg: svg.details }),
  };
}

export default inspect;
