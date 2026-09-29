import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import {
  buildRightsPacket,
  readRights,
  setRights,
} from "../../src/rights/index.js";
import type { ImageRights } from "../../src/rights/index.js";
import { OptimiserError } from "../../src/schema/index.js";
import { parseIloc, serialiseIloc } from "../../src/strip/avifIloc.js";
import type { AvifIloc } from "../../src/strip/avifIloc.js";
import {
  readAvifMeta,
  readIinf,
  readItemInfo,
} from "../../src/strip/avifItems.js";
import { stripLossless } from "../../src/strip/index.js";
import { FieldWriter, buildBox, rebuildBox } from "../../src/strip/isobmff.js";

type Reshape = {
  /** Boxes to add at the end of `meta`. */
  add?: Buffer[];
  /** Whether to keep `mdat`, false when its data has moved into `meta`. */
  keepMdat?: boolean;
};

const RIGHTS: ImageRights = { creator: ["Ada"], credit: "Example Agency" };
const PACKET = buildRightsPacket(RIGHTS) ?? Buffer.alloc(0);

/**
 * Renders a 16x24 image, so a width and height swapped would show.
 *
 * @param channels - 3 for an opaque image, or 4 for a half-transparent one.
 */
function renderTall(channels: 3 | 4 = 3) {
  const background = { r: 51, g: 102, b: 204, alpha: 0.5 };

  return sharp({ create: { width: 16, height: 24, channels, background } });
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
 * Returns an `iloc` header's bytes with new field sizes.
 *
 * @param version - The `iloc` version.
 * @param sizes - The offset, length and base offset sizes, in bytes.
 */
function ilocHeader(
  version: number,
  [offset, length, base]: [number, number, number]
) {
  return Buffer.from([version, 0, 0, 0, (offset << 4) | length, base << 4]);
}

/**
 * Rebuilds an AVIF from sharp, whose items' data all lies in the `mdat` after `meta`, with its
 * item locations rewritten and boxes added to `meta`.
 *
 * @param avif - The AVIF's bytes.
 * @param rewrite - Returns the new item locations, given the parsed ones and a function that
 * moves a file offset in `mdat` to where it lands in the new file.
 * @param reshape - Boxes to add to `meta`, and whether to keep `mdat`.
 */
function reshapeAvif(
  avif: Buffer,
  rewrite: (iloc: AvifIloc, move: (offset: number) => number) => AvifIloc,
  { add = [], keepMdat = true }: Reshape = {}
) {
  const { topLevel, meta, children, iloc: ilocBox } = readAvifMeta(avif);
  const [ftyp, , mdat] = topLevel;

  if (ftyp === undefined || mdat?.type !== "mdat") {
    throw new Error("unexpected AVIF layout");
  }

  const iloc = parseIloc(avif, ilocBox);
  const buildMeta = (dataStart: number) => {
    const move = (offset: number) => offset - mdat.payloadStart + dataStart;
    const boxes = children.map((child) =>
      child === ilocBox
        ? rebuildBox(avif, child, serialiseIloc(rewrite(iloc, move)))
        : avif.subarray(child.start, child.end)
    );
    const header = avif.subarray(meta.payloadStart, meta.payloadStart + 4);

    return rebuildBox(avif, meta, Buffer.concat([header, ...boxes, ...add]));
  };
  const mdatHeaderLength = mdat.payloadStart - mdat.start;
  const dataStart = ftyp.end + buildMeta(0).length + mdatHeaderLength;

  return Buffer.concat([
    avif.subarray(ftyp.start, ftyp.end),
    buildMeta(dataStart),
    ...(keepMdat ? [avif.subarray(mdat.start, mdat.end)] : []),
  ]);
}

/**
 * Moves every item's base offset to where its data lands.
 *
 * @param iloc - The parsed `iloc`.
 * @param move - Maps an old file offset to a new one.
 */
function moveItems(iloc: AvifIloc, move: (offset: number) => number) {
  return {
    ...iloc,
    items: iloc.items.map((item) => ({
      ...item,
      baseOffset: move(item.baseOffset),
    })),
  };
}

/**
 * Asserts that sharp decodes an AVIF carrying the packet to the pixels of the one it came from,
 * and that `readRights` reads the rights back.
 *
 * @param written - The AVIF with the packet.
 * @param original - The AVIF it came from.
 */
async function expectCarriesPacket(written: Buffer, original: Buffer) {
  const [samples, writtenSamples, metadata] = await Promise.all([
    readSamples(original),
    readSamples(written),
    sharp(written).metadata(),
  ]);

  expect(writtenSamples.equals(samples)).toBe(true);
  expect(metadata.xmp).toEqual(PACKET);
  expect(readRights(written, "avif")).toEqual(RIGHTS);
}

describe("setRights for AVIF", () => {
  it.each([
    { name: "an opaque", channels: 3 },
    { name: "a transparent", channels: 4 },
  ] as const)(
    "writes the same bytes into $name AVIF as sharp's withXmp",
    async ({ channels }) => {
      const [avif, withXmp] = await Promise.all([
        renderTall(channels).avif().toBuffer(),
        renderTall(channels).withXmp(PACKET.toString()).avif().toBuffer(),
      ]);

      expect(setRights(avif, "avif", PACKET).equals(withXmp)).toBe(true);
    }
  );

  it("leaves an AVIF's irot, imir and colr properties as they were", async () => {
    const bytes = await renderTall()
      .withMetadata({ orientation: 5 }) // a rotation and a mirror
      .withIccProfile("p3")
      .avif()
      .toBuffer();
    const { orientation } = await inspect(bytes);
    const stripped = stripLossless(bytes, {
      format: "avif",
      orientation,
    }).bytes;
    const written = setRights(stripped, "avif", PACKET);
    const iprpOf = (avif: Buffer) => {
      const { iprp } = readAvifMeta(avif);

      return iprp && avif.subarray(iprp.start, iprp.end);
    };
    const [before, after] = await Promise.all([
      inspect(stripped),
      inspect(written),
    ]);

    expect(iprpOf(written)).toEqual(iprpOf(stripped));
    expect(after).toEqual({
      ...before,
      bytes: written.length,
      metadata: ["xmp"],
      rights: RIGHTS,
    });
    expect(after).toMatchObject({ width: 24, height: 16, icc: "non-srgb" });
    await expectCarriesPacket(written, stripped);
  });

  it("keeps libavif's layout, with each offset in its extent", async () => {
    const avif = reshapeAvif(
      await renderTall().avif().toBuffer(),
      (iloc, move) => ({
        ...iloc,
        header: ilocHeader(0, [4, 4, 0]),
        baseOffsetSize: 0,
        items: iloc.items.map((item) => ({
          ...item,
          baseOffset: 0,
          extents: item.extents.map((extent) => ({
            ...extent,
            offset: move(item.baseOffset + extent.offset),
          })),
        })),
      })
    );
    const written = setRights(avif, "avif", PACKET);
    const { iloc } = readAvifMeta(written);
    const [image, xmp] = parseIloc(written, iloc).items;

    expect(image?.baseOffset).toBe(0);
    expect(xmp).toMatchObject({
      baseOffset: 0,
      extents: [{ offset: written.length - PACKET.length }],
    });
    await expectCarriesPacket(written, avif);
  });

  it("adds an mdat to an AVIF whose data all lies in idat", async () => {
    const opaque = await renderTall().avif().toBuffer();
    const [, , mdat] = readAvifMeta(opaque).topLevel;
    const payloadStart = mdat?.payloadStart ?? 0;
    const avif = reshapeAvif(
      opaque,
      (iloc) => ({
        ...iloc,
        header: ilocHeader(1, [4, 4, 4]),
        version: 1,
        items: iloc.items.map((item) => ({
          ...item,
          construction: 1, // offsets within idat
          baseOffset: item.baseOffset - payloadStart,
        })),
      }),
      {
        add: [buildBox("idat", opaque.subarray(payloadStart, mdat?.end))],
        keepMdat: false,
      }
    );
    const written = setRights(avif, "avif", PACKET);
    const { topLevel } = readAvifMeta(written);

    expect(topLevel.map((box) => box.type)).toEqual(["ftyp", "meta", "mdat"]);
    expect(topLevel[2]?.end).toBe(written.length);
    await expectCarriesPacket(written, avif);
  });

  it("numbers the XMP item above every entity group", async () => {
    const group = new FieldWriter()
      .write(0, 4) // version and flags
      .write(7, 4) // group id
      .write(1, 4) // entity count
      .write(1, 4) // the image item
      .toBuffer();
    const grpl = buildBox("grpl", buildBox("altr", group));
    const avif = reshapeAvif(await renderTall().avif().toBuffer(), moveItems, {
      add: [grpl],
    });
    const written = setRights(avif, "avif", PACKET);
    const { iinf } = readAvifMeta(written);
    const ids = readIinf(written, iinf).entries.map(
      (infe) => readItemInfo(written, infe).id
    );

    expect(ids).toEqual([1, 8]);
    await expectCarriesPacket(written, avif);
  });

  it("throws when the item table has no field for the packet's length", async () => {
    const avif = reshapeAvif(
      await renderTall().avif().toBuffer(),
      (iloc, move) => ({
        ...iloc,
        header: ilocHeader(0, [4, 0, 4]),
        lengthSize: 0,
        items: moveItems(iloc, move).items.map((item) => ({
          ...item,
          extents: item.extents.map((extent) => ({ ...extent, length: 0 })), // the whole file
        })),
      })
    );

    expect(() => setRights(avif, "avif", PACKET)).toThrow(RangeError);
  });

  it("needs a primary item for the packet to describe", async () => {
    const avif = await renderTall()
      .withXmp(PACKET.toString())
      .avif()
      .toBuffer();
    const { pitm } = readAvifMeta(avif);
    const noPrimary = Buffer.from(avif);

    noPrimary.write("free", (pitm?.start ?? 0) + 4, "latin1");

    const add = () => setRights(noPrimary, "avif", PACKET);

    expect(add).toThrow(OptimiserError);
    expect(add).toThrow(expect.objectContaining({ code: "E_DECODE" }));
    expect(readRights(setRights(noPrimary, "avif", undefined), "avif")).toEqual(
      {}
    );
  });
});
