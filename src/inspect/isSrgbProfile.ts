// exact descriptions only: a profile misread as srgb would be dropped and shift colours, while
// an unrecognised srgb profile is merely kept
const SRGB_DESCRIPTIONS = new Set([
  "sRGB", // libvips's compact v4 profile
  "sRGB IEC61966-2.1",
  "sRGB IEC61966-2-1 black scaled",
]);
const HEADER_LENGTH = 128;
const TAG_ENTRY_LENGTH = 12;

/**
 * Decodes the text of an ICC `desc` tag, in either the v2 `desc` or the v4 `mluc` type.
 *
 * @param tag - The tag's bytes, from its type signature onwards.
 * @returns The first description, or `undefined` when the tag can't be read.
 */
function readDescription(tag: Buffer) {
  const type = tag.toString("latin1", 0, 4);

  if (type === "desc" && tag.length >= 12) {
    const length = tag.readUInt32BE(8);

    return tag.toString("latin1", 12, 12 + length).replace(/\0+$/, "");
  }
  if (type === "mluc" && tag.length >= 28 && tag.readUInt32BE(8) > 0) {
    const length = tag.readUInt32BE(20); // first record's length and offset, in utf-16be
    const offset = tag.readUInt32BE(24);

    return new TextDecoder("utf-16be").decode(
      tag.subarray(offset, offset + length)
    );
  }
  return undefined;
}

/**
 * Returns the description of an ICC profile, the name applications show for it.
 *
 * @param icc - The profile's bytes.
 */
function describeProfile(icc: Buffer) {
  if (icc.length < HEADER_LENGTH + 4) {
    return undefined;
  }

  const tagCount = icc.readUInt32BE(HEADER_LENGTH);

  for (let index = 0; index < tagCount; index++) {
    const entry = HEADER_LENGTH + 4 + index * TAG_ENTRY_LENGTH;

    if (entry + TAG_ENTRY_LENGTH > icc.length) {
      return undefined;
    }
    if (icc.toString("latin1", entry, entry + 4) === "desc") {
      const offset = icc.readUInt32BE(entry + 4);
      const size = icc.readUInt32BE(entry + 8);

      return readDescription(icc.subarray(offset, offset + size));
    }
  }
  return undefined;
}

/**
 * Returns whether an ICC profile is a known sRGB profile, which can be dropped because sRGB is
 * what browsers assume for an untagged image.
 *
 * @param icc - The profile's bytes.
 * @returns `false` for any other profile, and for one too malformed to read.
 */
function isSrgbProfile(icc: Buffer) {
  const description = describeProfile(icc);

  return description !== undefined && SRGB_DESCRIPTIONS.has(description);
}

export default isSrgbProfile;
