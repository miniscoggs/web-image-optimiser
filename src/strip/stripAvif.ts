import hasGps from "../inspect/hasGps.js";
import isSrgbProfile from "../inspect/isSrgbProfile.js";
import { parseIloc } from "./avifIloc.js";
import {
  exifItemBlock,
  readAvifMeta,
  readItemData,
  readMetadataItems,
} from "./avifItems.js";
import { readBoxes } from "./isobmff.js";
import type { IsobmffBox } from "./isobmff.js";
import removeAvifItems from "./removeAvifItems.js";
import type { StripResult } from "./types.js";

const ICC_COLOUR_TYPES = new Set(["prof", "rICC"]);

/**
 * Returns whether an `Exif` item's EXIF block has GPS data.
 *
 * @param data - The item's data.
 */
function exifItemHasGps(data: Buffer) {
  const block = exifItemBlock(data);

  return block !== undefined && hasGps(block);
}

/**
 * Returns whether an `ipco` property is a `colr` box carrying an sRGB ICC profile.
 *
 * @param bytes - The file's bytes.
 * @param property - The property box.
 */
function isSrgbColour(bytes: Buffer, property: IsobmffBox) {
  const payload = bytes.subarray(property.payloadStart, property.end);

  return (
    property.type === "colr" &&
    ICC_COLOUR_TYPES.has(payload.toString("latin1", 0, 4)) &&
    isSrgbProfile(payload.subarray(4))
  );
}

/**
 * Returns the 1-based `ipco` indices of the `colr` properties carrying an sRGB profile.
 *
 * @param bytes - The file's bytes.
 * @param iprp - The `iprp` box, if there is one.
 */
function findSrgbProperties(bytes: Buffer, iprp: IsobmffBox | undefined) {
  const ipco = iprp
    ? [...readBoxes(bytes, iprp.payloadStart, iprp.end)].find(
        (box) => box.type === "ipco"
      )
    : undefined;
  const properties = ipco
    ? [...readBoxes(bytes, ipco.payloadStart, ipco.end)]
    : [];

  return new Set(
    properties.flatMap((property, index) =>
      isSrgbColour(bytes, property) ? [index + 1] : []
    )
  );
}

/**
 * Strips an AVIF's `Exif` and `mime` (XMP) items and any sRGB `colr` profile, leaving the image
 * items, their properties (including `irot` and `imir`) and their data untouched. AVIF keeps
 * orientation in its `irot` and `imir` properties, so no EXIF is written back.
 *
 * @param avif - The AVIF's bytes.
 * @throws {@link OptimiserError} `E_DECODE` when a box is truncated or the item table is missing;
 * a field read past the end throws a `RangeError`, which `stripLossless` reports as `E_DECODE`.
 */
function stripAvif(avif: Buffer): StripResult {
  const { iloc: ilocBox, iinf, iprp, idat } = readAvifMeta(avif);
  const iloc = parseIloc(avif, ilocBox);
  const itemKinds = readMetadataItems(avif, iinf);
  const properties = findSrgbProperties(avif, iprp);
  const removed = new Set(itemKinds.values());

  if (
    iloc.items.some(
      (item) =>
        itemKinds.get(item.id) === "exif" &&
        exifItemHasGps(readItemData(avif, item, idat?.payloadStart))
    )
  ) {
    removed.add("gps");
  }
  if (properties.size > 0) {
    removed.add("icc");
  }
  if (removed.size === 0) {
    return { bytes: avif, removed: [] };
  }
  return {
    bytes: removeAvifItems(avif, new Set(itemKinds.keys()), properties),
    removed: [...removed].toSorted(),
  };
}

export default stripAvif;
