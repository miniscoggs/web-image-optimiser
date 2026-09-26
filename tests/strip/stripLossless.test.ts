import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import type { InspectResult } from "../../src/inspect/index.js";
import jpegSegments from "../../src/inspect/jpegSegments.js";
import { decodeForScoring } from "../../src/metrics/index.js";
import { OptimiserError } from "../../src/schema/index.js";
import { parseIloc, serialiseIloc } from "../../src/strip/avifIloc.js";
import { stripLossless } from "../../src/strip/index.js";
import type { StripFormat } from "../../src/strip/index.js";
import { readBoxes, rebuildBox } from "../../src/strip/isobmff.js";
import { fixturePath, fixtures } from "../fixtureManifest.js";

const STRIPPABLE_FIXTURES = fixtures.filter(
  (fixture) => !fixture.animated && fixture.format !== "svg"
);
const XMP_PACKET =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';
const VP8X_FLAGS_OFFSET = 20; // riff header, then the vp8x chunk header
const EXIF_MAKE = "Fixture Camera Co";

/**
 * Returns the strip arguments for an inspected raster image.
 *
 * @param info - What inspect reported.
 */
function stripInfo(info: InspectResult) {
  if (info.format === "svg") {
    throw new Error("SVG is not strippable");
  }
  return { format: info.format, orientation: info.orientation };
}

/**
 * Inspects and strips an image.
 *
 * @param bytes - The image's bytes.
 */
async function strip(bytes: Buffer) {
  const before = await inspect(bytes);
  const result = stripLossless(bytes, stripInfo(before));

  return { before, ...result, after: await inspect(result.bytes) };
}

/**
 * Returns an image's stored samples, with no orientation or colour conversion.
 *
 * @param bytes - The image's bytes.
 */
function readSamples(bytes: Buffer) {
  return sharp(bytes, { ignoreIcc: true }).raw().toBuffer();
}

/**
 * Renders a 16x24 image, so tests can attach metadata to it.
 */
function renderSquare() {
  const create = {
    width: 16,
    height: 24,
    channels: 3,
    background: "#3366cc",
  } as const;

  return sharp({ create });
}

/**
 * Returns the markers of a JPEG's segments up to `SOS`.
 *
 * @param jpeg - The JPEG's bytes.
 */
function listMarkers(jpeg: Buffer) {
  return [...jpegSegments(jpeg)].map((segment) => segment.marker);
}

/**
 * Returns the types of an AVIF's `meta` children and of its `ipco` properties.
 *
 * @param avif - The AVIF's bytes.
 */
function listAvifBoxes(avif: Buffer) {
  const meta = [...readBoxes(avif, 0, avif.length)].find(
    (box) => box.type === "meta"
  );
  const children = meta
    ? [...readBoxes(avif, meta.payloadStart + 4, meta.end)]
    : [];
  const iprp = children.find((box) => box.type === "iprp");
  const ipco = iprp
    ? [...readBoxes(avif, iprp.payloadStart, iprp.end)].find(
        (box) => box.type === "ipco"
      )
    : undefined;
  const properties = ipco
    ? [...readBoxes(avif, ipco.payloadStart, ipco.end)]
    : [];

  return {
    meta: children.map((box) => box.type),
    properties: properties.map((box) => box.type),
  };
}

/**
 * Rewrites an AVIF from sharp so its Exif item's data lives in an `idat` box inside `meta`
 * rather than in `mdat`, which needs version 1 of `iloc`.
 *
 * @param avif - An AVIF whose items are an image then an Exif block, each in one extent.
 */
function moveExifToIdat(avif: Buffer) {
  const [ftyp, meta, mdat] = readBoxes(avif, 0, avif.length);
  const children = meta
    ? [...readBoxes(avif, meta.payloadStart + 4, meta.end)]
    : [];
  const ilocBox = children.find((box) => box.type === "iloc");
  const [image, exif] = ilocBox ? parseIloc(avif, ilocBox).items : [];
  const [imageExtent] = image?.extents ?? [];
  const [exifExtent] = exif?.extents ?? [];

  if (
    !ftyp ||
    !meta ||
    !mdat ||
    !ilocBox ||
    !image ||
    !exif ||
    !imageExtent ||
    !exifExtent
  ) {
    throw new Error("unexpected AVIF layout");
  }

  const imageData = avif.subarray(
    image.baseOffset,
    image.baseOffset + imageExtent.length
  );
  const exifData = avif.subarray(
    exif.baseOffset,
    exif.baseOffset + exifExtent.length
  );
  const idat = Buffer.concat([Buffer.alloc(4), Buffer.from("idat"), exifData]);
  const others = children
    .filter((box) => box.type !== "iloc")
    .map((box) => avif.subarray(box.start, box.end));
  const buildMeta = (imageOffset: number) => {
    const iloc = serialiseIloc({
      header: Buffer.from([1, 0, 0, 0, 0x44, 0x40]), // version 1; 4-byte offsets, lengths and bases
      version: 1,
      offsetSize: 4,
      lengthSize: 4,
      baseOffsetSize: 4,
      indexSize: 0,
      items: [
        { ...image, baseOffset: imageOffset },
        { ...exif, construction: 1, baseOffset: 0 }, // 1 = offsets within idat
      ],
    });
    const payload = Buffer.concat([
      avif.subarray(meta.payloadStart, meta.payloadStart + 4),
      rebuildBox(avif, ilocBox, iloc),
      ...others,
      idat,
    ]);

    return rebuildBox(avif, meta, payload);
  };
  const imageOffset = ftyp.end + buildMeta(0).length + 8; // the image data opens mdat

  idat.writeUInt32BE(idat.length, 0);
  return Buffer.concat([
    avif.subarray(ftyp.start, ftyp.end),
    buildMeta(imageOffset),
    rebuildBox(avif, mdat, imageData),
  ]);
}

