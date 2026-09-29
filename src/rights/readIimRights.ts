import { DEFAULT_LANGUAGE } from "./types.js";
import type { ImageRights } from "./types.js";

const RESOURCE_SIGNATURE = "8BIM";
const IPTC_RESOURCE = 0x0404;
const DATASET_TAG = 0x1c;
const EXTENDED_LENGTH = 0x8000; // the low bits then give the size of the length field that follows
const UTF8_DECLARATION = Buffer.from([0x1b, 0x25, 0x47]); // ESC % G in dataset 1:90
const CODED_CHARACTER_SET = "1:90";
const BY_LINE = "2:80";
const CREDIT = "2:110";
const COPYRIGHT_NOTICE = "2:116";

/**
 * Returns the IPTC-NAA record among Photoshop's image resources.
 *
 * @param resources - The resources, the data of every `Photoshop 3.0` `APP13` segment joined.
 */
function findIptcRecord(resources: Buffer) {
  let offset = 0;

  while (
    offset + 12 <= resources.length &&
    resources.toString("latin1", offset, offset + 4) === RESOURCE_SIGNATURE
  ) {
    const id = resources.readUInt16BE(offset + 4);
    const nameLength = resources.readUInt8(offset + 6);
    const sizeOffset = offset + 7 + nameLength + ((nameLength + 1) % 2); // a pascal name, padded to even

    if (sizeOffset + 4 > resources.length) {
      return undefined;
    }

    const size = resources.readUInt32BE(sizeOffset);
    const dataStart = sizeOffset + 4;

    if (id === IPTC_RESOURCE) {
      return resources.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + size + (size % 2);
  }
  return undefined;
}

/**
 * Yields an IPTC record's datasets in order, stopping at anything that isn't one.
 *
 * @param record - The IPTC-NAA record.
 */
function* iimDatasets(record: Buffer) {
  let offset = 0;

  while (
    offset + 5 <= record.length &&
    record.readUInt8(offset) === DATASET_TAG
  ) {
    let length = record.readUInt16BE(offset + 3);
    let valueStart = offset + 5;

    if ((length & EXTENDED_LENGTH) !== 0) {
      const lengthSize = length & ~EXTENDED_LENGTH;

      if (
        lengthSize < 1 ||
        lengthSize > 4 ||
        valueStart + lengthSize > record.length
      ) {
        return;
      }
      length = record.readUIntBE(valueStart, lengthSize);
      valueStart += lengthSize;
    }
    yield {
      name: `${record.readUInt8(offset + 1)}:${record.readUInt8(offset + 2)}`,
      value: record.subarray(valueStart, valueStart + length),
    };
    offset = valueStart + length;
  }
}

/**
 * Reads the rights fields from IPTC IIM: By-line (2:80) as Creator, Credit (2:110) and Copyright
 * Notice (2:116). Text is UTF-8 when dataset 1:90 declares it, and Latin-1 otherwise.
 *
 * @param resources - Photoshop's image resources, the data of every `Photoshop 3.0` `APP13`
 * segment joined.
 * @returns The fields found, untrimmed.
 */
function readIimRights(resources: Buffer): ImageRights {
  const record = findIptcRecord(resources);
  const datasets = record ? [...iimDatasets(record)] : [];
  const utf8 = datasets.some(
    (dataset) =>
      dataset.name === CODED_CHARACTER_SET &&
      dataset.value.equals(UTF8_DECLARATION)
  );
  const texts = (name: string) =>
    datasets
      .filter((dataset) => dataset.name === name)
      .map((dataset) => dataset.value.toString(utf8 ? "utf8" : "latin1"));
  const [credit] = texts(CREDIT);
  const [copyright] = texts(COPYRIGHT_NOTICE);

  return {
    creator: texts(BY_LINE),
    credit,
    copyright:
      copyright === undefined
        ? undefined
        : [{ lang: DEFAULT_LANGUAGE, value: copyright }],
  };
}

export default readIimRights;
