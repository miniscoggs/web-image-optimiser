import { describe, expect, it } from "vitest";
import type { PipelineFileResult } from "../../src/pipeline/types.js";
import {
  canCompare,
  cappedWidth,
  comparedOutputs,
  outputTitle,
} from "../../ui/src/comparison.js";
import { suiteResult } from "./results.js";

describe("canCompare", () => {
  it("needs outputs and the image's size", () => {
    const failed: PipelineFileResult = {
      input: "root/a.png",
      status: "failed",
      outputs: [],
      warnings: [],
      error: { code: "E_ANIMATED", message: "Animated" },
    };
    const sizeless = { ...suiteResult(), width: undefined };

    expect(canCompare(suiteResult())).toBe(true);
    expect(canCompare(failed)).toBe(false);
    expect(canCompare(sizeless)).toBe(false);
  });
});

describe("comparedOutputs", () => {
  it("orders a suite's outputs AVIF, WebP, then the fallback", () => {
    const file = suiteResult();

    if (!canCompare(file)) {
      throw new Error("the suite result should be comparable");
    }
    expect(comparedOutputs(file).map((output) => output.role)).toEqual([
      "avif",
      "webp",
      "fallback",
    ]);
  });
});

describe("outputTitle", () => {
  it("names an output by its format, and the fallback as one", () => {
    expect(outputTitle({ role: "avif", format: "avif" })).toBe("AVIF");
    expect(outputTitle({ role: "same", format: "jpeg" })).toBe("JPEG");
    expect(outputTitle({ role: "fallback", format: "png" })).toBe(
      "PNG fallback"
    );
  });
});

describe("cappedWidth", () => {
  it("gives the width outputs were capped at, and none when they are as wide as the original", () => {
    const file = suiteResult();

    if (!canCompare(file)) {
      throw new Error("the suite result should be comparable");
    }
    expect(cappedWidth(file)).toBeUndefined();
    expect(
      cappedWidth({
        ...file,
        outputs: file.outputs.map((output) => ({ ...output, width: 32 })),
      })
    ).toBe(32);
  });
});
