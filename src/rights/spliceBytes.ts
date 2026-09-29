type ByteEdit = {
  /** Offset of the first byte replaced. */
  start: number;
  /** Offset just after the last byte replaced, or `start` for an insertion. */
  end: number;
  /** What replaces them, or nothing for a removal. */
  bytes?: Buffer;
};

/**
 * Orders edits by offset, with an insertion before a removal that starts where it does.
 *
 * @param first - One edit.
 * @param second - The other.
 */
function compareEdits(first: ByteEdit, second: ByteEdit) {
  return first.start - second.start || first.end - second.end;
}

/**
 * Returns a copy of a buffer with ranges replaced, and every byte outside them as it was.
 *
 * @param bytes - The buffer.
 * @param edits - The ranges and their replacements, in any order, which must not overlap.
 */
function spliceBytes(bytes: Buffer, edits: ByteEdit[]) {
  const pieces: Buffer[] = [];
  let cursor = 0;

  for (const edit of edits.toSorted(compareEdits)) {
    pieces.push(
      bytes.subarray(cursor, edit.start),
      edit.bytes ?? Buffer.alloc(0)
    );
    cursor = edit.end;
  }
  pieces.push(bytes.subarray(cursor));
  return Buffer.concat(pieces);
}

export default spliceBytes;
export type { ByteEdit };
