import { OptimiserError } from "../schema/index.js";

type IsobmffBox = {
  /** The four-character box type, eg `meta`. */
  type: string;
  /** Offset of the box's size field. */
  start: number;
  /** Offset just after the box's header. */
  payloadStart: number;
  /** Offset just after the box. */
  end: number;
};

type ByteRange = { start: number; end: number };

/**
 * Yields the boxes laid end to end between two offsets.
 *
 * @param bytes - The file's bytes.
 * @param start - Offset of the first box.
 * @param end - Offset just after the last box, usually the end of the parent's payload.
 * @throws {@link OptimiserError} `E_DECODE` when a box runs past `end`.
 */
function* readBoxes(
  bytes: Buffer,
  start: number,
  end: number
): Generator<IsobmffBox> {
  let offset = start;

  while (offset < end) {
    const declaredSize = offset + 8 <= end ? bytes.readUInt32BE(offset) : 0;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    let headerLength = type === "uuid" ? 24 : 8; // a uuid box has a 16-byte extended type
    let size = declaredSize;

    if (declaredSize === 1) {
      size = Number(bytes.readBigUInt64BE(offset + 8));
      headerLength += 8;
    } else if (declaredSize === 0) {
      size = end - offset; // runs to the end of its parent
    }
    if (offset + 8 > end || size < headerLength || offset + size > end) {
      throw new OptimiserError("E_DECODE", `An AVIF ${type} box is truncated`);
    }
    yield {
      type,
      start: offset,
      payloadStart: offset + headerLength,
      end: offset + size,
    };
    offset += size;
  }
}

/**
 * Rebuilds a box around a new payload, keeping its header's form (32-bit, 64-bit or
 * to-the-end size).
 *
 * @param bytes - The file's bytes.
 * @param box - The original box.
 * @param payload - The new payload.
 */
function rebuildBox(bytes: Buffer, box: IsobmffBox, payload: Buffer) {
  const header = Buffer.from(bytes.subarray(box.start, box.payloadStart));
  const size = header.length + payload.length;
  const declaredSize = header.readUInt32BE(0);

  if (declaredSize === 1) {
    header.writeBigUInt64BE(BigInt(size), 8);
  } else if (declaredSize !== 0) {
    header.writeUInt32BE(size, 0);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Rebuilds a box with ranges cut out of its payload.
 *
 * @param bytes - The file's bytes.
 * @param box - The box.
 * @param cuts - Ranges relative to the box's payload, sorted and not overlapping.
 */
function cutBox(bytes: Buffer, box: IsobmffBox, cuts: ByteRange[]) {
  const pieces: Buffer[] = [];
  let position = box.payloadStart;

  for (const cut of cuts) {
    pieces.push(bytes.subarray(position, box.payloadStart + cut.start));
    position = box.payloadStart + cut.end;
  }
  pieces.push(bytes.subarray(position, box.end));
  return rebuildBox(bytes, box, Buffer.concat(pieces));
}

/**
 * Creates a function mapping an offset before cuts to the same byte's offset after them.
 *
 * @param cuts - The ranges removed.
 */
function createOffsetMap(cuts: ByteRange[]) {
  return (offset: number) =>
    cuts
      .filter((cut) => cut.end <= offset)
      .reduce((shifted, cut) => shifted - (cut.end - cut.start), offset);
}

/**
 * Reads big-endian unsigned integer fields one after another.
 */
class FieldReader {
  #bytes: Buffer;
  position: number;

  /**
   * Creates a reader.
   *
   * @param bytes - The bytes to read.
   * @param position - Offset of the first field.
   */
  constructor(bytes: Buffer, position: number) {
    this.#bytes = bytes;
    this.position = position;
  }

  /**
   * Reads the next field.
   *
   * @param size - The field's size in bytes: 0 (absent, reads as 0), 1 to 6, or 8.
   * @throws RangeError when the field runs past the end of the bytes.
   */
  read(size: number) {
    const offset = this.position;

    this.position += size;
    if (size === 0) {
      return 0;
    }
    return size === 8
      ? Number(this.#bytes.readBigUInt64BE(offset))
      : this.#bytes.readUIntBE(offset, size);
  }
}

/**
 * Collects big-endian unsigned integer fields into a buffer.
 */
class FieldWriter {
  #fields: { value: number; size: number }[] = [];

  /**
   * Appends a field.
   *
   * @param value - The value, which must fit the size.
   * @param size - The field's size in bytes: 0 (written as nothing), 1 to 6, or 8.
   */
  write(value: number, size: number) {
    this.#fields.push({ value, size });
    return this;
  }

  /**
   * Returns the fields written so far, end to end.
   */
  toBuffer() {
    const buffer = Buffer.alloc(
      this.#fields.reduce((length, field) => length + field.size, 0)
    );
    let offset = 0;

    for (const { value, size } of this.#fields) {
      if (size === 8) {
        buffer.writeBigUInt64BE(BigInt(value), offset);
      } else if (size > 0) {
        buffer.writeUIntBE(value, offset, size);
      }
      offset += size;
    }
    return buffer;
  }
}

export {
  FieldReader,
  FieldWriter,
  createOffsetMap,
  cutBox,
  readBoxes,
  rebuildBox,
};
export type { ByteRange, IsobmffBox };
