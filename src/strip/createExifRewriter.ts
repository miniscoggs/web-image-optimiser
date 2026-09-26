import hasGps, { EXIF_HEADER } from "../inspect/hasGps.js";
import type { StripRemovedKind } from "./types.js";

const ORIENTATION_TAG = 0x0112;
const SHORT_TYPE = 3;

/**
 * Builds a little-endian TIFF block whose only entry is the Orientation tag.
 *
 * @param orientation - The EXIF orientation, 2 to 8.
 */
function buildOrientationTiff(orientation: number) {
  const tiff = Buffer.alloc(26); // header, entry count, one entry, next-directory offset

  tiff.write("II*\0", 0, "latin1");
  tiff.writeUInt32LE(8, 4); // ifd0 follows the header
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(ORIENTATION_TAG, 10);
  tiff.writeUInt16LE(SHORT_TYPE, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  return tiff;
}

/**
 * Creates the function that decides what replaces each EXIF block in a file: a block holding
 * only the orientation for the first one when the orientation isn't 1, and nothing otherwise.
 *
 * @param orientation - The image's EXIF orientation.
 * @param removed - The set of removed kinds to add `exif` and `gps` to.
 * @returns A function taking an EXIF block's payload, with or without its `Exif\0\0` header,
 * and returning the payload to write in its place, or `undefined` to drop it.
 */
function createExifRewriter(
  orientation: number,
  removed: Set<StripRemovedKind>
) {
  let pending =
    orientation === 1 ? undefined : buildOrientationTiff(orientation);

  return (payload: Buffer) => {
    const tiff = pending;
    const header = payload.subarray(0, EXIF_HEADER.length).equals(EXIF_HEADER)
      ? EXIF_HEADER
      : Buffer.alloc(0);

    pending = undefined;
    if (tiff !== undefined && payload.length <= header.length + tiff.length) {
      return payload; // too short for anything but orientation, eg a second run
    }
    removed.add("exif");
    if (hasGps(payload)) {
      removed.add("gps");
    }
    return tiff && Buffer.concat([header, tiff]);
  };
}

export default createExifRewriter;
