import { describe, expect, it, vi } from "vitest";
import QUALITY_RANGES from "../../src/encode/qualityRanges.js";
import { searchQuality } from "../../src/search/index.js";
import type { SearchAttemptContext } from "../../src/search/index.js";

type FakeCandidate = { bytes: Uint8Array; quality: number };

type CurveShape = "rising" | "noisy" | "random";

const RANGES: readonly (readonly [number, number])[] = [
  ...Object.values(QUALITY_RANGES),
  [1, 4], // near-lossless WebP's levels
  [0, 1],
  [7, 7],
];
const SHAPES: CurveShape[] = ["rising", "noisy", "random"];
const TARGETS = [0, 30, 55, 70, 85, 100];
const LOOKAHEADS = [1, 2, 3, 8, 200];

/**
 * Returns a seeded generator of numbers from 0 to 1 (mulberry32), so a failure can be replayed.
 *
 * @param seed - The seed.
 */
function seededRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Resolves with a value after some turns of the microtask queue, so attempts settle out of order.
 *
 * @param value - The value.
 * @param turns - How many turns.
 */
async function afterTurns<T>(value: T, turns: number) {
  for (let turn = 0; turn < turns; turn++) {
    await Promise.resolve();
  }
  return value;
}

/**
 * Gives every quality in a range a fixed score and size: sizes rise with quality, with noise,
 * and scores rise with it, rise with noise, or are random.
 *
 * @param range - The quality range.
 * @param shape - How the scores behave.
 * @param random - The random numbers.
 */
function randomCurve(
  range: readonly [number, number],
  shape: CurveShape,
  random: () => number
) {
  const [lowest, highest] = range;
  const curve = new Map<number, { score: number; size: number }>();

  for (let quality = lowest; quality <= highest; quality++) {
    const rising =
      highest === lowest
        ? 100
        : (100 * (quality - lowest)) / (highest - lowest);
    const scores = {
      rising,
      noisy: rising + (random() - 0.5) * 30,
      random: random() * 100,
    };
    const size = Math.max(1, Math.round(quality * 10 + (random() - 0.5) * 40));

    curve.set(quality, { score: scores[shape], size });
  }
  return curve;
}

/**
 * Searches a curve, with each encode and score settling after a random number of turns.
 *
 * @param curve - Each quality's score and size.
 * @param options - The range, target and lookahead, if any.
 * @param random - The random numbers.
 * @returns The result, and every quality encoded, in order.
 */
async function searchCurve(
  curve: Map<number, { score: number; size: number }>,
  options: {
    range: readonly [number, number];
    target: number;
    lookahead?: number;
  },
  random: () => number
) {
  const { range, target, lookahead } = options;
  const encoded: number[] = [];
  const pointAt = (quality: number) =>
    curve.get(quality) ?? { score: Number.NaN, size: 0 };
  const result = await searchQuality({
    encode: (quality) => {
      encoded.push(quality);
      return afterTurns(
        { bytes: new Uint8Array(pointAt(quality).size), quality },
        Math.floor(random() * 20)
      );
    },
    score: (candidate) =>
      afterTurns(pointAt(candidate.quality).score, Math.floor(random() * 20)),
    target,
    range,
    ...(lookahead === undefined ? {} : { lookahead: () => lookahead }),
  });

  return { result, encoded };
}

/**
 * Creates an encoder whose attempts wait until the test releases them, keeping each attempt's
 * context.
 */
function createHeldEncoder() {
  const held = new Map<
    number,
    { context: SearchAttemptContext; release: () => void }
  >();
  const encode = (quality: number, context: SearchAttemptContext) => {
    const { promise, resolve } = Promise.withResolvers<FakeCandidate>();

    held.set(quality, {
      context,
      release: () => {
        resolve({ bytes: new Uint8Array(quality * 10), quality });
      },
    });
    return promise;
  };
  const release = async (quality: number) => {
    held.get(quality)?.release();
    await new Promise((resolve) => setImmediate(resolve)); // lets the search take its next step
  };
  const droppedOf = () =>
    [...held]
      .filter(([, attempt]) => attempt.context.signal.aborted)
      .map(([quality]) => quality);

  return { held, encode, release, droppedOf };
}

