import { OptimiserError } from "../schema/index.js";
import { locateItem } from "./avifIloc.js";
import type { AvifIlocItem } from "./avifIloc.js";
import { FieldReader, FieldWriter, readBoxes, rebuildBox } from "./isobmff.js";
import type { IsobmffBox } from "./isobmff.js";
import type { StripRemovedKind } from "./types.js";

const FULL_BOX_HEADER_LENGTH = 4; // version and flags
const XMP_CONTENT_TYPE = "application/rdf+xml";

/**
 * Returns an AVIF's top-level boxes, its `meta` box, the children of `meta`, and by name those
 * that hold or describe its items.
 *
 * @param avif - The AVIF's bytes.
 * @throws {@link OptimiserError} `E_DECODE` when a box is truncated or the item table is missing.
 */
function readAvifMeta(avif: Buffer) {
  const topLevel = [...readBoxes(avif, 0, avif.length)];
  const meta = topLevel.find((box) => box.type === "meta");
  const children = meta
    ? [...readBoxes(avif, meta.payloadStart + FULL_BOX_HEADER_LENGTH, meta.end)]
    : [];
  const findChild = (type: string) => children.find((box) => box.type === type);
  const iloc = findChild("iloc");
  const iinf = findChild("iinf");

  if (meta === undefined || iloc === undefined || iinf === undefined) {
    throw new OptimiserError("E_DECODE", "The AVIF has no item table");
  }
  return {
    topLevel,
    meta,
    children,
    iloc,
    iinf,
    iprp: findChild("iprp"),
    idat: findChild("idat"),
    iref: findChild("iref"),
    pitm: findChild("pitm"),
    grpl: findChild("grpl"),
  };
}

/**
 * Returns an `iinf` box's `infe` entries and the size of its entry count field.
 *
 * @param bytes - The file's bytes.
 * @param iinf - The `iinf` box.
 */
function readIinf(bytes: Buffer, iinf: IsobmffBox) {
  const countSize = bytes.readUInt8(iinf.payloadStart) === 0 ? 2 : 4;
  const entriesStart = iinf.payloadStart + FULL_BOX_HEADER_LENGTH + countSize;

  return { countSize, entries: [...readBoxes(bytes, entriesStart, iinf.end)] };
}

/**
 * Returns the ID, type and content type an `infe` box declares.
 *
 * @param bytes - The file's bytes.
 * @param infe - The `infe` box.
 * @returns `type` is `undefined` for versions 0 and 1, which declare none.
 */
function readItemInfo(bytes: Buffer, infe: IsobmffBox) {
  const reader = new FieldReader(bytes, infe.payloadStart);
  const version = reader.read(1);

  reader.read(3); // flags

  const id = reader.read(version === 3 ? 4 : 2);

  if (version < 2) {
    return { id, type: undefined, contentType: undefined };
  }
  reader.read(2); // protection index

  const typeStart = reader.position;
  const [, contentType] = bytes
    .toString("latin1", typeStart + 4, infe.end)
    .split("\0"); // item name, then a mime item's content type

  return {
    id,
    type: bytes.toString("latin1", typeStart, typeStart + 4),
    contentType,
  };
}

/**
 * Returns what kind of metadata an item holds, or `undefined` for an item to keep.
 *
 * @param info - The item's declared type and content type.
 */
function classifyItem(info: ReturnType<typeof readItemInfo>) {
  if (info.type === "Exif") {
    return "exif";
  }
  if (info.type === "mime") {
    return info.contentType === XMP_CONTENT_TYPE ? "xmp" : "other";
  }
  return undefined;
}

/**
 * Returns the kind of every metadata item an `iinf` box declares, by item ID.
 *
 * @param bytes - The file's bytes.
 * @param iinf - The `iinf` box.
 */
function readMetadataItems(bytes: Buffer, iinf: IsobmffBox) {
  const kinds = new Map<number, StripRemovedKind>();

  for (const infe of readIinf(bytes, iinf).entries) {
    const info = readItemInfo(bytes, infe);
    const kind = classifyItem(info);

    if (kind !== undefined) {
      kinds.set(info.id, kind);
    }
  }
  return kinds;
}

/**
 * Returns the ranges an item's extents cover, `file` extents as absolute offsets and `idat`
 * extents relative to the `idat` payload.
 *
 * @param item - The item.
 */
