import { EXIF_HEADER } from "../inspect/exifIfd0.js";
import jpegSegments, {
  APP0,
  APP1,
  SOS,
  XMP_ID,
  XMP_IDS,
  buildJpegSegment,
  hasSegmentId,
} from "../inspect/jpegSegments.js";
import { OptimiserError } from "../schema/index.js";
import spliceBytes from "./spliceBytes.js";
import type { ByteEdit } from "./spliceBytes.js";

const SOI_LENGTH = 2;
const EXIF_ID = EXIF_HEADER.toString("latin1");

/**
 * Replaces a JPEG's XMP, and any Extended XMP, with one `APP1` segment holding the packet, placed
 * after `APP0` and any EXIF `APP1` as the XMP spec orders them, or removes it.
 *
 * @param jpeg - The JPEG's bytes.
 * @param packet - The XMP packet, or `undefined` to remove the XMP.
 * @throws {@link OptimiserError} `E_DECODE` when the file has no `SOS` segment.
 * @throws {RangeError} When the packet is over 65,504 bytes, more than one segment holds.
 */
function setJpegXmp(jpeg: Buffer, packet: Buffer | undefined) {
  const segments = [...jpegSegments(jpeg)];

  if (segments.at(-1)?.marker !== SOS) {
    throw new OptimiserError("E_DECODE", "The JPEG has no image data");
  }

  const edits = segments
    .filter(
      (segment) =>
        segment.marker === APP1 &&
        XMP_IDS.some((id) => hasSegmentId(segment, id))
    )
    .map(({ start, end }): ByteEdit => ({ start, end }));

  if (packet !== undefined) {
    const header = segments.findLast(
      (segment) =>
        segment.marker === APP0 ||
        (segment.marker === APP1 && hasSegmentId(segment, EXIF_ID))
    );
    const at = header?.end ?? SOI_LENGTH;
    const payload = Buffer.concat([Buffer.from(XMP_ID, "latin1"), packet]);

    edits.push({ start: at, end: at, bytes: buildJpegSegment(APP1, payload) });
  }
  return spliceBytes(jpeg, edits);
}

export default setJpegXmp;
