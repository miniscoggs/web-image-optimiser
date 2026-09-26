import { crc32, inflateSync } from "node:zlib";
import isSrgbProfile from "../inspect/isSrgbProfile.js";
import pngChunks, { PNG_SIGNATURE_LENGTH } from "../inspect/pngChunks.js";
import { OptimiserError } from "../schema/index.js";
import createExifRewriter from "./createExifRewriter.js";
import type { StripRemovedKind, StripResult } from "./types.js";

const DISPLAY_CHUNKS = new Set([
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "cICP",
  "mDCV",
  "cLLI",
]); // ancillary, but they change how the pixels display
const TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);
const XMP_KEYWORD = "XML:com.adobe.xmp";

/**
 * Returns whether a chunk type is critical, which its uppercase first letter marks.
 *
 * @param type - The four-letter chunk type.
 */
function isCritical(type: string) {
  return (type.charCodeAt(0) & 0x20) === 0;
}

/**
 * Returns the keyword a text chunk starts with.
 *
 * @param data - The chunk's data.
 */
function readKeyword(data: Buffer) {
  const end = data.indexOf(0);

  return data.toString("latin1", 0, end === -1 ? data.length : end);
}

/**
 * Returns whether an `iCCP` chunk holds an sRGB profile.
 *
 * @param data - The chunk's data: a profile name, a null, a compression method and the
 * zlib-compressed profile.
 * @returns `false` when the profile can't be inflated, so it is kept.
 */
function isSrgbIccp(data: Buffer) {
  const nameEnd = data.indexOf(0);

  try {
    return isSrgbProfile(inflateSync(data.subarray(nameEnd + 2)));
  } catch {
    return false;
  }
}

/**
 * Builds a PNG chunk, including its CRC.
 *
 * @param type - The four-letter chunk type.
 * @param data - The chunk's data.
 */
function buildChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + 12);
  const crcOffset = chunk.length - 4;

  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);

  const crc = crc32(chunk.subarray(4, crcOffset)); // covers the type and data

  chunk.writeUInt32BE(crc, crcOffset);
  return chunk;
}

/**
 * Strips a PNG's metadata chunks, keeping the critical chunks, the chunks that change how pixels
 * display, a non-sRGB `iCCP`, and an orientation-only `eXIf` when the orientation isn't 1.
 * Kept chunks are copied with their CRCs untouched.
 *
 * @param png - The PNG's bytes.
 * @param orientation - Its EXIF orientation.
 * @throws {@link OptimiserError} `E_DECODE` when the file ends before `IEND`.
 */
function stripPng(png: Buffer, orientation: number): StripResult {
  const removed = new Set<StripRemovedKind>();
  const rewriteExif = createExifRewriter(orientation, removed);
  const pieces = [png.subarray(0, PNG_SIGNATURE_LENGTH)];
  let end = PNG_SIGNATURE_LENGTH;
  let complete = false;

  for (const chunk of pngChunks(png)) {
    const whole = png.subarray(chunk.start, chunk.end);
    const data = png.subarray(chunk.start + 8, chunk.end - 4);

    end = chunk.end;
    complete = chunk.type === "IEND";
    if (isCritical(chunk.type) || DISPLAY_CHUNKS.has(chunk.type)) {
      pieces.push(whole);
    } else if (chunk.type === "eXIf") {
      const replacement = rewriteExif(data);

      if (replacement !== undefined) {
        pieces.push(buildChunk("eXIf", replacement));
      }
    } else if (chunk.type === "iCCP" && !isSrgbIccp(data)) {
      pieces.push(whole);
    } else if (chunk.type === "iCCP") {
      removed.add("icc");
    } else if (TEXT_CHUNKS.has(chunk.type)) {
      removed.add(readKeyword(data) === XMP_KEYWORD ? "xmp" : "text");
    } else {
      removed.add("other");
    }
  }
  if (!complete) {
    throw new OptimiserError("E_DECODE", "The PNG ends before its IEND chunk");
  }
  if (end < png.length) {
    removed.add("other");
  }
  return { bytes: Buffer.concat(pieces), removed: [...removed].toSorted() };
}

export default stripPng;
