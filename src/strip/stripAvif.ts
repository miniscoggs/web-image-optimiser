import hasGps from "../inspect/hasGps.js";
import isSrgbProfile from "../inspect/isSrgbProfile.js";
import { OptimiserError } from "../schema/index.js";
import { locateItem, parseIloc, serialiseIloc } from "./avifIloc.js";
import type { AvifIloc, AvifIlocItem } from "./avifIloc.js";
import {
  FieldReader,
  FieldWriter,
  createOffsetMap,
  cutBox,
  readBoxes,
  rebuildBox,
} from "./isobmff.js";
import type { ByteRange, IsobmffBox } from "./isobmff.js";
import type { StripRemovedKind, StripResult } from "./types.js";

type AvifEdits = {
  /** IDs of the metadata items to remove. */
  items: Set<number>;
  /** 1-based `ipco` indices of the properties to remove. */
  properties: Set<number>;
  /** Ranges to cut from the `idat` payload, relative to it. */
  idatCuts: ByteRange[];
};

const FULL_BOX_HEADER_LENGTH = 4; // version and flags
const ICC_COLOUR_TYPES = new Set(["prof", "rICC"]);
const XMP_CONTENT_TYPE = "application/rdf+xml";

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
 * Returns whether an `Exif` item's EXIF block has GPS data.
 *
 * @param data - The item's data: a 32-bit offset to the TIFF header, then the EXIF block.
 */
