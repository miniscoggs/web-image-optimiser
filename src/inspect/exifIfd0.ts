type ExifIfd0Entry = {
  tag: number;
  /** The TIFF field type, eg 2 for ASCII. */
  type: number;
  /** The number of values. */
  count: number;
  /** Offset in the TIFF of the entry's 4-byte value field, which holds the value or its offset. */
  valueField: number;
};

type ExifIfd0 = {
  /** The TIFF block, without an `Exif\0\0` header. */
  tiff: Buffer;
  /** Reads a 32-bit field of the TIFF in its byte order. */
  readUInt32: (offset: number) => number;
  /** The directory's entries, up to where it's truncated. */
  entries: ExifIfd0Entry[];
};

const EXIF_HEADER = Buffer.from("Exif\0\0", "latin1");
const IFD_ENTRY_LENGTH = 12;

/**
 * Reads the entries of an EXIF block's first directory, IFD0.
 *
 * @param exif - The EXIF block, with or without its `Exif\0\0` header.
 * @returns `undefined` for a block too malformed to read.
 */
function readExifIfd0(exif: Buffer): ExifIfd0 | undefined {
  const tiff = exif.subarray(0, 6).equals(EXIF_HEADER)
    ? exif.subarray(EXIF_HEADER.length)
    : exif;
  const byteOrder = tiff.toString("latin1", 0, 2);

  if (tiff.length < 8 || (byteOrder !== "II" && byteOrder !== "MM")) {
    return undefined;
  }

  const littleEndian = byteOrder === "II";
  const readUInt16 = (offset: number) =>
    littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const readUInt32 = (offset: number) =>
    littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  const ifd0 = readUInt32(4);

  if (ifd0 + 2 > tiff.length) {
    return undefined;
  }

  const entries: ExifIfd0Entry[] = [];

  for (let index = 0; index < readUInt16(ifd0); index++) {
    const entry = ifd0 + 2 + index * IFD_ENTRY_LENGTH;

    if (entry + IFD_ENTRY_LENGTH > tiff.length) {
      break;
    }
    entries.push({
      tag: readUInt16(entry),
      type: readUInt16(entry + 2),
      count: readUInt32(entry + 4),
      valueField: entry + 8,
    });
  }
  return { tiff, readUInt32, entries };
}

export default readExifIfd0;
export { EXIF_HEADER };
