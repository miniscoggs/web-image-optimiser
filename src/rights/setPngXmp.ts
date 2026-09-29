import pngChunks, { buildPngChunk } from "../inspect/pngChunks.js";
import {
  PNG_TEXT_CHUNKS,
  PNG_XMP_KEYWORD,
  readPngKeyword,
} from "../inspect/pngText.js";
import { OptimiserError } from "../schema/index.js";
import spliceBytes from "./spliceBytes.js";
import type { ByteEdit } from "./spliceBytes.js";

const ITXT_XMP_HEADER = Buffer.from(`${PNG_XMP_KEYWORD}\0\0\0\0\0`, "latin1"); // uncompressed, no language or translated keyword

/**
 * Replaces a PNG's XMP text chunks with one uncompressed `iTXt` chunk holding the packet, before
 * the first `IDAT` as the XMP spec asks, or removes them.
 *
 * @param png - The PNG's bytes.
 * @param packet - The XMP packet, or `undefined` to remove the XMP.
 * @throws {@link OptimiserError} `E_DECODE` when the file has no `IDAT` chunk.
 */
function setPngXmp(png: Buffer, packet: Buffer | undefined) {
  const chunks = [...pngChunks(png)];
  const idat = chunks.find((chunk) => chunk.type === "IDAT");

  if (idat === undefined) {
    throw new OptimiserError("E_DECODE", "The PNG has no image data");
  }

  const edits = chunks
    .filter(
      (chunk) =>
        PNG_TEXT_CHUNKS.has(chunk.type) &&
        readPngKeyword(chunk.data) === PNG_XMP_KEYWORD
    )
    .map(({ start, end }): ByteEdit => ({ start, end }));

  if (packet !== undefined) {
    const itxt = buildPngChunk(
      "iTXt",
      Buffer.concat([ITXT_XMP_HEADER, packet])
    );

    edits.push({ start: idat.start, end: idat.start, bytes: itxt });
  }
  return spliceBytes(png, edits);
}

export default setPngXmp;
