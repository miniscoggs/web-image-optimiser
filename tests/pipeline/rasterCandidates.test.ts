import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import type { MetricsScorePool } from "../../src/metrics/index.js";
import scoreSsimulacra2 from "../../src/metrics/ssimulacra2.js";
import {
  createRasterCache,
  createRasterSource,
} from "../../src/pipeline/rasterCandidates.js";
import type { RasterContext } from "../../src/pipeline/rasterCandidates.js";
import { selectFormat } from "../../src/pipeline/selectRaster.js";
import { fixturePath } from "../fixtureManifest.js";

const FIXTURE = "text-chunks.png"; // a PNG, so WebP tries lossy, lossless and near-lossless

/**
 * Builds the fixture's raster source for a search.
 *
 * @param target - The target score.
 * @param context - The cache of what earlier searches made, and the pool, each if any.
 * @param maxWidth - The maximum width, if any.
 */
async function sourceOf(
  target: number,
  context: RasterContext = {},
  maxWidth?: number
) {
  const bytes = await readFile(fixturePath(FIXTURE));
  const info = await inspect(bytes);

  if (info.format === "svg") {
    throw new Error(`${FIXTURE} should be a raster image`);
  }

  const source = await createRasterSource(
    bytes,
    { ...info, format: info.format },
    { target, maxWidth, stripAll: false },
    context
  );

  return { source, inputBytes: bytes.length };
}

/**
 * Searches the fixture's WebP outputs at a target with no cache or pool, one attempt at a time.
 *
 * @param target - The target score.
 */
async function searchedAlone(target: number) {
  const { source, inputBytes } = await sourceOf(target);

  return selectFormat(source, "webp", inputBytes);
}

describe("RasterCache", () => {
  it("gives what an uncached search does at every target, making only what earlier searches didn't", async () => {
    const cache = createRasterCache();
    const sizes: number[] = [];

    for (const target of [70, 80, 60, 70]) {
      const kept = new Map(cache.attempts);
      const cached = await sourceOf(target, { cache });
      const found = await selectFormat(
        cached.source,
        "webp",
        cached.inputBytes
      );

      await expect(searchedAlone(target)).resolves.toEqual(found);
      for (const [key, attempt] of kept) {
        expect(cache.attempts.get(key)).toBe(attempt); // taken, not made again
      }
      sizes.push(cache.attempts.size);
    }

    expect(sizes[1]).toBeGreaterThan(sizes[0] ?? 0); // 80 needed qualities 70 didn't try
    expect(sizes[3]).toBe(sizes[2]); // back at 70, everything was kept
  });

  it("makes again an attempt an earlier search dropped before scoring it", async () => {
    const cache = createRasterCache();
    const dropped = Promise.reject(new Error("Dropped"));

    void dropped.catch(() => undefined);
    cache.attempts.set("webp 95", dropped); // the first quality a WebP search needs

    const cached = await sourceOf(70, { cache });

    await expect(
      selectFormat(cached.source, "webp", cached.inputBytes)
    ).resolves.toEqual(await searchedAlone(70));
    expect(cache.attempts.get("webp 95")).not.toBe(dropped);
  });

  it("reuses the decoded pixels at the maximum width, with no strip for a resized image", async () => {
    const cache = createRasterCache();
    const first = await sourceOf(70, { cache }, 100);
    const second = await sourceOf(80, { cache }, 100);

    expect(second.source.image).toBe(first.source.image);
    expect(second.source.image.width).toBe(100);
    expect(second.source.strip).toBeUndefined();
    expect(second.source.target).toBe(80);
  });
});

describe("searching on a pool", () => {
  it("runs ahead on the scorers its searches leave spare, choosing what it would one at a time", async () => {
    let speculativePairs = 0;
    const scorePool: MetricsScorePool = {
      size: 8, // the lossy and near-lossless searches get 3 attempts ahead each
      score: (pair, options) => {
        speculativePairs += options?.speculative?.() === true ? 1 : 0;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              scoreSsimulacra2(
                pair.reference,
                pair.distorted,
                pair.width,
                pair.height
              )
            );
          }, 100); // long enough for the attempts ahead to reach the pool meanwhile
        });
      },
      close: () => Promise.resolve(),
    };
    const pooled = await sourceOf(70, { scorePool });

    await expect(
      selectFormat(pooled.source, "webp", pooled.inputBytes)
    ).resolves.toEqual(await searchedAlone(70));
    expect(speculativePairs).toBeGreaterThan(0);
    expect(pooled.source.searches.running).toBe(0);
  });
});
