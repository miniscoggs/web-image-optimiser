import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decodeForScoring } from "../../src/metrics/index.js";
import { fixturePath } from "../fixtureManifest.js";

describe("decodeForScoring", () => {
  it("returns 8-bit RGBA for an opaque image", async () => {
    const image = await decodeForScoring(fixturePath("gradient.png"));

    expect(image.width).toBe(512);
    expect(image.height).toBe(384);
    expect(image.data.length).toBe(512 * 384 * 4);
    expect(image.data[3]).toBe(255);
  });

  it("reduces a 16-bit image to 8 bits", async () => {
    const image = await decodeForScoring(fixturePath("gradient-16bit.png"));

    expect(image.data.length).toBe(image.width * image.height * 4);
  });

  it("keeps transparency", async () => {
    const image = await decodeForScoring(fixturePath("logo-alpha.png"));
    const alphas = image.data.filter((_, index) => index % 4 === 3);

    expect(Math.min(...alphas)).toBe(0);
  });

  it("applies EXIF orientation", async () => {
    // red marker is stored top-left; orientation 6 turns it top-right
    const image = await decodeForScoring(fixturePath("orientation-6.jpg"));
    const topRight = (2 * image.width + image.width - 3) * 4;
    const [red = 0, green = 0, blue = 0] = image.data.subarray(
      topRight,
      topRight + 3
    );

    expect([image.width, image.height]).toEqual([320, 480]);
    expect(red).toBeGreaterThan(green + 100);
    expect(red).toBeGreaterThan(blue + 100);
  });

  it("converts an embedded Display P3 profile to sRGB", async () => {
    const path = fixturePath("display-p3.jpg");
    const image = await decodeForScoring(path);
    const unconverted = await sharp(path, { ignoreIcc: true })
      .ensureAlpha()
      .raw()
      .toBuffer();

    expect(image.data.equals(unconverted)).toBe(false);
  });

  it("decodes encoded bytes as well as paths", async () => {
    const path = fixturePath("lossy.webp");
    const fromPath = await decodeForScoring(path);
    const fromBytes = await decodeForScoring(await readFile(path));

    expect(fromBytes.data.equals(fromPath.data)).toBe(true);
  });

  it("renders an SVG at a given density", async () => {
    const path = fixturePath("title-viewbox.svg");
    const standard = await decodeForScoring(path);
    const doubled = await decodeForScoring(path, { density: 144 });

    expect([standard.width, standard.height]).toEqual([64, 64]);
    expect([doubled.width, doubled.height]).toEqual([128, 128]);
  });
});
