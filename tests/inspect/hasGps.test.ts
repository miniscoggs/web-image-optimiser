import { describe, expect, it } from "vitest";
import hasGps from "../../src/inspect/hasGps.js";

const GPS_IFD_POINTER = 0x8825;
const ORIENTATION = 0x0112;

/**
 * Builds a big-endian TIFF block whose IFD0 holds one LONG entry per tag.
 *
 * @param tags - The tags in IFD0.
 */
function buildBigEndianTiff(tags: number[]) {
  const tiff = Buffer.alloc(8 + 2 + tags.length * 12 + 4);

  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(tags.length, 8);
  tags.forEach((tag, index) => {
    const entry = 10 + index * 12;

    tiff.writeUInt16BE(tag, entry);
    tiff.writeUInt16BE(4, entry + 2); // long
    tiff.writeUInt32BE(1, entry + 4);
  });
  return tiff;
}

describe("hasGps", () => {
  it("finds the GPS pointer in big-endian EXIF without an Exif header", () => {
    expect(hasGps(buildBigEndianTiff([ORIENTATION, GPS_IFD_POINTER]))).toBe(
      true
    );
    expect(hasGps(buildBigEndianTiff([ORIENTATION]))).toBe(false);
  });

  it.each([
    ["only an Exif header", Buffer.from("Exif\0\0", "latin1")],
    ["an unknown byte order", Buffer.from("XX\0*\0\0\0\x08\0\0", "latin1")],
    ["IFD0 past the end", Buffer.from("MM\0*\0\0\x01\0", "latin1")],
    [
      "entries past the end",
      buildBigEndianTiff([GPS_IFD_POINTER]).subarray(0, 16),
    ],
  ])("returns false for %s", (_, exif) => {
    expect(hasGps(exif)).toBe(false);
  });
});