function extentRanges(item: AvifIlocItem) {
  return item.extents.map((extent) => {
    const start = item.baseOffset + extent.offset;

    return { start, end: start + extent.length };
  });
}

/**
 * Rebuilds an `iinf` box without the removed items, and with any added entries after the rest.
 *
 * @param bytes - The file's bytes.
 * @param iinf - The `iinf` box.
 * @param removedItems - IDs of the items to remove.
 * @param added - `infe` boxes to add.
 */
function rebuildIinf(
  bytes: Buffer,
  iinf: IsobmffBox,
  removedItems: Set<number>,
  added: Buffer[] = []
) {
  const { countSize, entries } = readIinf(bytes, iinf);
  const kept = entries
    .filter((infe) => !removedItems.has(readItemInfo(bytes, infe).id))
    .map((infe) => bytes.subarray(infe.start, infe.end));
  const payload = Buffer.concat([
    bytes.subarray(
      iinf.payloadStart,
      iinf.payloadStart + FULL_BOX_HEADER_LENGTH
    ),
    new FieldWriter().write(kept.length + added.length, countSize).toBuffer(),
    ...kept,
    ...added,
  ]);

  return rebuildBox(bytes, iinf, payload);
}

/**
 * Returns the size of the item IDs in an `iref` box's references.
 *
 * @param bytes - The file's bytes.
 * @param iref - The `iref` box.
 */
function irefIdSize(bytes: Buffer, iref: IsobmffBox) {
  return bytes.readUInt8(iref.payloadStart) === 0 ? 2 : 4;
}

/**
 * Rebuilds an `iref` box without references from or to the removed items, and with any added
 * references after the rest.
 *
 * @param bytes - The file's bytes.
 * @param iref - The `iref` box.
 * @param removedItems - IDs of the items to remove.
 * @param added - Reference boxes to add, with IDs of the size {@link irefIdSize} gives.
 * @returns The box, or `undefined` when no references remain.
 */
function rebuildIref(
  bytes: Buffer,
  iref: IsobmffBox,
  removedItems: Set<number>,
  added: Buffer[] = []
) {
  const idSize = irefIdSize(bytes, iref);
  const references: Buffer[] = [];

  for (const reference of readBoxes(
    bytes,
    iref.payloadStart + FULL_BOX_HEADER_LENGTH,
    iref.end
  )) {
    const reader = new FieldReader(bytes, reference.payloadStart);
    const from = reader.read(idSize);
    const to = Array.from({ length: reader.read(2) }, () =>
      reader.read(idSize)
    ).filter((id) => !removedItems.has(id));

    if (!removedItems.has(from) && to.length > 0) {
      const writer = new FieldWriter().write(from, idSize).write(to.length, 2);

      for (const id of to) {
        writer.write(id, idSize);
      }
      references.push(rebuildBox(bytes, reference, writer.toBuffer()));
    }
  }
  references.push(...added);
  if (references.length === 0) {
    return undefined;
  }

  const header = bytes.subarray(
    iref.payloadStart,
    iref.payloadStart + FULL_BOX_HEADER_LENGTH
  );

  return rebuildBox(bytes, iref, Buffer.concat([header, ...references]));
}

/**
 * Returns an item's data joined from its extents.
 *
 * @param bytes - The file's bytes.
 * @param item - The item.
 * @param idatStart - Offset of the `idat` payload, if there is one.
 */
function readItemData(bytes: Buffer, item: AvifIlocItem, idatStart?: number) {
  const origin = locateItem(item) === "idat" ? (idatStart ?? 0) : 0;
  const extents = extentRanges(item).map((range) =>
    bytes.subarray(origin + range.start, origin + range.end)
  );

  return Buffer.concat(extents);
}

/**
 * Returns the EXIF block inside an `Exif` item's data.
 *
 * @param data - The item's data: a 32-bit offset to the TIFF header, then the EXIF block.
 * @returns `undefined` when the data is too short to hold the offset.
 */
function exifItemBlock(data: Buffer) {
  return data.length < 4 ? undefined : data.subarray(4 + data.readUInt32BE(0));
}

export {
  FULL_BOX_HEADER_LENGTH,
  XMP_CONTENT_TYPE,
  exifItemBlock,
  extentRanges,
  irefIdSize,
  readAvifMeta,
  readIinf,
  readItemData,
  readItemInfo,
  readMetadataItems,
  rebuildIinf,
  rebuildIref,
};
