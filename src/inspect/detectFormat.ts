import type { InspectFormat } from "./types.js";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const AVIF_SEQUENCE_BRAND = "avis";
const XML_PROLOG_ITEM =
  /\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>/y;
const SVG_ROOT = /<svg[\s/>]/y;

/**
 * Returns the brands of an ISOBMFF file's leading `ftyp` box, major brand first, or none when
 * the file doesn't start with one.
 *
 * @param bytes - The file's bytes.
 */
function readFtypBrands(bytes: Buffer) {
  if (bytes.length < 16 || bytes.toString("latin1", 4, 8) !== "ftyp") {
    return [];
  }

  const boxEnd = Math.min(bytes.readUInt32BE(0), bytes.length);
  const brands = [bytes.toString("latin1", 8, 12)];

  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brands.push(bytes.toString("latin1", offset, offset + 4)); // compatible brands follow the minor version
  }
  return brands;
}

/**
 * Returns whether the bytes are XML whose root element is `<svg>`.
 *
 * @param bytes - The file's bytes.
 */
function isSvg(bytes: Buffer) {
  const start = bytes.subarray(0, 3).equals(UTF8_BOM) ? 3 : 0;
  const text = bytes.toString("latin1", start); // markup is ascii, so any ascii-compatible decoding finds the root
  let position = 0;

  for (;;) {
    XML_PROLOG_ITEM.lastIndex = position;
    if (!XML_PROLOG_ITEM.test(text)) {
      break;
    }
    position = XML_PROLOG_ITEM.lastIndex;
  }
  SVG_ROOT.lastIndex = position;
  return SVG_ROOT.test(text);
}

/**
 * Detects an image's format from its leading bytes.
 *
 * @param bytes - The file's bytes.
 * @returns The format, or `undefined` when it isn't one `wio` reads.
 */
function detectFormat(bytes: Buffer): InspectFormat | undefined {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "png";
  }
  if (bytes.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    return "jpeg";
  }
  if (
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (readFtypBrands(bytes).some((brand) => AVIF_BRANDS.has(brand))) {
    return "avif";
  }
  if (isSvg(bytes)) {
    return "svg";
  }
  return undefined;
}

/**
 * Returns whether an AVIF file declares an image sequence, which is how AVIF animates.
 *
 * @param bytes - The AVIF file's bytes.
 */
function isAvifSequence(bytes: Buffer) {
  return readFtypBrands(bytes).includes(AVIF_SEQUENCE_BRAND);
}

export { detectFormat, isAvifSequence };
