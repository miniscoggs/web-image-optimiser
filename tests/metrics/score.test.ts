import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeForScoring,
  isDownscaledForScoring,
  isScorable,
  score,
  type MetricsImage,
  type MetricsScorePool,
} from "../../src/metrics/index.js";
import scoreSsimulacra2 from "../../src/metrics/ssimulacra2.js";

const PHOTO = fileURLToPath(
  new URL("../../fixtures/photo-butterfly.jpg", import.meta.url)
);
const ICON = fileURLToPath(
  new URL("../../fixtures/icon-6x6.png", import.meta.url)
);

/**
 * Builds a square RGBA image whose pixels come from a function of their position.
 *
 * @param size - Width and height in pixels.
 * @param pixel - Returns `[red, green, blue, alpha]` for a position.
 */
function makeImage(
  size: number,
  pixel: (column: number, row: number) => readonly number[]
): MetricsImage {
  const data = Buffer.alloc(size * size * 4);

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      data.set(pixel(column, row), (row * size + column) * 4);
    }
  }
  return { data, width: size, height: size };
}

/**
 * Returns a copy of an image with every pixel replaced by a function of the original pixel.
 *
 * @param image - The image to copy.
 * @param pixel - Returns the new `[red, green, blue, alpha]` for an original pixel.
 */
function mapPixels(
  image: MetricsImage,
  pixel: (rgba: readonly number[]) => readonly number[]
): MetricsImage {
  const data = Buffer.from(image.data);

  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(pixel([...data.subarray(offset, offset + 4)]), offset);
  }
  return { ...image, data };
}

/**
 * Creates a pool that scores on the calling thread, recording what it's asked to score.
 */
function recordingPool() {
  const calls: Parameters<MetricsScorePool["score"]>[] = [];
  const pool: MetricsScorePool = {
    size: 2,
    score: (pair, options) => {
      calls.push([pair, options]);
      return Promise.resolve(
        scoreSsimulacra2(
          pair.reference,
          pair.distorted,
          pair.width,
          pair.height
        )
      );
    },
    close: () => Promise.resolve(),
  };

  return { pool, calls };
}

describe("score", () => {
  let photo: MetricsImage;

  beforeAll(async () => {
    const small = await sharp(PHOTO).resize({ width: 256 }).toBuffer();

    photo = await decodeForScoring(small);
  });

  it("scores identical images 100", async () => {
    await expect(score(photo, photo)).resolves.toBe(100);
  });

  it("scores a distorted opaque image below 100", async () => {
    const raw = {
      width: photo.width,
      height: photo.height,
      channels: 4,
    } as const;
    const jpeg = await sharp(photo.data, { raw })
      .jpeg({ quality: 20 })
      .toBuffer();
    const distorted = await decodeForScoring(jpeg);

    await expect(score(photo, distorted)).resolves.toBeLessThan(80);
  });

  it("throws when the dimensions differ", async () => {
    const other = makeImage(16, () => [0, 0, 0, 255]);

    await expect(score(photo, other)).rejects.toThrow(/must be the same size/);
  });

  it("throws when a buffer isn't RGBA for its dimensions", async () => {
    const rgb = { ...photo, data: photo.data.subarray(photo.width * 4) };

    await expect(score(photo, rgb)).rejects.toThrow(/RGBA pixels/);
  });

  it("reports which sizes are resized before scoring", () => {
    expect(isDownscaledForScoring({ width: 6240, height: 4160 })).toBe(false); // 25.96 MP
    expect(isDownscaledForScoring({ width: 6252, height: 4168 })).toBe(true); // 26.06 MP
  });

  describe("with transparency", () => {
    const pattern = (column: number, row: number) =>
      ((column * 7 + row * 13) % 64) * 2; // 0-126, so 64 + pattern stays a valid alpha

    it("ignores colour changes under fully transparent pixels", async () => {
      const reference = makeImage(32, (column, row) => [
        pattern(column, row),
        90,
        40,
        0,
      ]);
      const distorted = mapPixels(reference, ([, green = 0, blue = 0]) => [
        255,
        green,
        blue,
        0,
      ]);

      await expect(score(reference, distorted)).resolves.toBe(100);
    });

    // each pair is identical on one background, so < 90 shows the other was scored too
    it("catches a difference that only shows on black", async () => {
      const reference = makeImage(32, (column, row) => [
        255,
        255,
        255,
        64 + pattern(column, row),
      ]);
      const distorted = mapPixels(
        reference,
        ([red = 0, green = 0, blue = 0]) => [red, green, blue, 255]
      );

      await expect(score(reference, distorted)).resolves.toBeLessThan(90);
    });

    it("sends a pool each background's pair, giving it their memory and whether it's ahead of need", async () => {
      const reference = makeImage(32, (column, row) => [
        128,
        128,
        128,
        64 + pattern(column, row),
      ]); // differs from the opaque copy on both backgrounds
      const distorted = mapPixels(
        reference,
        ([red = 0, green = 0, blue = 0]) => [red, green, blue, 255]
      );
      const { pool, calls } = recordingPool();
      const { signal } = new AbortController();
      const speculative = () => true;
      const onThisThread = await score(reference, distorted);

      await expect(
        score(reference, distorted, { pool, signal, speculative })
      ).resolves.toBe(onThisThread);
      expect(calls).toHaveLength(2);
      for (const [pair, options] of calls) {
        expect(Object.keys(pair).toSorted()).toEqual([
          "distorted",
          "height",
          "reference",
          "width",
        ]); // no rgba pixels to copy
        expect(pair).toMatchObject({ width: 32, height: 32 });
        expect(pair.reference).toHaveLength(32 * 32 * 3);
        expect(options).toEqual({
          signal,
          transfer: [pair.reference.buffer, pair.distorted.buffer],
          speculative,
        });
      }
    });

    it("catches a difference that only shows on white", async () => {
      const reference = makeImage(32, (column, row) => [
        0,
        0,
        0,
        64 + pattern(column, row),
      ]);
      const distorted = mapPixels(
        reference,
        ([red = 0, green = 0, blue = 0]) => [red, green, blue, 255]
      );

      await expect(score(reference, distorted)).resolves.toBeLessThan(90);
    });
  });

  describe("with images smaller than 8x8", () => {
    let icon: MetricsImage;

    beforeAll(async () => {
      icon = await decodeForScoring(ICON);
    });

    it("reports that they can't be scored", () => {
      expect(isScorable(icon)).toBe(false);
      expect(isScorable({ width: 8, height: 8 })).toBe(true);
    });

    it("scores an identical pair 100", async () => {
      const copy = { ...icon, data: Buffer.from(icon.data) };

      await expect(score(icon, copy)).resolves.toBe(100);
    });

    it("throws for a pair that differs", async () => {
      const distorted = mapPixels(icon, ([red = 0, green = 0, , alpha = 0]) => [
        red,
        green,
        255,
        alpha,
      ]);

      await expect(score(icon, distorted)).rejects.toThrow(/smaller than 8x8/);
    });
  });
});
