import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";

type IimDataset = [record: number, dataset: number, value: Buffer];

const XMP_ID = "http://ns.adobe.com/xap/1.0/\0";
const ARTIST = 0x013b;
const COPYRIGHT = 0x8298;

/**
 * Wraps `rdf:Description` elements in an XMP packet's `x:xmpmeta` and `rdf:RDF` elements.
 *
 * @param descriptions - The descriptions, which declare the namespaces they use.
 */
function xmpPacket(descriptions: string) {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${descriptions}</rdf:RDF></x:xmpmeta>`;
}

/**
 * Renders a small opaque image, so tests can attach carriers to it.
 */
function renderImage() {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: "#336699" },
  });
}

/**
 * Builds a JPEG marker segment.
 *
 * @param marker - The marker byte, eg 0xe1 for APP1.
 * @param payload - The payload.
 */
function jpegSegment(marker: number, payload: Buffer) {
  const header = Buffer.from([0xff, marker, 0, 0]);

  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/**
 * Builds a JPEG with segments inserted straight after its `SOI`.
 *
 * @param segments - Complete segments.
 */
async function jpegWith(segments: Buffer[]) {
  const jpeg = await renderImage().jpeg().toBuffer();

  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

/**
 * Builds an `APP1` segment holding an XMP packet.
 *
 * @param packet - The packet.
 */
function xmpSegment(packet: string | Buffer) {
  return jpegSegment(
    0xe1,
    Buffer.concat([Buffer.from(XMP_ID, "latin1"), Buffer.from(packet)])
  );
}

/**
 * Builds Photoshop's image resources holding an IPTC-NAA record, as an `APP13` segment's data
 * after its `Photoshop 3.0` identifier. A named resource comes first, to exercise the padding.
 *
 * @param datasets - The record's datasets, in order.
 */
function iimResources(datasets: IimDataset[]) {
  const resource = (id: number, name: string, data: Buffer) => {
    const nameField = Buffer.from(`${String.fromCharCode(name.length)}${name}`);
    const header = Buffer.concat([
      Buffer.from("8BIM", "latin1"),
      Buffer.from([id >> 8, id & 0xff]),
      nameField,
      Buffer.alloc(nameField.length % 2),
      Buffer.alloc(4),
    ]);

    header.writeUInt32BE(data.length, header.length - 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
  };
  const record = Buffer.concat(
    datasets.map(([recordNumber, dataset, value]) => {
      const extended = value.length > 0x7fff; // then a 4-byte length follows
      const header = Buffer.alloc(extended ? 9 : 5);

      header.set([0x1c, recordNumber, dataset]);
      if (extended) {
        header.writeUInt16BE(0x8004, 3);
        header.writeUInt32BE(value.length, 5);
      } else {
        header.writeUInt16BE(value.length, 3);
      }
      return Buffer.concat([header, value]);
    })
  );

  return Buffer.concat([
    resource(0x03ed, "res", Buffer.from([1, 2, 3])),
    resource(0x0404, "", record),
  ]);
}

/**
 * Builds `APP13` segments holding IPTC IIM, split across as many segments as asked.
 *
 * @param datasets - The record's datasets, in order.
 * @param parts - How many segments to split the resources across.
 */
function iimSegments(datasets: IimDataset[], parts = 1) {
  const resources = iimResources(datasets);
  const partLength = Math.ceil(resources.length / parts);

  return Array.from({ length: parts }, (_, index) =>
    jpegSegment(
      0xed,
      Buffer.concat([
        Buffer.from("Photoshop 3.0\0", "latin1"),
        resources.subarray(index * partLength, (index + 1) * partLength),
      ])
    )
  );
}

/**
 * Builds a little-endian EXIF TIFF block whose IFD0 holds `Artist` and `Copyright` as ASCII.
 *
 * @param text - The raw bytes of each tag to write, null terminator included.
 */
function exifBlock(text: { artist?: Buffer; copyright?: Buffer }) {
  const entries = [
    { tag: ARTIST, value: text.artist },
    { tag: COPYRIGHT, value: text.copyright },
  ].flatMap(({ tag, value }) => (value ? [{ tag, value }] : []));
  const directoryEnd = 8 + 2 + entries.length * 12 + 4;
  const directory = Buffer.alloc(directoryEnd);
  const values: Buffer[] = [];
  let valueOffset = directoryEnd;

  directory.write("II*\0", 0, "latin1");
  directory.writeUInt32LE(8, 4);
  directory.writeUInt16LE(entries.length, 8);
  entries.forEach(({ tag, value }, index) => {
    const entry = 10 + index * 12;

    directory.writeUInt16LE(tag, entry);
    directory.writeUInt16LE(2, entry + 2); // ascii
    directory.writeUInt32LE(value.length, entry + 4);
    if (value.length <= 4) {
      value.copy(directory, entry + 8);
    } else {
      directory.writeUInt32LE(valueOffset, entry + 8);
      values.push(value);
      valueOffset += value.length;
    }
  });
  return Buffer.concat([directory, ...values]);
}

/**
 * Builds an `APP1` segment holding an EXIF block.
 *
 * @param tiff - The EXIF TIFF block.
 */
function exifSegment(tiff: Buffer) {
  return jpegSegment(
    0xe1,
    Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff])
  );
}

/**
 * Builds a PNG chunk, including its CRC.
 *
 * @param type - The four-letter chunk type.
 * @param data - The chunk's data.
 */
function pngChunk(type: string, data: Buffer) {
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const chunk = Buffer.alloc(typeAndData.length + 8);

  chunk.writeUInt32BE(data.length, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), chunk.length - 4);
  return chunk;
}

/**
 * Builds a PNG text chunk: `tEXt` and `zTXt` in Latin-1, `iTXt` in UTF-8, compressed or not.
 *
 * @param type - The chunk type.
 * @param keyword - The keyword.
 * @param text - The text.
 * @param compressed - Whether an `iTXt` compresses its text.
 */
function pngTextChunk(
  type: "tEXt" | "zTXt" | "iTXt",
  keyword: string,
  text: string,
  compressed = false
) {
  const keywordField = Buffer.from(`${keyword}\0`, "latin1");
  const fields = {
    tEXt: () => [Buffer.from(text, "latin1")],
    zTXt: () => [Buffer.from([0]), deflateSync(Buffer.from(text, "latin1"))],
    iTXt: () => [
      Buffer.from([compressed ? 1 : 0, 0]),
      Buffer.from("en\0\0", "latin1"), // language tag, then an empty translated keyword
      compressed ? deflateSync(Buffer.from(text)) : Buffer.from(text),
    ],
  };

  return pngChunk(type, Buffer.concat([keywordField, ...fields[type]()]));
}

/**
 * Builds a PNG with chunks inserted straight after its `IHDR`.
 *
 * @param chunks - Complete chunks.
 */
async function pngWith(chunks: Buffer[]) {
  const png = await renderImage().png().toBuffer();
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);

  return Buffer.concat([
    png.subarray(0, ihdrEnd),
    ...chunks,
    png.subarray(ihdrEnd),
  ]);
}

export {
  exifBlock,
  exifSegment,
  iimSegments,
  jpegWith,
  pngChunk,
  pngTextChunk,
  pngWith,
  renderImage,
  xmpPacket,
  xmpSegment,
};
export type { IimDataset };
