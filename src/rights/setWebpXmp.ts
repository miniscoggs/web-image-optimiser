import {
  CHUNK_HEADER_LENGTH,
  RIFF_HEADER_LENGTH,
  VP8X_ALPHA,
  VP8X_FLAGS_OFFSET,
  VP8X_XMP,
  buildRiffChunk,
  riffChunks,
  riffPayloadEnd,
} from "../inspect/riffChunks.js";
import type { RiffChunk } from "../inspect/riffChunks.js";
import { OptimiserError } from "../schema/index.js";
import spliceBytes from "./spliceBytes.js";
import type { ByteEdit } from "./spliceBytes.js";

const VP8L_SIGNATURE = 0x2f;
const VP8_START_CODE = 0x9d012a; // after the 3-byte frame tag
const DIMENSION_MASK = 0x3fff; // 14 bits
const VP8X_LENGTH = 10; // flags, 3 reserved bytes, then the canvas width and height less one

/**
 * Returns the size of a simple WebP's image and whether it holds alpha, from the header of its
 * `VP8 ` or `VP8L` bitstream.
 *
 * @param image - The file's first chunk.
 * @throws {@link OptimiserError} `E_DECODE` when it isn't a valid image chunk.
 */
function readImageHeader(image: RiffChunk | undefined) {
  const payload = image?.payload ?? Buffer.alloc(0);

  if (
    image?.type === "VP8L" &&
    payload.length >= 5 &&
    payload.readUInt8(0) === VP8L_SIGNATURE
  ) {
    const bits = payload.readUInt32LE(1); // width and height less one, then alpha_is_used

    return {
      width: (bits & DIMENSION_MASK) + 1,
      height: ((bits >>> 14) & DIMENSION_MASK) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
    };
  }
  if (
    image?.type === "VP8 " &&
    payload.length >= 10 &&
    payload.readUIntBE(3, 3) === VP8_START_CODE
  ) {
    return {
      width: payload.readUInt16LE(6) & DIMENSION_MASK, // the top 2 bits are the scale
      height: payload.readUInt16LE(8) & DIMENSION_MASK,
      alpha: false, // a simple lossy image has no ALPH chunk
    };
  }
  throw new OptimiserError(
    "E_DECODE",
    "The WebP's image header is missing or damaged"
  );
}

/**
 * Builds the `VP8X` chunk a simple WebP needs before it can hold XMP, with the XMP flag set.
 *
 * @param image - The file's first chunk, its `VP8 ` or `VP8L` bitstream.
 */
function buildVp8x(image: RiffChunk | undefined) {
  const { width, height, alpha } = readImageHeader(image);
  const payload = Buffer.alloc(VP8X_LENGTH);

  payload.writeUInt8(VP8X_XMP | (alpha ? VP8X_ALPHA : 0), 0);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return buildRiffChunk("VP8X", payload);
}

/**
 * Replaces a WebP's `XMP ` chunk with one holding the packet, at the end of the RIFF payload,
 * or removes it, then updates the `VP8X` XMP flag and the RIFF size. A simple WebP given a
 * packet first gains a `VP8X` chunk, which the XMP chunk needs.
 *
 * @param webp - The WebP's bytes.
 * @param packet - The XMP packet, or `undefined` to remove the XMP.
 * @throws {@link OptimiserError} `E_DECODE` when a chunk runs past the RIFF payload, or a simple
 * WebP's image header is damaged.
 */
function setWebpXmp(webp: Buffer, packet: Buffer | undefined) {
  const riffEnd = riffPayloadEnd(webp);
  const chunks = [...riffChunks(webp, riffEnd)];

  if ((chunks.at(-1)?.end ?? RIFF_HEADER_LENGTH) < riffEnd) {
    throw new OptimiserError(
      "E_DECODE",
      "A WebP chunk runs past the end of the file"
    );
  }

  const vp8x = chunks.find((chunk) => chunk.type === "VP8X");
  const edits = chunks
    .filter((chunk) => chunk.type === "XMP ")
    .map(({ start, end }): ByteEdit => ({ start, end }));

  if (vp8x !== undefined) {
    const flagsAt = vp8x.start + VP8X_FLAGS_OFFSET;
    const flags =
      (webp.readUInt8(flagsAt) & ~VP8X_XMP) |
      (packet === undefined ? 0 : VP8X_XMP);

    edits.push({
      start: flagsAt,
      end: flagsAt + 1,
      bytes: Buffer.from([flags]),
    });
  } else if (packet !== undefined) {
    edits.push({
      start: RIFF_HEADER_LENGTH,
      end: RIFF_HEADER_LENGTH,
      bytes: buildVp8x(chunks[0]),
    });
  }
  if (packet !== undefined) {
    edits.push({
      start: riffEnd,
      end: riffEnd,
      bytes: buildRiffChunk("XMP ", packet),
    });
  }

  const riff = spliceBytes(webp.subarray(0, riffEnd), edits);

  riff.writeUInt32LE(riff.length - CHUNK_HEADER_LENGTH, 4); // the size counts "WEBP"
  return Buffer.concat([riff, webp.subarray(riffEnd)]);
}

export default setWebpXmp;