function exifItemHasGps(data: Buffer) {
  return data.length >= 4 && hasGps(data.subarray(4 + data.readUInt32BE(0)));
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
 * Sorts ranges and merges any that overlap or touch.
 *
 * @param ranges - The ranges.
 */
function mergeRanges(ranges: ByteRange[]) {
  const merged: ByteRange[] = [];

  for (const range of ranges.toSorted(
    (first, second) => first.start - second.start
  )) {
    const last = merged.at(-1);

    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Moves the kept items' offsets to where their data lies after the cuts.
 *
 * @param iloc - The parsed `iloc`, with only kept items.
 * @param fileOffset - Maps a file offset from before the strip to after it.
 * @param idatOffset - Maps an `idat` offset from before the strip to after it.
 */
function relocateItems(
  iloc: AvifIloc,
  fileOffset: (offset: number) => number,
  idatOffset: (offset: number) => number
): AvifIloc {
  const items = iloc.items.map((item) => {
    const location = locateItem(item);
    const map = location === "file" ? fileOffset : idatOffset;

    if (location === "elsewhere") {
      return item;
    }

    const baseOffset = map(item.baseOffset);

    return {
      ...item,
      baseOffset,
      extents: item.extents.map((extent) => ({
        ...extent,
        offset: map(item.baseOffset + extent.offset) - baseOffset,
      })),
    };
  });

  return { ...iloc, items };
}

/**
 * Rebuilds an `iinf` box without the removed items.
 *
 * @param bytes - The file's bytes.
 * @param iinf - The `iinf` box.
 * @param removedItems - IDs of the items to remove.
 */
function rebuildIinf(
  bytes: Buffer,
  iinf: IsobmffBox,
  removedItems: Set<number>
) {
  const { countSize, entries } = readIinf(bytes, iinf);
  const kept = entries.filter(
    (infe) => !removedItems.has(readItemInfo(bytes, infe).id)
  );
  const payload = Buffer.concat([
    bytes.subarray(
      iinf.payloadStart,
      iinf.payloadStart + FULL_BOX_HEADER_LENGTH
    ),
    new FieldWriter().write(kept.length, countSize).toBuffer(),
    ...kept.map((infe) => bytes.subarray(infe.start, infe.end)),
  ]);

  return rebuildBox(bytes, iinf, payload);
}

/**
 * Rebuilds an `iref` box without references from or to the removed items.
 *
 * @param bytes - The file's bytes.
 * @param iref - The `iref` box.
 * @param removedItems - IDs of the items to remove.
 * @returns The box, or `undefined` when no references remain.
 */
function rebuildIref(
  bytes: Buffer,
  iref: IsobmffBox,
  removedItems: Set<number>
) {
  const idSize = bytes.readUInt8(iref.payloadStart) === 0 ? 2 : 4;
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
 * Rebuilds an `ipma` box without the removed items and properties, renumbering the property
 * indices that follow a removed property.
 *
 * @param bytes - The file's bytes.
 * @param ipma - The `ipma` box.
 * @param edits - The items and properties to remove.
 */
function rebuildIpma(bytes: Buffer, ipma: IsobmffBox, edits: AvifEdits) {
  const reader = new FieldReader(bytes, ipma.payloadStart);
  const version = reader.read(1);
  const flags = reader.read(3);
  const idSize = version < 1 ? 2 : 4;
  const indexSize = (flags & 1) === 1 ? 2 : 1;
  const essential = indexSize === 2 ? 0x8000 : 0x80; // the top bit; the rest is the index
  const removedProperties = [...edits.properties];
  const writer = new FieldWriter();
  let keptEntries = 0;

  for (let entry = reader.read(4); entry > 0; entry--) {
    const id = reader.read(idSize);
    const associations = Array.from({ length: reader.read(1) }, () =>
      reader.read(indexSize)
    );

    if (!edits.items.has(id)) {
      const renumbered = associations
        .filter(
          (association) => !edits.properties.has(association & (essential - 1))
        )
        .map(
          (association) =>
            association -
            removedProperties.filter(
              (removed) => removed < (association & (essential - 1))
            ).length
        );

      writer.write(id, idSize).write(renumbered.length, 1);
      for (const association of renumbered) {
        writer.write(association, indexSize);
      }
      keptEntries++;
    }
  }

  const header = bytes.subarray(
    ipma.payloadStart,
    ipma.payloadStart + FULL_BOX_HEADER_LENGTH
  );
  const count = new FieldWriter().write(keptEntries, 4).toBuffer();

  return rebuildBox(
    bytes,
    ipma,
    Buffer.concat([header, count, writer.toBuffer()])
  );
}

/**
 * Rebuilds an `iprp` box without the removed properties and items.
 *
 * @param bytes - The file's bytes.
 * @param iprp - The `iprp` box.
 * @param edits - The items and properties to remove.
 */
function rebuildIprp(bytes: Buffer, iprp: IsobmffBox, edits: AvifEdits) {
  const children = [...readBoxes(bytes, iprp.payloadStart, iprp.end)].map(
    (child) => {
      if (child.type === "ipma") {
        return rebuildIpma(bytes, child, edits);
      }
      if (child.type !== "ipco") {
        return bytes.subarray(child.start, child.end);
      }

      const kept = [...readBoxes(bytes, child.payloadStart, child.end)]
        .filter((_, index) => !edits.properties.has(index + 1))
        .map((property) => bytes.subarray(property.start, property.end));

      return rebuildBox(bytes, child, Buffer.concat(kept));
    }
  );

  return rebuildBox(bytes, iprp, Buffer.concat(children));
}

/**
 * Rebuilds the `meta` box with the edits applied and the given item locations.
 *
 * @param bytes - The file's bytes.
 * @param meta - The `meta` box.
 * @param iloc - The item locations to write, with only kept items.
 * @param edits - The items, properties and `idat` ranges to remove.
 */
function rebuildMeta(
  bytes: Buffer,
  meta: IsobmffBox,
  iloc: AvifIloc,
  edits: AvifEdits
) {
  const children = [
    ...readBoxes(bytes, meta.payloadStart + FULL_BOX_HEADER_LENGTH, meta.end),
  ];
  const rebuilt = children.map((child) => {
    switch (child.type) {
      case "iloc":
        return rebuildBox(bytes, child, serialiseIloc(iloc));
      case "iinf":
        return rebuildIinf(bytes, child, edits.items);
      case "iref":
        return rebuildIref(bytes, child, edits.items);
      case "iprp":
        return rebuildIprp(bytes, child, edits);
      case "idat":
        return cutBox(bytes, child, edits.idatCuts);
      default:
        return bytes.subarray(child.start, child.end);
    }
  });
  const header = bytes.subarray(
    meta.payloadStart,
    meta.payloadStart + FULL_BOX_HEADER_LENGTH
  );

  return rebuildBox(
    bytes,
    meta,
    Buffer.concat([header, ...rebuilt.filter((box) => box !== undefined)])
  );
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
 * Writes the stripped file: the `meta` box rebuilt with the edits and relocated items, and the
 * other top-level boxes with the removed items' data cut out.
 *
 * @param avif - The AVIF's bytes.
 * @param topLevel - Its top-level boxes.
 * @param meta - Its `meta` box.
 * @param iloc - Its item locations, with only the kept items.
 * @param edits - The items, properties and `idat` ranges to remove.
 * @param fileCuts - The removed items' data outside `meta`, as absolute ranges.
 */
function writeStripped(
  avif: Buffer,
  topLevel: IsobmffBox[],
  meta: IsobmffBox,
  iloc: AvifIloc,
  edits: AvifEdits,
  fileCuts: ByteRange[]
) {
  const metaShrink =
    meta.end - meta.start - rebuildMeta(avif, meta, iloc, edits).length; // relocating keeps field sizes, so this stays true
  const fileOffset = createOffsetMap([
    ...fileCuts,
    { start: meta.end - metaShrink, end: meta.end },
  ]);
  const idatOffset = createOffsetMap(edits.idatCuts);
  const relocated = relocateItems(iloc, fileOffset, idatOffset);

  return Buffer.concat(
    topLevel.map((box) => {
      if (box === meta) {
        return rebuildMeta(avif, meta, relocated, edits);
      }

      const cuts = fileCuts
        .filter((cut) => cut.start >= box.payloadStart && cut.end <= box.end)
        .map((cut) => ({
          start: cut.start - box.payloadStart,
          end: cut.end - box.payloadStart,
        }));

      return cuts.length === 0
        ? avif.subarray(box.start, box.end)
        : cutBox(avif, box, cuts);
    })
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
  const topLevel = [...readBoxes(avif, 0, avif.length)];
  const meta = topLevel.find((box) => box.type === "meta");
  const children = meta
    ? [...readBoxes(avif, meta.payloadStart + FULL_BOX_HEADER_LENGTH, meta.end)]
    : [];
  const findChild = (type: string) => children.find((box) => box.type === type);
  const ilocBox = findChild("iloc");
  const iinfBox = findChild("iinf");

  if (meta === undefined || ilocBox === undefined || iinfBox === undefined) {
    throw new OptimiserError("E_DECODE", "The AVIF has no item table");
  }

  const iloc = parseIloc(avif, ilocBox);
  const itemKinds = readMetadataItems(avif, iinfBox);
  const removedItems = iloc.items.filter((item) => itemKinds.has(item.id));
  const properties = findSrgbProperties(avif, findChild("iprp"));
  const removed = new Set(itemKinds.values());
  const idatStart = findChild("idat")?.payloadStart;

  if (
    removedItems.some(
      (item) =>
        itemKinds.get(item.id) === "exif" &&
        exifItemHasGps(readItemData(avif, item, idatStart))
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

  const rangesAt = (location: string) =>
    mergeRanges(
      removedItems
        .filter((item) => locateItem(item) === location)
        .flatMap(extentRanges)
    );
  const fileCuts = rangesAt("file");
  const dataBoxes = topLevel.filter((box) => box !== meta);

  if (
    !fileCuts.every((cut) =>
      dataBoxes.some(
        (box) => cut.start >= box.payloadStart && cut.end <= box.end
      )
    )
  ) {
    throw new OptimiserError(
      "E_DECODE",
      "An AVIF metadata item lies outside the file's data boxes"
    );
  }

  const edits = {
    items: new Set(itemKinds.keys()),
    properties,
    idatCuts: rangesAt("idat"),
  };
  const keptIloc = {
    ...iloc,
    items: iloc.items.filter((item) => !itemKinds.has(item.id)),
  };

  return {
    bytes: writeStripped(avif, topLevel, meta, keptIloc, edits, fileCuts),
    removed: [...removed].toSorted(),
  };
}

export default stripAvif;
