import isSrgbProfile from "../inspect/isSrgbProfile.js";
import {
  CHUNK_HEADER_LENGTH,
  RIFF_HEADER_LENGTH,
  riffChunks,
  riffPayloadEnd,
} from "../inspect/riffChunks.js";
import { OptimiserError } from "../schema/index.js";
import createExifRewriter from "./createExifRewriter.js";
import type { StripRemovedKind, StripResult } from "./types.js";

const IMAGE_CHUNKS = new Set(["VP8 ", "VP8L", "ALPH"]);
const VP8X_FLAGS_OFFSET = CHUNK_HEADER_LENGTH;
const VP8X_ICC = 0x20;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

/**
 * Builds a RIFF chunk, padded to an even length.
 *
 * @param type - The four-character chunk type.
 * @param payload - The chunk's payload.
 */
function buildChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(
    CHUNK_HEADER_LENGTH + payload.length + (payload.length % 2)
  );

  chunk.write(type, 0, "latin1");
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, CHUNK_HEADER_LENGTH);
  return chunk;
}

/**
 * Strips a WebP's metadata chunks, keeping the image data, a non-sRGB `ICCP` and an
 * orientation-only `EXIF` when the orientation isn't 1, then updates the `VP8X` flags and the
 * RIFF size to match.
 *
 * @param webp - The WebP's bytes.
 * @param orientation - Its EXIF orientation.
 * @throws {@link OptimiserError} `E_DECODE` when a chunk runs past the RIFF payload.
 */
function stripWebp(webp: Buffer, orientation: number): StripResult {
  const riffEnd = riffPayloadEnd(webp);
  const removed = new Set<StripRemovedKind>();
  const rewriteExif = createExifRewriter(orientation, removed);
  const pieces: Buffer[] = [];
  let vp8x: Buffer | undefined;
  let keptFlags = 0;
  let end = RIFF_HEADER_LENGTH;

  for (const chunk of riffChunks(webp, riffEnd)) {
    const whole = webp.subarray(chunk.start, chunk.end);

    end = chunk.end;
    if (chunk.type === "VP8X") {
      vp8x = Buffer.from(whole); // a copy, as its flags change below
      pieces.push(vp8x);
    } else if (IMAGE_CHUNKS.has(chunk.type)) {
      pieces.push(whole);
    } else if (chunk.type === "ICCP" && !isSrgbProfile(chunk.payload)) {
      pieces.push(whole);
      keptFlags |= VP8X_ICC;
    } else if (chunk.type === "ICCP") {
      removed.add("icc");
    } else if (chunk.type === "EXIF") {
      const replacement = rewriteExif(chunk.payload);

      if (replacement !== undefined) {
        pieces.push(buildChunk("EXIF", replacement));
        keptFlags |= VP8X_EXIF;
      }
    } else {
      removed.add(chunk.type === "XMP " ? "xmp" : "other");
    }
  }
  if (end < riffEnd) {
    throw new OptimiserError(
      "E_DECODE",
      "A WebP chunk runs past the end of the file"
    );
  }
  if (riffEnd < webp.length) {
    removed.add("other");
  }
  if (vp8x !== undefined) {
    const flags =
      vp8x.readUInt8(VP8X_FLAGS_OFFSET) & ~(VP8X_ICC | VP8X_EXIF | VP8X_XMP);

    vp8x.writeUInt8(flags | keptFlags, VP8X_FLAGS_OFFSET);
  }

  const body = Buffer.concat(pieces);
  const header = Buffer.from("RIFF\0\0\0\0WEBP", "latin1");

  header.writeUInt32LE(body.length + 4, 4); // the size counts "WEBP"
  return {
    bytes: Buffer.concat([header, body]),
    removed: [...removed].toSorted(),
  };
}

export default stripWebp;
