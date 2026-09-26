import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import { OptimiserError } from "../../src/schema/index.js";
import type { OptimiserErrorCode } from "../../src/schema/index.js";
import { fixturePath, fixtures } from "../fixtureManifest.js";

const STILL_FIXTURES = fixtures.filter((fixture) => !fixture.animated);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Returns the error that inspecting an input rejects with, checking its code.
 *
 * @param input - A file path or bytes.
 * @param code - The expected error code.
 */
async function expectFailure(input: Buffer | string, code: OptimiserErrorCode) {
  const error = await inspect(input).then(
    () => undefined,
    (caught: unknown) => caught
  );

  expect(error).toBeInstanceOf(OptimiserError);
  expect(error).toMatchObject({ code });
}

/**
 * Builds one PNG chunk, including its CRC.
 *
 * @param type - Four-letter chunk type.
 * @param data - Chunk payload.
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
 * Builds an APNG from a PNG by adding an `acTL` chunk after its IHDR.
 *
 * @param png - A still PNG.
 */
function toApng(png: Buffer) {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  const animationControl = Buffer.alloc(8); // one frame, looping forever

  animationControl.writeUInt32BE(1, 0);
  return Buffer.concat([
    png.subarray(0, ihdrEnd),
    pngChunk("acTL", animationControl),
    png.subarray(ihdrEnd),
  ]);
}

/**
 * Renders an 8x8 red image in another format.
 *
 * @param format - A sharp output format.
 */
function renderSquare(format: "gif" | "tiff") {
  const create = {
    width: 8,
    height: 8,
    channels: 3,
    background: "#ff0000",
  } as const;

  return sharp({ create }).toFormat(format).toBuffer();
}

describe("inspect", () => {
  it.each(STILL_FIXTURES)(
    "reports the manifest traits of $file",
    async (fixture) => {
      const path = fixturePath(fixture.file);
      const { length } = await readFile(path);

      await expect(inspect(path)).resolves.toEqual({
        format: fixture.format,
        bytes: length,
        width: fixture.width,
        height: fixture.height,
        hasAlpha: fixture.alpha,
        bitDepth: fixture.bitDepth,
        orientation: fixture.orientation,
        icc: fixture.icc,
        metadata: fixture.metadata,
        ...(fixture.svg && { svg: fixture.svg }),
      });
    }
  );

  it("reports the same for bytes as for a path", async () => {
    const path = fixturePath("orientation-6.jpg");

    expect(await inspect(await readFile(path))).toEqual(await inspect(path));
  });

  describe("with a temporary folder", () => {
    let folder = "";

    beforeAll(async () => {
      folder = await mkdtemp(join(tmpdir(), "wio inspect é "));
    });
    afterAll(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    it("detects the format from the bytes, not the extension", async () => {
      const path = join(folder, "misnamed.jpg");

      await writeFile(path, await readFile(fixturePath("gradient.png")));
      await expect(inspect(path)).resolves.toMatchObject({ format: "png" });
    });
  });

  it("finds an SVG root after a BOM, declaration, comment and doctype", async () => {
    const svg = Buffer.concat([
      UTF8_BOM,
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!-- exported <svg> -->
<!DOCTYPE svg [ <!ENTITY accent "#ff0000"> ]>
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12">
  <defs><linearGradient id="fade"/></defs>
  <rect width="16" height="12" fill="url('#fade')" stroke="url(#missing)" style="color:#fff"/>
</svg>`),
    ]);

    await expect(inspect(svg)).resolves.toMatchObject({
      format: "svg",
      width: 16,
      height: 12,
      metadata: ["comment"],
      svg: { viewBox: false, title: false, referencedIds: ["fade"] },
    });
  });

  it("ignores an SVG licence comment", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><!--! Icon licence: MIT --></svg>'
    );

    await expect(inspect(svg)).resolves.toMatchObject({ metadata: [] });
  });

  it("reports a <metadata> element as editor data", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><metadata>made by hand</metadata></svg>'
    );

    await expect(inspect(svg)).resolves.toMatchObject({ metadata: ["editor"] });
  });

  it("rejects an animated WebP", async () => {
    await expectFailure(fixturePath("animated.webp"), "E_ANIMATED");
  });

  it("rejects an APNG", async () => {
    const apng = toApng(await readFile(fixturePath("icon-6x6.png")));

    await expectFailure(apng, "E_ANIMATED");
  });

  it("rejects an AVIF image sequence", async () => {
    const avif = await readFile(fixturePath("exif.avif"));

    avif.write("avis", 8, "latin1"); // the major brand

    await expectFailure(avif, "E_ANIMATED");
  });

  it.each([
    ["a GIF", () => renderSquare("gif")],
    ["a TIFF", () => renderSquare("tiff")],
    [
      "a HEIC",
      () => Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "latin1"),
    ],
    [
      "an HTML page",
      () => Buffer.from("<!DOCTYPE html><html><body></body></html>"),
    ],
    ["plain text", () => Buffer.from("svg")],
    ["an empty file", () => Buffer.alloc(0)],
  ])("rejects %s as unsupported", async (_, build) => {
    await expectFailure(await build(), "E_UNSUPPORTED_FORMAT");
  });

  it.each([
    ["PNG", Buffer.from("\x89PNG\r\n\x1a\n" + "\x07".repeat(64), "latin1")],
    [
      "JPEG",
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)]),
    ],
    ["WebP", Buffer.from("RIFF\x10\0\0\0WEBPVP8 " + "\0".repeat(16), "latin1")],
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect')],
  ])("fails to decode a corrupt %s", async (_, bytes) => {
    await expectFailure(bytes, "E_DECODE");
  });
});
