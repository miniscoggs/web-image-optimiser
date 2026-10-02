import { availableParallelism, totalmem } from "node:os";
import { describe, expect, it } from "vitest";
import {
  defaultConcurrency,
  laneScorers,
  libuvThreads,
} from "../../src/pipeline/concurrency.js";

describe("defaultConcurrency", () => {
  it("leaves a CPU free, and gives each score 4 GiB of memory", () => {
    const concurrency = defaultConcurrency();

    expect(concurrency).toBeGreaterThanOrEqual(1);
    expect(concurrency).toBeLessThanOrEqual(
      Math.max(1, availableParallelism() - 1)
    );
    expect(concurrency).toBeLessThanOrEqual(
      Math.max(1, totalmem() / 4 / 1024 ** 3)
    );
  });
});

describe("laneScorers", () => {
  it.each<[number, number, number[]]>([
    [9, 1, [9]],
    [9, 2, [5, 4]],
    [9, 4, [3, 2, 2, 2]],
    [8, 3, [3, 3, 2]],
    [3, 3, [1, 1, 1]],
    [3, 20, [1, 1, 1]],
    [1, 1, [1]],
    [1, 5, [1]],
    [9, 0, []],
  ])(
    "splits a concurrency of %i over %i files as %j",
    (concurrency, files, expected) => {
      expect(laneScorers(concurrency, files)).toEqual(expected);
    }
  );

  it("runs exactly as many scores at once as the concurrency, given a file", () => {
    for (let concurrency = 1; concurrency <= 16; concurrency += 1) {
      for (let files = 1; files <= 20; files += 1) {
        const scorers = laneScorers(concurrency, files);

        expect(scorers).toHaveLength(Math.min(concurrency, files));
        expect(scorers.reduce((sum, count) => sum + count, 0)).toBe(
          concurrency
        );
      }
    }
  });
});

describe("libuvThreads", () => {
  it.each([
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 6],
    [9, 13],
  ])("gives %i scorers %i threads", (scorers, expected) => {
    expect(libuvThreads(scorers)).toBe(expected);
  });
});
