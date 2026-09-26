import { describe, expect, it } from "vitest";
import { searchQuality } from "../../src/search/index.js";

type FakeCandidate = { bytes: Uint8Array; quality: number };

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
});
