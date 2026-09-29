import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import jpegSegments, {
  XMP_ID,
  XMP_IDS,
  buildJpegSegment,
  hasSegmentId,
} from "../../src/inspect/jpegSegments.js";
import pngChunks from "../../src/inspect/pngChunks.js";
import {
  PNG_TEXT_CHUNKS,
  PNG_XMP_KEYWORD,
  readPngKeyword,
} from "../../src/inspect/pngText.js";
import { riffChunks } from "../../src/inspect/riffChunks.js";
import {
  buildRightsPacket,
  readRights,
  setRights,
} from "../../src/rights/index.js";
import type { ImageRights } from "../../src/rights/index.js";
import { OptimiserError } from "../../src/schema/index.js";
import {
  readAvifMeta,
  readIinf,
  readItemInfo,
  readMetadataItems,
} from "../../src/strip/avifItems.js";
import { stripLossless } from "../../src/strip/index.js";
import { readBoxes } from "../../src/strip/isobmff.js";
import { fixturePath, fixtures } from "../fixtureManifest.js";
import type { FixtureEntry } from "../fixtureManifest.js";
import {
  jpegWith,
  pngTextChunk,
  pngWith,
  renderImage,
  xmpSegment,
} from "./carriers.js";

type XmpFormat = Parameters<typeof setRights>[1];

const FORMATS: XmpFormat[] = ["jpeg", "png", "webp", "avif"];
const RIGHTS: ImageRights = {
  creator: ["Ada"],
  copyright: [{ lang: "x-default", value: "Copyright Ada" }],
};
const PACKET = requirePacket(RIGHTS);
const OLD_PACKET = requirePacket({ creator: ["Grace"], credit: "Old Agency" });
const FIXTURES = fixtures.filter(
  (fixture): fixture is FixtureEntry & { format: XmpFormat } =>
    !fixture.animated && (FORMATS as string[]).includes(fixture.format)
);
const JPEG_XMP_NAMES = ["xmp", "extended-xmp"]; // in the order of XMP_IDS
const EXTENDED_XMP_ID = "http://ns.adobe.com/xmp/extension/\0";
const VP8X_FLAGS_OFFSET = 20; // riff header, then the vp8x chunk header
const MAX_JPEG_PACKET = 65504; // a segment's 65533-byte payload less the xmp identifier

/**
 * Returns the packet for rights that have fields.
 *
 * @param rights - The rights.
 */
function requirePacket(rights: ImageRights) {
  const packet = buildRightsPacket(rights);

  if (packet === undefined) {
    throw new Error("No packet was built");
  }
  return packet;
}

/**
 * Names the parts of an image in file order: a JPEG's segments up to `SOS` by marker, a PNG's
 * or WebP's chunks by type, or an AVIF's top-level boxes, items and properties by type, with each
 * XMP carrier named `xmp`.
 *
 * @param bytes - The image's bytes.
 * @param format - Its format.
 */
function listParts(bytes: Buffer, format: XmpFormat) {
  const listers = {
    jpeg: () =>
      [...jpegSegments(bytes)].map((segment) => {
        const xmpIndex = XMP_IDS.findIndex((id) => hasSegmentId(segment, id));

        return JPEG_XMP_NAMES[xmpIndex] ?? segment.marker.toString(16);
      }),
    png: () =>
      [...pngChunks(bytes)].map((chunk) =>
        PNG_TEXT_CHUNKS.has(chunk.type) &&
        readPngKeyword(chunk.data) === PNG_XMP_KEYWORD
          ? "xmp"
          : chunk.type
      ),
    webp: () =>
      [...riffChunks(bytes)].map((chunk) =>
        chunk.type === "XMP " ? "xmp" : chunk.type
      ),
    avif: () => listAvifParts(bytes),
  };

  return listers[format]();
}

/**
 * Names an AVIF's top-level boxes, its items and its properties by type, with its XMP item named
 * `xmp`.
 *
 * @param avif - The AVIF's bytes.
 */
