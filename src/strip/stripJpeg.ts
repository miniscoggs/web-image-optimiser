import isSrgbProfile from "../inspect/isSrgbProfile.js";
import jpegSegments, {
  APP0,
  APP1,
  APP13,
  EOI,
  PHOTOSHOP_ID,
  SOS,
  XMP_IDS,
  buildJpegSegment,
  hasSegmentId,
} from "../inspect/jpegSegments.js";
import type { JpegSegment } from "../inspect/jpegSegments.js";
import { OptimiserError } from "../schema/index.js";
import createExifRewriter from "./createExifRewriter.js";
import type { StripRemovedKind, StripResult } from "./types.js";

type SegmentKind = "keep" | StripRemovedKind;

const APP2 = 0xe2;
const APP14 = 0xee;
const APP15 = 0xef;
const COM = 0xfe;
const ICC_ID = "ICC_PROFILE\0";
const ICC_HEADER_LENGTH = ICC_ID.length + 2; // then sequence number and count

/**
 * Returns what a segment before `SOS` holds.
 *
 * @param segment - The segment.
 */
function classifySegment(segment: JpegSegment): SegmentKind {
  const { marker } = segment;
  const startsWith = (id: string) => hasSegmentId(segment, id);

  if (marker === COM) {
    return "comment";
  }
  if (marker < APP0 || marker > APP15) {
    return "keep"; // tables and the frame header
  }
  if (
    (marker === APP0 && startsWith("JFIF\0")) ||
    (marker === APP14 && startsWith("Adobe")) // its transform flag controls colour decoding
  ) {
    return "keep";
  }
  if (marker === APP1 && startsWith("Exif\0\0")) {
    return "exif";
  }
  if (marker === APP1 && XMP_IDS.some(startsWith)) {
    return "xmp";
  }
  if (marker === APP2 && startsWith(ICC_ID)) {
    return "icc";
  }
  if (marker === APP13 && startsWith(PHOTOSHOP_ID)) {
    return "iptc";
  }
  return "other";
}

/**
 * Returns whether a JPEG's ICC profile, split across `APP2` segments, is sRGB.
 *
 * @param payloads - The payloads of its `ICC_PROFILE` segments, in file order.
 */
function isSrgbJpegProfile(payloads: Buffer[]) {
  const profile = Buffer.concat(
    payloads
      .toSorted(
        (first, second) =>
          first.readUInt8(ICC_ID.length) - second.readUInt8(ICC_ID.length)
      )
      .map((payload) => payload.subarray(ICC_HEADER_LENGTH))
  );

  return isSrgbProfile(profile);
}

/**
 * Returns the offset just after a JPEG's `EOI` marker, scanning the entropy-coded data and any
 * segments between scans from the first `SOS`.
 *
 * @param jpeg - The JPEG's bytes.
 * @param from - The offset of the first `SOS` marker.
 * @returns The end of the image, or the file's length when it has no `EOI`.
 */
function findImageEnd(jpeg: Buffer, from: number) {
  let position = from;

  for (;;) {
    const marker = jpeg.indexOf(0xff, position);

    if (marker === -1 || marker + 2 > jpeg.length) {
      return jpeg.length;
    }

    const code = jpeg.readUInt8(marker + 1);

    if (code === EOI) {
      return marker + 2;
    }
    if (code === 0x00 || code === 0xff || (code >= 0xd0 && code <= 0xd7)) {
      position = marker + 1; // stuffed byte, fill byte or restart marker inside scan data
    } else if (marker + 4 > jpeg.length) {
      return jpeg.length;
    } else {
      position = marker + 2 + jpeg.readUInt16BE(marker + 2);
    }
  }
}

/**
 * Strips a JPEG's metadata segments, keeping `APP0` JFIF, `APP14` Adobe, a non-sRGB ICC profile,
 * an orientation-only EXIF when the orientation isn't 1, and the image data up to `EOI`.
 *
 * @param jpeg - The JPEG's bytes.
 * @param orientation - Its EXIF orientation.
 * @throws {@link OptimiserError} `E_DECODE` when the file has no `SOS` segment.
 */
function stripJpeg(jpeg: Buffer, orientation: number): StripResult {
  const segments = [...jpegSegments(jpeg)];
  const sos = segments.pop();

  if (sos?.marker !== SOS) {
    throw new OptimiserError("E_DECODE", "The JPEG has no image data");
  }

  const removed = new Set<StripRemovedKind>();
  const rewriteExif = createExifRewriter(orientation, removed);
  const classified = segments.map((segment) => ({
    segment,
    kind: classifySegment(segment),
  }));
  const iccPayloads = classified
    .filter(({ kind }) => kind === "icc")
    .map(({ segment }) => segment.payload);
  const keepIcc = iccPayloads.length > 0 && !isSrgbJpegProfile(iccPayloads);
  const pieces = [jpeg.subarray(0, 2)];

  for (const { segment, kind } of classified) {
    if (kind === "keep" || (kind === "icc" && keepIcc)) {
      pieces.push(jpeg.subarray(segment.start, segment.end));
    } else if (kind === "exif") {
      const replacement = rewriteExif(segment.payload);

      if (replacement !== undefined) {
        pieces.push(buildJpegSegment(APP1, replacement));
      }
    } else {
      removed.add(kind);
    }
  }

  const imageEnd = findImageEnd(jpeg, sos.start);

  if (imageEnd < jpeg.length) {
    removed.add("other");
  }
  pieces.push(jpeg.subarray(sos.start, imageEnd));
  return { bytes: Buffer.concat(pieces), removed: [...removed].toSorted() };
}

export default stripJpeg;
