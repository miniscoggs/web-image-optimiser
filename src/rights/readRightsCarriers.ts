import { EXIF_HEADER } from "../inspect/exifIfd0.js";
import jpegSegments, {
  APP1,
  APP13,
  PHOTOSHOP_ID,
  XMP_ID,
  hasSegmentId,
} from "../inspect/jpegSegments.js";
import pngChunks from "../inspect/pngChunks.js";
import {
  PNG_TEXT_CHUNKS,
  PNG_XMP_KEYWORD,
  readPngText,
} from "../inspect/pngText.js";
import { riffChunks } from "../inspect/riffChunks.js";
import { OptimiserError } from "../schema/index.js";
import { parseIloc } from "../strip/avifIloc.js";
import {
  exifItemBlock,
  readAvifMeta,
  readItemData,
  readMetadataItems,
} from "../strip/avifItems.js";
import type { StripFormat } from "../strip/types.js";
import { DEFAULT_LANGUAGE } from "./types.js";
import type { ImageRights } from "./types.js";

type RightsCarriers = {
  /** The XMP packet. */
  xmp?: Buffer;
  /** Photoshop's image resources, which hold IPTC IIM. */
  iim?: Buffer;
  /** The EXIF block. */
  exif?: Buffer;
  /** The fields PNG's `Author` and `Copyright` text keywords hold. */
  pngText?: ImageRights;
};

/**
 * Returns the carriers in a JPEG's `APP1` and `APP13` segments. Extended XMP is left out, since
 * it never holds the rights fields.
 *
 * @param jpeg - The JPEG's bytes.
 */
function readJpegCarriers(jpeg: Buffer): RightsCarriers {
  const segments = [...jpegSegments(jpeg)];
  const payloadsAfter = (marker: number, id: string) =>
    segments
      .filter(
        (segment) => segment.marker === marker && hasSegmentId(segment, id)
      )
      .map((segment) => segment.payload.subarray(id.length));
  const [xmp] = payloadsAfter(APP1, XMP_ID);
  const [exif] = payloadsAfter(APP1, EXIF_HEADER.toString("latin1"));
  const resources = payloadsAfter(APP13, PHOTOSHOP_ID); // split across segments when large

  return {
    xmp,
    iim: resources.length === 0 ? undefined : Buffer.concat(resources),
    exif,
  };
}

/**
 * Returns the carriers in a PNG's `eXIf` and text chunks.
 *
 * @param png - The PNG's bytes.
 */
function readPngCarriers(png: Buffer): RightsCarriers {
  const carriers: RightsCarriers = {};
  const pngText: ImageRights = {};

  for (const chunk of pngChunks(png)) {
    const text = PNG_TEXT_CHUNKS.has(chunk.type)
      ? readPngText(chunk.type, chunk.data)
      : undefined;
    const value = text?.text.toString(text.utf8 ? "utf8" : "latin1");

    if (chunk.type === "eXIf") {
      carriers.exif ??= chunk.data;
    } else if (text?.keyword === PNG_XMP_KEYWORD) {
      carriers.xmp ??= text.text; // xmp is utf-8 whatever the chunk
    } else if (text?.keyword === "Author" && value !== undefined) {
      pngText.creator ??= [value];
    } else if (text?.keyword === "Copyright" && value !== undefined) {
      pngText.copyright ??= [{ lang: DEFAULT_LANGUAGE, value }];
    }
  }
  return { ...carriers, pngText };
}

/**
 * Returns the carriers in a WebP's `XMP ` and `EXIF` chunks.
 *
 * @param webp - The WebP's bytes.
 */
function readWebpCarriers(webp: Buffer): RightsCarriers {
  const chunks = [...riffChunks(webp)];
  const payloadOf = (type: string) =>
    chunks.find((chunk) => chunk.type === type)?.payload;

  return { xmp: payloadOf("XMP "), exif: payloadOf("EXIF") };
}

/**
 * Returns the carriers in an AVIF's `mime` (XMP) and `Exif` items.
 *
 * @param avif - The AVIF's bytes.
 */
function readAvifCarriers(avif: Buffer): RightsCarriers {
  const { iloc, iinf, idat } = readAvifMeta(avif);
  const kinds = readMetadataItems(avif, iinf);
  const { items } = parseIloc(avif, iloc);
  const dataOf = (kind: "exif" | "xmp") => {
    const item = items.find((candidate) => kinds.get(candidate.id) === kind);

    return item && readItemData(avif, item, idat?.payloadStart);
  };
  const exif = dataOf("exif");

  return { xmp: dataOf("xmp"), exif: exif && exifItemBlock(exif) };
}

const CARRIER_READERS = {
  avif: readAvifCarriers,
  jpeg: readJpegCarriers,
  png: readPngCarriers,
  webp: readWebpCarriers,
};

/**
 * Returns the parts of an image that can carry rights fields: its XMP packet, IPTC IIM, EXIF
 * block and PNG text, the first of each kind.
 *
 * @param bytes - The image's bytes.
 * @param format - Its format.
 * @returns No carriers when the file's structure can't be read.
 */
function readRightsCarriers(
  bytes: Buffer,
  format: StripFormat
): RightsCarriers {
  try {
    return CARRIER_READERS[format](bytes);
  } catch (error) {
    if (error instanceof OptimiserError || error instanceof RangeError) {
      return {}; // a broken structure is the strip's to report
    }
    throw error;
  }
}

export default readRightsCarriers;
