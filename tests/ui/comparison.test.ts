import { describe, expect, it } from "vitest";
import type { PipelineFileResult } from "../../src/pipeline/types.js";
import {
  canCompare,
  comparedOutputs,
  currentOutput,
  outputTitle,
  qualitySliderOf,
} from "../../ui/src/comparison.js";
import { sameResult, suiteResult } from "./results.js";

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
  it("orders a suite's outputs WebP, AVIF, then the fallback", () => {
    const file = suiteResult();

    if (!canCompare(file)) {
      throw new Error("the suite result should be comparable");
    }
    expect(comparedOutputs(file).map((output) => output.role)).toEqual([
      "webp",
      "avif",
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

describe("qualitySliderOf", () => {
  it("starts a lossy output at its quality, another at the top of the range, and a lossless format at none", () => {
    const [avif, webp, png] = suiteResult().outputs;
    const [jpegStrip] = sameResult().outputs;

    expect(avif && qualitySliderOf(avif)).toEqual({
      format: "avif",
      range: [20, 90],
      start: 52,
    });
    expect(webp && qualitySliderOf(webp)?.start).toBe(71);
    expect(jpegStrip && qualitySliderOf(jpegStrip)).toEqual({
      format: "jpeg",
      range: [40, 95],
      start: 95,
    });
    expect(png && qualitySliderOf(png)).toBeUndefined();
  });
});

describe("currentOutput", () => {
  it("describes a re-encode as the output it replaces in the pane", () => {
    const [, webp] = suiteResult().outputs;

    if (webp === undefined) {
      throw new Error("the suite result should have a WebP");
    }
    expect(currentOutput(webp, undefined)).toBe(webp);
    expect(
      currentOutput(webp, {
        ref: "session/encodes/1/cat.webp",
        format: "webp",
        quality: 55,
        bytes: 8_000,
        saving: 0.92,
        score: 78.5,
        verdict: "high",
        warnings: [],
      })
    ).toEqual({
      ...webp,
      path: "session/encodes/1/cat.webp",
      method: "lossy",
      quality: 55,
      bytes: 8_000,
      saving: 0.92,
      score: 78.5,
      verdict: "high",
    });
  });
});
