import { describe, expect, it } from "vitest";
import keptBySuiteChain from "../../src/pipeline/suiteChain.js";

describe("keptBySuiteChain", () => {
  it.each([
    ["each smaller than the one before", [300, 200, 100], [true, true, true]],
    [
      "a WebP no smaller than the fallback",
      [200, 200, 100],
      [true, false, true],
    ],
    ["an AVIF larger than the WebP", [300, 100, 200], [true, true, false]],
    [
      "an AVIF between them, once the WebP is dropped",
      [200, 300, 100],
      [true, false, true],
    ],
    ["no fallback", [undefined, 300, 100], [false, true, true]],
    ["no WebP", [300, undefined, 400], [true, false, false]],
  ])("keeps %s", (_name, sizes, kept) => {
    expect(keptBySuiteChain(sizes)).toEqual(kept);
  });
});
