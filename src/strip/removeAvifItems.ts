import { OptimiserError } from "../schema/index.js";
import {
  locateItem,
  parseIloc,
  relocateItems,
  serialiseIloc,
} from "./avifIloc.js";
import type { AvifIloc } from "./avifIloc.js";
import {
  FULL_BOX_HEADER_LENGTH,
  extentRanges,
  readAvifMeta,
  rebuildIinf,
  rebuildIref,
} from "./avifItems.js";
import {
  FieldReader,
  FieldWriter,
  createOffsetMap,
  cutBox,
  readBoxes,
  rebuildBox,
} from "./isobmff.js";
import type { ByteRange, IsobmffBox } from "./isobmff.js";

type AvifEdits = {
  /** IDs of the items to remove. */
  items: Set<number>;
  /** 1-based `ipco` indices of the properties to remove. */
  properties: Set<number>;
  /** Ranges to cut from the `idat` payload, relative to it. */
  idatCuts: ByteRange[];
};

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
 * Writes the file without the removed items: the `meta` box rebuilt with the edits and relocated
 * items, and the other top-level boxes with the removed items' data cut out.
 *
 * @param avif - The AVIF's bytes.
 * @param topLevel - Its top-level boxes.
 * @param meta - Its `meta` box.
 * @param iloc - Its item locations, with only the kept items.
 * @param edits - The items, properties and `idat` ranges to remove.
 * @param fileCuts - The removed items' data outside `meta`, as absolute ranges.
 */
function writeWithout(
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
 * Removes items and properties from an AVIF: the items from `iinf`, `iloc`, `iref` and `ipma`,
 * with their data cut from `mdat` or `idat`, and the properties from `ipco`, renumbering the
 * `ipma` indices after them. `meta` is rebuilt twice, once to measure how much it shrinks, then
 * with every kept item's offsets moved by that shrink and by the bytes cut before its data.
 * Field sizes never change, and offsets only get smaller, so they always fit.
 *
 * @param avif - The AVIF's bytes.
 * @param items - IDs of the items to remove.
 * @param properties - 1-based `ipco` indices of the properties to remove.
 * @throws {@link OptimiserError} `E_DECODE` when a box is truncated, the item table is missing, or
 * a removed item's data lies outside the file's data boxes; a field read past the end throws a
 * `RangeError`.
 */
function removeAvifItems(
  avif: Buffer,
  items: Set<number>,
  properties = new Set<number>()
) {
  const { topLevel, meta, iloc: ilocBox } = readAvifMeta(avif);
  const iloc = parseIloc(avif, ilocBox);
  const removedItems = iloc.items.filter((item) => items.has(item.id));
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

  const edits = { items, properties, idatCuts: rangesAt("idat") };
  const keptIloc = {
    ...iloc,
    items: iloc.items.filter((item) => !items.has(item.id)),
  };

  return writeWithout(avif, topLevel, meta, keptIloc, edits, fileCuts);
}

export default removeAvifItems;
