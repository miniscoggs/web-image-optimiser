type PngChunk = {
  /** The four-letter chunk type, eg `IDAT`. */
  type: string;
  /** Offset of the chunk's length field. */
  start: number;
  /** Offset just after the chunk's CRC. */
  end: number;
};

const PNG_SIGNATURE_LENGTH = 8;
const CHUNK_OVERHEAD = 12; // length, type and crc

/**
 * Yields a PNG's chunks in order, stopping after `IEND` or before a chunk that runs past the
 * end of the file.
 *
 * @param png - The PNG's bytes, signature included.
 */
function* pngChunks(png: Buffer): Generator<PngChunk> {
  let start = PNG_SIGNATURE_LENGTH;

  while (start + CHUNK_OVERHEAD <= png.length) {
    const end = start + CHUNK_OVERHEAD + png.readUInt32BE(start);

    if (end > png.length) {
      return;
    }

    const type = png.toString("latin1", start + 4, start + 8);

    yield { type, start, end };
    if (type === "IEND") {
      return;
    }
    start = end;
  }
}

export default pngChunks;
export { PNG_SIGNATURE_LENGTH };
export type { PngChunk };
