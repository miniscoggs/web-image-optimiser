import readExifIfd0 from "./exifIfd0.js";

const GPS_IFD_POINTER = 0x8825;

/**
 * Returns whether an EXIF block points to a GPS directory from its first directory, IFD0.
 *
 * @param exif - The EXIF block, with or without its `Exif\0\0` header.
 * @returns `false` for a block too malformed to read.
 */
function hasGps(exif: Buffer) {
  return (
    readExifIfd0(exif)?.entries.some(
      (entry) => entry.tag === GPS_IFD_POINTER
    ) ?? false
  );
}

export default hasGps;