function listAvifParts(avif: Buffer) {
  const { topLevel, iinf, iprp } = readAvifMeta(avif);
  const kinds = readMetadataItems(avif, iinf);
  const items = readIinf(avif, iinf).entries.map((infe) => {
    const { id, type } = readItemInfo(avif, infe);

    return kinds.get(id) === "xmp" ? "xmp" : (type ?? "infe");
  });
  const iprpChildren = iprp
    ? [...readBoxes(avif, iprp.payloadStart, iprp.end)]
    : [];
  const properties = iprpChildren
    .filter((box) => box.type === "ipco")
    .flatMap((box) => [...readBoxes(avif, box.payloadStart, box.end)]);

  return [
    ...topLevel.map((box) => box.type),
    ...items,
    ...properties.map((box) => box.type),
  ];
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
 * Renders a 16x24 image, so a width and height swapped would show.
 *
 * @param channels - 3 for an opaque image, or 4 for a half-transparent one.
 */
function renderTall(channels: 3 | 4) {
  const background = { r: 51, g: 102, b: 204, alpha: 0.5 };

  return sharp({ create: { width: 16, height: 24, channels, background } });
}

/**
 * Asserts that writing a packet into a damaged file throws an `E_DECODE` error.
 *
 * @param bytes - The damaged file.
 * @param format - The format it claims to be.
 */
function expectDecodeError(bytes: Buffer, format: XmpFormat) {
  const run = () => setRights(bytes, format, PACKET);

  expect(run).toThrow(OptimiserError);
  expect(run).toThrow(expect.objectContaining({ code: "E_DECODE" }));
}

describe("setRights", () => {
  it.each(FORMATS)(
    "writes a packet into a %s that readRights and sharp read back, leaving its pixels",
    async (format) => {
      const bytes = await renderImage().toFormat(format).toBuffer();
      const written = setRights(bytes, format, PACKET);
      const [samples, writtenSamples, metadata] = await Promise.all([
        readSamples(bytes),
        readSamples(written),
        sharp(written).metadata(),
      ]);

      expect(readRights(written, format)).toEqual(RIGHTS);
      expect(metadata.xmp).toEqual(PACKET);
      expect(writtenSamples.equals(samples)).toBe(true);
    }
  );

  it.each(FIXTURES)(
    "keeps everything a strip of $file keeps",
    async ({ file, format }) => {
      const bytes = await readFile(fixturePath(file));
      const { orientation } = await inspect(bytes);
      const stripped = stripLossless(bytes, { format, orientation }).bytes;
      const written = setRights(stripped, format, PACKET);
      const [before, after, samples, writtenSamples] = await Promise.all([
        inspect(stripped),
        inspect(written),
        readSamples(stripped),
        readSamples(written),
      ]);

      expect(after).toEqual({
        ...before,
        bytes: written.length,
        metadata: [...before.metadata, "xmp"],
        rights: RIGHTS,
      });
      expect(writtenSamples.equals(samples)).toBe(true);
      expect(
        listParts(written, format).filter((part) => part !== "xmp")
      ).toEqual(listParts(stripped, format));
    }
  );

  it.each(["png", "webp"] as const)(
    "keeps a stripped %s's orientation and colour profile",
    async (format) => {
      const bytes = await renderTall(3)
        .withMetadata({ orientation: 6 })
        .withIccProfile("p3")
        .toFormat(format)
        .toBuffer();
      const stripped = stripLossless(bytes, { format, orientation: 6 }).bytes;

      expect(await inspect(setRights(stripped, format, PACKET))).toMatchObject({
        orientation: 6,
        width: 24,
        height: 16,
        icc: "non-srgb",
        metadata: ["exif", "xmp"],
        rights: RIGHTS,
      });
    }
  );

  it("puts a JPEG's XMP after its APP0 and EXIF segments", async () => {
    const strip = async (file: string) => {
      const bytes = await readFile(fixturePath(file));
      const { orientation } = await inspect(bytes);

      return stripLossless(bytes, { format: "jpeg", orientation }).bytes;
    };
    const [rotated, rhino, butterfly] = await Promise.all([
      strip("orientation-6.jpg"),
      strip("photo-rhino.jpg"),
      strip("photo-butterfly.jpg"),
    ]);
    const firstParts = (jpeg: Buffer) =>
      listParts(setRights(jpeg, "jpeg", PACKET), "jpeg").slice(0, 3);

    expect(firstParts(rotated)).toEqual(["e1", "xmp", "db"]);
    expect(firstParts(rhino)).toEqual(["e0", "xmp", "e2"]);
    expect(firstParts(butterfly)).toEqual(["xmp", "ee", "db"]); // adobe's segment is kept
  });

  it("puts a PNG's XMP in an uncompressed iTXt chunk before its IDAT", async () => {
    const png = await renderImage().png().toBuffer();
    const written = setRights(png, "png", PACKET);
    const itxt = [...pngChunks(written)].find((chunk) => chunk.type === "iTXt");

    expect(listParts(written, "png")).toEqual([
      "IHDR",
      "pHYs",
      "xmp",
      "IDAT",
      "IEND",
    ]);
    expect(itxt?.data).toEqual(
      Buffer.concat([
        Buffer.from(`${PNG_XMP_KEYWORD}\0\0\0\0\0`, "latin1"),
        PACKET,
      ])
    );
  });

  it.each(FORMATS)("replaces the XMP a %s has", async (format) => {
    const bytes = await renderImage()
      .withXmp(OLD_PACKET.toString())
      .toFormat(format)
      .toBuffer();
    const written = setRights(bytes, format, PACKET);

    expect(readRights(bytes, format)).not.toEqual(RIGHTS);
    expect(readRights(written, format)).toEqual(RIGHTS);
    expect((await sharp(written).metadata()).xmp).toEqual(PACKET);
    expect(
      listParts(written, format).filter((part) => part === "xmp")
    ).toHaveLength(1);
  });

  it("drops a JPEG's Extended XMP and every XMP chunk of a PNG", async () => {
    const extended = buildJpegSegment(
      0xe1,
      Buffer.from(`${EXTENDED_XMP_ID}${"0".repeat(40)}`, "latin1") // then a guid and the data
    );
    const jpeg = await jpegWith([xmpSegment(OLD_PACKET), extended]);
    const png = await pngWith([
      pngTextChunk("tEXt", PNG_XMP_KEYWORD, OLD_PACKET.toString()),
      pngTextChunk("iTXt", PNG_XMP_KEYWORD, OLD_PACKET.toString(), true),
    ]);
    const writtenJpeg = setRights(jpeg, "jpeg", PACKET);
    const writtenPng = setRights(png, "png", PACKET);

    expect(listParts(jpeg, "jpeg").slice(0, 2)).toEqual([
      "xmp",
      "extended-xmp",
    ]);
    expect(listParts(writtenJpeg, "jpeg")).not.toContain("extended-xmp");
    expect(readRights(writtenJpeg, "jpeg")).toEqual(RIGHTS);
    expect(
      listParts(writtenPng, "png").filter((part) => part === "xmp")
    ).toHaveLength(1);
    expect(readRights(writtenPng, "png")).toEqual(RIGHTS);
  });

  it.each(FORMATS)(
    "changes nothing when a %s is given the same packet twice",
    async (format) => {
      const once = setRights(
        await renderImage().toFormat(format).toBuffer(),
        format,
        PACKET
      );

      expect(setRights(once, format, PACKET).equals(once)).toBe(true);
    }
  );

  it.each(["jpeg", "png", "avif"] as const)(
    "removes the XMP from a %s, leaving it as it was before",
    async (format) => {
      const bytes = await renderImage().toFormat(format).toBuffer();
      const once = setRights(bytes, format, PACKET);
      const removed = setRights(once, format, undefined);

      expect(removed.equals(bytes)).toBe(true);
      expect((await sharp(removed).metadata()).xmp).toBeUndefined();
    }
  );

  it.each([
    {
      name: "a lossy",
      render: () => renderTall(3).webp(),
      parts: ["VP8X", "VP8 ", "xmp"],
      flags: 0x04,
    },
    {
      name: "a lossless",
      render: () => renderTall(3).webp({ lossless: true }),
      parts: ["VP8X", "VP8L", "xmp"],
      flags: 0x04,
    },
    {
      name: "a lossless, transparent",
      render: () => renderTall(4).webp({ lossless: true }),
      parts: ["VP8X", "VP8L", "xmp"],
      flags: 0x14, // alpha and xmp
    },
    {
      name: "a lossy, transparent",
      render: () => renderTall(4).webp(),
      parts: ["VP8X", "ALPH", "VP8 ", "xmp"],
      flags: 0x14,
    },
  ])(
    "gives $name WebP a VP8X that matches its image",
    async ({ render, parts, flags }) => {
      const bytes = await render().toBuffer();
      const written = setRights(bytes, "webp", PACKET);
      const removed = setRights(written, "webp", undefined);
      const [before, after, samples, writtenSamples] = await Promise.all([
        sharp(bytes).metadata(),
        sharp(written).metadata(),
        readSamples(bytes),
        readSamples(written),
      ]);

      expect(listParts(written, "webp")).toEqual(parts);
      expect(written.readUInt8(VP8X_FLAGS_OFFSET)).toBe(flags);
      expect(written.readUInt32LE(4)).toBe(written.length - 8);
      expect(after).toMatchObject({
        width: 16,
        height: 24,
        hasAlpha: before.hasAlpha,
        xmp: PACKET,
      });
      expect(writtenSamples.equals(samples)).toBe(true);
      expect(listParts(removed, "webp")).toEqual(parts.slice(0, -1));
      expect(removed.readUInt8(VP8X_FLAGS_OFFSET)).toBe(flags & ~0x04);
      expect(readRights(removed, "webp")).toEqual({});
    }
  );

  it("fits a packet of up to 65,504 bytes in a JPEG", async () => {
    const jpeg = await renderImage().jpeg().toBuffer();
    const largest = Buffer.alloc(MAX_JPEG_PACKET, " ");

    expect(setRights(jpeg, "jpeg", largest).length).toBe(
      jpeg.length + 4 + XMP_ID.length + MAX_JPEG_PACKET
    );
    expect(() =>
      setRights(jpeg, "jpeg", Buffer.alloc(MAX_JPEG_PACKET + 1, " "))
    ).toThrow(RangeError);
  });

  it("fails on a file whose structure ends early", async () => {
    const png = await renderImage().png().toBuffer();
    const webp = await renderImage().webp().toBuffer();
    const avif = await renderImage().avif().toBuffer();
    const damagedHeader = Buffer.from(webp);

    damagedHeader.writeUInt8(0, 23); // the vp8 start code, after the frame tag
    expectDecodeError(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "jpeg");
    expectDecodeError(png.subarray(0, 33), "png"); // the signature and ihdr
    expectDecodeError(webp.subarray(0, webp.length - 4), "webp");
    expectDecodeError(damagedHeader, "webp");
    expectDecodeError(avif.subarray(0, 200), "avif"); // inside meta
  });
});