/**
 * Asserts that stripping throws an `E_DECODE` error.
 *
 * @param bytes - The damaged file.
 * @param format - The format it claims to be.
 */
function expectDecodeError(bytes: Buffer, format: StripFormat) {
  const run = () => stripLossless(bytes, { format, orientation: 1 });

  expect(run).toThrow(OptimiserError);
  expect(run).toThrow(expect.objectContaining({ code: "E_DECODE" }));
}

describe("stripLossless", () => {
  it.each(STRIPPABLE_FIXTURES)(
    "strips $file without changing its pixels",
    async (fixture) => {
      const bytes = await readFile(fixturePath(fixture.file));
      const { before, bytes: stripped, removed, after } = await strip(bytes);
      const [samples, strippedSamples, decoded, strippedDecoded] =
        await Promise.all([
          readSamples(bytes),
          readSamples(stripped),
          decodeForScoring(bytes),
          decodeForScoring(stripped),
        ]);

      expect(strippedSamples.equals(samples)).toBe(true);
      expect(strippedDecoded.data.equals(decoded.data)).toBe(true);
      expect(stripped.length).toBeLessThanOrEqual(bytes.length);
      expect(after).toEqual({
        ...before,
        bytes: stripped.length,
        icc: before.icc === "non-srgb" ? "non-srgb" : null,
        metadata: before.orientation === 1 ? [] : ["exif"],
      });
      expect(removed).toEqual(expect.arrayContaining(before.metadata));
      expect(removed.includes("icc")).toBe(before.icc === "srgb");
    }
  );

  it.each(STRIPPABLE_FIXTURES)(
    "finds nothing more to strip in stripped $file",
    async (fixture) => {
      const once = await strip(await readFile(fixturePath(fixture.file)));
      const twice = stripLossless(once.bytes, stripInfo(once.after));

      expect(twice.removed).toEqual([]);
      expect(twice.bytes).toBe(once.bytes);
    }
  );

  it("keeps JPEG's JFIF and Adobe segments and a non-sRGB profile", async () => {
    const butterfly = await strip(
      await readFile(fixturePath("photo-butterfly.jpg"))
    );
    const rhino = await strip(await readFile(fixturePath("photo-rhino.jpg")));

    expect(butterfly.removed).toEqual(["exif", "gps", "icc", "iptc", "xmp"]);
    expect(listMarkers(butterfly.bytes)).toEqual([
      0xee, 0xdb, 0xdb, 0xc2, 0xc4, 0xc4, 0xda,
    ]);
    expect(rhino.removed).toEqual(["comment", "exif"]);
    expect(listMarkers(rhino.bytes)).toEqual([
      0xe0, 0xe2, 0xdb, 0xdb, 0xc2, 0xc4, 0xc4, 0xda,
    ]);
  });

  it("replaces a JPEG's EXIF with one holding only the orientation", async () => {
    const { bytes, removed } = await strip(
      await readFile(fixturePath("orientation-6.jpg"))
    );
    const [exif] = jpegSegments(bytes);

    expect(removed).toEqual(["comment", "exif", "gps", "icc", "xmp"]);
    expect(exif?.marker).toBe(0xe1);
    expect(exif && exif.end - exif.start).toBe(36); // marker, length, Exif header and a 26-byte tiff
  });

  it("drops other APPn segments and bytes after a JPEG's EOI", async () => {
    const original = await readFile(fixturePath("display-p3.jpg"));
    const ducky = Buffer.from("\xff\xec\0\x0bDucky\0\0\0\0", "latin1");
    const padded = Buffer.concat([
      original.subarray(0, 2),
      ducky,
      original.subarray(2),
      Buffer.from("appended motion photo"),
    ]);
    const { bytes, removed } = await strip(padded);

    expect(removed).toEqual(["other"]);
    expect(bytes.equals(original)).toBe(true);
  });

  it("keeps a non-sRGB PNG profile and drops an sRGB one", async () => {
    const p3 = await strip(
      await renderSquare().withIccProfile("p3").png().toBuffer()
    );
    const srgb = await strip(
      await renderSquare().withIccProfile("srgb").png().toBuffer()
    );

    expect(p3.before.icc).toBe("non-srgb");
    expect(p3.after.icc).toBe("non-srgb");
    expect(srgb.before.icc).toBe("srgb");
    expect(srgb.after.icc).toBeNull();
    expect(srgb.removed).toContain("icc");
  });

  it("reports PNG XMP as xmp rather than text", async () => {
    const { before, removed, after } = await strip(
      await renderSquare().withXmp(XMP_PACKET).png().toBuffer()
    );

    expect(before.metadata).toContain("xmp");
    expect(removed).toContain("xmp");
    expect(removed).not.toContain("text");
    expect(after.metadata).toEqual([]);
  });

  it.each(["png", "webp"] as const)(
    "keeps the orientation of a %s",
    async (format) => {
      const rotated = await renderSquare()
        .withMetadata({ orientation: 6 })
        .toFormat(format)
        .toBuffer();
      const { before, removed, after } = await strip(rotated);

      expect(before.orientation).toBe(6);
      expect(removed).toContain("exif");
      expect(after).toMatchObject({
        orientation: 6,
        width: 24,
        height: 16,
        metadata: ["exif"],
      });
    }
  );

  it("updates the WebP VP8X flags and RIFF size", async () => {
    const lossy = await strip(await readFile(fixturePath("lossy.webp")));
    const p3 = await strip(
      await renderSquare().withIccProfile("p3").webp().toBuffer()
    );

    expect(lossy.bytes.readUInt8(VP8X_FLAGS_OFFSET)).toBe(0);
    expect(lossy.bytes.readUInt32LE(4)).toBe(lossy.bytes.length - 8);
    expect(p3.bytes.readUInt8(VP8X_FLAGS_OFFSET)).toBe(0x20); // icc only
    expect(p3.after.icc).toBe("non-srgb");
  });

  it("drops bytes after a WebP's RIFF payload", async () => {
    const original = await readFile(fixturePath("lossless.webp"));
    const { bytes, removed } = await strip(
      Buffer.concat([original, Buffer.from("trailing")])
    );

    expect(removed).toEqual(["exif", "other", "xmp"]);
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  });

  it("fails on files whose structure ends early", async () => {
    const jpeg = await readFile(fixturePath("orientation-6.jpg"));
    const png = await readFile(fixturePath("gradient.png"));
    const webp = await readFile(fixturePath("lossy.webp"));
    const avif = await readFile(fixturePath("exif.avif"));

    expectDecodeError(jpeg.subarray(0, 300), "jpeg");
    expectDecodeError(png.subarray(0, 10_000), "png");
    expectDecodeError(webp.subarray(0, 10_000), "webp");
    expectDecodeError(avif.subarray(0, 200), "avif");
  });

  it("fails on a JPEG whose ICC profile segments are cut short", async () => {
    const jpeg = await readFile(fixturePath("orientation-6.jpg"));
    const empty = Buffer.from("\xff\xe2\0\x0eICC_PROFILE\0", "latin1"); // no sequence number
    const damaged = Buffer.concat([
      jpeg.subarray(0, 2),
      empty,
      empty,
      jpeg.subarray(2),
    ]);

    expectDecodeError(damaged, "jpeg");
  });

  describe("AVIF", () => {
    it("removes the Exif and XMP items and the sRGB profile, keeping irot", async () => {
      const original = await readFile(fixturePath("rotated-xmp.avif"));
      const { bytes, removed, after } = await strip(original);
      const text = bytes.toString("latin1");

      expect(removed).toEqual(["exif", "gps", "icc", "xmp"]);
      expect(listAvifBoxes(bytes)).toEqual({
        meta: ["hdlr", "iloc", "iinf", "pitm", "iprp"], // iref held only the metadata references
        properties: ["av1C", "ispe", "pixi", "irot"],
      });
      expect(text).not.toContain(EXIF_MAKE);
      expect(text).not.toContain("xmpmeta");
      expect(after).toMatchObject({ width: 320, height: 480 });
    });

    it("keeps a non-sRGB profile, leaving nothing to strip", async () => {
      const p3 = await renderSquare().withIccProfile("p3").avif().toBuffer();
      const { bytes, removed, after } = await strip(p3);

      expect(removed).toEqual([]);
      expect(bytes).toBe(p3);
      expect(after.icc).toBe("non-srgb");
    });

    it("removes an Exif item stored in idat", async () => {
      const original = moveExifToIdat(await readFile(fixturePath("exif.avif")));
      const { before, bytes, removed, after } = await strip(original);
      const [samples, strippedSamples] = await Promise.all([
        readSamples(original),
        readSamples(bytes),
      ]);

      expect(before.metadata).toEqual(["exif"]);
      expect(removed).toEqual(["exif"]);
      expect(after.metadata).toEqual([]);
      expect(strippedSamples.equals(samples)).toBe(true);
      expect(bytes.toString("latin1")).not.toContain(EXIF_MAKE);
    });
  });
});
