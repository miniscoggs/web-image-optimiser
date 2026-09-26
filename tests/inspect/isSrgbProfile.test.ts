import { describe, expect, it } from "vitest";
import isSrgbProfile from "../../src/inspect/isSrgbProfile.js";

/**
 * Builds a minimal ICC profile holding only a `desc` tag.
 *
 * @param tag - The tag's bytes, from its type signature onwards.
 * @param offset - Where the tag table says the tag starts.
 */
function buildProfile(tag: Buffer, offset = 144) {
  const table = Buffer.alloc(16);

  table.writeUInt32BE(1, 0);
  table.write("desc", 4, "latin1");
  table.writeUInt32BE(offset, 8);
  table.writeUInt32BE(tag.length, 12);
  return Buffer.concat([Buffer.alloc(128), table, tag]);
}

/**
 * Builds a v2 `desc` tag.
 *
 * @param text - The ASCII description.
 */
function buildTextDescription(text: string) {
  const tag = Buffer.alloc(12 + text.length + 1);

  tag.write("desc", 0, "latin1");
  tag.writeUInt32BE(text.length + 1, 8); // counts the terminating null
  tag.write(text, 12, "latin1");
  return tag;
}

describe("isSrgbProfile", () => {
  it("recognises a known sRGB description", () => {
    const profile = buildProfile(buildTextDescription("sRGB IEC61966-2.1"));

    expect(isSrgbProfile(profile)).toBe(true);
  });

  it("treats a similar name as another profile", () => {
    const profile = buildProfile(buildTextDescription("sRGB linear"));

    expect(isSrgbProfile(profile)).toBe(false);
  });

  it.each([
    ["a truncated header", Buffer.alloc(100)],
    [
      "a tag past the end",
      buildProfile(buildTextDescription("sRGB"), 4096).subarray(0, 144),
    ],
    ["an unknown tag type", buildProfile(Buffer.from("text\0\0\0\0sRGB"))],
  ])("returns false for %s", (_, profile) => {
    expect(isSrgbProfile(profile)).toBe(false);
  });
});
