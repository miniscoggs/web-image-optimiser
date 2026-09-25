import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeModule = { score: () => number };

const moduleCache: Record<string, FakeModule> = {};
let loads = 0;
let nextScore: () => number = () => 50;

// a fake require whose module scores through nextScore, so a test can make the wasm trap
const fakeRequire = Object.assign(
  (path: string) => {
    loads++;
    moduleCache[path] = { score: () => nextScore() };
    return moduleCache[path];
  },
  { resolve: (path: string) => path, cache: moduleCache }
);

vi.doMock("node:module", () => ({ createRequire: () => fakeRequire }));

const { default: scoreSsimulacra2 } =
  await import("../../src/metrics/ssimulacra2.js");

const pixels = new Uint8Array(8 * 8 * 3);

describe("scoreSsimulacra2", () => {
  beforeEach(() => {
    nextScore = () => 50;
  });

  it("loads the module once and reuses it", () => {
    const before = loads;

    scoreSsimulacra2(pixels, pixels, 8, 8);
    scoreSsimulacra2(pixels, pixels, 8, 8);

    expect(loads - before).toBeLessThanOrEqual(1);
  });

  it("loads a fresh module after a trap", () => {
    scoreSsimulacra2(pixels, pixels, 8, 8);
    const before = loads;
    nextScore = () => {
      throw Object.assign(new Error("unreachable"), { name: "RuntimeError" }); // what a wasm trap throws
    };

    expect(() => scoreSsimulacra2(pixels, pixels, 8, 8)).toThrow("unreachable");
    expect(Object.keys(moduleCache)).toHaveLength(0);

    nextScore = () => 50;
    expect(scoreSsimulacra2(pixels, pixels, 8, 8)).toBe(50);
    expect(loads - before).toBe(1);
  });

  it("keeps the module after an ordinary error", () => {
    scoreSsimulacra2(pixels, pixels, 8, 8);
    const before = loads;
    nextScore = () => {
      throw new Error("Expected 8x8x3 bytes of RGB pixels, got 1");
    };

    expect(() => scoreSsimulacra2(pixels, pixels, 8, 8)).toThrow(/Expected/);

    nextScore = () => 50;
    scoreSsimulacra2(pixels, pixels, 8, 8);
    expect(loads - before).toBe(0);
  });
});
