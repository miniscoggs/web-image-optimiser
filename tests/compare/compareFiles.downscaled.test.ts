import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.doMock("../../src/metrics/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/metrics/index.js")>()),
  isDownscaledForScoring: () => true, // as for images over 26 MP
}));

const { compareFiles } = await import("../../src/compare/index.js");

const PAIR_DIR = new URL("../../fixtures/ssimulacra2/", import.meta.url);

describe("compareFiles on images too large to score at full size", () => {
  it("warns with W_SCORED_DOWNSCALED", async () => {
    const result = await compareFiles(
      fileURLToPath(new URL("butterfly.png", PAIR_DIR)),
      fileURLToPath(new URL("butterfly-q60.webp", PAIR_DIR))
    );

    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "W_SCORED_DOWNSCALED",
    ]);
  });
});
