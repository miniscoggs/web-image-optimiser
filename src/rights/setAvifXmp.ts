import { OptimiserError } from "../schema/index.js";
import { parseIloc, relocateItems, serialiseIloc } from "../strip/avifIloc.js";
import type { AvifIloc, AvifIlocItem } from "../strip/avifIloc.js";
import {
  FULL_BOX_HEADER_LENGTH,
  XMP_CONTENT_TYPE,
  irefIdSize,
  readAvifMeta,
  readIinf,
  readItemInfo,
  readMetadataItems,
  rebuildIinf,
  rebuildIref,
} from "../strip/avifItems.js";
import {
  FieldReader,
  FieldWriter,
  buildBox,
  readBoxes,
  rebuildBox,
} from "../strip/isobmff.js";
import type { IsobmffBox } from "../strip/isobmff.js";
import removeAvifItems from "../strip/removeAvifItems.js";

type AvifLayout = ReturnType<typeof readAvifMeta>;

const INFE_VERSION = 2; // 16-bit item IDs, and an item type
const HIDDEN_ITEM = 1; // libheif marks its metadata items hidden, and so does this
const IREF_VERSION = 0; // 16-bit item IDs

/**
 * Builds the `infe` box declaring an XMP item, byte for byte as libheif writes one, with an empty
 * name and an empty content encoding. The encoding is optional, but matching libheif means a file
 * carries its XMP the same way whether sharp or `setRights` wrote it.
 *
 * @param id - The item's ID.
 */
function buildXmpInfe(id: number) {
  const fields = new FieldWriter()
    .write(INFE_VERSION, 1)
    .write(HIDDEN_ITEM, 3)
    .write(id, 2)
    .write(0, 2) // protection index
    .toBuffer();
  const names = Buffer.from(`mime\0${XMP_CONTENT_TYPE}\0\0`, "latin1");

  return buildBox("infe", Buffer.concat([fields, names]));
}

/**
 * Returns the ID of an AVIF's primary item, which its XMP describes.
 *
 * @param avif - The AVIF's bytes.
 * @param pitm - Its `pitm` box, if it has one.
 * @throws {@link OptimiserError} `E_DECODE` when it has none.
 */
function readPrimaryItem(avif: Buffer, pitm: IsobmffBox | undefined) {
  if (pitm === undefined) {
    throw new OptimiserError("E_DECODE", "The AVIF has no primary item");
  }

  const reader = new FieldReader(avif, pitm.payloadStart);
  const version = reader.read(1);

  reader.read(3); // flags
  return reader.read(version === 0 ? 2 : 4);
}

/**
 * Returns an ID above every item's and entity group's, since the two share one space.
 *
 * @param avif - The AVIF's bytes.
 * @param layout - Its layout, from {@link readAvifMeta}.
 */
function nextItemId(avif: Buffer, { iinf, grpl }: AvifLayout) {
  const itemIds = readIinf(avif, iinf).entries.map(
    (infe) => readItemInfo(avif, infe).id
  );
  const groups = grpl ? [...readBoxes(avif, grpl.payloadStart, grpl.end)] : [];
  const groupIds = groups.map((group) =>
    avif.readUInt32BE(group.payloadStart + FULL_BOX_HEADER_LENGTH)
  );

  return Math.max(0, ...itemIds, ...groupIds) + 1;
}

/**
 * Builds a `cdsc` reference saying that one item describes another.
 *
 * @param from - The describing item's ID.
 * @param to - The described item's ID.
 * @param idSize - The size of the `iref` box's item IDs.
 */
function buildDescribes(from: number, to: number, idSize: number) {
  const fields = new FieldWriter()
    .write(from, idSize)
    .write(1, 2) // reference count
    .write(to, idSize);

  return buildBox("cdsc", fields.toBuffer());
}

/**
 * Builds an `iref` box holding one reference, for an AVIF that has none.
 *
 * @param reference - The reference, with 16-bit item IDs.
 */
function buildIref(reference: Buffer) {
  const header = Buffer.from([IREF_VERSION, 0, 0, 0]); // version and flags

  return buildBox("iref", Buffer.concat([header, reference]));
}

/**
 * Returns the `iloc` entry of an item whose one extent starts at a file offset, which goes in the
 * base offset when `iloc` has that field, as libheif writes it, or else in the extent's offset, as
 * libavif does.
 *
 * @param iloc - The parsed `iloc`.
 * @param id - The item's ID.
 * @param offset - Where its data starts in the file.
 * @param length - Its data's length.
 */