/**
 * Creates a fake encoder whose output grows with quality, counting its calls.
 *
 * @param sizeAt - Returns the encoded size at a quality; defaults to 10 bytes per quality step.
 */
function createEncoder(sizeAt = (quality: number) => quality * 10) {
  const calls: number[] = [];
  const encode = (quality: number) => {
    calls.push(quality);
    return Promise.resolve({
      bytes: new Uint8Array(sizeAt(quality)),
      quality,
    });
  };

  return { calls, encode };
}

/**
 * Creates a fake scorer from a function of the candidate's quality.
 *
 * @param scoreAt - Returns the score at a quality.
 */
function createScorer(scoreAt: (quality: number) => number) {
  return (candidate: FakeCandidate) =>
    Promise.resolve(scoreAt(candidate.quality));
}

describe("searchQuality", () => {
  it("finds the lowest passing quality when the score rises with quality", async () => {
    const { calls, encode } = createEncoder();
    const result = await searchQuality({
      encode,
      score: createScorer((quality) => quality),
      target: 70,
      range: [30, 95],
    });

    expect(result.reached).toBe(true);
    expect(result.chosen).toMatchObject({
      quality: 70,
      score: 70,
      passed: true,
    });
    expect(calls[0]).toBe(95);
    expect(calls).toContain(71); // the step above the result
    expect(calls.length).toBeLessThanOrEqual(9);
    expect(new Set(calls).size).toBe(calls.length);
    expect(result.attempts.map((attempt) => attempt.quality)).toEqual(
      calls.toSorted((first, second) => first - second)
    );
  });

  it("returns the lowest quality when everything passes", async () => {
    const result = await searchQuality({
      encode: createEncoder().encode,
      score: createScorer(() => 100),
      target: 90,
      range: [20, 90],
    });

    expect(result.chosen.quality).toBe(20);
  });

  // over 0 to 10 with a target of 5, the search tries 10, 5, 2 and 4, so 6 is only tried as the step above
  it("keeps a passing result when the step above it fails", async () => {
    const { calls, encode } = createEncoder();
    const result = await searchQuality({
      encode,
      score: createScorer((quality) => (quality === 6 ? 0 : quality)),
      target: 5,
      range: [0, 10],
    });

    expect(calls).toEqual([10, 5, 2, 4, 6]);
    expect(result.chosen.quality).toBe(5);
    expect(result.attempts).toContainEqual(
      expect.objectContaining({ quality: 6, passed: false })
    );
  });

  it("prefers the step above when it passes at a smaller size", async () => {
    const result = await searchQuality({
      encode: createEncoder((quality) => (quality === 6 ? 1 : quality * 10))
        .encode,
      score: createScorer((quality) => quality),
      target: 5,
      range: [0, 10],
    });

    expect(result.chosen.quality).toBe(6);
  });

  it("stops after the highest quality when the target is out of reach", async () => {
    const { calls, encode } = createEncoder();
    const result = await searchQuality({
      encode,
      score: createScorer((quality) => quality / 2),
      target: 80,
      range: [40, 95],
    });

    expect(result.reached).toBe(false);
    expect(result.chosen).toMatchObject({ quality: 95, passed: false });
    expect(calls).toEqual([95]);
  });

  it("rejects an empty or fractional range", async () => {
    const options = {
      encode: createEncoder().encode,
      score: createScorer(() => 100),
      target: 80,
    };

    await expect(
      searchQuality({ ...options, range: [90, 20] })
    ).rejects.toThrow(RangeError);
    await expect(
      searchQuality({ ...options, range: [20.5, 90] })
    ).rejects.toThrow(RangeError);
  });

  describe("running ahead", () => {
    it("gives what it would one at a time, however far it runs ahead and whatever the scores", async () => {
      const random = seededRandom(9);

      for (const range of RANGES) {
        for (const shape of SHAPES) {
          const curve = randomCurve(range, shape, random);

          for (const target of TARGETS) {
            const alone = await searchCurve(curve, { range, target }, random);

            for (const lookahead of LOOKAHEADS) {
              const ahead = await searchCurve(
                curve,
                { range, target, lookahead },
                random
              );
              const label = `${range.join("-")} ${shape} ${target} ${lookahead}`;

              expect(ahead.result, label).toEqual(alone.result);
              expect(ahead.encoded, label).toEqual(
                expect.arrayContaining(alone.encoded)
              );
              expect(new Set(ahead.encoded).size, label).toBe(
                ahead.encoded.length
              );
            }
          }
        }
      }
    });

    it("starts what it could need next while it waits, as far as it may", async () => {
      const { held, encode, release } = createHeldEncoder();
      const lookahead = vi.fn(() => 2);
      const search = searchQuality({
        encode,
        score: createScorer((quality) => quality),
        target: 5,
        range: [0, 10],
        lookahead,
      });

      expect([...held.keys()]).toEqual([10, 5, 2]); // 5 if 10 passes, then 2 if 5 does too
      expect(held.get(10)?.context.speculative()).toBe(false);
      expect(held.get(5)?.context.speculative()).toBe(true);

      await release(10);

      expect(held.get(5)?.context.speculative()).toBe(false); // reached
      expect([...held.keys()]).toEqual([10, 5, 2, 8]); // 2 if 5 passes, 8 if it fails
      expect(lookahead).toHaveBeenCalledTimes(2); // once a step

      for (const quality of [5, 2, 4, 6]) {
        await release(quality);
      }
      await expect(search).resolves.toMatchObject({ chosen: { quality: 5 } });
    });

    it("drops what it can no longer reach, and what's left when it's done", async () => {
      const { encode, release, droppedOf } = createHeldEncoder();
      const search = searchQuality({
        encode,
        score: createScorer((quality) => quality),
        target: 5,
        range: [0, 10],
        lookahead: () => 2,
      });

      await release(10);
      await release(5); // passes, so 8 is out of reach

      expect(droppedOf()).toEqual([8]);

      for (const quality of [2, 4, 6]) {
        await release(quality); // the sequential path
      }

      await expect(search).resolves.toMatchObject({ chosen: { quality: 5 } });
      expect(droppedOf().toSorted((first, second) => first - second)).toEqual([
        1, 3, 8,
      ]);
    });

    it("follows the outcome of an attempt that finished ahead of need, starting nothing it can't reach", async () => {
      const { held, encode, release } = createHeldEncoder();
      const search = searchQuality({
        encode,
        score: createScorer((quality) => quality),
        target: 5,
        range: [0, 10],
        lookahead: () => 2,
      });

      await release(5); // passes before the search reaches it
      await release(10);

      expect([...held.keys()]).toEqual([10, 5, 2, 1, 4]); // 8 only if 5 failed

      for (const quality of [2, 4, 6]) {
        await release(quality);
      }
      await expect(search).resolves.toMatchObject({ chosen: { quality: 5 } });
    });

    it("starts nothing more once its signal aborts, and drops what's ahead", async () => {
      const { held, encode, release, droppedOf } = createHeldEncoder();
      const controller = new AbortController();
      const search = searchQuality({
        encode,
        score: createScorer((quality) => quality),
        target: 5,
        range: [0, 10],
        lookahead: () => 2,
        signal: controller.signal,
      });
      const stopped = expect(search).rejects.toThrow("Stopped");

      controller.abort(new Error("Stopped"));
      await release(10);

      await stopped;
      expect([...held.keys()]).toEqual([10, 5, 2]);
      expect(droppedOf()).toEqual([10, 5, 2]); // the search's own signal reaches them all
    });

    it("fails only when an attempt it reaches fails", async () => {
      const { encode } = createEncoder();
      const failingAt = (failing: number) => (quality: number) =>
        quality === failing
          ? Promise.reject(new Error(`No ${failing}`))
          : encode(quality);
      const options = {
        score: createScorer((quality) => quality),
        target: 5,
        range: [0, 10],
        lookahead: () => 2,
      } as const;

      await expect(
        searchQuality({ ...options, encode: failingAt(8) }) // started ahead, never reached
      ).resolves.toMatchObject({ chosen: { quality: 5 } });
      await expect(
        searchQuality({ ...options, encode: failingAt(2) })
      ).rejects.toThrow("No 2");
    });
  });
});
