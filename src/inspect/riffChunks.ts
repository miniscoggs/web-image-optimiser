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

export {
  CHUNK_HEADER_LENGTH,
  RIFF_HEADER_LENGTH,
  isLosslessWebp,
  riffChunks,
  riffPayloadEnd,
};
export type { RiffChunk };
