import { describe, expect, it } from "vitest";
import { verdictFor } from "../../src/metrics/index.js";

describe("verdictFor", () => {
  it.each([
    [100, "visually-lossless"],
    [90, "visually-lossless"],
    [89.99, "excellent"],
    [85, "excellent"],
    [84.99, "very-high"],
    [80, "very-high"],
    [79.99, "high"],
    [70, "high"],
    [69.99, "noticeable"],
    [50, "noticeable"],
    [49.99, "obvious"],
    [-20, "obvious"],
  ] as const)("maps %d to %s", (score, verdict) => {
    expect(verdictFor(score)).toBe(verdict);
  });
});
