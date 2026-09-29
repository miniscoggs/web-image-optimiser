import type { StripFormat } from "../strip/types.js";
import mergeRights from "./mergeRights.js";
import readExifRights from "./readExifRights.js";
import readIimRights from "./readIimRights.js";
import readRightsCarriers from "./readRightsCarriers.js";
import readXmpRights from "./readXmpRights.js";
import { NOT_XML } from "./types.js";
import type { ImageRights } from "./types.js";

/**
 * Trims a value, dropping the characters XML can't hold, such as the nulls binary carriers often
 * end a value with, so it reads as the packet will hold it.
 *
 * @param value - The value.
 * @returns `undefined` when nothing is left.
 */
function trimValue(value: string | undefined) {
  const trimmed = value?.replace(NOT_XML, "").trim();

  return trimmed === "" ? undefined : trimmed;
}

/**
 * Trims a list's items, dropping those left empty.
 *
 * @param items - The list.
 * @param trimItem - Trims one item, returning `undefined` when it is left empty.
 * @returns `undefined` when no item is left.
 */
function trimList<Item>(
  items: Item[] | undefined,
  trimItem: (item: Item) => Item | undefined
) {
  const kept = items?.flatMap((item) => trimItem(item) ?? []) ?? [];

  return kept.length === 0 ? undefined : kept;
}

/**
 * Trims every value of a carrier's fields, dropping those left empty.
 *
 * @param rights - The fields as the carrier held them.
 */
function trimRights(rights: ImageRights): ImageRights {
  return {
    creator: trimList(rights.creator, trimValue),
    credit: trimValue(rights.credit),
    copyright: trimList(rights.copyright, ({ lang, value }) => {
      const trimmed = trimValue(value);

      return trimmed === undefined ? undefined : { lang, value: trimmed };
    }),
    webStatement: trimValue(rights.webStatement),
    licensorUrl: trimList(rights.licensorUrl, trimValue),
    digitalSourceType: trimValue(rights.digitalSourceType),
  };
}

/**
 * Reads the copyright, licence and AI-origin fields an image carries, filling each from the
 * first carrier that has it: XMP, then IPTC IIM, then EXIF's `Artist` and `Copyright`, then
 * PNG's `Author` and `Copyright` text. Values lose the characters XML can't hold and are trimmed,
 * and empty values dropped.
 *
 * It never throws: a malformed carrier, or a file whose structure can't be read, contributes
 * nothing.
 *
 * @param bytes - The image's bytes.
 * @param format - Its format, from `inspect`.
 */
function readRights(bytes: Buffer, format: StripFormat) {
  const carriers = readRightsCarriers(bytes, format);
  const found = [
    carriers.xmp && readXmpRights(carriers.xmp),
    carriers.iim && readIimRights(carriers.iim),
    carriers.exif && readExifRights(carriers.exif),
    carriers.pngText,
  ];

  return found.reduce<ImageRights>(
    (rights, next) => mergeRights(rights, trimRights(next ?? {})),
    {}
  );
}

export default readRights;
