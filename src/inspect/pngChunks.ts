import { crc32 } from "node:zlib";

type PngChunk = {
  /** The four-letter chunk type, eg `IDAT`. */
  type: string;
  /** Offset of the chunk's length field. */
  start: number;
  /** Offset just after the chunk's CRC. */
  end: number;
  /** The chunk's data, between its type and its CRC. */
  data: Buffer;
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

    yield { type, start, end, data: png.subarray(start + 8, end - 4) };
    if (type === "IEND") {
      return;
    }
    start = end;
  }
}

/**
 * Builds a PNG chunk, including its CRC.
 *
 * @param type - The four-letter chunk type.
 * @param data - The chunk's data.
 */
function buildPngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + CHUNK_OVERHEAD);
  const crcOffset = chunk.length - 4;

  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);

  const crc = crc32(chunk.subarray(4, crcOffset)); // covers the type and data

  chunk.writeUInt32BE(crc, crcOffset);
  return chunk;
}

export default pngChunks;
export { PNG_SIGNATURE_LENGTH, buildPngChunk };
export type { PngChunk };
