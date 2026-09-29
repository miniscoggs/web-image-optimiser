type RiffChunk = {
  /** The four-character chunk type, eg `VP8L`. */
  type: string;
  /** Offset of the chunk's type field. */
  start: number;
  /** Offset just after the chunk's payload and any padding byte. */
  end: number;
  /** The chunk's payload. */
  payload: Buffer;
};

const RIFF_HEADER_LENGTH = 12; // "RIFF", the size, then "WEBP"
const CHUNK_HEADER_LENGTH = 8;
const VP8X_FLAGS_OFFSET = CHUNK_HEADER_LENGTH; // from the start of the vp8x chunk
const VP8X_ICC = 0x20;
const VP8X_ALPHA = 0x10;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

/**
 * Returns the end of a WebP's RIFF payload, as its header states, capped at the file's length.
 *
 * @param webp - The WebP's bytes.
 */
function riffPayloadEnd(webp: Buffer) {
  return Math.min(CHUNK_HEADER_LENGTH + webp.readUInt32LE(4), webp.length);
}

/**
 * Yields a WebP's chunks in order, stopping before a chunk that runs past the RIFF payload.
 *
 * @param webp - The WebP's bytes.
 * @param riffEnd - The end of the RIFF payload.
 */
function* riffChunks(
  webp: Buffer,
  riffEnd = riffPayloadEnd(webp)
): Generator<RiffChunk> {
  let start = RIFF_HEADER_LENGTH;

  while (start + CHUNK_HEADER_LENGTH <= riffEnd) {
    const size = webp.readUInt32LE(start + 4);
    const payloadEnd = start + CHUNK_HEADER_LENGTH + size;

    if (payloadEnd > riffEnd) {
      return;
    }

    const type = webp.toString("latin1", start, start + 4);
    const end = Math.min(payloadEnd + (size % 2), riffEnd); // payloads pad to even lengths

    yield { type, start, end, payload: webp.subarray(start + 8, payloadEnd) };
    start = end;
  }
}

/**
 * Returns whether a WebP's image is stored losslessly, in a `VP8L` chunk.
 *
 * @param webp - The WebP's bytes.
 */
function isLosslessWebp(webp: Buffer) {
  return riffChunks(webp).some((chunk) => chunk.type === "VP8L");
}

/**
 * Builds a RIFF chunk, padded to an even length.
 *
 * @param type - The four-character chunk type.
 * @param payload - The chunk's payload.
 */
function buildRiffChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(
    CHUNK_HEADER_LENGTH + payload.length + (payload.length % 2)
  );

  chunk.write(type, 0, "latin1");
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, CHUNK_HEADER_LENGTH);
  return chunk;
}

export {
  CHUNK_HEADER_LENGTH,
  RIFF_HEADER_LENGTH,
  VP8X_ALPHA,
  VP8X_EXIF,
  VP8X_FLAGS_OFFSET,
  VP8X_ICC,
  VP8X_XMP,
  buildRiffChunk,
  isLosslessWebp,
  riffChunks,
  riffPayloadEnd,
};
export type { RiffChunk };
