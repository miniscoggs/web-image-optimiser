import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createDiffMap, type MetricsImage } from "../../src/metrics/index.js";

const SIZE = 48;

type Region = { left: number; top: number; size: number };
type Change = { region: Region; rgba: readonly number[] };

// three 16-pixel squares: unchanged, changed a little, changed a lot
const UNCHANGED: Region = { left: 0, top: 0, size: 16 };
const SMALL_CHANGE: Region = { left: 16, top: 16, size: 16 };
const LARGE_CHANGE: Region = { left: 32, top: 32, size: 16 };

/**
 * Builds an image filled with one RGBA value, overridden inside the given regions.
 *
 * @param rgba - The fill value.
 * @param changes - Regions and the RGBA value each holds instead.
 */
function fillImage(rgba: readonly number[], changes: Change[] = []) {
  const data = Buffer.alloc(SIZE * SIZE * 4);

  for (let row = 0; row < SIZE; row++) {
    for (let column = 0; column < SIZE; column++) {
      const change = changes.find(({ region }) =>
        contains(region, column, row)
      );

      data.set(change?.rgba ?? rgba, (row * SIZE + column) * 4);
    }
  }
  return { data, width: SIZE, height: SIZE } satisfies MetricsImage;
}

/**
 * Returns whether a pixel lies inside a region.
 *
 * @param region - The region to test.
 * @param column - Pixel column.
 * @param row - Pixel row.
 */
function contains(region: Region, column: number, row: number) {
  return (
    column >= region.left &&
    column < region.left + region.size &&
    row >= region.top &&
    row < region.top + region.size
  );
}

/**
 * Returns the mean heat of a diff map over a region. The heat colour adds red and never blue,
 * so red minus blue measures it, and is 0 for unchanged grey pixels.
 *
 * @param map - Decoded RGB pixels of the diff map.
 * @param region - The region to average over.
 */
function meanHeat(map: Buffer, region: Region) {
  let total = 0;

  for (let row = region.top; row < region.top + region.size; row++) {
    for (
      let column = region.left;
      column < region.left + region.size;
      column++
    ) {
      const offset = (row * SIZE + column) * 3;

      total += (map[offset] ?? 0) - (map[offset + 2] ?? 0);
    }
  }
  return total / (region.size * region.size);
}

/**
 * Creates a diff map and decodes it to RGB pixels.
 *
 * @param reference - The original image.
 * @param distorted - The image compared against it.
 */
async function decodedDiffMap(
  reference: MetricsImage,
  distorted: MetricsImage
) {
  const png = await createDiffMap(reference, distorted);

  return sharp(png).raw().toBuffer({ resolveWithObject: true });
}

describe("createDiffMap", () => {
  it("draws changed regions hotter than unchanged ones", async () => {
    const reference = fillImage([128, 128, 128, 255]);
    const distorted = fillImage(
      [128, 128, 128, 255],
      [
        { region: SMALL_CHANGE, rgba: [132, 132, 132, 255] },
        { region: LARGE_CHANGE, rgba: [168, 168, 168, 255] },
      ]
    );
    const { data, info } = await decodedDiffMap(reference, distorted);

    expect([info.width, info.height, info.channels]).toEqual([SIZE, SIZE, 3]);
    expect(meanHeat(data, UNCHANGED)).toBe(0);
    expect(meanHeat(data, SMALL_CHANGE)).toBeGreaterThan(0);
    expect(meanHeat(data, LARGE_CHANGE)).toBeGreaterThan(
      meanHeat(data, SMALL_CHANGE)
    );
  });

  it("draws a difference in transparency that only shows on black", async () => {
    const reference = fillImage([255, 255, 255, 255]);
    const distorted = fillImage(
      [255, 255, 255, 255],
      [
        { region: LARGE_CHANGE, rgba: [255, 255, 255, 128] }, // same as opaque white on white
      ]
    );
    const { data } = await decodedDiffMap(reference, distorted);

    expect(meanHeat(data, UNCHANGED)).toBe(0);
    expect(meanHeat(data, LARGE_CHANGE)).toBeGreaterThan(0);
  });

  it("returns a PNG", async () => {
    const image = fillImage([128, 128, 128, 255]);
    const png = await createDiffMap(image, image);
    const metadata = await sharp(png).metadata();

    expect(metadata.format).toBe("png");
  });

  it("throws when the dimensions differ", async () => {
    const other: MetricsImage = {
      data: Buffer.alloc(8 * 8 * 4),
      width: 8,
      height: 8,
    };

    await expect(
      createDiffMap(fillImage([128, 128, 128, 255]), other)
    ).rejects.toThrow(/must be the same size/);
  });
});
