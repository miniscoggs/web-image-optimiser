import setAvifXmp from "./setAvifXmp.js";
import setJpegXmp from "./setJpegXmp.js";
import setPngXmp from "./setPngXmp.js";
import setWebpXmp from "./setWebpXmp.js";

const XMP_WRITERS = {
  avif: setAvifXmp,
  jpeg: setJpegXmp,
  png: setPngXmp,
  webp: setWebpXmp,
};

/**
 * Replaces whatever XMP an encoded image has with a rights packet, or removes it, and touches
 * nothing else, so a strip and a re-encode carry their rights the same way.
 *
 * - **JPEG:** one `APP1` segment after `APP0` and any EXIF `APP1`. Extended XMP goes too.
 * - **PNG:** one uncompressed `iTXt` chunk keyed `XML:com.adobe.xmp`, before the first `IDAT`.
 * - **WebP:** an `XMP ` chunk at the end, with the `VP8X` XMP flag and the RIFF size updated. A
 *   simple WebP given a packet gains a `VP8X` chunk first.
 * - **AVIF:** one `mime` item describing the primary item, as libheif writes it, with its data at
 *   the end of `mdat`.
 *
 * @param bytes - The image's bytes.
 * @param format - Its format.
 * @param packet - The packet from `buildRightsPacket`, or `undefined` to remove the XMP.
 * @returns A copy of the image carrying the packet.
 * @throws {@link OptimiserError} `E_DECODE` when the file's structure ends early, or an AVIF has
 * no primary item for the packet to describe.
 * @throws {RangeError} When a JPEG's packet is over 65,504 bytes, more than one segment holds, or
 * an AVIF's item table has no field to hold the packet's offset or length.
 */
function setRights(
  bytes: Buffer,
  format: keyof typeof XMP_WRITERS,
  packet: Buffer | undefined
) {
  return XMP_WRITERS[format](bytes, packet);
}

export default setRights;
