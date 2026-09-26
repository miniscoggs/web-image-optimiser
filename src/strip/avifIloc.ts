import { FieldReader, FieldWriter } from "./isobmff.js";
import type { IsobmffBox } from "./isobmff.js";

type AvifIlocItem = {
  id: number;
  /** The raw 16-bit field of versions 1 and 2; its low 4 bits are the construction method. */
  construction: number;
  dataReferenceIndex: number;
  baseOffset: number;
  extents: { index: number; offset: number; length: number }[];
};

type AvifIloc = {
  /** The version, flags and field sizes, copied back unchanged. */
  header: Buffer;
  version: number;
  offsetSize: number;
  lengthSize: number;
  baseOffsetSize: number;
  indexSize: number;
  items: AvifIlocItem[];
};

const FILE_OFFSET = 0;
const IDAT_OFFSET = 1;

/**
 * Parses an `iloc` box, which says where each item's data lies.
 *
 * @param bytes - The file's bytes.
 * @param box - The `iloc` box.
 */
function parseIloc(bytes: Buffer, box: IsobmffBox): AvifIloc {
  const reader = new FieldReader(bytes, box.payloadStart);
  const version = reader.read(1);

  reader.read(3); // flags

  const sizes = reader.read(1);
  const moreSizes = reader.read(1);
  const idSize = version < 2 ? 2 : 4; // also the item count's size
  const iloc = {
    header: bytes.subarray(box.payloadStart, reader.position),
    version,
    offsetSize: sizes >> 4,
    lengthSize: sizes & 0xf,
    baseOffsetSize: moreSizes >> 4,
    indexSize: version === 0 ? 0 : moreSizes & 0xf,
  };
  const items = Array.from({ length: reader.read(idSize) }, () => ({
    id: reader.read(idSize),
    construction: version === 0 ? 0 : reader.read(2),
    dataReferenceIndex: reader.read(2),
    baseOffset: reader.read(iloc.baseOffsetSize),
    extents: Array.from({ length: reader.read(2) }, () => ({
      index: reader.read(iloc.indexSize),
      offset: reader.read(iloc.offsetSize),
      length: reader.read(iloc.lengthSize),
    })),
  }));

  return { ...iloc, items };
}

/**
 * Serialises an `iloc` box's payload with the field sizes it was read with.
 *
 * @param iloc - The parsed box, possibly with items removed or offsets changed.
 */
function serialiseIloc(iloc: AvifIloc) {
  const idSize = iloc.version < 2 ? 2 : 4;
  const writer = new FieldWriter().write(iloc.items.length, idSize);

  for (const item of iloc.items) {
    writer.write(item.id, idSize);
    if (iloc.version > 0) {
      writer.write(item.construction, 2);
    }
    writer
      .write(item.dataReferenceIndex, 2)
      .write(item.baseOffset, iloc.baseOffsetSize)
      .write(item.extents.length, 2);
    for (const extent of item.extents) {
      writer
        .write(extent.index, iloc.indexSize)
        .write(extent.offset, iloc.offsetSize)
        .write(extent.length, iloc.lengthSize);
    }
  }
  return Buffer.concat([iloc.header, writer.toBuffer()]);
}

/**
 * Returns where an item's data lies: `file` offsets from the start of this file, `idat`
 * offsets inside the `idat` box's payload, or `elsewhere` (another file or item).
 *
 * @param item - The item.
 */
function locateItem(item: AvifIlocItem) {
  if (item.dataReferenceIndex !== 0) {
    return "elsewhere";
  }

  const method = item.construction & 0xf;

  if (method === FILE_OFFSET) {
    return "file";
  }
  return method === IDAT_OFFSET ? "idat" : "elsewhere";
}

export { locateItem, parseIloc, serialiseIloc };
export type { AvifIloc, AvifIlocItem };
