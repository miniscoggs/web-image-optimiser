import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

type Ssimulacra2 = typeof import("../../wasm/pkg/ssimulacra2.js");

type RgbImage = { data: Buffer; width: number; height: number };

type ReferencePair = {
  reference: string;
  distorted: string;
  quality: number;
  score: number;
};

// generated module is commonjs
const require = createRequire(import.meta.url);
const { score } = require("../../wasm/pkg/ssimulacra2.js") as Ssimulacra2;

const PHOTO = fileURLToPath(
  new URL("../../fixtures/photo-butterfly.jpg", import.meta.url)
);
const PAIR_DIR = new URL("../../fixtures/ssimulacra2/", import.meta.url);
// largest allowed gap from libjxl's reference tool
const LIBJXL_TOLERANCE = 0.5;

const referencesText = await readFile(
  new URL("references.json", PAIR_DIR),
  "utf8"
);
const references = JSON.parse(referencesText) as { pairs: ReferencePair[] };

/**
 * Decodes an image into 8-bit RGB pixels, optionally resized to a width.
 *
 * @param input - Encoded image bytes, or a fixture path.
 * @param width - Width to resize to, if any.
 */
async function decodeRgb(input: Buffer | string, width?: number) {
  const { data, info } = await sharp(input)
    .resize({ width })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height } satisfies RgbImage;
}

/**
 * Round-trips an image through JPEG at a quality and decodes it again.
 *
 * @param image - The image to compress.
 * @param quality - JPEG quality, 1-100.
 */
async function jpegRoundTrip(image: RgbImage, quality: number) {
  const raw = {
    width: image.width,
    height: image.height,
    channels: 3,
  } as const;
  const jpeg = await sharp(image.data, { raw }).jpeg({ quality }).toBuffer();

  return decodeRgb(jpeg);
}

describe("ssimulacra2 wasm", () => {
  let photo: RgbImage;

  beforeAll(async () => {
    photo = await decodeRgb(PHOTO, 320);
  });

  it("scores an identical pair 100", () => {
    expect(score(photo.data, photo.data, photo.width, photo.height)).toBe(100);
  });

  it("scores a heavily compressed pair low", async () => {
    const compressed = await jpegRoundTrip(photo, 5);

    expect(
      score(photo.data, compressed.data, photo.width, photo.height)
    ).toBeLessThan(30);
  });

  it("scores a lightly compressed pair high", async () => {
    const compressed = await jpegRoundTrip(photo, 95);

    expect(
      score(photo.data, compressed.data, photo.width, photo.height)
    ).toBeGreaterThan(80);
  });

  it("throws when a buffer doesn't match the dimensions", () => {
    const short = photo.data.subarray(1);

    expect(() => score(photo.data, short, photo.width, photo.height)).toThrow(
      /Expected \d+x\d+x3 bytes/
    );
  });

  it("throws for images smaller than 8x8", () => {
    const tiny = new Uint8Array(7 * 7 * 3);

    expect(() => score(tiny, tiny, 7, 7)).toThrow(/at least 8x8/);
  });

  it.each(references.pairs)(
    "scores $distorted within the tolerance of libjxl",
    async (pair) => {
      const reference = await decodeRgb(
        fileURLToPath(new URL(pair.reference, PAIR_DIR))
      );
      const distorted = await decodeRgb(
        fileURLToPath(new URL(pair.distorted, PAIR_DIR))
      );
      const actual = score(
        reference.data,
        distorted.data,
        reference.width,
        reference.height
      );

      expect(Math.abs(actual - pair.score)).toBeLessThanOrEqual(
        LIBJXL_TOLERANCE
      );
    }
  );
});
