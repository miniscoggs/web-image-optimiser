const EXIF_HEADER = Buffer.from("Exif\0\0", "latin1");
const GPS_IFD_POINTER = 0x8825;
const IFD_ENTRY_LENGTH = 12;

/**
 * Returns whether an EXIF block points to a GPS directory from its first directory, IFD0.
 *
 * @param exif - The EXIF block, with or without its `Exif\0\0` header.
 * @returns `false` for a block too malformed to read.
 */
function hasGps(exif: Buffer) {
  const tiff = exif.subarray(0, 6).equals(EXIF_HEADER)
    ? exif.subarray(EXIF_HEADER.length)
    : exif;
  const byteOrder = tiff.toString("latin1", 0, 2);

  if (tiff.length < 8 || (byteOrder !== "II" && byteOrder !== "MM")) {
    return false;
  }

  const littleEndian = byteOrder === "II";
  const readUInt16 = (offset: number) =>
    littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const ifd0 = littleEndian ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);

  if (ifd0 + 2 > tiff.length) {
    return false;
  }

  const entryCount = readUInt16(ifd0);

  for (let index = 0; index < entryCount; index++) {
    const entry = ifd0 + 2 + index * IFD_ENTRY_LENGTH;

    if (entry + IFD_ENTRY_LENGTH > tiff.length) {
      return false;
    }
    if (readUInt16(entry) === GPS_IFD_POINTER) {
      return true;
    }
  }
  return false;
}

export default hasGps;
export { EXIF_HEADER };