function fileItem(
  iloc: AvifIloc,
  id: number,
  offset: number,
  length: number
): AvifIlocItem {
  const inBase = iloc.baseOffsetSize > 0;

  return {
    id,
    construction: 0, // file offsets
    dataReferenceIndex: 0, // this file
    baseOffset: inBase ? offset : 0,
    extents: [{ index: 0, offset: inBase ? 0 : offset, length }],
  };
}

/**
 * Adds an XMP item describing an AVIF's primary item, as libheif lays one out: its `infe` after
 * the others, a `cdsc` reference in `iref` (which is created when there is none), and the packet
 * at the end of the last `mdat` (or in a new one). `meta` is built twice, once to measure how much
 * it grows, then with every file offset after it moved by that growth, and any after the packet
 * by the packet's length.
 *
 * @param avif - The AVIF's bytes, with no XMP item.
 * @param packet - The XMP packet.
 */
function addXmpItem(avif: Buffer, packet: Buffer) {
  const layout = readAvifMeta(avif);
  const { topLevel, meta, children, iref } = layout;
  const iloc = parseIloc(avif, layout.iloc);
  const id = nextItemId(avif, layout);
  const idSize = iref ? irefIdSize(avif, iref) : 2;
  const reference = buildDescribes(
    id,
    readPrimaryItem(avif, layout.pitm),
    idSize
  );
  const infe = buildXmpInfe(id);
  const mdat = topLevel.findLast((box) => box.type === "mdat");
  const insertAt = mdat?.end ?? avif.length;
  const inserted = mdat ? packet : buildBox("mdat", packet);
  const buildMeta = (items: AvifIlocItem[]) => {
    const rebuilt = children.map((child) => {
      switch (child.type) {
        case "iloc":
          return rebuildBox(avif, child, serialiseIloc({ ...iloc, items }));
        case "iinf":
          return rebuildIinf(avif, child, new Set(), [infe]);
        case "iref":
          return rebuildIref(avif, child, new Set(), [reference]);
        default:
          return avif.subarray(child.start, child.end);
      }
    });
    const header = avif.subarray(
      meta.payloadStart,
      meta.payloadStart + FULL_BOX_HEADER_LENGTH
    );
    return rebuildBox(
      avif,
      meta,
      Buffer.concat([
        header,
        ...rebuilt.filter((box) => box !== undefined),
        ...(iref ? [] : [buildIref(reference)]),
      ])
    );
  };
  const placeholder = fileItem(iloc, id, 0, packet.length);
  const growth =
    buildMeta([...iloc.items, placeholder]).length - (meta.end - meta.start); // field sizes are fixed, so offsets don't change it
  const fileOffset = (offset: number) =>
    offset +
    (offset >= meta.end ? growth : 0) +
    (offset >= insertAt ? inserted.length : 0);
  const relocated = relocateItems(iloc, fileOffset, (offset) => offset);
  const packetStart = fileOffset(insertAt) - packet.length; // the packet ends what's inserted
  const rebuiltMeta = buildMeta([
    ...relocated.items,
    fileItem(iloc, id, packetStart, packet.length),
  ]);
  const boxes = topLevel.map((box) => {
    if (box === meta) {
      return rebuiltMeta;
    }
    if (box === mdat) {
      const payload = avif.subarray(mdat.payloadStart, mdat.end);

      return rebuildBox(avif, mdat, Buffer.concat([payload, packet]));
    }
    return avif.subarray(box.start, box.end);
  });

  return Buffer.concat(mdat ? boxes : [...boxes, inserted]);
}

/**
 * Replaces an AVIF's XMP items with one holding the packet, or removes them. Every existing XMP
 * item is removed with its data and references first, so a second call with the same packet
 * changes nothing. The image items, their properties (including `irot`, `imir` and `colr`) and
 * their data are untouched.
 *
 * @param avif - The AVIF's bytes.
 * @param packet - The XMP packet, or `undefined` to remove the XMP.
 * @throws {@link OptimiserError} `E_DECODE` when a box is truncated, the item table is missing, an
 * XMP item's data lies outside the file's data boxes, or a packet is given and the file has no
 * primary item.
 * @throws {RangeError} When a field is read past the end, or the item table has no field to hold
 * the packet's offset or length.
 */
function setAvifXmp(avif: Buffer, packet: Buffer | undefined) {
  const { iinf } = readAvifMeta(avif);
  const xmpItems = [...readMetadataItems(avif, iinf)]
    .filter(([, kind]) => kind === "xmp")
    .map(([id]) => id);
  const withoutXmp =
    xmpItems.length === 0
      ? Buffer.from(avif)
      : removeAvifItems(avif, new Set(xmpItems));

  return packet === undefined ? withoutXmp : addXmpItem(withoutXmp, packet);
}

export default setAvifXmp;
