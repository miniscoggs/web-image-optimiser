type JpegSegment = {
  /** The marker byte after `0xff`, eg `0xfe` for `COM`. */
  marker: number;
  /** Offset of the segment's `0xff` marker prefix. */
  start: number;
  /** Offset just after the segment's payload. */
  end: number;
};

const SOS = 0xda;
const EOI = 0xd9;
const FILL = 0xff;

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
    yield { marker, start, end };
    if (marker === SOS) {
      return;
    }
    start = end;
  }
}

export default jpegSegments;
export { EOI, SOS };
export type { JpegSegment };
