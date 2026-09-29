type JpegSegment = {
  /** The marker byte after `0xff`, eg `0xfe` for `COM`. */
  marker: number;
  /** Offset of the segment's `0xff` marker prefix. */
  start: number;
  /** Offset just after the segment's payload. */
  end: number;
  /** The segment's payload, after its length field. */
  payload: Buffer;
};

const APP0 = 0xe0;
const APP1 = 0xe1;
const APP13 = 0xed;
const SOS = 0xda;
const EOI = 0xd9;
const FILL = 0xff;
const XMP_ID = "http://ns.adobe.com/xap/1.0/\0";
const XMP_IDS = [XMP_ID, "http://ns.adobe.com/xmp/extension/\0"]; // the packet, then extended xmp
const PHOTOSHOP_ID = "Photoshop 3.0\0"; // an APP13 of image resources, IPTC IIM among them

/**
 * Yields a JPEG's marker segments in order, from after `SOI` up to and including the first
 * `SOS`, which entropy-coded data follows. Stops early before a segment that runs past the
 * end of the file.
 *
 * @param jpeg - The JPEG's bytes, `SOI` included.
 */
function* jpegSegments(jpeg: Buffer): Generator<JpegSegment> {
  let start = 2; // after soi

  while (start + 4 <= jpeg.length && jpeg.readUInt8(start) === FILL) {
    const marker = jpeg.readUInt8(start + 1);

    if (marker === FILL) {
      start += 1; // padding before a marker
      continue;
    }
    if (marker === EOI) {
      return;
    }

    const end = start + 2 + jpeg.readUInt16BE(start + 2);

    if (end > jpeg.length) {
      return;
    }
    yield { marker, start, end, payload: jpeg.subarray(start + 4, end) };
    if (marker === SOS) {
      return;
    }
    start = end;
  }
}

/**
 * Returns whether a segment's payload starts with an identifier, such as {@link XMP_ID}.
 *
 * @param segment - The segment.
 * @param id - The identifier, as Latin-1 text.
 */
function hasSegmentId(segment: JpegSegment, id: string) {
  return segment.payload.toString("latin1", 0, id.length) === id;
}

/**
 * Builds a JPEG marker segment.
 *
 * @param marker - The marker byte.
 * @param payload - The payload, up to 65533 bytes.
 * @throws {RangeError} When the payload is longer.
 */
function buildJpegSegment(marker: number, payload: Buffer) {
  const header = Buffer.from([FILL, marker, 0, 0]);

  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

export default jpegSegments;
export {
  APP0,
  APP1,
  APP13,
  EOI,
  PHOTOSHOP_ID,
  SOS,
  XMP_ID,
  XMP_IDS,
  buildJpegSegment,
  hasSegmentId,
};
export type { JpegSegment };
