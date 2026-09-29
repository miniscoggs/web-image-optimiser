import readExifIfd0 from "../inspect/exifIfd0.js";
import { DEFAULT_LANGUAGE } from "./types.js";
import type { ImageRights } from "./types.js";

const ARTIST = 0x013b;
const COPYRIGHT = 0x8298;
const ASCII = 2;

/**
 * Decodes an EXIF text value, which many writers store as UTF-8 though EXIF says ASCII.
 *
 * @param bytes - The value's bytes.
 * @returns The text as UTF-8 when it is valid UTF-8, and as Latin-1 otherwise.
 */
function decodeText(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

/**
 * Reads the rights fields from an EXIF block's IFD0: `Artist` as Creator and `Copyright` as
 * Copyright Notice. A `Copyright` holding the photographer's and the editor's notices, split by
 * a null, gives both, joined with a space.
 *
 * @param exif - The EXIF block, with or without its `Exif\0\0` header.
 * @returns The fields found. A block too malformed to read gives none.
 */
function readExifRights(exif: Buffer): ImageRights {
  const ifd0 = readExifIfd0(exif);
  const readText = (tag: number) => {
    const entry = ifd0?.entries.find(
      (candidate) => candidate.tag === tag && candidate.type === ASCII
    );

    if (ifd0 === undefined || entry === undefined) {
      return undefined;
    }

    const start =
      entry.count <= 4 ? entry.valueField : ifd0.readUInt32(entry.valueField); // short values sit in the entry itself
    const parts = decodeText(ifd0.tiff.subarray(start, start + entry.count))
      .split("\0")
      .map((part) => part.trim());

    return parts.filter((part) => part !== "").join(" ");
  };
  const artist = readText(ARTIST);
  const copyright = readText(COPYRIGHT);

  return {
    creator: artist === undefined ? undefined : [artist],
    copyright:
      copyright === undefined
        ? undefined
        : [{ lang: DEFAULT_LANGUAGE, value: copyright }],
  };
}

export default readExifRights;
